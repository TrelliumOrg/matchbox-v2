import type {
  Prices,
  TokenAmount,
  TokenRef,
  ValueBreakdown,
} from "@matchbox/contracts/read-models"
import {
  decimalToScaledBigInt,
  formatFixedPoint,
  tokenUsdMicroValue,
} from "@matchbox/domain"

// Exact decimal arithmetic for read models. Amounts are whole-unit decimal
// strings; USD values are rounded half up to cents.

/** Tokens the read models know by address (lower-case). */
export const knownTokens: Readonly<Record<string, TokenRef>> = {
  "0x7b7c000000000000000000000000000000000000": {
    address: "0x7b7c000000000000000000000000000000000000",
    symbol: "BTC",
    name: "Bitcoin",
    decimals: 18,
  },
  "0x7b7c000000000000000000000000000000000001": {
    address: "0x7b7c000000000000000000000000000000000001",
    symbol: "MEZO",
    name: "Mezo",
    decimals: 18,
  },
  "0xdd468a1ddc392dcdbef6db6e34e89aa338f9f186": {
    address: "0xdd468a1ddc392dcdbef6db6e34e89aa338f9f186",
    symbol: "MUSD",
    name: "Mezo USD",
    decimals: 18,
  },
  "0x04671c72aab5ac02a03c1098314b1bb6b560c197": {
    address: "0x04671c72aab5ac02a03c1098314b1bb6b560c197",
    symbol: "mUSDC",
    name: "Mezo Circle USDC",
    decimals: 6,
  },
  "0xeb5a5d39de4ea42c2aa6a57eca2894376683bb8e": {
    address: "0xeb5a5d39de4ea42c2aa6a57eca2894376683bb8e",
    symbol: "mUSDT",
    name: "Mezo Tether USD",
    decimals: 6,
  },
}

export const btcToken = "0x7b7c000000000000000000000000000000000000"

export const btcTokenRef: TokenRef = {
  address: btcToken,
  symbol: "BTC",
  name: "Bitcoin",
  decimals: 18,
}
export const mezoToken = "0x7b7c000000000000000000000000000000000001"

const stablecoins = new Set([
  "0xdd468a1ddc392dcdbef6db6e34e89aa338f9f186",
  "0x04671c72aab5ac02a03c1098314b1bb6b560c197",
  "0xeb5a5d39de4ea42c2aa6a57eca2894376683bb8e",
])

/** Whole-unit decimal of a base-unit integer ("412000000000000" → "0.000412"). */
export function fromRaw(raw: bigint, decimals: number): string {
  return formatFixedPoint(raw, decimals)
}

function microToCents(micro: bigint): bigint {
  return (micro + 5_000n) / 10_000n
}

function centsToDecimal(cents: bigint): string {
  const sign = cents < 0n ? "-" : ""
  const absolute = cents < 0n ? -cents : cents
  const whole = absolute / 100n
  const fraction = (absolute % 100n).toString().padStart(2, "0")
  return `${sign}${whole}.${fraction}`
}

/** Exact cents of a non-negative or negative decimal, half up. */
export function toCents(value: string): bigint {
  const negative = value.startsWith("-")
  const micro = decimalToScaledBigInt(negative ? value.slice(1) : value, 6)
  const cents = microToCents(micro)
  return negative ? -cents : cents
}

/** `amount × price`, rounded to cents ("0.000412" × "105710" → "43.55"). */
export function usdValue(amount: string, priceUsd: string): string {
  const scaled = decimalToScaledBigInt(amount, 18)
  return centsToDecimal(microToCents(tokenUsdMicroValue(scaled, 18, priceUsd)))
}

export function sumUsd(values: readonly string[]): string {
  return centsToDecimal(values.reduce((sum, value) => sum + toCents(value), 0n))
}

export function subtractUsd(left: string, right: string): string {
  return centsToDecimal(toCents(left) - toCents(right))
}

/** The USD price a token is valued at now, or null when it has none. */
export function currentPrice(token: string, prices: Prices): string | null {
  const address = token.toLowerCase()
  if (stablecoins.has(address)) return "1"
  if (address === btcToken) return prices.btc?.usd ?? null
  if (address === mezoToken) return prices.mezo?.usd ?? null
  return null
}

export function priceTokenAmount(
  amount: TokenAmount,
  prices: Prices,
): TokenAmount {
  const price = currentPrice(amount.token.address, prices)
  return {
    ...amount,
    usd: price === null ? null : usdValue(amount.amount, price),
  }
}

/** Reprices every token at current prices and re-totals. */
export function priceBreakdown(
  tokens: readonly TokenAmount[],
  prices: Prices,
): ValueBreakdown {
  const priced = tokens.map((token) => priceTokenAmount(token, prices))
  return {
    usd: sumUsd(
      priced.flatMap((token) => (token.usd === null ? [] : [token.usd])),
    ),
    tokens: priced,
  }
}

/** Adds token amounts by token address, keeping first-seen order. */
export function mergeTokenAmounts(
  groups: readonly (readonly TokenAmount[])[],
): TokenAmount[] {
  const totals = new Map<string, { token: TokenRef; raw: bigint }>()
  for (const group of groups) {
    for (const entry of group) {
      const key = entry.token.address
      const raw = decimalToScaledBigInt(entry.amount, entry.token.decimals)
      const current = totals.get(key)
      totals.set(key, {
        token: entry.token,
        raw: (current?.raw ?? 0n) + raw,
      })
    }
  }
  return [...totals.values()].map(({ token, raw }) => ({
    token,
    amount: fromRaw(raw, token.decimals),
    usd: null,
  }))
}
