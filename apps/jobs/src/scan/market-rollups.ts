import type { DailyPoint } from "./aggregates"

// Per-token sums across Mezo's pools, so a chart of every pool together is
// one range scan of a few token rows a day instead of two rows per pool:
// - pool.token_balance: pool.balance (pool:token) summed per token, written
//   with the closing values;
// - dex.token_volume_in: dex.volume_in (pool:token) summed per token,
//   written with the earn-pools subgraph's days.
// Amounts stay base units of one token each, never priced: USD is applied
// at read time from the daily closes, as for every other series. Shared
// with the one-time backfill (scripts/scan-backfill/market-rollups.ts), so
// a backfilled rollup is computed as a live one.

/** The rollup each pool-token metric sums into, per token. */
export const tokenRollups: Readonly<Record<string, string>> = {
  "pool.balance": "pool.token_balance",
  "dex.volume_in": "dex.token_volume_in",
}

/** The token of a `pool:token` dimension; null for any other shape. */
function tokenOf(dimension: string): string | null {
  const [pool, token, extra] = dimension.split(":")
  if (extra !== undefined || pool === undefined || token === undefined) {
    return null
  }
  return /^0x[0-9a-f]{40}$/.test(token) ? token : null
}

/**
 * The rollup points of one day's points: for each metric in
 * `tokenRollups`, its pool-token values summed per token (exact bigint).
 * A token is listed only when some pool row names it, so a token in no
 * pool has no row, not a zero.
 */
export function rollupPoints(points: readonly DailyPoint[]): DailyPoint[] {
  const sums = new Map<string, DailyPoint>()
  for (const point of points) {
    const rollup = tokenRollups[point.metric]
    if (rollup === undefined) continue
    const token = tokenOf(point.dimension)
    if (token === null) continue
    const key = `${rollup}\u0000${token}`
    const existing = sums.get(key)
    if (existing === undefined) {
      sums.set(key, { metric: rollup, dimension: token, value: point.value })
    } else {
      existing.value += point.value
    }
  }
  return [...sums.values()].sort((a, b) =>
    a.metric === b.metric
      ? a.dimension.localeCompare(b.dimension)
      : a.metric.localeCompare(b.metric),
  )
}

/** One day's points with their rollups added. */
export function withRollups(points: readonly DailyPoint[]): DailyPoint[] {
  return [...points, ...rollupPoints(points)]
}

/** A stored `daily` row the backfill reads back. */
export type StoredDailyRow = {
  metric: string
  dimension: string
  day: string
  value: string
}

/**
 * Days whose stored pool.balance rows miss a pool-token the nearest
 * earlier and later stored days both have: a read that failed (the
 * archive-reads backfill lets a single read fail), not a pool that
 * emptied, since an empty pool still has its zero row. A sum of such a
 * day would be short, so it gets no pool.token_balance.
 */
export function incompleteBalanceDays(
  rows: readonly StoredDailyRow[],
): string[] {
  const byDay = new Map<string, Set<string>>()
  for (const row of rows) {
    if (row.metric !== "pool.balance") continue
    const set = byDay.get(row.day) ?? new Set<string>()
    set.add(row.dimension)
    byDay.set(row.day, set)
  }
  const days = [...byDay.keys()].sort()
  const out: string[] = []
  for (let index = 1; index < days.length - 1; index += 1) {
    const before = byDay.get(days[index - 1] ?? "") ?? new Set<string>()
    const now = byDay.get(days[index] ?? "") ?? new Set<string>()
    const after = byDay.get(days[index + 1] ?? "") ?? new Set<string>()
    for (const dimension of before) {
      if (after.has(dimension) && !now.has(dimension)) {
        out.push(days[index] ?? "")
        break
      }
    }
  }
  return out
}

/**
 * Rollup points per day from stored pool-token rows, for the days before
 * `beforeDay` only: today's rows are partial and its rollup is the live
 * writer's. Days with no pool-token row get no rollup, and a day with a
 * pool's balance missing (`incompleteBalanceDays`) no pool.token_balance.
 */
export function rollupDays(
  rows: readonly StoredDailyRow[],
  beforeDay: string,
): Map<string, DailyPoint[]> {
  const incomplete = new Set(incompleteBalanceDays(rows))
  const byDay = new Map<string, DailyPoint[]>()
  for (const row of rows) {
    if (row.day >= beforeDay || tokenRollups[row.metric] === undefined) continue
    if (row.metric === "pool.balance" && incomplete.has(row.day)) continue
    if (!/^[0-9]+$/.test(row.value)) {
      throw new Error(
        `Not a base-unit amount: ${row.metric} ${row.dimension} ${row.day}`,
      )
    }
    const list = byDay.get(row.day) ?? []
    list.push({
      metric: row.metric,
      dimension: row.dimension,
      value: BigInt(row.value),
    })
    byDay.set(row.day, list)
  }
  return new Map(
    [...byDay.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, points]) => [day, rollupPoints(points)]),
  )
}

/**
 * Marks every day with a trove event dirty, so the copy step's aggregates
 * recompute it (and write musd.borrowed, repaid, redeemed and liquidated)
 * within their usual per-run budget, current day first. One statement; a
 * day already marked gets a new generation, as the copy marks it.
 */
export const troveDaysDirtySql = `INSERT INTO scan_dirty (kind, key, generation)
SELECT 'day', strftime('%Y-%m-%d', timestamp, 'unixepoch'), 0
FROM trove_events WHERE true
GROUP BY 2
ON CONFLICT (kind, key) DO UPDATE SET generation = scan_dirty.generation + 1;
`
