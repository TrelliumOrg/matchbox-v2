import type { Address } from "viem"
import { getAddress } from "viem"
import { CHAIN_ID, type SupportedChainId } from "./chains"

// Prices are decimal strings (USD per whole token) so they can go straight
// into @thesis-co/cent. There is no hardcoded MEZO price: callers pass a live
// one or null.

// MEZO token address (same on testnet and mainnet)
export const MEZO_TOKEN_ADDRESS = getAddress(
  "0x7B7c000000000000000000000000000000000001",
)

// ============================================================================
// Token Type System
// ============================================================================

/**
 * Token pricing types determine how a token's USD value is calculated
 */
export type TokenPriceType =
  | "stablecoin" // Pegged to $1 USD
  | "btc-pegged" // Pegged to BTC price
  | "mezo" // MEZO token with its own price
  | "unknown" // Unknown token, no price available

/**
 * Token registry entry with pricing information
 */
export type TokenRegistryEntry = {
  symbol: string
  priceType: TokenPriceType
  // Fixed USD price as a decimal string, or null to use the reference price
  // for its price type
  fixedPrice: string | null
}

/**
 * Known token addresses mapped to their pricing configuration.
 * Addresses are stored lowercase for case-insensitive lookups.
 *
 * This registry is the only source of token prices: a token that is not
 * listed here by address is unpriced, whatever its symbol. The `symbol`
 * field is a label for people reading this file, never used for pricing.
 *
 * To add a new token:
 * 1. Add its address (lowercase) as the key
 * 2. Set the symbol and priceType
 * 3. Set fixedPrice for tokens with a known static value, otherwise null
 */
const TOKEN_REGISTRY: Record<string, TokenRegistryEntry> = {
  // MEZO token (same on testnet and mainnet)
  "0x7b7c000000000000000000000000000000000001": {
    symbol: "MEZO",
    priceType: "mezo",
    fixedPrice: null,
  },

  // Native BTC address used across the app and token lists on Mezo
  "0x7b7c000000000000000000000000000000000000": {
    symbol: "BTC",
    priceType: "btc-pegged",
    fixedPrice: null,
  },

  // ============================================================================
  // Stablecoins - pegged to $1 USD
  // ============================================================================

  // MUSD — Mezo USD (testnet / mainnet per Mezo docs)
  "0x118917a40faf1cd7a13db0ef56c86de7973ac503": {
    symbol: "MUSD",
    priceType: "stablecoin",
    fixedPrice: "1",
  },
  "0xdd468a1ddc392dcdbef6db6e34e89aa338f9f186": {
    symbol: "MUSD",
    priceType: "stablecoin",
    fixedPrice: "1",
  },

  // Bridged stablecoins on Mezo (same Mezo address on testnet and mainnet).
  // Registry symbols use lowercase "m" — mUSDC / mUSDT — not USDC / USDT.
  "0x04671c72aab5ac02a03c1098314b1bb6b560c197": {
    symbol: "mUSDC",
    priceType: "stablecoin",
    fixedPrice: "1",
  },
  "0xeb5a5d39de4ea42c2aa6a57eca2894376683bb8e": {
    symbol: "mUSDT",
    priceType: "stablecoin",
    fixedPrice: "1",
  },

  // USDC variants
  "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48": {
    symbol: "USDC",
    priceType: "stablecoin",
    fixedPrice: "1",
  },

  // USDT variants
  "0xdac17f958d2ee523a2206206994597c13d831ec7": {
    symbol: "USDT",
    priceType: "stablecoin",
    fixedPrice: "1",
  },

  // DAI
  "0x6b175474e89094c44da98b954eedeac495271d0f": {
    symbol: "DAI",
    priceType: "stablecoin",
    fixedPrice: "1",
  },

  // ============================================================================
  // BTC-pegged tokens - use BTC price
  // ============================================================================

  // WBTC
  "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599": {
    symbol: "WBTC",
    priceType: "btc-pegged",
    fixedPrice: null,
  },

  // tBTC
  "0x18084fba666a33d37592fa2633fd49a74dd93a88": {
    symbol: "tBTC",
    priceType: "btc-pegged",
    fixedPrice: null,
  },

  // sBTC (Stacks BTC)
  "0x5c6a8ea1e714dd3de1a28de1a00f5d5289313822": {
    symbol: "sBTC",
    priceType: "btc-pegged",
    fixedPrice: null,
  },

  // Bridged BTC wrappers on Mezo mainnet. symbol(), name() and decimals()
  // read at these addresses on Mezo mainnet at block 13,329,514 (19 Nov
  // 2026). The API's read-model token registry
  // (apps/api/src/read-models/token-registry.ts) and Scan's pricing list
  // (apps/scan/src/data/scan/pricing.ts) list all three at BTC;
  // SCAN_STREAM_TOKENS (scan-stream.ts) lists mSolvBTC and mcbBTC only.
  // Stuart priced their incentives at BTC by symbol before pricing became
  // address-only, so they are listed here to keep those prices.
  //
  // Other tokens Stuart used to price by symbol are deliberately not here,
  // so they are now unpriced in Stuart: sMUSD (0xb4d4...51cc) and sUSDat
  // (0xde40...904f), staking shares once priced at $1 for "USD" in the
  // symbol; mlvBTC-mUSDC (0xd3f6...8788), a lending vault share once priced
  // at $1; and mbhBTC (0xe223...9318), "Mezo Bitcoin Home BTC Vault", a
  // vault share once priced at the BTC price. A share is worth its
  // exchange rate, not 1 USD or 1 BTC, so leaving them unpriced is the safe
  // direction.

  // mSolvBTC, "Mezo Solv BTC", 18 decimals
  "0xa10ad2570ea7b93d19fdae6bd7189ff4929bc747": {
    symbol: "mSolvBTC",
    priceType: "btc-pegged",
    fixedPrice: null,
  },

  // mxSolvBTC, "Mezo xSolvBTC", 18 decimals. Exactly 1 BTC is an
  // approximation: xSolvBTC is yield-bearing (a published xSolvBTC/SolvBTC
  // exchange-rate feed exists), so one is worth slightly more than one BTC.
  // The error is bounded by its small supply on Mezo, about 0.80 in total
  // on 19 Nov 2026.
  "0xdf708431162ba247ddae362d2c919e0fbafcf9de": {
    symbol: "mxSolvBTC",
    priceType: "btc-pegged",
    fixedPrice: null,
  },

  // mcbBTC, "Mezo Coinbase Wrapped BTC", 8 decimals
  "0x6a7cd8e1384d49f502b4a4ce9ac9eb320835c5d7": {
    symbol: "mcbBTC",
    priceType: "btc-pegged",
    fixedPrice: null,
  },
}

