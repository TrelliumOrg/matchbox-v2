import { formatUnits } from "@matchbox/api/market/money"
import {
  baseMezoToken,
  baseMusdToken,
  mezoMusdPool,
  mezoUsdFromSqrtPriceX96,
  type ReferencePrices,
  skipBtcUsdOracle,
} from "@matchbox/api/market/prices"
import type { ReferencePrice } from "@matchbox/contracts/market"
import { type Address, parseAbi } from "viem"
import { lastBlockBefore } from "./lib"

// The reference prices the live price job and market cron read
// (apps/api/src/market/prices.ts, readReferencePrices), pinned to a past
// block: BTC from the Skip BTC/USD oracle on Mezo, MEZO from the Aerodrome
// Slipstream MEZO/MUSD pool on Base (MUSD at $1). The same checks reject
// the same answers; the oracle's staleness is measured from the block's
// time instead of the wall clock. A price that cannot be read is null,
// with the reason, never an estimate.

const aggregatorAbi = parseAbi([
  "function decimals() view returns (uint8)",
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
])
const poolAbi = parseAbi([
  "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, bool unlocked)",
  "function liquidity() view returns (uint128)",
  "function token0() view returns (address)",
  "function token1() view returns (address)",
])
const decimalsAbi = parseAbi(["function decimals() view returns (uint8)"])

/** As the live reader: oracle rounds older than this are stale. */
export const maxOracleAgeSeconds = 3_600n
const maxMezoUsdWhole = 1_000_000n
const priceDecimals = 18

/** The one viem call the readers make (a fake in tests). */
export type ContractReader = {
  readContract(args: {
    address: Address
    abi: readonly unknown[]
    functionName: string
    blockNumber: bigint
  }): Promise<unknown>
}

/**
 * A price, or why there is none: `rejected` when the source answered and
 * the live checks refuse the answer (the live job publishes no price then
 * either), not when the read itself failed (worth retrying).
 */
export type PriceAt =
  | { price: ReferencePrice; reason: null; rejected: false }
  | { price: null; reason: string; rejected: boolean }

function rejected(reason: string): PriceAt {
  return { price: null, reason, rejected: true }
}

function reasonOf(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  return text.split("\n")[0]?.slice(0, 160) ?? "unknown"
}

function sameAddress(a: unknown, b: string): boolean {
  return typeof a === "string" && a.toLowerCase() === b.toLowerCase()
}

/** BTC/USD from the Skip oracle on Mezo at `block` (time `blockTs`). */
export async function btcUsdAt(
  mezo: ContractReader,
  block: bigint,
  blockTs: number,
): Promise<PriceAt> {
  try {
    const call = {
      address: skipBtcUsdOracle,
      abi: aggregatorAbi,
      blockNumber: block,
    }
    const [round, decimals] = await Promise.all([
      mezo.readContract({ ...call, functionName: "latestRoundData" }),
      mezo.readContract({ ...call, functionName: "decimals" }),
    ])
    const answer = Array.isArray(round) ? round[1] : null
    const updatedAt = Array.isArray(round) ? round[3] : null
    if (typeof answer !== "bigint" || typeof updatedAt !== "bigint") {
      return rejected("Oracle answered an unexpected shape")
    }
    if (typeof decimals !== "number" || decimals < 0 || decimals > 36) {
      return rejected(`Oracle decimals ${String(decimals)}`)
    }
    if (answer <= 0n) {
      return rejected(`Oracle answer is not positive: ${answer}`)
    }
    if (BigInt(blockTs) - updatedAt > maxOracleAgeSeconds) {
      return rejected(
        `Oracle round is stale (updatedAt ${updatedAt}, block time ${blockTs})`,
      )
    }
    return {
      price: { usd: formatUnits(answer, decimals), source: "skip-oracle" },
      reason: null,
      rejected: false,
    }
  } catch (error) {
    return { price: null, reason: reasonOf(error), rejected: false }
  }
}

/** MEZO/USD from the Aerodrome MEZO/MUSD pool on Base at `block`. */
export async function mezoUsdAt(
  base: ContractReader,
  block: bigint,
): Promise<PriceAt> {
  try {
    const pool = { address: mezoMusdPool, abi: poolAbi, blockNumber: block }
    const [slot0, liquidity, token0, token1, mezoDecimals, musdDecimals] =
      await Promise.all([
        base.readContract({ ...pool, functionName: "slot0" }),
        base.readContract({ ...pool, functionName: "liquidity" }),
        base.readContract({ ...pool, functionName: "token0" }),
        base.readContract({ ...pool, functionName: "token1" }),
        base.readContract({
          address: baseMezoToken,
          abi: decimalsAbi,
          functionName: "decimals",
          blockNumber: block,
        }),
        base.readContract({
          address: baseMusdToken,
          abi: decimalsAbi,
          functionName: "decimals",
          blockNumber: block,
        }),
      ])
    const mezoIsToken0 =
      sameAddress(token0, baseMezoToken) && sameAddress(token1, baseMusdToken)
    const mezoIsToken1 =
      sameAddress(token0, baseMusdToken) && sameAddress(token1, baseMezoToken)
    if (!mezoIsToken0 && !mezoIsToken1) {
      return rejected(`Pool pair is ${token0}/${token1}`)
    }
    const sqrtPriceX96 = Array.isArray(slot0) ? slot0[0] : null
    if (
      typeof sqrtPriceX96 !== "bigint" ||
      typeof liquidity !== "bigint" ||
      typeof mezoDecimals !== "number" ||
      typeof musdDecimals !== "number"
    ) {
      return rejected("Pool answered an unexpected shape")
    }
    if (liquidity === 0n || sqrtPriceX96 === 0n) {
      return rejected("Pool has no liquidity")
    }
    const price = mezoUsdFromSqrtPriceX96(sqrtPriceX96, {
      mezoIsToken0,
      mezoDecimals,
      musdDecimals,
    })
    const usd = formatUnits(price, priceDecimals)
    if (
      price === 0n ||
      price >= maxMezoUsdWhole * 10n ** BigInt(priceDecimals)
    ) {
      return rejected(`MEZO price out of range: ${usd}`)
    }
    return {
      price: { usd, source: "aerodrome-cl" },
      reason: null,
      rejected: false,
    }
  } catch (error) {
    return { price: null, reason: reasonOf(error), rejected: false }
  }
}

/** Both reference prices, as the market cron's snapshot stores them. */
export function referencePricesOf(
  btc: PriceAt,
  mezo: PriceAt,
): ReferencePrices {
  return { btcUsd: btc.price, mezoUsd: mezo.price }
}

/**
 * Base's last block below `bound`: Base blocks are 2 s apart, so the
 * estimate from Base's head is within a few blocks; the search then runs
 * between bounds a minute either side (or the whole chain if they do not
 * bracket it).
 */
export async function baseBlockBefore(
  timestampOf: (block: number) => Promise<number>,
  head: { block: number; timestamp: number },
  bound: number,
): Promise<number> {
  const estimate = head.block - Math.ceil((head.timestamp - bound) / 2)
  const low = Math.max(1, estimate - 30)
  const high = Math.min(head.block, estimate + 30)
  const [lowTs, highTs] = await Promise.all([
    timestampOf(low),
    timestampOf(high),
  ])
  if (lowTs < bound && highTs >= bound) {
    return lastBlockBefore(timestampOf, bound, { low, lowTs, high, highTs })
  }
  return lastBlockBefore(timestampOf, bound, {
    low: 1,
    lowTs: await timestampOf(1),
    high: head.block,
    highTs: head.timestamp,
  })
}
