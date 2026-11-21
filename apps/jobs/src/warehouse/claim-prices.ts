import {
  type CoinGeckoConfig,
  CoinGeckoError,
  coingeckoIds,
  decimalFromNumber,
} from "@matchbox/api/market/coingecko"
import {
  addDays,
  type ClaimPrices,
  type CoverageState,
  claimPricesCursor,
  coverageStamp,
  dayStart,
  type HistoryToken,
  historyTokens,
  isMissingTable,
  latestSettledDay,
  parseCoverage,
  settleDays,
  utcDay,
  valueClaim,
} from "@matchbox/api/read-models/claim-prices"
import { readModelEtag } from "@matchbox/api/read-store"
import { activityRowSchema } from "@matchbox/contracts/read-models"
import { EPOCH_ZERO_START } from "@matchbox/domain"
import type { Logger } from "@matchbox/logger"
import { z } from "zod"
import { readCursor, writeCursor } from "../cursors"

// Claims' values when claimed (apps/api/src/read-models/claim-prices.ts).
//
// 1. `fillDailyPrices`: BTC's and MEZO's price at 00:00 UTC each day, from
//    CoinGecko's `/coins/{id}/market_chart/range` with `interval=daily`, into
//    READ_DB `token_price_daily`, once. At most one call a token a run, and
//    only when a new day has settled: in practice one call a token a day.
//    CoinGecko revises a day for up to 2 days, so a day is stored when it is
//    `settleDays` old and never rewritten. A failed call stores nothing and
//    is not tried again for `retrySeconds`; it never fails the run. An
//    answer that misses a day after the token's first point (an empty or
//    cut short list) checks the days before the gap only, and the rest
//    waits `retrySeconds` too, unless the day is over a week settled and
//    the answer goes on past it: that is checked with no price
//    (`checkedThrough`).
// 2. `fillClaimValues`: stored history rows (wallet_activity_rows) written
//    before their claim's day was priced get `atClaim`. A pass walks every
//    stored claim through the claims index, a page a run within what the
//    run's history budget left, and a new pass starts when more days are
//    checked.
//
// Reach: a Demo or keyless key reads only the past 365 days (CoinGecko
// docs, read 20 Nov 2026), so a day older than that when first asked for
// is checked with no price. Epoch 0 (11 Dec 2025) is within reach until
// 11 Dec 2026.

const network = "mezo"

export { settleDays }

/** A failed history call is not tried again for this long. */
export const retrySeconds = 6 * 3_600

/** The first day asked for: a week before Epoch 0, the first activity. */
export const historyStartDay = addDays(utcDay(EPOCH_ZERO_START), -8)

/** Days one call asks for at most (the Demo reach). */
export const maxDaysPerCall = 364

/** A history call gives up after this long; the run goes on. */
export const historyTimeoutMs = 8_000

const coingeckoIdOf: Record<HistoryToken, string> = {
  btc: "bitcoin",
  mezo: coingeckoIds.mezo,
}

/** A daily point is a day's when it is this close after 00:00 UTC. */
const pointTolerance = 300

const publicBase = "https://api.coingecko.com/api/v3"
const proBase = "https://pro-api.coingecko.com/api/v3"

/** The range request, the key in a header (never the URL). */
export function rangeRequest(
  token: HistoryToken,
  from: number,
  to: number,
  config: CoinGeckoConfig,
): { url: string; headers: Record<string, string> } {
  const base =
    config.apiKey !== null && config.plan === "pro" ? proBase : publicBase
  const query = new URLSearchParams({
    vs_currency: "usd",
    from: String(from),
    to: String(to),
    interval: "daily",
    precision: "full",
  })
  const headers: Record<string, string> = { accept: "application/json" }
  if (config.apiKey !== null) {
    headers[config.plan === "pro" ? "x-cg-pro-api-key" : "x-cg-demo-api-key"] =
      config.apiKey
  }
  return {
    url: `${base}/coins/${coingeckoIdOf[token]}/market_chart/range?${query}`,
    headers,
  }
}

const rangeBodySchema = z.object({
  prices: z.array(z.tuple([z.number(), z.number()])),
})

/** Reads a token's daily points between two times; throws on failure. */
export type PriceHistoryFetch = (
  token: HistoryToken,
  from: number,
  to: number,
) => Promise<unknown>

/** The CoinGecko reader the Worker uses. */
export function coingeckoHistory(config: CoinGeckoConfig): PriceHistoryFetch {
  return async function fetchHistory(token, from, to) {
    const request = rangeRequest(token, from, to, config)
    const response = await fetch(request.url, {
      headers: request.headers,
      signal: AbortSignal.timeout(historyTimeoutMs),
    })
    if (!response.ok) throw new CoinGeckoError(response.status)
    return response.json()
  }
}

