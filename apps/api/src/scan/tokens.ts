import type {
  BlockscoutTokenRef,
  NextPageParams,
} from "@matchbox/contracts/blockscout"
import type { Prices } from "@matchbox/contracts/read-models"
import type {
  ScanAddressTokens,
  ScanPricedAs,
  ScanPriceSource,
  ScanTokenListItem,
} from "@matchbox/contracts/scan"
import { decimalToScaledBigInt, formatFixedPoint } from "@matchbox/domain"
import { tokenRegistry } from "../read-models/token-registry"

// Tokens for Scan: an address's ERC-20 balances (the address document's
// `tokens` part) and the token list with price, supply and holders. USD
// values come from the token registry's pricing and the KV prices only:
// `priced_as` says what a value rests on, so a client that will not value
// a stablecoin at $1, or a wrapped BTC at BTC's price, can leave it out.

const WAD = 10n ** 18n

/** USD per whole token, 1e18-scaled, by the registry's pricing. */
function priceOf(pricedAs: ScanPricedAs, prices: Prices | null): bigint | null {
  switch (pricedAs) {
    case "usd":
      return WAD
    case "btc":
      return prices?.btc === null || prices?.btc === undefined
        ? null
        : decimalToScaledBigInt(prices.btc.usd, 18)
    case "mezo":
      return prices?.mezo === null || prices?.mezo === undefined
        ? null
        : decimalToScaledBigInt(prices.mezo.usd, 18)
    default:
      return null
  }
}

/** Where `priceOf`'s price comes from; null when it has none. */
function sourceOf(
  pricedAs: ScanPricedAs,
  prices: Prices | null,
): ScanPriceSource {
  switch (pricedAs) {
    case "usd":
      return "registry"
    case "btc":
      return prices?.btc?.source ?? null
    case "mezo":
      return prices?.mezo?.source ?? null
    default:
      return null
  }
}

/** A raw amount's USD value at a decimal USD price, or null. */
export function usdAt(
  raw: bigint,
  decimals: number | null,
  priceUsd: string | null,
): string | null {
  if (priceUsd === null || decimals === null) return null
  const price = decimalToScaledBigInt(priceUsd, 18)
  return formatFixedPoint((raw * price) / 10n ** BigInt(decimals), 18)
}

/** A token's own market price (MUSD's), from the cross-chain quotes. */
export type MarketPrice = { usd: string; source: "venues" | "coingecko" }

/** A raw amount's USD value as an exact decimal string, or null. */
export function usdValue(
  raw: bigint,
  decimals: number | null,
  pricedAs: ScanPricedAs,
  prices: Prices | null,
): string | null {
  const price = priceOf(pricedAs, prices)
  if (price === null || decimals === null) return null
  return formatFixedPoint((raw * price) / 10n ** BigInt(decimals), 18)
}

function pricedAsOf(address: string): ScanPricedAs {
  return tokenRegistry.get(address.toLowerCase())?.pricing ?? null
}

function decimalsOf(ref: BlockscoutTokenRef): number | null {
  const registered = tokenRegistry.get(ref.address_hash.toLowerCase())
  if (registered !== undefined) return registered.token.decimals
  if (ref.decimals === null) return null
  const parsed = Number(ref.decimals)
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 36 ? parsed : null
}

/** The address document's `tokens` part from a Blockscout balances page. */
export function addressTokens(
  page: {
    items: { token: BlockscoutTokenRef; value: string }[]
    next_page_params: NextPageParams
  },
  prices: Prices | null,
): ScanAddressTokens {
  return {
    items: page.items.map((balance) => {
      const address = balance.token.address_hash.toLowerCase()
      const registered = tokenRegistry.get(address)
      const decimals = decimalsOf(balance.token)
      const pricedAs = pricedAsOf(address)
      return {
        token: {
          address,
          symbol: registered?.token.symbol ?? balance.token.symbol,
          name: registered?.token.name ?? balance.token.name,
          decimals,
        },
        value: balance.value,
        value_usd: usdValue(BigInt(balance.value), decimals, pricedAs, prices),
        priced_as: pricedAs,
      }
    }),
    next_page_params: page.next_page_params,
    prices: {
      btc_usd: prices?.btc?.usd ?? null,
      mezo_usd: prices?.mezo?.usd ?? null,
    },
  }
}

/**
 * A token-list row before its figures: the registry's own fields, priced
 * at the token's own market price where `market` has one (MUSD), else by
 * the registry's pricing.
 */
export function tokenListBase(
  address: string,
  prices: Prices | null,
  market: ReadonlyMap<string, MarketPrice> = new Map(),
): Omit<ScanTokenListItem, "supply" | "holders" | "supply_usd"> {
  const registered = tokenRegistry.get(address)
  const own = market.get(address)
  if (own !== undefined) {
    return {
      address,
      symbol: registered?.token.symbol ?? null,
      name: registered?.token.name ?? null,
      decimals: registered?.token.decimals ?? null,
      priced_as: "market",
      price_usd: formatFixedPoint(decimalToScaledBigInt(own.usd, 18), 18),
      price_source: own.source,
    }
  }
  const pricedAs = registered?.pricing ?? null
  const price = priceOf(pricedAs, prices)
  return {
    address,
    symbol: registered?.token.symbol ?? null,
    name: registered?.token.name ?? null,
    decimals: registered?.token.decimals ?? null,
    priced_as: pricedAs,
    price_usd: price === null ? null : formatFixedPoint(price, 18),
    price_source: price === null ? null : sourceOf(pricedAs, prices),
  }
}

/** Every registered token's address, lower case. */
export function registeredTokens(): string[] {
  return [...tokenRegistry.keys()]
}
