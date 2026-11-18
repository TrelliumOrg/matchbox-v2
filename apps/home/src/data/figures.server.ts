import { env, waitUntil } from "cloudflare:workers"
import { mainPageBlocksSchema } from "@matchbox/contracts/blockscout"
import {
  type GaugeCard,
  gaugeDirectoryResponseSchema,
  gaugeKindSchema,
  gaugePictureSchema,
  proSummaryResponseSchema,
} from "@matchbox/contracts/read-models"
import {
  scanBorrowTotalsResponseSchema,
  scanSeriesSchema,
  scanValidatorsSchema,
} from "@matchbox/contracts/scan"
import { formatDecimal, unitsToDecimal } from "@matchbox/domain/format"
import { type LiveConfig, liveConfig } from "@matchbox/live/config"
import { createLogger } from "@matchbox/logger"
import { z } from "zod"
import { borrowFigures } from "./borrow"
import {
  dayText,
  emptyFigures,
  type HomeFigures,
  type LatestBlock,
  mergeFigures,
  type ProGauge,
  scaleSeries,
} from "./figures"
import { fixtureFigures, fixtureNames } from "./fixtures"
import {
  anyUnnamed,
  type KnownNames,
  nameBlocks,
  noNames,
  shortAddress,
  type ValidatorNames,
  validatorNames,
} from "./validators"

/**
 * The homepage's figures at the edge. The page renders from the last
 * snapshot and never waits for an upstream read: a snapshot younger than
 * `freshMs` is served as it is, an older one is served at once while one
 * refresh runs in the background (stale while revalidating), and with no
 * snapshot at all the slots say "Not available" until the refresh lands.
 * The browser's own fresh request (`fresh: true`) does wait for the
 * refresh, which it bounds with its own 5 s deadline. Every upstream read
 * has a deadline, and a slot whose read fails keeps its last value.
 *
 * Snapshots live in the Cache API under one key per build (`snapshotKey`),
 * with a copy in the isolate so a warm isolate answers without a cache
 * read. The Cache API stores nothing on workers.dev, so there only the
 * isolate's copy lasts (README, Live figures).
 */

const log = createLogger({
  fields: { service: "matchbox-home", area: "figures" },
})

/** Served without a refresh while younger than this. */
export const freshMs = 15_000

/** How long the Cache API keeps a snapshot: a day, so a quiet colo still paints figures. */
const keepSeconds = 86_400

/** Each upstream read's deadline, headers and body. */
export const upstreamTimeoutMs = 3_000

/**
 * The borrow totals route caches each answer for a minute (`max-age=60`,
 * within a five-minute snapshot slot), so the edge reads it no more often
 * than that, however often the page refreshes. The last read, whether it
 * answered or not, and the snapshot's last good read both count.
 */
export const borrowEveryMs = 60_000

/**
 * Validator names change when a validator joins the set or renames, days
 * apart, so the edge re-reads them every five minutes, not with every
 * block. A shown block whose proposer has no known name (a validator new
 * since the last read) brings the read forward, to no sooner than a
 * minute after the last one: a proposer that no read names (no directory
 * name, no label) costs a read a minute at most, never one per block.
 * The last read, whether it answered or not, and the snapshot's last good
 * read both count.
 */
export const namesEveryMs = 300_000
export const namesRetryMs = 60_000

/** The caller name the API's Blockscout proxy and rate limits see. */
export const homeClientName = "matchbox-home"

/**
 * The build's id is in the key, so a deploy never reads a snapshot an
 * earlier build stored, whose shape it may not share; `v4` is the shape.
 */
export const snapshotKey = `https://home.internal/figures/v4/${__HOME_BUILD_ID__}`

const decimal = z.string().regex(/^\d+(\.\d+)?$/)
const series = z.array(z.number().min(0).max(1).nullable()).nullable()
const days = z
  .array(z.object({ label: z.string(), text: z.string() }).nullable())
  .nullable()

