import type { MezoChainId } from "./search"

/**
 * Network names and chain ids, as in `@matchbox/contracts/network` (which
 * also exports zod schemas, so the browser keeps its own copy).
 */

export type NetworkSlug = "mezo" | "mezo-testnet"

export const networkNames: Record<NetworkSlug, string> = {
  mezo: "Mezo",
  "mezo-testnet": "Mezo Testnet",
}

export const chainIdByNetwork: Record<NetworkSlug, MezoChainId> = {
  mezo: 31612,
  "mezo-testnet": 31611,
}

export function chainName(chainId: MezoChainId): string {
  return chainId === 31612 ? networkNames.mezo : networkNames["mezo-testnet"]
}
