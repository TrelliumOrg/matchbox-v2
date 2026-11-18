import { CONTRACTS, MUSD_CONTRACTS } from "@matchbox/chain"
import {
  formatBtc,
  formatTokenWithSymbol,
  groupThousands,
  unitsToDecimal,
} from "@matchbox/domain/format"

/**
 * The tokens Scan names and formats without asking Blockscout: Mezo's core
 * tokens with their decimals. A token outside this table (and outside the
 * page's own Blockscout transfers) is shown by address, never with guessed
 * decimals.
 */

export type TokenInfo = { symbol: string; decimals: number }

/**
 * A token as a Morpho market names it: its decimals from the API (read on
 * chain), null when nobody knows them.
 */
export type MarketToken = { symbol: string; decimals: number | null }

const btc = "0x7b7c000000000000000000000000000000000000"

export const knownTokens: Readonly<Record<string, TokenInfo>> = {
  [btc]: { symbol: "BTC", decimals: 18 },
  [CONTRACTS.mainnet.mezoToken.toLowerCase()]: { symbol: "MEZO", decimals: 18 },
  [MUSD_CONTRACTS.mainnet.musd.toLowerCase()]: { symbol: "MUSD", decimals: 18 },
  "0x04671c72aab5ac02a03c1098314b1bb6b560c197": {
    symbol: "mUSDC",
    decimals: 6,
  },
  "0xeb5a5d39de4ea42c2aa6a57eca2894376683bb8e": {
    symbol: "mUSDT",
    decimals: 6,
  },
}

export type TokenLookup = (address: string | null) => TokenInfo | null

/** Looks in `extra` (a page's own Blockscout tokens) after the table. */
export function tokenLookup(
  extra: Readonly<Record<string, TokenInfo>> = {},
): TokenLookup {
  return (address) => {
    if (address === null) return null
    const key = address.toLowerCase()
    return knownTokens[key] ?? extra[key] ?? null
  }
}

/**
 * "1.2400 BTC", "6,086.96 MEZO": an amount in base units by the house
 * rules (BTC 4 decimals, others by symbol); null without the token; its
 * base units, labelled so, when its decimals are not known (never 18).
 */
export function formatTokenAmount(
  units: string,
  token: MarketToken | null,
): string | null {
  if (token === null) return null
  if (token.decimals === null) {
    const negative = units.startsWith("-")
    const whole = groupThousands(BigInt(negative ? units.slice(1) : units))
    return `${negative ? "-" : ""}${whole} raw units of ${token.symbol}`
  }
  const decimal = unitsToDecimal(units, token.decimals)
  if (token.symbol === "BTC") return formatBtc(decimal).text
  return formatTokenWithSymbol(decimal, token.symbol)
}