/**
 * Get token info from the registry by address
 */
export function getTokenFromRegistry(
  address: string,
): TokenRegistryEntry | undefined {
  return TOKEN_REGISTRY[address.toLowerCase()]
}

/**
 * The price type of a token, by its contract address only.
 *
 * Incentive and bribe tokens are permissionless: anyone can deploy a token
 * named "7777USD", "FAKEBTC" or "MUSD" and post it on a gauge. A token's
 * symbol is never evidence of its value, so a token that is not in the
 * registry is "unknown" (unpriced), whatever its symbol says.
 */
export function getTokenPriceType(address: string): TokenPriceType {
  return getTokenFromRegistry(address)?.priceType ?? "unknown"
}

/**
 * Get the USD price for a token given reference prices, by registry
 * address only (see getTokenPriceType).
 *
 * @param address - Token contract address
 * @param btcPrice - Current BTC price in USD, as a decimal string
 * @param mezoPrice - Current MEZO price in USD, as a decimal string
 * @returns USD price per token as a decimal string, or null if unpriced
 */
export function getTokenUsdPrice(
  address: string,
  btcPrice: string | null,
  mezoPrice: string | null,
): string | null {
  const registryEntry = getTokenFromRegistry(address)
  if (registryEntry === undefined) return null

  switch (registryEntry.priceType) {
    case "stablecoin":
      return registryEntry.fixedPrice ?? "1"
    case "btc-pegged":
      return registryEntry.fixedPrice ?? btcPrice
    case "mezo":
      return registryEntry.fixedPrice ?? mezoPrice
    case "unknown":
      return null
  }
}

/**
 * Check if a token is a registered stablecoin
 */
export function isStablecoin(address: string): boolean {
  return getTokenPriceType(address) === "stablecoin"
}

