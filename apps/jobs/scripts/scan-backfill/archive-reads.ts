import path from "node:path"
import { createMezoClient } from "@matchbox/api/chain/client"
import {
  baseMezoToken,
  mezoMusdPool,
  mezoUsdFromSqrtPriceX96,
  skipBtcUsdOracle,
} from "@matchbox/api/market/prices"
import {
  BaseError,
  ContractFunctionZeroDataError,
  erc20Abi,
  formatUnits,
  getAddress,
} from "viem"
import { z } from "zod"
import { priceDailySpec, supplyTokens } from "../../src/scan/closing"
import { earnPoolsUrl } from "../../src/scan/earn-pools"
import { upsertStatements } from "../../src/scan/statements"
import { dayOf, dayStart, nextDay } from "../../src/scan/transform"
import {
  blockTimestamp,
  bump,
  dailyStatements,
  daysSchema,
  lastBlockBefore,
  logger,
  nowSeconds,
  Pacer,
  parseCommon,
  pointsOf,
  rpcCall,
  StateFile,
  writeSqlFiles,
} from "./lib"

// (e) Pool liquidity and historical prices, one archive block per day: the
// day's last block (the closing state), found by a secant search on block
// timestamps (a few headers a day). At that block:
// - every basic and CL pool's token balances (balanceOf the pool, one
//   multicall; the pool list comes from Mezo's earn-pools subgraph, the
//   only source that has the CL pools): pool.balance per pool:token;
// - totalSupply() of BTC, MEZO, MUSD, mUSDC, mUSDT and the BTC wrappers:
//   token.total_supply (the live writer's read; BTC is its native supply);
// - BTC from the Skip BTC/USD oracle on Mezo (latestRoundData), the source
//   the price job uses: price_daily btc.
// MEZO is priced by the price job from the Aerodrome Slipstream MEZO/MUSD
// pool on Base, so it is read at Base's last block of the day (Base blocks
// are 2 s apart, so that block is computed from the head, then checked):
// price_daily mezo. A public Base RPC may not serve old state; the run
// reports it if so.
//
//   pnpm --filter @matchbox/jobs exec tsx scripts/scan-backfill/archive-reads.ts \
//     --from 2025-05-01 [--to YYYY-MM-DD] [--mezo-rpc <url>] [--base-rpc <url>] \
//     [--max-requests N] [--write] [--fresh]
//
// The ABIs here are viem's ERC-20 ABI and raw selectors (slot0 0x3850c7bd,
// latestRoundData 0xfeaf968c, decimals 0x313ce567), since packages/chain
// does not export an aggregator or Slipstream pool ABI.

const { values, common } = parseCommon({
  from: { type: "string" },
  to: { type: "string" },
  "mezo-rpc": { type: "string" },
  "base-rpc": { type: "string" },
})
const mezoRpc = values["mezo-rpc"] ?? "https://rpc-internal.mezo.org"
const baseRpc = values["base-rpc"] ?? "https://mainnet.base.org"
const day = z.iso.date()
const today = dayOf(nowSeconds())
const from = day.parse(values.from ?? "2025-05-01")
const to = day.parse(values.to ?? dayOf(nowSeconds() - 86_400))

const pacer = new Pacer(150)
const hex = z.string().regex(/^0x[0-9a-fA-F]*$/)

function rpc(url: string, method: string, params: unknown[]) {
  return rpcCall(pacer, url, method, params)
}

function timestampOf(url: string, block: number): Promise<number> {
  return blockTimestamp(pacer, url, block)
}

function word(data: string, index: number): bigint {
  return BigInt(`0x${data.slice(2 + index * 64, 2 + (index + 1) * 64) || "0"}`)
}

async function ethCall(
  url: string,
  address: string,
  data: string,
  block: number,
) {
  return hex.parse(
    await rpc(url, "eth_call", [
      { to: address, data },
      `0x${block.toString(16)}`,
    ]),
  )
}

