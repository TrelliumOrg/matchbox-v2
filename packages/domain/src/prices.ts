import { getTokenUsdPrice } from "@matchbox/chain"
import { decimalToScaledBigInt, tokenUsdMicroValue } from "./money"

// Reference prices for reward tokens (Stuart's providers/prices.ts on
// feat/pro-rebuild, without the fetching). There is no hard-coded MEZO
// price: an unpriced token stays unpriced.

export type PriceQuote = {
  priceUsd: string | null
  source: "skip-oracle" | "aerodrome-cl" | "coingecko" | "unavailable"
  fetchedAt: string
}

export type PriceSnapshot = {
  btc: PriceQuote
  mezo: PriceQuote
}

/**
 * Reference USD price for a reward token, or null when Matchbox has no
 * verified price for it. Priced by contract address only, through the
 * @matchbox/chain token registry (as the API's market `tokenPrice` does):
 * incentive tokens are permissionless, so a token's symbol is never
 * evidence of its value, and an unregistered token named "7777USD",
 * "FAKEBTC" or even "MUSD" stays unpriced. Never falls back to a
 * hard-coded MEZO price.
 */
export function referencePrice(
  token: string,
  prices: PriceSnapshot,
): string | null {
  return getTokenUsdPrice(token, prices.btc.priceUsd, prices.mezo.priceUsd)
}

/**
 * Token amount → micro-USD, or null when unpriced (never $0). Callers must
 * count an unpriced token as zero value for totals, ranking and the
 * optimizer, and still say that it exists.
 */
export function tokenMicroUsd(input: {
  amount: bigint
  decimals: number
  token: string
  prices: PriceSnapshot
}): bigint | null {
  const price = referencePrice(input.token, input.prices)
  if (price === null) return null
  return tokenUsdMicroValue(input.amount, input.decimals, price)
}

export function priceMicroUsd(price: string | null): bigint | null {
  return price === null ? null : decimalToScaledBigInt(price, 6)
}
