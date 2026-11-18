import { createMezoClient } from "@matchbox/api/chain/client"
import type { CrossChain } from "@matchbox/chain"
import { createPublicClient, fallback, http, type PublicClient } from "viem"
import { base, bsc, mainnet } from "viem/chains"

// RPC clients for the chains MUSD and MEZO are bridged to. Each chain has
// public defaults (each answered eth_chainId on 12 Nov 2026); an optional
// configured URL goes first (a secret: keyed URLs carry their key). Reads
// are batched into Multicall3, which each chain has at the canonical
// address.

export const publicRpcUrls: Readonly<
  Record<Exclude<CrossChain, "mezo">, readonly string[]>
> = {
  ethereum: [
    "https://ethereum-rpc.publicnode.com",
    "https://eth.drpc.org",
    "https://cloudflare-eth.com",
  ],
  base: ["https://mainnet.base.org", "https://base-rpc.publicnode.com"],
  bsc: ["https://bsc-rpc.publicnode.com", "https://bsc-dataseed.bnbchain.org"],
}

export type CrossChainRpcConfig = {
  /** MEZO_RPC_URLS; null uses Mezo's public RPCs. */
  mezo: readonly string[] | null
  ethereum: string | null
  base: string | null
  bsc: string | null
}

export type CrossChainClients = Record<CrossChain, PublicClient>

const viemChains = { ethereum: mainnet, base, bsc } as const

/** The configured URL first, then the public ones, without repeats. */
export function rpcUrlsFor(
  chain: Exclude<CrossChain, "mezo">,
  configured: string | null,
): string[] {
  return [
    ...new Set([
      ...(configured === null ? [] : [configured]),
      ...publicRpcUrls[chain],
    ]),
  ]
}

function evmClient(
  chain: Exclude<CrossChain, "mezo">,
  configured: string | null,
  timeoutMs: number,
): PublicClient {
  const client = createPublicClient({
    chain: viemChains[chain],
    transport: fallback(
      rpcUrlsFor(chain, configured).map((url) =>
        http(url, { timeout: timeoutMs, retryCount: 1 }),
      ),
    ),
    batch: { multicall: { wait: 0 } },
  })
  return client as PublicClient
}

export function crossChainClients(
  config: CrossChainRpcConfig,
  timeoutMs = 10_000,
): CrossChainClients {
  return {
    mezo: createMezoClient(config.mezo ?? undefined, timeoutMs),
    ethereum: evmClient("ethereum", config.ethereum, timeoutMs),
    base: evmClient("base", config.base, timeoutMs),
    bsc: evmClient("bsc", config.bsc, timeoutMs),
  }
}