const stateSchema = z.object({
  next: z.string(),
  days: daysSchema,
  prices: z.record(z.string(), z.record(z.string(), z.string())),
  failures: z.array(z.string()),
  /** Last closing block found, as the next search's lower bound. */
  low: z.number().int(),
  lowTs: z.number().int(),
})
type State = z.infer<typeof stateSchema>

/**
 * Records the reads of a day that failed for a reason other than a token
 * with no code at that block (not deployed yet, so no balance to read): a
 * failed batch (out of gas, rate limit, timeout) is then listed in
 * state.failures instead of leaving the day short without a trace.
 */
function noteFailures(
  dayKey: string,
  what: string,
  errors: readonly (Error | undefined)[],
): void {
  const real = errors.filter(
    (error): error is Error =>
      error !== undefined &&
      !(
        error instanceof BaseError &&
        error.walk((cause) => cause instanceof ContractFunctionZeroDataError)
      ),
  )
  const first = real[0]
  if (first === undefined) return
  state.failures.push(
    `${dayKey} ${what}: ${real.length} reads failed: ${first.message.split("\n")[0]?.slice(0, 120)}`,
  )
}

const store = new StateFile<State>(
  path.join(common.out, "archive-reads"),
  stateSchema,
  () => ({ next: from, days: {}, prices: {}, failures: [], low: 1, lowTs: 0 }),
)
const state = store.load(common.fresh)

// Pools, basic and CL, with their tokens (1 subgraph request).
const poolsResponse = await pacer.fetch(earnPoolsUrl, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    query:
      "{ pools(first: 1000) { id token0 { id } token1 { id } } clpools(first: 1000) { id token0 { id } token1 { id } } }",
  }),
})
const poolRef = z.object({
  id: z.string(),
  token0: z.object({ id: z.string() }),
  token1: z.object({ id: z.string() }),
})
const pools = z
  .object({
    data: z.object({ pools: z.array(poolRef), clpools: z.array(poolRef) }),
  })
  .parse(await poolsResponse.json())
const allPools = [...pools.data.pools, ...pools.data.clpools]

const mezo = createMezoClient([mezoRpc])
const headBlock = Number(hex.parse(await rpc(mezoRpc, "eth_blockNumber", [])))
const headTs = await timestampOf(mezoRpc, headBlock)
if (state.lowTs === 0) state.lowTs = await timestampOf(mezoRpc, state.low)
const baseHead = Number(hex.parse(await rpc(baseRpc, "eth_blockNumber", [])))
const baseHeadTs = await timestampOf(baseRpc, baseHead)
const oracleDecimals = Number(
  word(await ethCall(mezoRpc, skipBtcUsdOracle, "0x313ce567", headBlock), 0),
)
const mezoIsToken0 =
  `0x${(await ethCall(baseRpc, mezoMusdPool, "0x0dfe1681", baseHead)).slice(-40)}`.toLowerCase() ===
  baseMezoToken
const started = Date.now()