/** A stored snapshot, checked when read back from the Cache API. */
const figuresSchema = z.object({
  pro: z.object({
    incentivesUsd: decimal.nullable(),
    gauges: z
      .array(
        z.object({
          address: z.string(),
          name: z.string(),
          kind: gaugeKindSchema,
          picture: gaugePictureSchema,
          votes: decimal,
          votesUnit: z.enum(["veBTC", "veMEZO"]),
          incentivesUsd: decimal,
          tokens: z.array(z.string()),
        }),
      )
      .nullable(),
  }),
  scan: z.object({
    borrowedMusd: decimal.nullable(),
    borrowedEnclaves: decimal.nullable(),
    borrowedSeries: series,
    borrowedDays: days,
    vebtcLocked: decimal.nullable(),
    vebtcLockedUsd: decimal.nullable(),
    vebtcSeries: series,
    vebtcDays: days,
    blocks: z
      .array(
        z.object({
          number: z.number().int(),
          address: z.string(),
          proposer: z.string(),
          transactions: z.number().int(),
        }),
      )
      .nullable(),
  }),
  at: z.object({
    summary: z.number().nullable(),
    gauges: z.number().nullable(),
    vebtcSeries: z.number().nullable(),
    blocks: z.number().nullable(),
    borrow: z.number().nullable(),
  }),
}) satisfies z.ZodType<HomeFigures>

/** The validator names, kept at the edge only: blocks are named here. */
const namesSchema = z.object({
  byAddress: z.record(z.string(), z.string()),
  at: z.number().nullable(),
}) satisfies z.ZodType<KnownNames>

const snapshotSchema = z.object({
  storedAt: z.number(),
  figures: figuresSchema,
  names: namesSchema,
})

type Snapshot = { storedAt: number; figures: HomeFigures; names: KnownNames }

let memo: Snapshot | null = null
let refreshing: Promise<Snapshot> | null = null
/** This isolate's last borrow totals read, answered or not. */
let borrowTriedAt: number | null = null
/** This isolate's last validator names read, answered or not. */
let namesTriedAt: number | null = null

/** For tests: forget the isolate's copy. */
export function resetFigures(): void {
  memo = null
  refreshing = null
  borrowTriedAt = null
  namesTriedAt = null
}

/** Whether the borrow totals are due a read: a minute after the last. */
function borrowDue(nowMs: number, lastReadAt: number | null): boolean {
  const last = Math.max(lastReadAt ?? -Infinity, borrowTriedAt ?? -Infinity)
  return nowMs - last >= borrowEveryMs
}

/**
 * Whether the validator names are due a read: five minutes after the
 * last, or a minute after it when a shown block's proposer has no name.
 */
function namesDue(
  nowMs: number,
  names: KnownNames,
  blocks: readonly LatestBlock[] | null,
): boolean {
  const since =
    nowMs - Math.max(names.at ?? -Infinity, namesTriedAt ?? -Infinity)
  if (since >= namesEveryMs) return true
  return since >= namesRetryMs && anyUnnamed(blocks, names.byAddress)
}

async function figureCache(): Promise<Cache | null> {
  if (typeof caches === "undefined") return null
  return caches.open("home-figures").catch(() => null)
}

async function readSnapshot(): Promise<Snapshot | null> {
  if (memo !== null) return memo
  const cache = await figureCache()
  const hit = await cache?.match(snapshotKey).catch(() => undefined)
  if (hit === undefined) return null
  const parsed = snapshotSchema.safeParse(await hit.json().catch(() => null))
  if (!parsed.success) return null
  memo = parsed.data
  return memo
}

async function writeSnapshot(snapshot: Snapshot): Promise<void> {
  memo = snapshot
  const cache = await figureCache()
  if (cache === null) return
  const body = JSON.stringify(snapshot)
  await cache
    .put(
      snapshotKey,
      new Response(body, {
        headers: {
          "content-type": "application/json",
          "cache-control": `public, max-age=${keepSeconds}`,
        },
      }),
    )
    .catch(() => undefined)
}

function apiHeaders(): Headers {
  const headers = new Headers({ accept: "application/json" })
  headers.set("X-Matchbox-Client", homeClientName)
  if (env.INTERNAL_TOKEN !== undefined) {
    headers.set("authorization", `Bearer ${env.INTERNAL_TOKEN}`)
  }
  return headers
}

