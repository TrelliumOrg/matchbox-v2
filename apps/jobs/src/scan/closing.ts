import type { Prices } from "@matchbox/contracts/read-models"
import type { Logger } from "@matchbox/logger"
import { erc20Abi, getAddress, type PublicClient } from "viem"
import { z } from "zod"
import {
  backfillGuard,
  type DailyPoint,
  dailyRows,
  dailySpec,
} from "./aggregates"
import { withRollups } from "./market-rollups"
import {
  cursorStatement,
  runBatch,
  servedBatch,
  type UpsertSpec,
  upsertStatements,
} from "./statements"
import { dayOf } from "./transform"

// Closing values per day, written by the existing triggers:
// - after the 5-minute live snapshot: pool balances (and their sum per
//   token, market-rollups), MUSD supply, trove and
//   Stability Pool totals, Morpho market totals, escrow supplies. Each
//   metric is one upsert that overwrites the day's row, so the row ends the
//   day holding the last value. To bound writes it runs on the :00 and :30
//   live runs and on the day's last run (23:55), and a value that did not
//   change writes nothing.
// - after the minute price job: one closing USD price per token per day,
//   written at minute :59 of each hour (and 00:00), so the 23:59 sample is
//   the close.

/**
 * Minute of the UTC day of the day's last closing run (23:55): the run
 * whose values a day's rows end with, unless it failed.
 */
export const lastClosingMinute = 1_435

/** Whether this live run records closing values. */
export function isClosingRun(nowSeconds: number): boolean {
  const minuteOfDay = Math.floor((nowSeconds % 86_400) / 60)
  const minute = minuteOfDay % 60
  return (
    minute < 5 ||
    (minute >= 30 && minute < 35) ||
    minuteOfDay >= lastClosingMinute
  )
}

/** Whether this minute's price is recorded in price_daily. */
export function isPriceCloseMinute(nowSeconds: number): boolean {
  const minuteOfDay = Math.floor((nowSeconds % 86_400) / 60)
  return minuteOfDay % 60 === 59 || minuteOfDay === 0
}

/** One multicall of ERC-20 reads (a fake in tests). */
export type ClosingChainReader = {
  /** balanceOf(holder) per token; a failed read is absent. */
  balances(
    reads: readonly { token: string; holder: string }[],
    block?: number,
  ): Promise<Map<string, bigint>>
  totalSupply(token: string, block?: number): Promise<bigint | null>
}

export function balanceKey(token: string, holder: string): string {
  return `${token.toLowerCase()}:${holder.toLowerCase()}`
}

export function createClosingChainReader(
  client: PublicClient,
): ClosingChainReader {
  return {
    async balances(reads, block) {
      if (reads.length === 0) return new Map()
      const results = await client.multicall({
        allowFailure: true,
        ...(block === undefined ? {} : { blockNumber: BigInt(block) }),
        contracts: reads.map((read) => ({
          address: getAddress(read.token),
          abi: erc20Abi,
          functionName: "balanceOf" as const,
          args: [getAddress(read.holder)] as const,
        })),
      })
      const balances = new Map<string, bigint>()
      results.forEach((result, index) => {
        const read = reads[index]
        if (read !== undefined && result.status === "success") {
          balances.set(balanceKey(read.token, read.holder), result.result)
        }
      })
      return balances
    },
    async totalSupply(token, block) {
      try {
        return await client.readContract({
          address: getAddress(token),
          abi: erc20Abi,
          functionName: "totalSupply",
          ...(block === undefined ? {} : { blockNumber: BigInt(block) }),
        })
      } catch {
        return null
      }
    },
  }
}

const address = z.string().regex(/^0x[0-9a-f]{40}$/)
const raw = z.string().regex(/^[0-9]+$/)

async function all<Schema extends z.ZodType>(
  db: D1Database,
  schema: Schema,
  sql: string,
): Promise<z.output<Schema>[]> {
  const result = await db.prepare(sql).all()
  return z.array(schema).parse(result.results)
}

/**
 * Pools and their tokens: the pools table (basic pools from copied
 * PoolCreated rows, basic and CL pools from the earn-pools subgraph's daily
 * read).
 */
export async function poolsOf(
  scanDb: D1Database,
): Promise<{ pool: string; token0: string; token1: string }[]> {
  return all(
    scanDb,
    z.object({ pool: address, token0: address, token1: address }),
    "SELECT pool, token0, token1 FROM pools ORDER BY pool",
  )
}

