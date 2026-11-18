import type { TokenRef } from "@matchbox/contracts/read-models"
import { knownTokens } from "./money"

// Tokens Mezo's pools and vaults trade, beyond the read models' known
// tokens: for balances, pool pairs and vault coins. `price` says how a token
// is valued: one USD, the BTC price, the MEZO price, or not at all.

export type TokenPricing = "usd" | "btc" | "mezo" | null

export type RegisteredToken = { token: TokenRef; pricing: TokenPricing }

function entry(
  address: string,
  symbol: string,
  name: string,
  decimals: number,
  pricing: TokenPricing,
): RegisteredToken {
  return { token: { address, symbol, name, decimals }, pricing }
}

/** Every registered token by lower-case address. */
export const tokenRegistry: ReadonlyMap<string, RegisteredToken> = new Map(
  [
    entry(
      "0x7b7c000000000000000000000000000000000000",
      "BTC",
      "Bitcoin",
      18,
      "btc",
    ),
    entry(
      "0x7b7c000000000000000000000000000000000001",
      "MEZO",
      "Mezo",
      18,
      "mezo",
    ),
    entry(
      "0xdd468a1ddc392dcdbef6db6e34e89aa338f9f186",
      "MUSD",
      "Mezo USD",
      18,
      "usd",
    ),
    entry(
      "0x04671c72aab5ac02a03c1098314b1bb6b560c197",
      "mUSDC",
      "Mezo Circle USDC",
      6,
      "usd",
    ),
    entry(
      "0xeb5a5d39de4ea42c2aa6a57eca2894376683bb8e",
      "mUSDT",
      "Mezo Tether USD",
      6,
      "usd",
    ),
    entry(
      "0xb4d498029af77680cd1ef828b967f010d06c51cc",
      "sMUSD",
      "MUSD Savings Rate",
      18,
      null,
    ),
    entry(
      "0xa10ad2570ea7b93d19fdae6bd7189ff4929bc747",
      "mSolvBTC",
      "Mezo Solv BTC",
      18,
      "btc",
    ),
    entry(
      "0xdf708431162ba247ddae362d2c919e0fbafcf9de",
      "mxSolvBTC",
      "Mezo xSolvBTC",
      18,
      "btc",
    ),
    entry(
      "0x6a7cd8e1384d49f502b4a4ce9ac9eb320835c5d7",
      "mcbBTC",
      "Mezo Coinbase Wrapped BTC",
      8,
      "btc",
    ),
    entry(
      "0xf333171788de7005695b2e8fb9cae97ba9c4dd7a",
      "avBTCm",
      "Liquid locked BTC",
      18,
      "btc",
    ),
    entry(
      "0xb894b11a78b762c82cb095148f5bc11dc93c3560",
      "avMEZOm",
      "Liquid locked MEZO",
      18,
      "mezo",
    ),
    entry(
      "0xd3f6f147662bf2943ca09ee16bedaea28ae28788",
      "mlvBTC-mUSDC",
      "Mezo BTC-mUSDC Lending Vault",
      18,
      null,
    ),
    entry(
      "0xaac423edc4e3ee9ef81517e8093d52737165b71f",
      "mT",
      "Mezo Threshold Network Token",
      18,
      null,
    ),
    entry(
      "0x9d36f8f62347538440a212e9162f534f797542df",
      "SATS",
      "Satoshi",
      18,
      null,
    ),
    entry(
      "0xde402d7021f3f7f00be5d0ab5c238b2be1d2904f",
      "sUSDat",
      "Staked USDat",
      18,
      null,
    ),
    entry(
      "0x68bba5ecc126dedfa52c0399671e3a7a514d311c",
      "REKT",
      "REKT",
      18,
      null,
    ),
  ].map((registered) => [registered.token.address, registered]),
)

/** A token's ref: the known or registered one, else built from chain reads. */
export function tokenRefFor(
  address: string,
  symbol: string | null,
  decimals: number | null,
): TokenRef | null {
  const lower = address.toLowerCase()
  const known = knownTokens[lower] ?? tokenRegistry.get(lower)?.token
  if (known !== undefined) return known
  if (symbol === null || decimals === null) return null
  return { address: lower, symbol, name: symbol, decimals }
}