/**
 * Check if a token is a registered BTC-pegged token
 */
export function isBtcPegged(address: string): boolean {
  return getTokenPriceType(address) === "btc-pegged"
}

// ============================================================================
// Pyth Oracle Configuration (existing)
// ============================================================================

// Pyth Network oracle proxy contracts on Mezo
export const PYTH_ORACLE_CONTRACTS = {
  [CHAIN_ID.testnet]: getAddress("0x2880aB155794e7179c9eE2e38200202908C17B43"),
  [CHAIN_ID.mainnet]: getAddress("0x2880aB155794e7179c9eE2e38200202908C17B43"),
} as const

// Pyth price feed ID for MEZO token
// TODO: Replace with actual MEZO price feed ID from Pyth
// Find feed IDs at: https://pyth.network/developers/price-feed-ids
export const MEZO_PYTH_PRICE_FEED_ID =
  "0x0000000000000000000000000000000000000000000000000000000000000000" as `0x${string}`

// Pyth oracle ABI (minimal interface for reading prices)
export const PYTH_ORACLE_ABI = [
  {
    inputs: [{ internalType: "bytes32", name: "id", type: "bytes32" }],
    name: "getPrice",
    outputs: [
      {
        components: [
          { internalType: "int64", name: "price", type: "int64" },
          { internalType: "uint64", name: "conf", type: "uint64" },
          { internalType: "int32", name: "expo", type: "int32" },
          { internalType: "uint256", name: "publishTime", type: "uint256" },
        ],
        internalType: "struct PythStructs.Price",
        name: "price",
        type: "tuple",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { internalType: "bytes32", name: "id", type: "bytes32" },
      { internalType: "uint256", name: "age", type: "uint256" },
    ],
    name: "getPriceNoOlderThan",
    outputs: [
      {
        components: [
          { internalType: "int64", name: "price", type: "int64" },
          { internalType: "uint64", name: "conf", type: "uint64" },
          { internalType: "int32", name: "expo", type: "int32" },
          { internalType: "uint256", name: "publishTime", type: "uint256" },
        ],
        internalType: "struct PythStructs.Price",
        name: "price",
        type: "tuple",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "bytes32", name: "id", type: "bytes32" }],
    name: "getPriceUnsafe",
    outputs: [
      {
        components: [
          { internalType: "int64", name: "price", type: "int64" },
          { internalType: "uint64", name: "conf", type: "uint64" },
          { internalType: "int32", name: "expo", type: "int32" },
          { internalType: "uint256", name: "publishTime", type: "uint256" },
        ],
        internalType: "struct PythStructs.Price",
        name: "price",
        type: "tuple",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
] as const

export type PythPrice = {
  price: bigint
  conf: bigint
  expo: number
  publishTime: bigint
}

// Convert a Pyth price to an exact decimal string. Pyth prices are integers
// with an exponent (e.g., price=12345, expo=-4 means 1.2345).
export function pythPriceToDecimal(pythPrice: PythPrice): string {
  const negative = pythPrice.price < 0n
  const digits = (negative ? -pythPrice.price : pythPrice.price).toString()
  const sign = negative ? "-" : ""
  if (pythPrice.expo >= 0) {
    if (pythPrice.price === 0n) return "0"
    return `${sign}${digits}${"0".repeat(pythPrice.expo)}`
  }
  const scale = -pythPrice.expo
  const padded = digits.padStart(scale + 1, "0")
  const whole = padded.slice(0, padded.length - scale)
  const fraction = padded.slice(padded.length - scale).replace(/0+$/, "")
  if (whole === "0" && fraction.length === 0) return "0"
  return fraction.length > 0 ? `${sign}${whole}.${fraction}` : `${sign}${whole}`
}

// Maximum age for Pyth price (5 minutes in seconds)
export const PYTH_MAX_PRICE_AGE = 300n

// Get Pyth oracle contract address for a given chain
export function getPythOracleAddress(chainId: SupportedChainId): Address {
  return PYTH_ORACLE_CONTRACTS[chainId]
}

// Check if an address is the MEZO token
export function isMezoToken(address: string): boolean {
  return address.toLowerCase() === MEZO_TOKEN_ADDRESS.toLowerCase()
}
