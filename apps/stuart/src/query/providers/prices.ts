import type { Prices } from "@matchbox/contracts/read-models"
import type { PriceQuote, PriceSnapshot } from "@matchbox/domain/prices"

// Reference prices come from the API's `/internal/pro/prices` read model
// (matchbox-jobs writes them to KV every minute). The token pricing rules
// live in @matchbox/domain; an unpriced token stays unpriced.

export {
  type PriceQuote,
  type PriceSnapshot,
  priceMicroUsd,
  referencePrice,
  tokenMicroUsd,
} from "@matchbox/domain/prices"

function quote(price: Prices["btc"], unavailableAt: Date): PriceQuote {
  if (price === null) {
    return {
      priceUsd: null,
      source: "unavailable",
      fetchedAt: unavailableAt.toISOString(),
    }
  }
  return {
    priceUsd: price.usd,
    // The jobs Worker's BTC price is the Skip BTC/USD oracle on Mezo.
    source: price.source === "mezo-oracle" ? "skip-oracle" : price.source,
    fetchedAt: new Date(price.updatedAt * 1000).toISOString(),
  }
}

export function pricesFromReadModel(prices: Prices, now: Date): PriceSnapshot {
  return { btc: quote(prices.btc, now), mezo: quote(prices.mezo, now) }
}

export function priceSourceLabel(quote: PriceQuote): string {
  if (quote.source === "skip-oracle") return "Skip oracle (Mezo)"
  if (quote.source === "aerodrome-cl") return "Aerodrome CL slot0 (Base)"
  if (quote.source === "coingecko") return "CoinGecko"
  return "Unavailable"
}
