import { formatFixedPoint } from "./money"

// Market prices from pool state, in 18-decimal fixed point (WAD) bigints:
// concentrated-liquidity ticks and sqrt prices, Curve metapool quotes, and
// the liquidity-weighted median across venues. No floats anywhere.

export const WAD = 10n ** 18n
const q96 = 2n ** 96n
const q192 = 2n ** 192n
const maxTick = 887_272

/**
 * sqrt(1.0001^tick) as Q64.96, Uniswap v3's TickMath.getSqrtRatioAtTick
 * (bit-exact).
 */
export function sqrtRatioAtTick(tick: number): bigint {
  if (!Number.isInteger(tick) || Math.abs(tick) > maxTick) {
    throw new RangeError(`Tick out of range: ${tick}`)
  }
  const absTick = BigInt(Math.abs(tick))
  let ratio =
    (absTick & 0x1n) !== 0n
      ? 0xfffcb933bd6fad37aa2d162d1a594001n
      : 0x100000000000000000000000000000000n
  const steps: readonly [bigint, bigint][] = [
    [0x2n, 0xfff97272373d413259a46990580e213an],
    [0x4n, 0xfff2e50f5f656932ef12357cf3c7fdccn],
    [0x8n, 0xffe5caca7e10e4e61c3624eaa0941cd0n],
    [0x10n, 0xffcb9843d60f6159c9db58835c926644n],
    [0x20n, 0xff973b41fa98c081472e6896dfb254c0n],
    [0x40n, 0xff2ea16466c96a3843ec78b326b52861n],
    [0x80n, 0xfe5dee046a99a2a811c461f1969c3053n],
    [0x100n, 0xfcbe86c7900a88aedcffc83b479aa3a4n],
    [0x200n, 0xf987a7253ac413176f2b074cf7815e54n],
    [0x400n, 0xf3392b0822b70005940c7a398e4b70f3n],
    [0x800n, 0xe7159475a2c29b7443b29c7fa6e889d9n],
    [0x1000n, 0xd097f3bdfd2022b8845ad8f792aa5825n],
    [0x2000n, 0xa9f746462d870fdf8a65dc1f90e061e5n],
    [0x4000n, 0x70d869a156d2a1b890bb3df62baf32f7n],
    [0x8000n, 0x31be135f97d08fd981231505542fcfa6n],
    [0x10000n, 0x9aa508b5b7a84e1c677de54f3e99bc9n],
    [0x20000n, 0x5d6af8dedb81196699c329225ee604n],
    [0x40000n, 0x2216e584f5fa1ea926041bedfe98n],
    [0x80000n, 0x48a170391f7dc42444e8fa2n],
  ]
  for (const [bit, factor] of steps) {
    if ((absTick & bit) !== 0n) ratio = (ratio * factor) >> 128n
  }
  if (tick > 0) ratio = ((1n << 256n) - 1n) / ratio
  // Q128.128 to Q64.96, rounding up.
  return (ratio >> 32n) + (ratio % (1n << 32n) === 0n ? 0n : 1n)
}

/**
 * The mean tick over `seconds` from two `observe()` tick cumulatives
 * (older first), rounded toward negative infinity like Uniswap's
 * OracleLibrary.consult.
 */
export function meanTick(
  tickCumulatives: readonly [bigint, bigint],
  seconds: number,
): number {
  const window = BigInt(seconds)
  if (window <= 0n) throw new RangeError("Window must be positive")
  const delta = tickCumulatives[1] - tickCumulatives[0]
  let tick = delta / window
  if (delta < 0n && delta % window !== 0n) tick -= 1n
  return Number(tick)
}

/** Token1 per whole token0, WAD, from a Q64.96 sqrt price. */
export function token1PerToken0(
  sqrtPriceX96: bigint,
  decimals0: number,
  decimals1: number,
): bigint {
  return (
    (sqrtPriceX96 * sqrtPriceX96 * WAD * 10n ** BigInt(decimals0)) /
    (q192 * 10n ** BigInt(decimals1))
  )
}

/** Token0 per whole token1, WAD, from a Q64.96 sqrt price. */
export function token0PerToken1(
  sqrtPriceX96: bigint,
  decimals0: number,
  decimals1: number,
): bigint {
  if (sqrtPriceX96 === 0n) return 0n
  return (
    (q192 * WAD * 10n ** BigInt(decimals1)) /
    (sqrtPriceX96 * sqrtPriceX96 * 10n ** BigInt(decimals0))
  )
}

/** The Q64.96 constant, for callers that check a price is in range. */
export const sqrtPriceOne = q96

/**
 * USD per coin 0 of a Curve metapool whose coin 1 is a USD base pool's LP
 * token: `get_dy(0, 1, 1e18)` (base LP received for one coin 0) times the
 * base pool's `get_virtual_price()` (USD per LP, both WAD). Assumes the
 * base pool's coins at $1.
 */