const marketRowSchema = z.object({
  market_id: z.string(),
  total_supply_assets_raw: raw,
  total_borrow_assets_raw: raw,
})
const collateralRowSchema = z.object({
  market_id: z.string(),
  collateral_raw: raw,
})
const troveRowSchema = z.object({
  coll_raw: raw,
  principal_raw: raw,
  interest_raw: raw,
})
const poolRowSchema = z.object({ total_musd_deposits_raw: raw })
const supplyRowSchema = z.object({
  escrow: z.enum(["vebtc", "vemezo"]),
  supply_raw: raw,
})

/** The live snapshot's read-model rows the closing values come from. */
export type ReadModelRows = {
  markets: z.output<typeof marketRowSchema>[]
  collateral: z.output<typeof collateralRowSchema>[]
  troves: z.output<typeof troveRowSchema>[]
  pool: z.output<typeof poolRowSchema>[]
  supply: z.output<typeof supplyRowSchema>[]
}

/** Borrow and escrow totals from what the live snapshot just wrote. */
export async function readModelPoints(
  readDb: D1Database,
): Promise<DailyPoint[]> {
  const [markets, collateral, troves, pool, supply] = await Promise.all([
    all(
      readDb,
      marketRowSchema,
      `SELECT market_id, total_supply_assets_raw, total_borrow_assets_raw
       FROM morpho_markets WHERE network = 'mezo'`,
    ),
    all(
      readDb,
      collateralRowSchema,
      `SELECT market_id, collateral_raw FROM morpho_positions
       WHERE network = 'mezo'`,
    ),
    all(
      readDb,
      troveRowSchema,
      `SELECT coll_raw, principal_raw, interest_raw FROM troves
       WHERE network = 'mezo'`,
    ),
    all(
      readDb,
      poolRowSchema,
      `SELECT total_musd_deposits_raw FROM stability_pool
       WHERE network = 'mezo'`,
    ),
    all(
      readDb,
      supplyRowSchema,
      `SELECT escrow, supply_raw FROM escrow_supply WHERE network = 'mezo'`,
    ),
  ])
  return readModelPointsOf({ markets, collateral, troves, pool, supply })
}

/**
 * Closing points from read-model rows. Shared with the one-time history
 * backfill (scripts/scan-backfill/daily-history.ts), which builds the same
 * rows from archive reads, so a backfilled close is computed as a live one.
 */
export function readModelPointsOf(rows: ReadModelRows): DailyPoint[] {
  const { markets, collateral, troves, pool, supply } = rows
  const points: DailyPoint[] = []
  for (const market of markets) {
    points.push(
      {
        metric: "morpho.total_supply",
        dimension: market.market_id,
        value: BigInt(market.total_supply_assets_raw),
      },
      {
        metric: "morpho.total_borrow",
        dimension: market.market_id,
        value: BigInt(market.total_borrow_assets_raw),
      },
    )
  }
  const collateralByMarket = new Map<string, bigint>()
  for (const position of collateral) {
    collateralByMarket.set(
      position.market_id,
      (collateralByMarket.get(position.market_id) ?? 0n) +
        BigInt(position.collateral_raw),
    )
  }
  for (const [market, value] of collateralByMarket) {
    points.push({ metric: "morpho.total_collateral", dimension: market, value })
  }
  if (troves.length > 0) {
    let debt = 0n
    let coll = 0n
    for (const trove of troves) {
      debt += BigInt(trove.principal_raw) + BigInt(trove.interest_raw)
      coll += BigInt(trove.coll_raw)
    }
    points.push(
      { metric: "musd.trove_debt", dimension: "", value: debt },
      { metric: "musd.trove_coll", dimension: "", value: coll },
    )
  }
  const stability = pool[0]
  if (stability !== undefined) {
    points.push({
      metric: "musd.stability_pool",
      dimension: "",
      value: BigInt(stability.total_musd_deposits_raw),
    })
  }
  for (const row of supply) {
    points.push({
      metric: "escrow.supply",
      dimension: row.escrow,
      value: BigInt(row.supply_raw),
    })
  }
  return points
}

/** Tokens whose closing total supply is kept: token.total_supply. */
export const supplyTokens = [
  "0x7b7c000000000000000000000000000000000000", // BTC (native supply)
  "0x7b7c000000000000000000000000000000000001", // MEZO
  "0xdd468a1ddc392dcdbef6db6e34e89aa338f9f186", // MUSD
  "0x04671c72aab5ac02a03c1098314b1bb6b560c197", // mUSDC
  "0xeb5a5d39de4ea42c2aa6a57eca2894376683bb8e", // mUSDT
  "0xa10ad2570ea7b93d19fdae6bd7189ff4929bc747", // mSolvBTC
  "0x6a7cd8e1384d49f502b4a4ce9ac9eb320835c5d7", // mcbBTC
  "0xe2232789d4cf5bb1ffada1a105cc59b18d639318", // mbhBTC
] as const

