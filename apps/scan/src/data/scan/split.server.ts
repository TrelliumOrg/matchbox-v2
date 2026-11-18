import type { ScanSeriesSplit } from "@matchbox/contracts/scan"
import { canonicalQuery } from "../caller.server"
import type { Section } from "../explorer"
import { type DailyPrices, dayOf } from "./pricing"
import { readScan } from "./read.server"
import { scanSchemas } from "./schemas"

/**
 * Every dimension of one metric over a range (`/series/split`): the
 * per-token pool rollups, or a pool-token metric over a few days. Points
 * stay base units with each series' own token; pricing is the caller's
 * (market-views). A range past 45 days is read as two requests, the
 * settled days (kept a day by the API and the edge) and the last three, so
 * a new copy run re-reads a few rows, not the whole history.
 */

export type SplitPoint = { day: string; units: bigint; partial: boolean }

export type SplitSeries = {
  dimension: string
  /** The dimension's token (lower case); null when it names none. */
  token: string | null
  points: SplitPoint[]
}

export type SplitView = {
  kind: "flow" | "level"
  /** The first day served (later than asked when the API cut the range). */
  from: string
  series: SplitSeries[]
}

/** Days at the end of a range read on their own, unsettled. */
const recentDays = 3
/**
 * Ranges up to this long are one request: a few hundred rows re-read on a
 * new copy run cost less than a second round trip on the page's loader.
 */
const oneReadDays = 45

function splitView(data: ScanSeriesSplit): SplitView {
  return {
    kind: data.kind,
    from: data.from,
    series: data.series.map((series) => ({
      dimension: series.dimension,
      token: series.token?.address.toLowerCase() ?? null,
      points: series.points.map((point) => ({
        day: point.day,
        units: BigInt(point.value),
        partial: point.partial,
      })),
    })),
  }
}

async function readOne(
  metric: string,
  from: string,
  to: string,
): Promise<Section<SplitView>> {
  const read = await readScan(
    "series/split",
    canonicalQuery({ metric, from, to }),
    scanSchemas.seriesSplit,
  )
  if (read.status === "rate-limited") return { status: "rate-limited" }
  if (read.status === "disabled") return { status: "disabled" }
  if (read.status !== "ok") return { status: "unavailable" }
  return { status: "ok", data: splitView(read.data.data) }
}

/** Network's markets (`/markets`): the three splits and the closes. */
export type MarketsView = {
  /** pool.token_balance over the period. */
  balances: SplitView
  /** dex.token_volume_in over at least 31 days. */
  volume: SplitView
  /** dex.volume_in per pool over the last three days. */
  pools: SplitView
  prices: DailyPrices
}

/**
 * Everything Network's TVL and DEX volume panels read, in one request:
 * one subrequest where the splits and closes would take six.
 */
export async function readMarkets(input: {
  days: number
}): Promise<Section<MarketsView>> {
  const read = await readScan(
    "markets",
    canonicalQuery({ days: input.days }),
    scanSchemas.dexMarkets,
  )
  if (read.status === "rate-limited") return { status: "rate-limited" }
  if (read.status === "disabled") return { status: "disabled" }
  if (read.status !== "ok") return { status: "unavailable" }
  const data = read.data.data
  const closes = (points: readonly { day: string; price: string }[]) =>
    points
      .map((point) => ({ day: point.day, price: point.price }))
      .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0))
  return {
    status: "ok",
    data: {
      balances: splitView(data.balances),
      volume: splitView(data.volume),
      pools: splitView(data.pools),
      prices: { btc: closes(data.prices.btc), mezo: closes(data.prices.mezo) },
    },
  }
}

function merge(older: SplitView, newer: SplitView): SplitView {
  const byDimension = new Map<string, SplitSeries>()
  for (const series of [...older.series, ...newer.series]) {
    const kept = byDimension.get(series.dimension)
    if (kept === undefined) {
      byDimension.set(series.dimension, {
        ...series,
        points: [...series.points],
      })
      continue
    }
    const days = new Set(kept.points.map((point) => point.day))
    kept.points.push(...series.points.filter((point) => !days.has(point.day)))
    kept.points.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0))
  }
  return {
    kind: newer.kind,
    from: older.from,
    series: [...byDimension.values()].sort((a, b) =>
      a.dimension.localeCompare(b.dimension),
    ),
  }
}

/** One metric split by dimension over the `days` to `now`. */
export async function readSplit(input: {
  metric: string
  days: number
  now: number
}): Promise<Section<SplitView>> {
  const to = dayOf(input.now)
  const from = dayOf(input.now - Math.max(1, input.days - 1) * 86_400)
  if (input.days <= oneReadDays) return readOne(input.metric, from, to)
  const cut = dayOf(input.now - recentDays * 86_400)
  const recent = dayOf(input.now - (recentDays - 1) * 86_400)
  const [older, newer] = await Promise.all([
    readOne(input.metric, from, cut),
    readOne(input.metric, recent, to),
  ])
  if (newer.status !== "ok") return newer
  if (older.status !== "ok") return older
  return { status: "ok", data: merge(older.data, newer.data) }
}