while (
  state.next <= to &&
  state.next < today &&
  pacer.requests < common.maxRequests
) {
  const dayKey = state.next
  const close = dayStart(nextDay(dayKey))
  try {
    const block = await lastBlockBefore(
      (number) => timestampOf(mezoRpc, number),
      close,
      {
        low: state.low,
        lowTs: state.lowTs,
        high: headBlock,
        highTs: headTs,
      },
    )
    state.low = block
    state.lowTs = await timestampOf(mezoRpc, block)
    const reads = allPools.flatMap((pool) =>
      [pool.token0.id, pool.token1.id].map((token) => ({
        pool: pool.id,
        token,
      })),
    )
    const balances = await mezo.multicall({
      blockNumber: BigInt(block),
      allowFailure: true,
      // Mezo's archive nodes answer "out of gas" (whatever gas is sent) to
      // an eth_call of more than about 70 balanceOf reads at blocks before
      // Feb 2026, which failed every pool read of those days. 1 KB of inner
      // call data is 28 reads a batch, well under that.
      batchSize: 1024,
      contracts: reads.map((read) => ({
        address: getAddress(read.token),
        abi: erc20Abi,
        functionName: "balanceOf" as const,
        args: [getAddress(read.pool)] as const,
      })),
    })
    noteFailures(
      dayKey,
      "pool.balance",
      balances.map((result) => result.error),
    )
    balances.forEach((result, index) => {
      const read = reads[index]
      if (read === undefined || result.status !== "success") return
      bump(
        state.days,
        dayKey,
        "pool.balance",
        `${read.pool}:${read.token}`,
        result.result,
      )
    })
    // token.total_supply: totalSupply() at the day's close (BTC's is its
    // native supply on Mezo), the same read the live writer makes.
    const supplies = await mezo.multicall({
      blockNumber: BigInt(block),
      allowFailure: true,
      contracts: supplyTokens.map((token) => ({
        address: getAddress(token),
        abi: erc20Abi,
        functionName: "totalSupply" as const,
      })),
    })
    noteFailures(
      dayKey,
      "token.total_supply",
      supplies.map((result) => result.error),
    )
    supplies.forEach((result, index) => {
      const token = supplyTokens[index]
      if (token === undefined || result.status !== "success") return
      bump(state.days, dayKey, "token.total_supply", token, result.result)
    })
    const prices: Record<string, string> = {}
    try {
      const round = await ethCall(
        mezoRpc,
        skipBtcUsdOracle,
        "0xfeaf968c",
        block,
      )
      const answer = word(round, 1)
      if (answer > 0n) prices.btc = formatUnits(answer, oracleDecimals)
    } catch (error) {
      state.failures.push(`${dayKey} btc: ${String(error).slice(0, 120)}`)
    }
    try {
      const baseBlock = baseHead - Math.ceil((baseHeadTs - (close - 1)) / 2)
      const slot0 = await ethCall(
        baseRpc,
        mezoMusdPool,
        "0x3850c7bd",
        baseBlock,
      )
      if (slot0 === "0x") {
        state.failures.push(
          `${dayKey} mezo: no pool state at Base block ${baseBlock}`,
        )
      }
      const sqrtPriceX96 = word(slot0, 0)
      if (sqrtPriceX96 > 0n) {
        prices.mezo = formatUnits(
          mezoUsdFromSqrtPriceX96(sqrtPriceX96, {
            mezoIsToken0,
            mezoDecimals: 18,
            musdDecimals: 18,
          }),
          18,
        )
      }
    } catch (error) {
      state.failures.push(`${dayKey} mezo: ${String(error).slice(0, 120)}`)
    }
    state.prices[dayKey] = prices
  } catch (error) {
    state.failures.push(`${dayKey}: ${String(error).slice(0, 160)}`)
  }
  state.next = nextDay(dayKey)
  store.save(state)
}

const daysDone = Object.keys(state.prices).sort()
const elapsed = (Date.now() - started) / 1000
const perDay = daysDone.length === 0 ? 0 : pacer.requests / daysDone.length
logger.info({
  message:
    state.next > to || state.next >= today
      ? "Archive reads complete"
      : "Stopped at the request budget",
  days: daysDone.length,
  pools: allPools.length,
  requests: pacer.requests,
  requestsPerDay: perDay.toFixed(1),
  elapsedSeconds: Math.round(elapsed),
  failures: state.failures.slice(-5),
  sample: daysDone.slice(-2).map((key) => ({ day: key, ...state.prices[key] })),
})
if (common.write) {
  const priceRows = Object.entries(state.prices).flatMap(([dayKey, prices]) =>
    Object.entries(prices).map(([token, price]) => ({
      token,
      day: dayKey,
      price,
      source:
        token === "btc" ? "backfill:skip-oracle" : "backfill:aerodrome-cl",
      updated_at: nowSeconds(),
    })),
  )
  const files = writeSqlFiles(path.join(common.out, "archive-reads"), "daily", [
    ...dailyStatements(pointsOf(state.days), "backfill:archive", nowSeconds()),
    ...upsertStatements(priceDailySpec, priceRows),
  ])
  logger.info({ message: "SQL written", files })
}