export type ClosingDeps = {
  readDb: D1Database
  scanDb: D1Database
  chain: ClosingChainReader
  nowSeconds: number
  logger: Logger
  /** The block this run's live snapshot read; null when it failed. */
  liveBlock: number | null
}

export type ClosingResult =
  | { status: "written"; points: number; rowsWritten: number }
  | { status: "skipped"; reason: string }

/**
 * One closing value per metric for today, all or nothing: a run whose live
 * snapshot failed, or whose chain reads came back incomplete, writes no
 * row, so a day's rows are always one consistent set (the last complete
 * run's). Rows of today are partial until the day is over.
 */
export async function runClosingValues(
  deps: ClosingDeps,
): Promise<ClosingResult | null> {
  if (!isClosingRun(deps.nowSeconds)) return null
  const block = deps.liveBlock
  if (block === null) {
    deps.logger.warn({
      message: "Live snapshot failed; closing values not recorded this run",
    })
    return { status: "skipped", reason: "Live snapshot failed" }
  }
  const pools = await poolsOf(deps.scanDb)
  const reads = pools.flatMap((pool) => [
    { token: pool.token0, holder: pool.pool },
    { token: pool.token1, holder: pool.pool },
  ])
  const [models, balances, supplies] = await Promise.all([
    readModelPoints(deps.readDb),
    // At the snapshot's own block, so chain reads and read models agree.
    deps.chain.balances(reads, block),
    Promise.all(
      supplyTokens.map((token) => deps.chain.totalSupply(token, block)),
    ),
  ])
  const missing =
    reads.filter((read) => !balances.has(balanceKey(read.token, read.holder)))
      .length + supplies.filter((supply) => supply === null).length
  if (missing > 0) {
    deps.logger.warn({
      message: "Closing reads incomplete; nothing recorded this run",
      missing,
    })
    return { status: "skipped", reason: `${missing} reads failed` }
  }
  const pointsRead: DailyPoint[] = [...models]
  for (const read of reads) {
    const value = balances.get(balanceKey(read.token, read.holder))
    if (value === undefined) continue
    pointsRead.push({
      metric: "pool.balance",
      dimension: `${read.holder}:${read.token}`,
      value,
    })
  }
  supplyTokens.forEach((token, index) => {
    const supply = supplies[index]
    if (supply === undefined || supply === null) return
    pointsRead.push({
      metric: "token.total_supply",
      dimension: token,
      value: supply,
    })
  })
  // The pools' balances summed per token (pool.token_balance), from this
  // same consistent set of reads.
  const points = withRollups(pointsRead)
  // close:<day> records which run (UTC time and block) supplied the
  // day's closing values: the 23:55 run, or an earlier one if it failed.
  const day = dayOf(deps.nowSeconds)
  const time = new Date(deps.nowSeconds * 1000).toISOString().slice(11, 16)
  const rowsWritten = await runBatch(
    deps.scanDb,
    servedBatch(
      upsertStatements(
        dailySpec,
        dailyRows(points, day, "live", deps.nowSeconds, true),
      ),
      [
        cursorStatement(
          `close:${day}`,
          `${time} block ${block}`,
          deps.nowSeconds,
        ),
      ],
    ),
  )
  deps.logger.info({
    message: "Scan closing values written",
    points: points.length,
    rowsWritten,
  })
  return { status: "written", points: points.length, rowsWritten }
}

export const priceDailySpec: UpsertSpec = {
  table: "price_daily",
  columns: ["token", "day", "price", "source", "updated_at"],
  key: ["token", "day"],
  update: ["price", "source", "updated_at"],
  guard: backfillGuard("price_daily"),
}

/** Writes today's closing price per token on a close minute. */
export async function runPriceClose(input: {
  scanDb: D1Database
  prices: Prices
  nowSeconds: number
}): Promise<number> {
  if (!isPriceCloseMinute(input.nowSeconds)) return 0
  // 00:00 closes the day that just ended with the newest price.
  const minuteOfDay = Math.floor((input.nowSeconds % 86_400) / 60)
  const day = dayOf(
    minuteOfDay === 0 ? input.nowSeconds - 60 : input.nowSeconds,
  )
  const rows = (["btc", "mezo"] as const).flatMap((token) => {
    const price = input.prices[token]
    if (price === null) return []
    return [
      {
        token,
        day,
        price: price.usd,
        source: price.source,
        updated_at: input.nowSeconds,
      },
    ]
  })
  return runBatch(
    input.scanDb,
    servedBatch(upsertStatements(priceDailySpec, rows)),
  )
}
