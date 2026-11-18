import { BORROW_CONTRACTS, CONTRACTS, MUSD_CONTRACTS } from "@matchbox/chain"
import {
  type ScanBorrowCollateral,
  type ScanBorrowTotals,
  type ScanBorrowTotalsReason,
  type ScanBorrowVenue,
  type ScanEnclaveEventItem,
  scanBorrowTotalsDays,
} from "@matchbox/contracts/scan"
import { PlatformError } from "@matchbox/server"
import type { Hono } from "hono"
import { z } from "zod"
import { callerOf } from "../blockscout/endpoint"
import type { ApiEnv } from "../context"
import { tokenRegistry } from "../read-models/token-registry"
import {
  marketRowSchema,
  positionRowSchema,
  rowOf,
  troveRowSchema,
} from "./borrow"
import { queryOf, type ScanContext } from "./context"
import { enclaveItem, lockItem, RowShapeError } from "./items"
import { knownMarketDecimals, marketDecimalsOf } from "./market-decimals"
import { maxKey, scanQueries } from "./queries"

// /internal/scan/borrow/totals: MUSD owed across Mezo's three borrow venues,
// for the homepage's "Borrowed" figure (README, "Borrow totals").
//
// - Troves: open troves' principal plus interest (READ_DB live snapshot).
// - Enclaves: open positions' principal after their latest event
//   (enclave_events). Interest accrues with no event, so it is left out.
// - Morpho markets that lend MUSD: total borrow assets (READ_DB). A market
//   lending another token (mUSDC) is listed as excluded, in its own token.
//
// One unit, MUSD base units, summed in bigint. Nothing is priced: there is
// no MUSD or mUSDC price source, and a stablecoin is never taken as $1. A
// venue that cannot be read makes `total` null, never a smaller number.
// History: the daily closes the jobs Worker writes (musd.trove_debt,
// morpho.total_borrow per MUSD market) and Enclave principal at each day's
// end from the same events; today's point is the live total.
//
// Collateral: the BTC behind the loans Borrowed counts (open troves, the
// veBTC open Enclave positions pledge, BTC-collateral positions in the
// MUSD markets) and those markets' positions that owe, for the
// homepage's "BTC collateral" and "Open positions". Troves and markets
// come from the same reads as their debt.

const network = "mezo"

/** The unit of every summed amount: MUSD, with its registered decimals. */
function musdUnit(): ScanBorrowTotals["unit"] {
  const entry = tokenRegistry.get(MUSD_CONTRACTS.mainnet.musd.toLowerCase())
  if (entry === undefined) throw new Error("MUSD is not in the token registry")
  return {
    symbol: "MUSD",
    token: entry.token.address.toLowerCase(),
    decimals: entry.token.decimals,
  }
}

const unit = musdUnit()

/** Open troves read per statement, and statements at most (1,000). */
const trovePage = 100
const trovePages = 10
/** Enclave positions walked at most (four exist, all governance-made). */
const maxPositions = 25
/** Enclave events read per position for the history, per page and pages. */
const eventPage = 100
const eventPages = 3

const dayMs = 86_400_000
const wad = 10n ** 18n

const btcToken = BORROW_CONTRACTS.mainnet.btc.toLowerCase()
const veBtc = CONTRACTS.mainnet.veBTC.toLowerCase()

/** A bounded read stopped before the end of its rows. */
class IncompleteRead extends Error {
  constructor(readonly what: string) {
    super(`More ${what} than one answer reads`)
    this.name = "IncompleteRead"
  }
}

type Part<T> =
  | { status: "ok"; data: T }
  | { status: "unavailable"; reason: ScanBorrowTotalsReason }

/** Reasons that hold for everyone until config or data change. */
const shareableReasons: ReadonlySet<ScanBorrowTotalsReason> = new Set([
  "disabled",
  "incomplete",
])

