import { MORPHO_MARKETS } from "@matchbox/chain"
import type { Hex } from "viem"
import type { LiveChainReader } from "../../src/live/snapshot"
import {
  type DailyPoint,
  dailyRows,
  dailySpec,
} from "../../src/scan/aggregates"
import {
  type ClosingChainReader,
  lastClosingMinute,
  type ReadModelRows,
  readModelPointsOf,
  supplyTokens,
} from "../../src/scan/closing"
import {
  type SqlStatement,
  servedBatch,
  type UpsertSpec,
  upsertStatements,
} from "../../src/scan/statements"
import { dayStart } from "../../src/scan/transform"

// The closes the live snapshot's closing run writes, rebuilt for past days
// from archive state (daily-history.ts): the read-model series (escrow,
// troves, Stability Pool, Morpho markets and positions) and
// token.total_supply. Each day is read with the live snapshot's and the
// closing writer's own chain reads at the block the day's last closing run
// (23:55 UTC) reads, turned into read-model rows as the snapshot stores
// them, and into points by the closing writer's own function, so a
// backfilled close is computed exactly as a live one.

/** The metrics this backfill writes. */
export const historyMetrics = [
  "escrow.supply",
  "musd.trove_debt",
  "musd.trove_coll",
  "musd.stability_pool",
  "morpho.total_supply",
  "morpho.total_borrow",
  "morpho.total_collateral",
  "token.total_supply",
] as const

export const historySource = "backfill:daily-history"

/**
 * The close of `day` reads the head at the start of the day's last closing
 * run (the 5-minute live cron at 23:55 UTC), so the closing block is the
 * last block with a timestamp at or before 23:55:00: the last one below
 * this bound.
 */
export function closeBound(day: string): number {
  return dayStart(day) + lastClosingMinute * 60 + 1
}

/** Morpho markets the live snapshot reads: configured plus discovered. */
export function marketIdsOf(discovered: readonly string[]): Hex[] {
  return [
    ...new Set<Hex>([
      ...Object.values(MORPHO_MARKETS.mainnet),
      ...discovered.map((id) => id.toLowerCase() as Hex),
    ]),
  ].sort()
}

/**
 * Morpho accounts the live snapshot would know of at `block`: those whose
 * first Supply, Borrow or SupplyCollateral log lies in a log window that
 * starts at or before it. An account counted a little early only adds a
 * zero position, which the reader drops.
 */
export function accountsAt(
  firstSeen: Readonly<Record<string, number>>,
  block: number,
): string[] {
  return Object.entries(firstSeen)
    .filter(([, first]) => first <= block)
    .map(([account]) => account)
    .sort()
}

export type CloseReader = Pick<
  LiveChainReader,
  "escrowSupply" | "troves" | "morpho"
> &
  Pick<ClosingChainReader, "totalSupply">

/**
 * One day's closing points at `block`. A failed request throws (the day is
 * retried); a call that reverts at that block (a contract or market not
 * yet there) leaves its series out, as the live snapshot does. A token
 * whose totalSupply() fails is left out here; `missingSupplies` tells a
 * token not yet deployed from a failed read.
 */
export async function readClosePoints(
  reader: CloseReader,
  marketIds: readonly Hex[],
  accounts: readonly string[],
  block: number,
): Promise<DailyPoint[]> {
  const at = BigInt(block)
  const [supply, troves, morpho, supplies] = await Promise.all([
    reader.escrowSupply(at),
    reader.troves(at),
    reader.morpho(marketIds, accounts, at),
    Promise.all(supplyTokens.map((token) => reader.totalSupply(token, block))),
  ])
  // The rows the live snapshot stores (src/live/snapshot.ts).
  const rows: ReadModelRows = {
    markets: morpho.markets.map((market) => ({
      market_id: market.marketId,
      total_supply_assets_raw: market.totalSupplyAssets.toString(),
      total_borrow_assets_raw: market.totalBorrowAssets.toString(),
    })),
    collateral: morpho.positions.map((position) => ({
      market_id: position.marketId,
      collateral_raw: position.collateral.toString(),
    })),
    troves: troves.troves.map((trove) => ({
      coll_raw: trove.coll.toString(),
      principal_raw: trove.principal.toString(),
      interest_raw: trove.interest.toString(),
    })),
    pool: [
      {
        total_musd_deposits_raw:
          troves.stabilityPool.totalMusdDeposits.toString(),
      },
    ],
    supply: (["vebtc", "vemezo"] as const).flatMap((escrow) => {
      const value = supply[escrow]
      return value === null ? [] : [{ escrow, supply_raw: value.toString() }]
    }),
  }
  const wanted = new Set<string>(historyMetrics)
  const points = readModelPointsOf(rows).filter((point) =>
    wanted.has(point.metric),
  )
  // token.total_supply as the closing writer computes it (closing.ts).
  supplyTokens.forEach((token, index) => {
    const value = supplies[index]
    if (value === undefined || value === null) return
    points.push({ metric: "token.total_supply", dimension: token, value })
  })
  return points
}

/**
 * Tokens with a supply on an earlier day but none on this one. A token is
 * never undeployed, so this is a failed read, and the day is retried; a
 * token with no earlier supply is simply not deployed yet.
 */
export function missingSupplies(
  earlier: Iterable<Readonly<Record<string, string>>>,
  points: readonly DailyPoint[],
): string[] {
  const seen = new Set<string>()
  for (const bucket of earlier) {
    for (const key of Object.keys(bucket)) {
      if (key.startsWith("token.total_supply|")) seen.add(key.slice(19))
    }
  }
  const now = new Set(
    points
      .filter((point) => point.metric === "token.total_supply")
      .map((point) => point.dimension),
  )
  return [...seen].filter((token) => !now.has(token)).sort()
}

/**
 * `daily` inserts that never touch an existing row: a day the live writer
 * (or anything else) already wrote is left as it is, and applying the file
 * twice changes nothing.
 */
export const historySpec: UpsertSpec = { ...dailySpec, update: [] }

/**
 * Days in groups of at most `rowsPerFile` rows (whole days; a day bigger
 * than that is a group of its own), oldest first: one SQL file each, so
 * each file's `historyStatements` is its own served batch. A file applied
 * with `wrangler d1 execute --file` runs in its own session, and the
 * data_version bump compares total_changes() within one.
 */
export function historyChunks(
  byDay: ReadonlyMap<string, readonly DailyPoint[]>,
  rowsPerFile: number,
): Map<string, readonly DailyPoint[]>[] {
  const chunks: Map<string, readonly DailyPoint[]>[] = []
  let current = new Map<string, readonly DailyPoint[]>()
  let rows = 0
  for (const [day, points] of [...byDay.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    if (current.size > 0 && rows + points.length > rowsPerFile) {
      chunks.push(current)
      current = new Map()
      rows = 0
    }
    current.set(day, points)
    rows += points.length
  }
  if (current.size > 0) chunks.push(current)
  return chunks
}

/**
 * The statements for every day: inserts of complete days (partial 0),
 * wrapped so scan_status.data_version moves only if a row was inserted,
 * which retires the API's cached series and borrow totals.
 */
export function historyStatements(
  byDay: ReadonlyMap<string, readonly DailyPoint[]>,
  nowSeconds: number,
  source = historySource,
): SqlStatement[] {
  const rows = [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .flatMap(([day, points]) => dailyRows(points, day, source, nowSeconds))
  return servedBatch(upsertStatements(historySpec, rows))
}