/**
 * The day's price from a range body: the first point within a few minutes
 * after 00:00 UTC, for days `from` to `through`. Prices are JSON numbers,
 * kept as their exact decimal text.
 */
export function dailyPoints(
  body: unknown,
  from: string,
  through: string,
): Map<string, { usd: string; at: number }> {
  const parsed = rangeBodySchema.parse(body)
  const found = new Map<string, { usd: string; at: number }>()
  for (const [ms, price] of parsed.prices) {
    const at = Math.floor(ms / 1000)
    const day = utcDay(at)
    if (day < from || day > through) continue
    if (at - dayStart(day) >= pointTolerance) continue
    const usd = decimalFromNumber(price)
    if (usd === null || /^0(\.0*)?$/.test(usd)) continue
    const known = found.get(day)
    if (known === undefined || at < known.at) found.set(day, { usd, at })
  }
  return found
}

/** What one token's step would ask for this run; null when nothing. */
export function nextRequest(input: {
  state: CoverageState | null
  nowSeconds: number
  /** Demo and keyless keys reach back 365 days. */
  limitedReach: boolean
}): { from: string; askFrom: string; through: string } | null {
  const { state, nowSeconds } = input
  if (state?.retryAt !== undefined && nowSeconds < state.retryAt) return null
  const latest = latestSettledDay(nowSeconds)
  const from = state?.from ?? historyStartDay
  const first = state === null ? from : addDays(state.through, 1)
  if (first > latest) return null
  // Days before the reach are checked with no price.
  const reach = addDays(utcDay(nowSeconds), -maxDaysPerCall)
  let askFrom = input.limitedReach && first < reach ? reach : first
  // The first point is tested again by every call: it asks for the days
  // before it too, as far back as one call reaches. An answer that once
  // came back without the first days is put right by the next one.
  const probe = [
    from,
    input.limitedReach ? reach : from,
    addDays(latest, 1 - maxDaysPerCall),
  ].sort()[2]
  if (
    state?.pricedFrom !== undefined &&
    probe !== undefined &&
    probe < state.pricedFrom &&
    probe < askFrom
  ) {
    askFrom = probe
  }
  const last = addDays(askFrom, maxDaysPerCall - 1)
  return { from, askFrom, through: earlierDay(last, latest) }
}

/** The earlier of two `YYYY-MM-DD` days (they sort as text). */
function earlierDay(a: string, b: string): string {
  if (a < b) return a
  return b
}

const rowsPerStatement = 16

function insertStatements(
  db: D1Database,
  token: HistoryToken,
  points: Map<string, { usd: string; at: number }>,
  nowSeconds: number,
): D1PreparedStatement[] {
  const entries = [...points]
  const statements: D1PreparedStatement[] = []
  // 16 rows of 6 parameters a statement: D1 binds at most 100.
  for (let start = 0; start < entries.length; start += rowsPerStatement) {
    const slice = entries.slice(start, start + rowsPerStatement)
    const values = slice
      .map((_, index) => {
        const base = index * 6
        return `(?${base + 1}, ?${base + 2}, ?${base + 3}, ?${base + 4}, ?${base + 5}, ?${base + 6})`
      })
      .join(", ")
    statements.push(
      db
        .prepare(
          `INSERT INTO token_price_daily
             (token, day, usd, source, priced_at, updated_at)
           VALUES ${values}
           ON CONFLICT (token, day) DO NOTHING`,
        )
        .bind(
          ...slice.flatMap(([day, point]) => [
            token,
            day,
            point.usd,
            "coingecko",
            point.at,
            nowSeconds,
          ]),
        ),
    )
  }
  return statements
}

