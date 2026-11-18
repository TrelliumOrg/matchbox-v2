import { EPOCH_SECONDS } from "@matchbox/domain/epoch"
import {
  formatCompact,
  formatUsd,
  parseDecimal,
  unitsToDecimal,
} from "@matchbox/domain/format"
import { knownTokens } from "./tokens"

/**
 * USD for token amounts from the stored daily prices (`/prices/btc`,
 * `/prices/mezo`, one close a day), by the API token registry's pricing:
 * BTC and BTC wrappers at BTC's price, MEZO at MEZO's, the dollar
 * stablecoins taken as $1, anything else unpriced. Exact: an amount's USD
 * is bigint arithmetic at 18 places (financial-precision.md), and a total
 * that leaves out an unpriced token says so (`unpriced`), never $0.
 */

/** What a token's USD rests on. */
export type PriceBasis = "btc" | "mezo" | "usd"

type PricedToken = { symbol: string; decimals: number; basis: PriceBasis }

/**
 * The registry's priced tokens (apps/api/src/read-models/token-registry.ts,
 * `pricing` not null), by lower-case address. Keep the two in step.
 */
const pricedTokens: Readonly<Record<string, PricedToken>> = {
  "0x7b7c000000000000000000000000000000000000": {
    symbol: "BTC",
    decimals: 18,
    basis: "btc",
  },
  "0x7b7c000000000000000000000000000000000001": {
    symbol: "MEZO",
    decimals: 18,
    basis: "mezo",
  },
  "0xdd468a1ddc392dcdbef6db6e34e89aa338f9f186": {
    symbol: "MUSD",
    decimals: 18,
    basis: "usd",
  },
  "0x04671c72aab5ac02a03c1098314b1bb6b560c197": {
    symbol: "mUSDC",
    decimals: 6,
    basis: "usd",
  },
  "0xeb5a5d39de4ea42c2aa6a57eca2894376683bb8e": {
    symbol: "mUSDT",
    decimals: 6,
    basis: "usd",
  },
  "0xa10ad2570ea7b93d19fdae6bd7189ff4929bc747": {
    symbol: "mSolvBTC",
    decimals: 18,
    basis: "btc",
  },
  "0xdf708431162ba247ddae362d2c919e0fbafcf9de": {
    symbol: "mxSolvBTC",
    decimals: 18,
    basis: "btc",
  },
  "0x6a7cd8e1384d49f502b4a4ce9ac9eb320835c5d7": {
    symbol: "mcbBTC",
    decimals: 8,
    basis: "btc",
  },
  "0xf333171788de7005695b2e8fb9cae97ba9c4dd7a": {
    symbol: "avBTCm",
    decimals: 18,
    basis: "btc",
  },
  "0xb894b11a78b762c82cb095148f5bc11dc93c3560": {
    symbol: "avMEZOm",
    decimals: 18,
    basis: "mezo",
  },
}

/** BTC and MEZO, Mezo's two native tokens (lower case). */
export const btcToken = "0x7b7c000000000000000000000000000000000000"
export const mezoToken = "0x7b7c000000000000000000000000000000000001"

/** A token's symbol and pricing; null for a token we do not price. */
export function pricedToken(address: string): PricedToken | null {
  const key = address.toLowerCase()
  return pricedTokens[key] ?? null
}

/**
 * USD per whole token on `day` as a decimal string, by the token's
 * pricing; null when it has none that day.
 */
export function tokenPriceOn(
  token: string,
  day: string,
  prices: DailyPrices,
): string | null {
  const info = pricedToken(token)
  if (info === null) return null
  if (info.basis === "usd") return "1"
  return priceOn(prices[info.basis], day)
}

/** A priced token's address by its symbol ("mUSDC"); null for others. */
export function tokenBySymbol(symbol: string): string | null {
  for (const [address, token] of Object.entries(pricedTokens)) {
    if (token.symbol === symbol) return address
  }
  return null
}

/** One daily close: "YYYY-MM-DD" and USD per whole token. */
export type DailyPrice = { day: string; price: string }

/** BTC's and MEZO's daily closes, oldest first; empty when not read. */
export type DailyPrices = Readonly<{
  btc: readonly DailyPrice[]
  mezo: readonly DailyPrice[]
}>

export const noPrices: DailyPrices = { btc: [], mezo: [] }

/** "2026-11-05" for unix seconds. */
export function dayOf(seconds: number): string {
  return new Date(seconds * 1000).toISOString().slice(0, 10)
}

/**
 * The close on `day`, else the latest before it (a day with no row yet,
 * today before its close is written). Null before the history starts:
 * an earlier price is never borrowed from later.
 */
export function priceOn(
  points: readonly DailyPrice[],
  day: string,
): string | null {
  let low = 0
  let high = points.length - 1
  let found: string | null = null
  while (low <= high) {
    const middle = (low + high) >> 1
    const point = points[middle]
    if (point === undefined) break
    if (point.day <= day) {
      found = point.price
      low = middle + 1
    } else {
      high = middle - 1
    }
  }
  return found
}

