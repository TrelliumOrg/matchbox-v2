import { type ChartSeries, getBorrowCharts } from "../../data/borrow"
import type { Section } from "../../data/explorer"
import { type ChartPeriod, periodKey } from "./search"

/**
 * The overview's one request for every market chart. The page starts it
 * as it mounts, beside the charts' code, and each chart joins it: one
 * request however many charts ask. A whole answer is kept for a minute
 * (the response's s-maxage); a failed one, or one with a market missing,
 * is dropped once it settles, so a retry asks again.
 */

export type Charts = Record<string, Section<ChartSeries>>

export type ChartMarket = { id: string; decimals: number | null }

/** How long a whole answer is reused, ms. */
export const keepMs = 60_000

const reads = new Map<string, { read: Promise<Charts>; at: number }>()

/** A market's series that a retry may fix. */
export function chartFailed(series: Section<ChartSeries>): boolean {
  return series.status === "unavailable" || series.status === "rate-limited"
}

function whole(charts: Charts, markets: readonly ChartMarket[]): boolean {
  return markets.every((market) => {
    const series = charts[market.id]
    return series !== undefined && !chartFailed(series)
  })
}

export function readCharts(
  period: ChartPeriod,
  markets: readonly ChartMarket[],
): Promise<Charts> {
  const now = Date.now()
  for (const [key, entry] of reads) {
    if (now - entry.at >= keepMs) reads.delete(key)
  }
  const key = `${periodKey(period)}:${markets.map((market) => market.id).join(",")}`
  const kept = reads.get(key)
  if (kept !== undefined) return kept.read
  const read = getBorrowCharts({ data: { ...period, markets: [...markets] } })
  reads.set(key, { read, at: now })
  const drop = () => {
    if (reads.get(key)?.read === read) reads.delete(key)
  }
  read.then((charts) => {
    if (!whole(charts, markets)) drop()
  }, drop)
  return read
}

/** Forgets every kept answer (tests). */
export function forgetCharts(): void {
  reads.clear()
}