/** One upstream read: validated, or null on any failure or past its deadline. */
async function readApi<T>(
  path: string,
  schema: z.ZodType<T>,
): Promise<T | null> {
  const init: RequestInit = {
    headers: apiHeaders(),
    signal: AbortSignal.timeout(upstreamTimeoutMs),
  }
  try {
    const response =
      env.API === undefined
        ? await fetch(new URL(path, env.API_ORIGIN), init)
        : await env.API.fetch(new Request(`https://api.internal${path}`, init))
    if (!response.ok) {
      log.error({
        message: "figure read failed",
        path,
        status: response.status,
      })
      return null
    }
    const parsed = schema.safeParse(await response.json())
    if (!parsed.success) {
      log.error({
        message: "figure read failed validation",
        path,
        issues: parsed.error.issues.slice(0, 5),
      })
      return null
    }
    return parsed.data
  } catch (error) {
    log.error({
      message: "figure read did not answer",
      path,
      error: error instanceof Error ? error.name : "unknown",
    })
    return null
  }
}

function day(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

const seriesResponseSchema = z.object({ data: scanSeriesSchema })

export function proGauge(card: GaugeCard): ProGauge {
  return {
    address: card.gauge.address,
    name: card.gauge.name,
    kind: card.gauge.kind,
    picture: card.gauge.picture,
    votes: card.votes,
    votesUnit: card.votesUnit,
    incentivesUsd: card.incentives.usd,
    tokens: card.incentives.tokens
      .map((entry) => entry.token.symbol)
      .slice(0, 3),
  }
}

/** What a refresh knows before it reads: the snapshot's figures and names. */
type Known = { figures: HomeFigures; names: KnownNames }

/**
 * The figures as the API has them now, and the validator names when they
 * were due a read and it answered (else null). Slots it could not read
 * are null. The borrow totals are not read again within a minute of the
 * last read (`borrowEveryMs`), and are then null with no read time, so
 * the merge keeps the last ones; the names are read on their own
 * schedule (`namesEveryMs`). The blocks are named with the fresh names,
 * else the known ones.
 */
export async function readUpstream(
  nowMs: number,
  known: Known = { figures: emptyFigures, names: noNames },
): Promise<{ figures: HomeFigures; names: ValidatorNames | null }> {
  const from = day(nowMs - 29 * 86_400_000)
  const to = day(nowMs)
  const readBorrow = borrowDue(nowMs, known.figures.at.borrow)
  if (readBorrow) borrowTriedAt = nowMs
  const readNames = namesDue(nowMs, known.names, known.figures.scan.blocks)
  if (readNames) namesTriedAt = nowMs
  const [summary, gauges, vebtc, blocks, borrowTotals, validators] =
    await Promise.all([
      readApi("/internal/pro/summary", proSummaryResponseSchema),
      readApi(
        "/internal/pro/gauges?funded=true&limit=3&sort=incentives",
        gaugeDirectoryResponseSchema,
      ),
      readApi(
        `/internal/scan/series?dimension=vebtc&from=${from}&metric=escrow.supply&to=${to}`,
        seriesResponseSchema,
      ),
      readApi(
        "/internal/blockscout/api/v2/main-page/blocks",
        mainPageBlocksSchema,
      ),
      readBorrow
        ? readApi(
            "/internal/scan/borrow/totals",
            scanBorrowTotalsResponseSchema,
          )
        : null,
      readNames
        ? readApi("/internal/scan/validators", scanValidatorsSchema)
        : null,
    ])
  const names = validators === null ? null : validatorNames(validators)
  const latest = nameBlocks(
    blocks === null || blocks.length === 0
      ? null
      : blocks.slice(0, 3).map((block) => ({
          number: block.height,
          address: block.miner.hash.toLowerCase(),
          proposer: block.miner.name ?? shortAddress(block.miner.hash),
          transactions: block.transactions_count,
        })),
    names === null
      ? known.names.byAddress
      : { ...known.names.byAddress, ...names },
  )
  const gaugeRows =
    gauges === null ? null : gauges.data.gauges.slice(0, 3).map(proGauge)
  const vebtcSeries =
    vebtc === null
      ? null
      : scaleSeries(vebtc.data.points.map((point) => point.value))
  // veBTC has 18 decimals, as the series' base units.
  const vebtcDays =
    vebtcSeries === null || vebtc === null
      ? null
      : vebtc.data.points.map((point) => ({
          label: dayText(point.day, point.partial),
          text: `${formatDecimal(unitsToDecimal(point.value, 18), 2)} BTC`,
        }))
  // An answer with no total (a venue it could not read) counts as a read
  // that failed: the stat keeps its last figures, and their time.
  const borrow = borrowTotals === null ? null : borrowFigures(borrowTotals)
  // Each read's own time: one that failed has none, so the merge keeps
  // its last time with its last values and the page can call it stale.
  const readAt = (value: unknown): number | null =>
    value === null ? null : nowMs
  const figures: HomeFigures = {
    pro: {
      incentivesUsd: summary?.data.incentives.usd ?? null,
      gauges: gaugeRows,
    },
    scan: {
      borrowedMusd: borrow?.borrowedMusd ?? null,
      borrowedEnclaves: borrow?.borrowedEnclaves ?? null,
      borrowedSeries: borrow?.borrowedSeries ?? null,
      borrowedDays: borrow?.borrowedDays ?? null,
      vebtcLocked: summary?.data.stats.vebtcLocked ?? null,
      vebtcLockedUsd: summary?.data.stats.vebtcLockedUsd ?? null,
      vebtcSeries,
      vebtcDays,
      blocks: latest,
    },
    at: {
      summary: readAt(summary),
      gauges: readAt(gaugeRows),
      vebtcSeries: readAt(vebtcSeries),
      blocks: readAt(latest),
      borrow: readAt(borrow),
    },
  }
  return { figures, names }
}

function fixturesMode(): boolean {
  return env.HOME_DATA === "fixtures"
}

/** The fixtures' snapshot: their figures, named from their names. */
function fixtureSnapshot(nowMs: number): Snapshot {
  return {
    storedAt: nowMs,
    figures: fixtureFigures(nowMs),
    names: { byAddress: fixtureNames, at: nowMs },
  }
}

/**
 * One refresh per isolate at a time; the result is merged and stored.
 * Names that answered go over the known ones, and every block shown, the
 * kept ones too, is named with them: a name that arrives after its block
 * swaps in. A validator the answer lacks (the API could not read the
 * directory, say) keeps its last name; names that did not answer keep
 * the last ones and their time.
 */
function refresh(nowMs: number): Promise<Snapshot> {
  refreshing ??= (async () => {
    try {
      const stored = await readSnapshot()
      const known: Known = {
        figures: stored?.figures ?? emptyFigures,
        names: stored?.names ?? noNames,
      }
      const fresh = fixturesMode()
        ? { figures: fixtureFigures(nowMs), names: fixtureNames }
        : await readUpstream(nowMs, known)
      const names =
        fresh.names === null
          ? known.names
          : {
              byAddress: { ...known.names.byAddress, ...fresh.names },
              at: nowMs,
            }
      const merged = mergeFigures(known.figures, fresh.figures)
      const snapshot: Snapshot = {
        storedAt: nowMs,
        figures: {
          ...merged,
          scan: {
            ...merged.scan,
            blocks: nameBlocks(merged.scan.blocks, names.byAddress),
          },
        },
        names,
      }
      await writeSnapshot(snapshot)
      return snapshot
    } finally {
      refreshing = null
    }
  })()
  return refreshing
}

/**
 * The figures for a page (never waits upstream) or for the browser's
 * fresh request (waits for a refresh when the snapshot is old).
 */
export async function getHomeFigures(options: {
  fresh: boolean
  nowMs?: number
}): Promise<HomeFigures> {
  const nowMs = options.nowMs ?? Date.now()
  // Fixtures are the last known figures from the start: local builds and
  // the smoke tests paint them on the first request.
  if (fixturesMode() && memo === null) memo = fixtureSnapshot(nowMs)
  const snapshot = await readSnapshot()
  const young = snapshot !== null && nowMs - snapshot.storedAt < freshMs
  if (young) return snapshot.figures
  if (options.fresh) return (await refresh(nowMs)).figures
  waitUntil(refresh(nowMs).catch(() => undefined))
  return snapshot?.figures ?? emptyFigures
}

export type HomeSeed = {
  figures: HomeFigures
  /** The server's clock at render, so the epoch line hydrates as rendered. */
  renderedAt: number
  live: LiveConfig
}

/** The page's loader data: the last snapshot, never an upstream wait. */
export async function loadSeed(): Promise<HomeSeed> {
  return {
    figures: await getHomeFigures({ fresh: false }),
    renderedAt: Date.now(),
    live: liveConfig(fixturesMode(), env.MEZO_RPC_URL),
  }
}