/** The latest close, null with none. */
export function latestPrice(points: readonly DailyPrice[]): DailyPrice | null {
  return points.at(-1) ?? null
}

const places = 18
const scale = 10n ** BigInt(places)

/** A decimal string at 18 places (digits beyond are cut). */
export function scaled(decimal: string): bigint {
  const { negative, int, fraction } = parseDecimal(decimal)
  const kept = fraction.padEnd(places, "0").slice(0, places)
  const value = int * scale + BigInt(kept === "" ? "0" : kept)
  return negative ? -value : value
}

/** USD per whole token on `day`, 18 places; null when it has no price. */
function unitPrice(
  token: PricedToken,
  day: string,
  prices: DailyPrices,
): bigint | null {
  if (token.basis === "usd") return scale
  const price = priceOn(prices[token.basis], day)
  return price === null ? null : scaled(price)
}

/** USD at 18 places, from an amount in base units. */
export type Usd = bigint

/** A whole-unit amount ("1.24") at a USD price ("102000.5"), exact. */
export function decimalUsd(amount: string, price: string): Usd {
  return (scaled(amount) * scaled(price)) / scale
}

/** One token of a priced map. */
export type PricedLine = {
  token: string
  symbol: string | null
  units: bigint
  /** USD at 18 places; null when the token has no price that day. */
  usd: Usd | null
}

/**
 * A {token: base units} map in USD: `usd` sums the priced tokens, and
 * `tokens` keeps each with its own USD (null unpriced) so a total that
 * leaves one out can say so. Fits `usdText` (`Priced`) through `asPriced`.
 */
export type PricedMap = { usd: Usd; tokens: PricedLine[] }

export const emptyPriced: PricedMap = { usd: 0n, tokens: [] }

/** One amount of one token in USD on `day`; null unpriced. */
export function amountUsd(
  token: string,
  units: bigint,
  day: string,
  prices: DailyPrices,
): Usd | null {
  const info = pricedToken(token)
  if (info === null) return null
  const price = unitPrice(info, day, prices)
  if (price === null) return null
  return (units * price) / 10n ** BigInt(info.decimals)
}

/** A token map's USD at `day`'s closes. Zero amounts are left out. */
export function priceMap(
  map: Readonly<Record<string, string>>,
  day: string,
  prices: DailyPrices,
): PricedMap {
  const tokens: PricedLine[] = []
  let usd = 0n
  for (const [token, amount] of Object.entries(map)) {
    const units = BigInt(amount)
    if (units === 0n) continue
    const value = amountUsd(token, units, day, prices)
    if (value !== null) usd += value
    tokens.push({
      token: token.toLowerCase(),
      symbol:
        pricedToken(token)?.symbol ??
        knownTokens[token.toLowerCase()]?.symbol ??
        null,
      units,
      usd: value,
    })
  }
  return { usd, tokens }
}

/** Two priced maps together: USD added, tokens kept apart. */
export function addPriced(a: PricedMap, b: PricedMap): PricedMap {
  return { usd: a.usd + b.usd, tokens: [...a.tokens, ...b.tokens] }
}

/** Whether a token in the map has no price: its USD is then a floor. */
export function anyUnpriced(map: PricedMap): boolean {
  return map.tokens.some((line) => line.usd === null)
}

/** USD at 18 places as a decimal string ("1180.5"). */
export function usdDecimal(usd: Usd): string {
  return unitsToDecimal(usd.toString(), places)
}

/** "$1,180", "$20,200", "$1.24M" (whole dollars, compact from $1M). */
export function usdShort(usd: Usd): string {
  const decimal = usdDecimal(usd)
  const { negative, int } = parseDecimal(decimal)
  if (int < 1_000_000n) return formatUsd(decimal, "whole")
  return `${negative ? "-" : ""}$${formatCompact(int)}`
}

/** "$350.2k": compact from $1,000 (a note under an amount). */
export function usdCompact(usd: Usd): string {
  const decimal = usdDecimal(usd)
  const { negative, int } = parseDecimal(decimal)
  if (int < 1_000n) return formatUsd(decimal)
  return `${negative ? "-" : ""}$${formatCompact(int)}`
}

/**
 * A priced map as text: "$1,180"; "$120 + unpriced" when a token has no
 * price; "Unpriced" when none has one; null for an empty map. `format`
 * writes the USD ("whole" by default).
 */
export function pricedText(
  map: PricedMap,
  format: (usd: Usd) => string = usdShort,
): string | null {
  if (map.tokens.length === 0) return null
  if (!anyUnpriced(map)) return format(map.usd)
  const priced = map.tokens.some((line) => line.usd !== null)
  return priced ? `${format(map.usd)} + unpriced` : "Unpriced"
}

/**
 * The day an epoch's amounts are priced on: its last day's close, or the
 * latest close while it runs (`now`).
 */
export function epochPriceDay(epochStart: number, now: number): string {
  return dayOf(Math.min(epochStart + EPOCH_SECONDS - 1, now))
}

/** A chart height in whole dollars (display only). */
export function usdHeight(usd: Usd): number {
  return Number(usd / 10n ** 16n) / 100
}
