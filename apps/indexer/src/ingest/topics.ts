import { INDEXED_EVENTS } from "@matchbox/chain"
import { type Hex, toEventSelector } from "viem"
import type { ContractKind } from "./store"

// Events ingest stores per contract kind (the explorer subgraph's handlers
// plus the warehouse-only kinds) live in @matchbox/chain as INDEXED_EVENTS;
// test/ingest/manifest.test.ts fails on drift from the explorer manifest.
// Ingest stores only these: pools alone emit Sync/Fees/LP Transfer/Approval
// at roughly twice the rate of everything the decoder reads, which would not
// fit the warehouse. Widening a set is a config change plus a re-backfill
// (about 30 minutes).
export const HANDLED_EVENTS: Record<ContractKind, string[]> = INDEXED_EVENTS

export type FilterGroup = {
  kinds: ContractKind[]
}

// eth_getLogs ANDs addresses with topics, so kinds share a filter only when no
// kind in the group emits another kind's topic it doesn't handle. Escrows
// (Transfer) and pools (LP Transfer, Swap) get their own filters; the rest
// share one, which over-includes nothing the probe found. The ~750 voter
// bribe contracts get their own too: eight address chunks a window. Scanning
// their two reward topics without addresses was cheaper, but any contract can
// emit those topics, and enough look-alikes in one block failed the scan for
// good (audit MBX-02).
export const FILTER_GROUPS: FilterGroup[] = [
  { kinds: ["votingEscrow"] },
  { kinds: ["pool"] },
  {
    kinds: [
      "boostVoter",
      "poolsVoter",
      "thirdPartyVoter",
      "validatorsVoter",
      "splitter",
      "minter",
      "rebaseDistributor",
      "merkleDistributor",
      "musdSavingsRate",
      "pcv",
      "poolFactory",
      "gauge",
      "bribeVotingReward",
      "feeVotingReward",
      "musdBorrowerOperations",
      "musdTroveManager",
    ],
  },
  { kinds: ["voterBribeReward"] },
]

export function topic0sFor(kinds: ContractKind[]): Hex[] {
  return [
    ...new Set(
      kinds.flatMap((kind) =>
        HANDLED_EVENTS[kind].map((signature) => toEventSelector(signature)),
      ),
    ),
  ].sort()
}

export function filterGroupOf(kind: ContractKind): number {
  const index = FILTER_GROUPS.findIndex((group) => group.kinds.includes(kind))
  if (index === -1) throw new Error(`Contract kind ${kind} has no log filter`)
  return index
}