function cursorStatement(
  db: D1Database,
  token: HistoryToken,
  state: CoverageState,
  nowSeconds: number,
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO job_cursors (job, network, value, updated_at)
       VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT (job, network) DO UPDATE SET
         value = excluded.value, updated_at = excluded.updated_at`,
    )
    .bind(claimPricesCursor(token), network, JSON.stringify(state), nowSeconds)
}

export type DailyFillResult = {
  /** CoinGecko calls made. */
  calls: number
  /** Price rows sent (rows already stored are left alone). */
  rows: number
  failed: HistoryToken[]
}

/**
 * One step of each token's daily history: at most one call a token, the
 * rows and the coverage in one D1 batch. Never throws for the source: a
 * failed call (an error, a timeout, a 429) or an unreadable body stores
 * nothing and waits `retrySeconds`. A D1 failure throws (the caller logs).
 */
export async function fillDailyPrices(input: {
  db: D1Database
  fetchHistory: PriceHistoryFetch
  limitedReach: boolean
  nowSeconds: number
  logger: Logger
}): Promise<DailyFillResult> {
  const { db, nowSeconds } = input
  const result: DailyFillResult = { calls: 0, rows: 0, failed: [] }
  // Before migration 0008 nothing could be stored: no call is spent.
  try {
    await db.prepare("SELECT 1 FROM token_price_daily LIMIT 1").first()
  } catch (error) {
    if (isMissingTable(error)) return result
    throw error
  }
  for (const token of historyTokens) {
    const state = parseCoverage(
      await readCursor(db, claimPricesCursor(token), network),
    )
    const request = nextRequest({
      state,
      nowSeconds,
      limitedReach: input.limitedReach,
    })
    if (request === null) continue
    result.calls += 1
    let points: Map<string, { usd: string; at: number }>
    try {
      const body = await input.fetchHistory(
        token,
        dayStart(request.askFrom) - 3_600,
        dayStart(request.through) + 3_600,
      )
      points = dailyPoints(body, request.askFrom, request.through)
    } catch (error) {
      result.failed.push(token)
      input.logger.warn({
        message: "claim_prices_history_failed",
        // Not `token`: the logger redacts a field of that name.
        asset: token,
        detail:
          error instanceof Error ? error.message.slice(0, 200) : "Unknown",
      })
      const waiting: CoverageState = {
        from: state?.from ?? request.from,
        through: state?.through ?? addDays(request.from, -1),
        ...(state?.pricedFrom === undefined
          ? {}
          : { pricedFrom: state.pricedFrom }),
        retryAt: nowSeconds + retrySeconds,
      }
      await cursorStatement(db, token, waiting, nowSeconds).run()
      continue
    }
    const checked = checkedThrough({ state, request, points, nowSeconds })
    for (const day of checked.missing) {
      input.logger.warn({
        message: "claim_prices_day_missing",
        asset: token,
        day,
      })
    }
    if (checked.gap !== null) {
      result.failed.push(token)
      input.logger.warn({
        message: "claim_prices_history_failed",
        // Not `token`: the logger redacts a field of that name.
        asset: token,
        detail: `No daily point for ${checked.gap}`,
      })
    }
    await db.batch([
      ...insertStatements(db, token, points, nowSeconds),
      cursorStatement(db, token, checked.state, nowSeconds),
    ])
    result.rows += points.size
  }
  return result
}

/** A day missing this long before the latest settled day: no price. */
export const missingDayGraceDays = 7

/**
 * How far an answer checks a token's days. Days before its first daily
 * point are checked with no price; the first point is the earliest one
 * returned, once known. From there every day must have a point: the first
 * missing one (an empty or cut short answer) ends what is checked, and the
 * rest is asked for again after `retrySeconds`.
 *
 * Except a hole CoinGecko does not fill: a day missing more than
 * `missingDayGraceDays` before the latest settled day, with a point after
 * it in the same answer, is checked with no price (`missing`) and the walk
 * goes on. Without that, one day CoinGecko never fills would hold every
 * later day pending for good. A later answer that has the day stores it,
 * and its claims are valued again (`valueClaim`). A day after the last
 * point (a cut short answer) is never taken as no price.
 */
export function checkedThrough(input: {
  state: CoverageState | null
  request: { from: string; askFrom: string; through: string }
  points: ReadonlyMap<string, unknown>
  nowSeconds: number
}): { state: CoverageState; gap: string | null; missing: string[] } {
  const { state, request, points } = input
  const before = state?.through ?? addDays(request.from, -1)
  const earliest = [...points.keys()].sort()[0]
  let pricedFrom = state?.pricedFrom
  if (
    earliest !== undefined &&
    (pricedFrom === undefined || earliest < pricedFrom)
  ) {
    pricedFrom = earliest
  }
  // No point at all and none known before: nothing is checked.
  if (pricedFrom === undefined) {
    return {
      state: {
        from: request.from,
        through: before,
        retryAt: input.nowSeconds + retrySeconds,
      },
      gap: request.askFrom,
      missing: [],
    }
  }
  let through = request.through
  let gap: string | null = null
  const missing: string[] = []
  const days = [...points.keys()].sort()
  const lastPoint = days.at(-1) ?? pricedFrom
  const grace = addDays(
    latestSettledDay(input.nowSeconds),
    -missingDayGraceDays,
  )
  // Days already checked stay checked; the walk starts after them.
  const start = [addDays(before, 1), request.askFrom, pricedFrom].sort()[2]
  for (
    let day = start ?? request.through;
    day <= request.through;
    day = addDays(day, 1)
  ) {
    if (points.has(day)) continue
    if (day < grace && day < lastPoint) {
      missing.push(day)
      continue
    }
    gap = day
    through = addDays(day, -1)
    break
  }
  if (through < before) through = before
  return {
    state: {
      from: request.from,
      through,
      pricedFrom,
      ...(gap === null ? {} : { retryAt: input.nowSeconds + retrySeconds }),
    },
    gap,
    missing,
  }
}

// ---------------------------------------------------------------------------
// Stored rows
// ---------------------------------------------------------------------------

/** Where the pass over stored claims is, in `job_cursors`. */
export const claimValuesCursor = "claim-values-fill"

const passSchema = z.object({
  /** The last claim looked at; null at the start of a pass. */
  after: z
    .object({ wallet: z.string(), ts: z.number().int(), id: z.string() })
    .nullable(),
  done: z.boolean(),
  /** The coverage the pass started with (`coverageStamp`). */
  stamp: z.string(),
})

export type ClaimValuesPass = z.infer<typeof passSchema>

function parsePass(value: string | null): ClaimValuesPass | null {
  if (value === null) return null
  try {
    const parsed = passSchema.safeParse(JSON.parse(value))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

/** Claims read a run at most, beside the writes the budget allows. */
export const claimValueReadsPerRun = 500

const storedClaimSchema = z.object({
  wallet: z.string(),
  sort_ts: z.number().int(),
  row_id: z.string(),
  body: z.string(),
  etag: z.string(),
})

export type ClaimValuesResult = {
  /** Stored claims read and rows given their value this run. */
  read: number
  written: number
  /** The pass reached the last stored claim. */
  done: boolean
}

/**
 * Gives stored claim rows their value when claimed, in the claims index's
 * order (wallet, then time), at most `budget` rows written and
 * `claimValueReadsPerRun` read a run. Rows whose day is not checked yet
 * are passed over and looked at again in the next pass, which starts once
 * the coverage moves (about once a day). A row valued "No price" for a
 * day that has a price now is valued again in the same way. A row
 * rewritten since it was read (its etag changed) is left for the next
 * pass.
 */
export async function fillClaimValues(input: {
  db: D1Database
  prices: ClaimPrices
  budget: number
  nowSeconds: number
}): Promise<ClaimValuesResult> {
  const { db } = input
  const stamp = coverageStamp(input.prices)
  const stored = parsePass(await readCursor(db, claimValuesCursor, network))
  let pass: ClaimValuesPass
  if (stored === null || (stored.done && stored.stamp !== stamp)) {
    pass = { after: null, done: false, stamp }
  } else if (stored.done) {
    return { read: 0, written: 0, done: true }
  } else {
    pass = stored
  }
  if (input.budget < 1) return { read: 0, written: 0, done: false }
  const after = pass.after ?? { wallet: "", ts: -1, id: "" }
  const { results } = await db
    .prepare(
      `SELECT wallet, sort_ts, row_id, body, etag
       FROM wallet_activity_rows INDEXED BY wallet_activity_rows_claims
       WHERE network = ?1 AND category = 'claims'
         AND (wallet, sort_ts, row_id) > (?2, ?3, ?4)
       ORDER BY wallet, sort_ts, row_id LIMIT ?5`,
    )
    .bind(network, after.wallet, after.ts, after.id, claimValueReadsPerRun)
    .all()
  const statements: D1PreparedStatement[] = []
  let last: ClaimValuesPass["after"] = pass.after
  let read = 0
  for (const raw of results) {
    if (statements.length >= input.budget) break
    const row = storedClaimSchema.parse(raw)
    read += 1
    last = { wallet: row.wallet, ts: row.sort_ts, id: row.row_id }
    const activity = activityRowSchema.parse(JSON.parse(row.body))
    if (activity.type !== "claim") continue
    // A recorded value comes back as it is, unless a "No price" in it
    // has a price now (valueClaim): only those rows are rewritten.
    const value = valueClaim(activity, input.prices)
    if (value === null || value === activity.atClaim) continue
    const { estimate: _estimate, ...rest } = activity
    const valued = activityRowSchema.parse({ ...rest, atClaim: value })
    statements.push(
      db
        .prepare(
          `UPDATE wallet_activity_rows
           SET body = ?1, etag = ?2, updated_at = ?3
           WHERE network = ?4 AND wallet = ?5 AND sort_ts = ?6
             AND row_id = ?7 AND etag = ?8`,
        )
        .bind(
          JSON.stringify(valued),
          await readModelEtag(valued),
          input.nowSeconds,
          network,
          row.wallet,
          row.sort_ts,
          row.row_id,
          row.etag,
        ),
    )
  }
  const done = read === results.length && results.length < claimValueReadsPerRun
  const next: ClaimValuesPass = { after: last, done, stamp: pass.stamp }
  let written = 0
  for (let start = 0; start < statements.length; start += 50) {
    const batch = await db.batch(statements.slice(start, start + 50))
    for (const each of batch) written += each.meta.changes
  }
  await writeCursor(
    db,
    claimValuesCursor,
    network,
    JSON.stringify(next),
    input.nowSeconds,
  )
  return { read, written, done }
}