async function partOf<T>(
  scan: ScanContext,
  name: string,
  read: () => Promise<T>,
): Promise<Part<T>> {
  try {
    return { status: "ok", data: await read() }
  } catch (error) {
    if (error instanceof PlatformError && error.code === "service_disabled") {
      return { status: "unavailable", reason: "disabled" }
    }
    if (error instanceof RowShapeError) {
      scan.deps.logger.error({
        message: "Borrow totals row failed its schema",
        part: name,
        table: error.table,
      })
      return { status: "unavailable", reason: "schema" }
    }
    if (error instanceof IncompleteRead) {
      scan.deps.logger.warn({ message: error.message, part: name })
      return { status: "unavailable", reason: "incomplete" }
    }
    scan.deps.logger.warn({
      message: "Borrow totals part failed",
      part: name,
      error,
    })
    return { status: "unavailable", reason: "upstream" }
  }
}

/** Every row mapped, or a RowShapeError: a total missing a row is wrong. */
function everyRow<Row>(
  scan: ScanContext,
  raws: readonly unknown[],
  map: (raw: unknown) => Row,
  table: string,
): Row[] {
  const mapped = scan.mapRows(raws, map)
  if (mapped.skipped > 0) throw new RowShapeError(table)
  return mapped.rows
}

function dayOf(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

function dayStart(day: string): number {
  return Date.parse(`${day}T00:00:00Z`) / 1000
}

// -- live venues --------------------------------------------------------------

type TrovesTotal = Extract<
  ScanBorrowTotals["venues"]["troves"],
  { status: "ok" }
>["data"]

/** The open troves' total, and their collateral (BTC base units). */
async function trovesTotal(
  scan: ScanContext,
): Promise<{ total: TrovesTotal; collateral: bigint }> {
  let principal = 0n
  let interest = 0n
  let collateral = 0n
  let open = 0
  let block: number | null = null
  let after = ""
  for (let page = 0; ; page += 1) {
    if (page === trovePages) throw new IncompleteRead("open troves")
    // One row past the page says whether another page follows.
    const raws = await scan.rows(scanQueries.openTroves, [
      network,
      after,
      trovePage + 1,
    ])
    const rows = everyRow(
      scan,
      raws.slice(0, trovePage),
      (raw) => rowOf(troveRowSchema, raw, "troves"),
      "troves",
    )
    for (const row of rows) {
      principal += BigInt(row.principal_raw)
      interest += BigInt(row.interest_raw)
      collateral += BigInt(row.coll_raw)
      open += 1
      block = block === null ? row.block : Math.max(block, row.block)
    }
    const last = rows.at(-1)
    if (raws.length <= trovePage || last === undefined) break
    after = last.owner
  }
  return {
    total: {
      basis: "principal_plus_interest",
      debt: (principal + interest).toString(),
      principal: principal.toString(),
      interest: interest.toString(),
      open,
      block,
    },
    collateral,
  }
}

type MarketsTotal = Extract<
  ScanBorrowTotals["venues"]["markets"],
  { status: "ok" }
>["data"]

/** An included (MUSD) market's collateral side, for the collateral part. */
type IncludedMarket = {
  market_id: string
  collateral_token: string
  collateral_decimals: number | null
}

async function marketsTotal(
  scan: ScanContext,
): Promise<{ total: MarketsTotal; markets: IncludedMarket[] }> {
  const [raws, known] = await Promise.all([
    scan.rows(scanQueries.markets, [network]),
    knownMarketDecimals(scan),
  ])
  const rows = everyRow(
    scan,
    raws,
    (raw) => rowOf(marketRowSchema, raw, "morpho_markets"),
    "morpho_markets",
  )
  let debt = 0n
  const included: MarketsTotal["included"] = []
  const excluded: MarketsTotal["excluded"] = []
  const markets: IncludedMarket[] = []
  for (const row of rows) {
    const loanToken = row.loan_token.toLowerCase()
    const decimals = marketDecimalsOf(known, row).loan
    const entry = {
      market_id: row.market_id,
      loan_token: loanToken,
      borrowed: row.total_borrow_assets_raw,
      loan_decimals: decimals,
    }
    if (loanToken !== unit.token) {
      excluded.push({ ...entry, reason: "loan_token" })
    } else if (decimals !== unit.decimals) {
      // MUSD whose decimals did not resolve to the unit's: never assumed.
      excluded.push({ ...entry, reason: "decimals" })
    } else {
      included.push(entry)
      markets.push({
        market_id: row.market_id,
        collateral_token: row.collateral_token.toLowerCase(),
        collateral_decimals: marketDecimalsOf(known, row).collateral,
      })
      debt += BigInt(row.total_borrow_assets_raw)
    }
  }
  return {
    total: {
      basis: "total_borrow_assets",
      debt: debt.toString(),
      included,
      excluded,
    },
    markets,
  }
}

/** An Enclave event's position debt after it: 0 once closed. */
function principalAfter(event: ScanEnclaveEventItem): bigint {
  if (event.action === "POSITION_CLOSED") return 0n
  // Every row of a position carries its principal; one without is bad.
  if (event.principal === null) throw new RowShapeError("enclave_events")
  return BigInt(event.principal)
}

/**
 * The latest event of every Enclave position, one indexed row each
 * (enclaveNextPosition), in position id order.
 */
async function latestPerPosition(
  scan: ScanContext,
): Promise<ScanEnclaveEventItem[]> {
  const latest: ScanEnclaveEventItem[] = []
  let after = ""
  for (;;) {
    const raw = await scan.first(scanQueries.enclaveNextPosition, [after])
    if (raw === null) return latest
    if (latest.length === maxPositions) {
      throw new IncompleteRead("Enclave positions")
    }
    const [event] = everyRow(scan, [raw], enclaveItem, "enclave_events")
    if (event === undefined || event.position_id === null) {
      throw new RowShapeError("enclave_events")
    }
    latest.push(event)
    after = event.position_id
  }
}

type EnclavesTotal = Extract<
  ScanBorrowTotals["venues"]["enclaves"],
  { status: "ok" }
>["data"]

function enclavesTotal(latest: readonly ScanEnclaveEventItem[]): EnclavesTotal {
  let debt = 0n
  let open = 0
  let newest: ScanEnclaveEventItem | null = null
  for (const event of latest) {
    const owed = principalAfter(event)
    if (event.action !== "POSITION_CLOSED") open += 1
    debt += owed
    if (
      newest === null ||
      event.block_number > newest.block_number ||
      (event.block_number === newest.block_number &&
        event.log_index > newest.log_index)
    ) {
      newest = event
    }
  }
  return {
    basis: "principal",
    debt: debt.toString(),
    open,
    positions: latest.length,
    latest_block: newest?.block_number ?? null,
    latest_timestamp: newest?.timestamp ?? null,
  }
}

// -- collateral ---------------------------------------------------------------

type Collateral = ScanBorrowCollateral

/**
 * Positions read per market statement, and statements at most (300 a
 * market): past that the part is incomplete rather than a long read.
 */
const positionPage = 100
const positionPages = 3

/**
 * Every position of a market, paged by account: the collateral of all,
 * and how many owe anything.
 */
async function marketPositions(
  scan: ScanContext,
  market: string,
): Promise<{ collateral: bigint; open: number }> {
  let collateral = 0n
  let open = 0
  let after = ""
  for (let page = 0; ; page += 1) {
    if (page === positionPages) throw new IncompleteRead("Morpho positions")
    const raws = await scan.rows(scanQueries.positionsByMarket, [
      network,
      market,
      after,
      positionPage + 1,
    ])
    const rows = everyRow(
      scan,
      raws.slice(0, positionPage),
      (raw) => rowOf(positionRowSchema, raw, "morpho_positions"),
      "morpho_positions",
    )
    for (const row of rows) {
      collateral += BigInt(row.collateral_raw)
      if (row.borrow_shares_raw !== "0") open += 1
    }
    const last = rows.at(-1)
    if (raws.length <= positionPage || last === undefined) break
    after = last.account
  }
  return { collateral, open }
}

/** A collateral amount in `decimals` as BTC base units (18 decimals). */
function asBtc(amount: bigint, decimals: number): bigint {
  return decimals <= 18
    ? amount * 10n ** BigInt(18 - decimals)
    : amount / 10n ** BigInt(decimals - 18)
}

/**
 * BTC collateral per venue, over what Borrowed counts: open troves' `coll`
 * (summed with their debt), the veBTC amount of each live lock open
 * Enclave positions pledge (one primary-key read per lock), and the
 * collateral of positions in the MUSD markets Borrowed includes whose
 * collateral is BTC. `open_markets` counts those markets' positions that
 * owe. A market whose collateral decimals are unknown stops the part.
 */
async function collateralTotal(
  scan: ScanContext,
  latest: readonly ScanEnclaveEventItem[],
  troves: bigint,
  markets: readonly IncludedMarket[],
): Promise<Collateral> {
  const pledged = [
    ...new Set(
      latest
        .filter((event) => event.action !== "POSITION_CLOSED")
        .flatMap((event) => event.pledged_ve_btc),
    ),
  ]
  // Each read in its own async step: a database that is not bound throws
  // at once, and no read is left rejecting with nobody waiting on it.
  const [locks, reads] = await Promise.all([
    Promise.all(
      pledged.map(async (id) => scan.first(scanQueries.lock, [veBtc, id])),
    ),
    Promise.all(
      markets.map(async (market) => marketPositions(scan, market.market_id)),
    ),
  ])
  let enclaves = 0n
  for (const raw of locks) {
    if (raw === null) continue
    const [lock] = everyRow(scan, [raw], lockItem, "locks")
    if (lock !== undefined && !lock.is_withdrawn && !lock.is_merged) {
      enclaves += BigInt(lock.amount)
    }
  }
  let collateral = 0n
  let open = 0
  for (const [index, market] of markets.entries()) {
    const read = reads[index]
    if (read === undefined) continue
    open += read.open
    if (market.collateral_token !== btcToken) continue
    if (market.collateral_decimals === null) {
      throw new IncompleteRead("market decimals")
    }
    collateral += asBtc(read.collateral, market.collateral_decimals)
  }
  return {
    token: btcToken,
    decimals: 18,
    total: (troves + enclaves + collateral).toString(),
    troves: troves.toString(),
    enclaves: enclaves.toString(),
    markets: collateral.toString(),
    open_markets: open,
  }
}

// -- history ------------------------------------------------------------------

/**
 * A position's principal over time: `changes` oldest first, each the
 * principal after an event at `at`; `before` the principal before the
 * first change (0 before the position opened), null when the read stopped
 * before reaching it.
 */
type Timeline = {
  before: bigint | null
  changes: { at: number; value: bigint }[]
}

async function timelineOf(
  scan: ScanContext,
  latest: ScanEnclaveEventItem,
  windowStart: number,
): Promise<Timeline> {
  // Nothing happened in the window: the latest event holds throughout.
  if (latest.timestamp < windowStart) {
    return { before: principalAfter(latest), changes: [] }
  }
  const position = latest.position_id ?? ""
  const events: ScanEnclaveEventItem[] = []
  let key: [number, number, string] = [maxKey, maxKey, ""]
  for (let page = 0; page < eventPages; page += 1) {
    const raws = await scan.rows(scanQueries.enclaveByPosition, [
      position,
      ...key,
      eventPage,
    ])
    const rows = everyRow(scan, raws, enclaveItem, "enclave_events")
    events.push(...rows)
    const last = rows.at(-1)
    // The whole history: before its first event the position owed nothing.
    if (rows.length < eventPage || last === undefined) {
      return { before: 0n, changes: changesOf(events) }
    }
    // An event before the window carries the principal it starts with.
    if (last.timestamp < windowStart) {
      return { before: null, changes: changesOf(events) }
    }
    key = [last.block_number, last.log_index, last.ve_btc_token_id]
  }
  return { before: null, changes: changesOf(events) }
}

function changesOf(newestFirst: readonly ScanEnclaveEventItem[]) {
  return [...newestFirst]
    .reverse()
    .map((event) => ({ at: event.timestamp, value: principalAfter(event) }))
}

/** The principal at `end` (exclusive), or null when unknown. */
function valueAt(timeline: Timeline, end: number): bigint | null {
  let value = timeline.before
  for (const change of timeline.changes) {
    if (change.at >= end) break
    value = change.value
  }
  return value
}

const closeRowSchema = z.object({
  day: z.iso.date(),
  value: z.string().regex(/^(0|[1-9][0-9]*)$/),
  partial: z.union([z.literal(0), z.literal(1)]).default(0),
})

type Close = { value: bigint; partial: boolean }

async function closesOf(
  scan: ScanContext,
  metric: string,
  dimension: string,
  from: string,
  to: string,
): Promise<Map<string, Close>> {
  const raws = await scan.rows(scanQueries.dailyRange, [
    metric,
    dimension,
    from,
    to,
  ])
  const closes = new Map<string, Close>()
  for (const raw of raws) {
    const parsed = closeRowSchema.safeParse(raw)
    if (!parsed.success) {
      scan.deps.logger.error({
        message: "Scan row failed its schema",
        table: "daily",
        key: { metric, dimension },
      })
      throw new RowShapeError("daily")
    }
    closes.set(parsed.data.day, {
      value: BigInt(parsed.data.value),
      partial: parsed.data.partial === 1,
    })
  }
  return closes
}

type History = Extract<ScanBorrowTotals["history"], { status: "ok" }>["data"]
type Point = History["points"][number]

function sumOf(values: readonly (bigint | null)[]): bigint | null {
  let sum = 0n
  for (const value of values) {
    if (value === null) return null
    sum += value
  }
  return sum
}

function point(
  day: string,
  troves: bigint | null,
  enclaves: bigint | null,
  markets: bigint | null,
  partial: boolean,
): Point {
  const total = sumOf([troves, enclaves, markets])
  return {
    day,
    total: total?.toString() ?? null,
    troves: troves?.toString() ?? null,
    enclaves: enclaves?.toString() ?? null,
    markets: markets?.toString() ?? null,
    partial,
  }
}

async function historyOf(
  scan: ScanContext,
  nowMs: number,
  latest: readonly ScanEnclaveEventItem[],
  included: readonly string[],
  live: { troves: bigint | null; enclaves: bigint; markets: bigint },
): Promise<History> {
  const today = dayOf(nowMs)
  const days = Array.from({ length: scanBorrowTotalsDays }, (_, index) =>
    dayOf(nowMs - (scanBorrowTotalsDays - 1 - index) * dayMs),
  )
  const from = days[0] ?? today
  const yesterday = days.at(-2) ?? from
  const windowStart = dayStart(from)
  const [troves, markets, timelines, dirtyDays] = await Promise.all([
    closesOf(scan, "musd.trove_debt", "", from, yesterday),
    Promise.all(
      included.map((id) =>
        closesOf(scan, "morpho.total_borrow", id, from, yesterday),
      ),
    ),
    Promise.all(latest.map((event) => timelineOf(scan, event, windowStart))),
    scan.dirty("day"),
  ])
  const points = days.map((day) => {
    if (day === today) {
      return point(day, live.troves, live.enclaves, live.markets, true)
    }
    const end = dayStart(day) + 86_400
    const trove = troves.get(day)
    const closes = markets.map((series) => series.get(day))
    const market = sumOf(closes.map((close) => close?.value ?? null))
    const enclave = sumOf(timelines.map((line) => valueAt(line, end)))
    const partial =
      dirtyDays.has(day) ||
      trove?.partial === true ||
      closes.some((close) => close?.partial === true)
    return point(day, trove?.value ?? null, enclave, market, partial)
  })
  return { from, to: today, points }
}

// -- the route ----------------------------------------------------------------

export async function borrowTotals(
  scan: ScanContext,
): Promise<{ data: ScanBorrowTotals; shareable: boolean }> {
  const [troveRead, marketRead, latest] = await Promise.all([
    partOf(scan, "troves", () => trovesTotal(scan)),
    partOf(scan, "markets", () => marketsTotal(scan)),
    partOf(scan, "enclaves", () => latestPerPosition(scan)),
  ])
  const troves: Part<TrovesTotal> =
    troveRead.status === "ok"
      ? { status: "ok", data: troveRead.data.total }
      : troveRead
  const markets: Part<MarketsTotal> =
    marketRead.status === "ok"
      ? { status: "ok", data: marketRead.data.total }
      : marketRead
  const enclaves: Part<EnclavesTotal> =
    latest.status === "ok"
      ? await partOf(scan, "enclaves", async () => enclavesTotal(latest.data))
      : latest
  const debts: Record<ScanBorrowVenue, bigint | null> = {
    troves: troves.status === "ok" ? BigInt(troves.data.debt) : null,
    enclaves: enclaves.status === "ok" ? BigInt(enclaves.data.debt) : null,
    markets: markets.status === "ok" ? BigInt(markets.data.debt) : null,
  }
  const missing = (["troves", "enclaves", "markets"] as const).filter(
    (venue) => debts[venue] === null,
  )
  const total = sumOf([debts.troves, debts.enclaves, debts.markets])
  // History needs the MUSD market list and every Enclave position.
  const [history, collateral]: [Part<History>, Part<Collateral>] =
    await Promise.all([
      markets.status !== "ok"
        ? markets
        : latest.status !== "ok"
          ? latest
          : enclaves.status !== "ok"
            ? enclaves
            : partOf(scan, "history", () =>
                historyOf(
                  scan,
                  scan.nowMs(),
                  latest.data,
                  markets.data.included.map((each) => each.market_id),
                  {
                    troves: debts.troves,
                    enclaves: BigInt(enclaves.data.debt),
                    markets: BigInt(markets.data.debt),
                  },
                ),
              ),
      troveRead.status !== "ok"
        ? troveRead
        : marketRead.status !== "ok"
          ? marketRead
          : latest.status !== "ok"
            ? latest
            : partOf(scan, "collateral", () =>
                collateralTotal(
                  scan,
                  latest.data,
                  troveRead.data.collateral,
                  marketRead.data.markets,
                ),
              ),
    ])
  const parts: Part<unknown>[] = [
    troves,
    enclaves,
    markets,
    history,
    collateral,
  ]
  return {
    data: {
      unit,
      total: total?.toString() ?? null,
      missing,
      enclaves_share:
        total === null || total === 0n || debts.enclaves === null
          ? null
          : ((debts.enclaves * wad) / total).toString(),
      venues: { troves, enclaves, markets },
      history,
      collateral,
    },
    shareable: parts.every(
      (part) => part.status === "ok" || shareableReasons.has(part.reason),
    ),
  }
}

export function registerScanBorrowTotals(
  app: Hono<ApiEnv>,
  scan: ScanContext,
): void {
  /**
   * A live document keyed by the snapshot slot and the Scan data version
   * (Enclave events and daily closes come from SCAN_DB). Each part degrades
   * alone; an answer with a transient failure is never stored.
   */
  app.get("/internal/scan/borrow/totals", (c) => {
    queryOf(c, {})
    return (async () => {
      const url = new URL(c.req.url)
      let versionFailed = false
      const data = await scan.aggregateVersion().catch((error: unknown) => {
        versionFailed = !(
          error instanceof PlatformError && error.code === "service_disabled"
        )
        return "none"
      })
      return scan.responder.serve(c, {
        cacheClass: "live",
        resource: `${url.pathname}${url.search}`,
        version: `${scan.liveVersion()}-d${dayOf(scan.nowMs())}-a${data}`,
        caller: callerOf(c),
        render: async () => {
          const [totals, snapshot] = await Promise.all([
            borrowTotals(scan),
            scan.liveSnapshot(),
          ])
          return {
            body: { data: totals.data, snapshot },
            store:
              !versionFailed &&
              totals.shareable &&
              // As every live answer: a head the clock missed is not kept.
              !(snapshot.head === null && snapshot.block !== null),
          }
        },
      })
    })()
  })
}
