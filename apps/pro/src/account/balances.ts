import { CONTRACTS, MUSD_CONTRACTS } from "@matchbox/chain"
import type { Address } from "viem"
import type { Market } from "../data/view-models"
import { usdValue } from "../tx/amounts"
import type { Fetcher } from "./rpc-test"

/**
 * The connected or viewed wallet's tokens for the Account panel: native BTC
 * and the MEZO and MUSD ERC-20s, read through the RPC the Network setting
 * picks (`readRpc`). Plain JSON-RPC, no wagmi, so a read-only viewer never
 * loads wallet code.
 */

export type WalletTokenSymbol = "BTC" | "MEZO" | "MUSD"

export type WalletTokenInfo = {
  symbol: WalletTokenSymbol
  /** CoinGecko names. */
  name: string
  /** null for native BTC. */
  address: Address | null
  decimals: 18
}

export const walletTokens: readonly WalletTokenInfo[] = [
  {
    symbol: "MUSD",
    name: "Mezo USD",
    address: MUSD_CONTRACTS.mainnet.musd,
    decimals: 18,
  },
  { symbol: "BTC", name: "Bitcoin", address: null, decimals: 18 },
  {
    symbol: "MEZO",
    name: "Mezo",
    address: CONTRACTS.mainnet.mezoToken,
    decimals: 18,
  },
]

export type WalletToken = WalletTokenInfo & {
  balance: bigint
  usd: string | null
  /** 24h change in basis points; null without a price. */
  changeBps: number | null
}

function quantity(body: unknown): bigint {
  if (typeof body !== "object" || body === null) throw new Error("No result")
  const result: unknown = Reflect.get(body, "result")
  if (typeof result !== "string" || !/^0x[0-9a-fA-F]*$/.test(result))
    throw new Error("No result")
  return result === "0x" ? 0n : BigInt(result)
}

async function call(
  fetcher: Fetcher,
  url: string,
  method: string,
  params: unknown[],
): Promise<bigint> {
  const response = await fetcher(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  })
  if (!response.ok) throw new Error(`RPC ${response.status}`)
  const body: unknown = await response.json()
  return quantity(body)
}

/** `balanceOf(owner)` calldata. */
export function balanceOfData(owner: string): string {
  return `0x70a08231${owner.slice(2).toLowerCase().padStart(64, "0")}`
}

function priceOf(
  symbol: WalletTokenSymbol,
  prices: Market["prices"],
): { usd: string; changeBps: number | null } | null {
  if (symbol === "MUSD") return { usd: "1", changeBps: 0 }
  const price = symbol === "BTC" ? prices.btc : prices.mezo
  return price === null
    ? null
    : { usd: price.usd, changeBps: price.change24hBps }
}

export async function readWalletTokens(input: {
  rpcUrl: string
  owner: string
  prices: Market["prices"]
  fetcher?: Fetcher
}): Promise<WalletToken[]> {
  const fetcher: Fetcher = input.fetcher ?? ((url, init) => fetch(url, init))
  const balances = await Promise.all(
    walletTokens.map((token) =>
      token.address === null
        ? call(fetcher, input.rpcUrl, "eth_getBalance", [input.owner, "latest"])
        : call(fetcher, input.rpcUrl, "eth_call", [
            { to: token.address, data: balanceOfData(input.owner) },
            "latest",
          ]),
    ),
  )
  return walletTokens.map((token, index) => {
    const balance = balances[index] ?? 0n
    const price = priceOf(token.symbol, input.prices)
    return {
      ...token,
      balance,
      usd: price === null ? null : usdValue(balance, token.decimals, price.usd),
      changeBps: price?.changeBps ?? null,
    }
  })
}
