import type { ClaimSourceKind } from "@matchbox/stuart-ui/contract"
import type { Address } from "viem"
import type { VotingDomain } from "./voting"

// What a lock can claim from one voting domain. `readModelProviders.ts`
// builds it from the API's wallet rewards read model.

export type ClaimableEntry = {
  contract: Address
  token: Address
  symbol: string
  decimals: number
  earned: bigint
}

export type ClaimableLock = {
  source: Exclude<ClaimSourceKind, "collateral_surplus">
  voter: Address
  tokenId: bigint
  entries: ClaimableEntry[]
}

export function sourceForDomain(domain: VotingDomain): ClaimableLock["source"] {
  if (domain.branch === "boost") return "boost_bribes"
  if (domain.branch === "pools") return "pool_fees_bribes"
  return "validator_bribes"
}

/** Groups entries into the `(rewards[], tokens[][])` claim arguments. */
export function claimArguments(entries: readonly ClaimableEntry[]): {
  contracts: Address[]
  tokens: Address[][]
} {
  const grouped = new Map<string, { contract: Address; tokens: Address[] }>()
  for (const entry of entries) {
    const key = entry.contract.toLowerCase()
    const group = grouped.get(key) ?? { contract: entry.contract, tokens: [] }
    group.tokens.push(entry.token)
    grouped.set(key, group)
  }
  const groups = [...grouped.values()]
  return {
    contracts: groups.map((group) => group.contract),
    tokens: groups.map((group) => group.tokens),
  }
}