export function curveMetapoolUsd(dy: bigint, baseVirtualPrice: bigint): bigint {
  return (dy * baseVirtualPrice) / WAD
}

export type WeightedQuote = {
  /** WAD price. */
  price: bigint
  /** Depth in any unit, the same for every quote (USD WAD here). */
  weight: bigint
}

/**
 * The liquidity-weighted median: quotes sorted by price, the first whose
 * cumulative weight reaches half of the total. Null without positive
 * weight. With two quotes of equal weight it is the lower one.
 */
export function weightedMedian(
  quotes: readonly WeightedQuote[],
): bigint | null {
  const usable = quotes.filter((quote) => quote.weight > 0n)
  if (usable.length === 0) return null
  const sorted = [...usable].sort((a, b) =>
    a.price < b.price ? -1 : a.price > b.price ? 1 : 0,
  )
  const total = sorted.reduce((sum, quote) => sum + quote.weight, 0n)
  let cumulative = 0n
  for (const quote of sorted) {
    cumulative += quote.weight
    if (cumulative * 2n >= total) return quote.price
  }
  return sorted[sorted.length - 1]?.price ?? null
}

/** (max - min) / min in basis points, rounded down; 0 for fewer than two. */
export function spreadBps(prices: readonly bigint[]): bigint {
  const positive = prices.filter((price) => price > 0n)
  if (positive.length < 2) return 0n
  let low = positive[0] ?? 0n
  let high = low
  for (const price of positive) {
    if (price < low) low = price
    if (price > high) high = price
  }
  return ((high - low) * 10_000n) / low
}

/** A raw token amount in USD WAD at a WAD price. */
export function usdOfRaw(raw: bigint, decimals: number, price: bigint): bigint {
  return (raw * price) / 10n ** BigInt(decimals)
}

/** A WAD value as a trimmed decimal string ("0.99375"). */
export function wadToDecimal(value: bigint): string {
  return formatFixedPoint(value, 18)
}

/**
 * NTT circulating supply: on the hub (locking) chain, totalSupply minus
 * what the manager holds for the other chains; elsewhere totalSupply.
 */
export function circulatingSupply(
  totalSupply: bigint,
  managerBalance: bigint,
  mode: "locking" | "burning",
): bigint {
  if (mode === "burning") return totalSupply
  return totalSupply > managerBalance ? totalSupply - managerBalance : 0n
}

/** A signed decimal string ("-1.5", "0.09") as a WAD bigint; null if malformed. */
export function signedDecimalToWad(value: string): bigint | null {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value.trim())
  if (match === null) return null
  const whole = BigInt(match[2] ?? "0")
  const fraction = BigInt((match[3] ?? "").slice(0, 18).padEnd(18, "0"))
  const magnitude = whole * WAD + fraction
  return match[1] === "-" ? -magnitude : magnitude
}

/** A signed WAD as a decimal string, cut (toward zero) to `places`. */
export function wadToSignedDecimal(value: bigint, places = 18): string {
  const negative = value < 0n
  const magnitude = negative ? -value : value
  const cut = 10n ** BigInt(18 - Math.min(Math.max(places, 0), 18))
  const text = formatFixedPoint((magnitude / cut) * cut, 18)
  return negative && text !== "0" ? `-${text}` : text
}

/** The sum of signed decimal strings, cut to `places`; null for none. */
export function sumDecimals(
  values: readonly (string | null)[],
  places = 4,
): string | null {
  const present = values
    .filter((value): value is string => value !== null)
    .map(signedDecimalToWad)
    .filter((value): value is bigint => value !== null)
  if (present.length === 0) return null
  return wadToSignedDecimal(
    present.reduce((sum, value) => sum + value, 0n),
    places,
  )
}

/** The mean of signed decimal strings, cut to `places`; null for none. */
export function meanDecimals(
  values: readonly string[],
  places = 4,
): string | null {
  const parsed = values
    .map(signedDecimalToWad)
    .filter((value): value is bigint => value !== null)
  if (parsed.length === 0) return null
  const sum = parsed.reduce((total, value) => total + value, 0n)
  return wadToSignedDecimal(sum / BigInt(parsed.length), places)
}

/**
 * Fee APR in percent from a day's volume: volume × fee × 365 / TVL. An
 * estimate: it assumes today's volume every day and that every LP earns
 * fees (on ve(3,3) venues, liquidity staked in a gauge gives its fees to
 * voters). Null without TVL.
 */
export function feeAprPercent(
  volume24hUsd: string,
  feeBps: number,
  tvlUsd: string,
  places = 4,
): string | null {
  const volume = signedDecimalToWad(volume24hUsd)
  const tvl = signedDecimalToWad(tvlUsd)
  if (volume === null || tvl === null || tvl <= 0n || volume < 0n) return null
  // percent = volume * feeBps / 10_000 * 365 / tvl * 100
  const percent = (volume * BigInt(feeBps) * 365n * WAD) / (100n * tvl)
  return wadToSignedDecimal(percent, places)
}
