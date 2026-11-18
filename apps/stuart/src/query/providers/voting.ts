import type { GaugeKind, GaugePicture } from "@matchbox/contracts/read-models"
import type { VoteTarget } from "@matchbox/domain/voteMath"
import type { VoteBranch } from "@matchbox/stuart-ui/contract"
import type { Address } from "viem"
import { MAINNET } from "./abis"
import type { RewardContracts } from "./rewardContracts"

// The voting shapes Stuart's tools read. `readModelProviders.ts` builds them
// from the API's gauge directory, wallet overview and gauge profiles;
// `VoteTarget` and `IncentiveToken` are the @matchbox/domain types.

export type { IncentiveToken, VoteTarget } from "@matchbox/domain/voteMath"

export const EPOCH_SECONDS = 604_800n
// `maxVotingNum` is 30 on every Mezo voter.
export const MAX_VOTING_NUM = 30

export type VotingDomain = {
  branch: VoteBranch
  voter: Address
  governanceAsset: "veMEZO" | "veBTC"
  epochStart: bigint
  epochNext: bigint
  // The snapshot block: the read model's `meta.block`.
  blockNumber: bigint
  fetchedAt: string
  totalWeight: bigint
  maxVotingNum: number
  source: string
  targets: VoteTarget[]
  // How each target is drawn (read model `gaugeRef.picture`), by lowercase
  // target address.
  pictures: ReadonlyMap<string, GaugePicture>
  // Each target's gauge type (read model `gaugeRef.kind`), same keys.
  kinds: ReadonlyMap<string, GaugeKind>
  // Pool gauges' pool type label ("CL200", "Volatile", "Stable"), same
  // keys; target names already end with it, as Pro and Matchscan show them.
  labels: ReadonlyMap<string, string>
  // Bribe and fee contracts (claims), by lowercase gauge address.
  rewardContracts: ReadonlyMap<string, RewardContracts>
}

export type WalletLock = {
  asset: "veMEZO" | "veBTC"
  tokenId: bigint
  amount: bigint
  end: bigint
  isPermanent: boolean
  votingPower: bigint
}

export type LockVoteState = {
  tokenId: bigint
  lastVoted: bigint
  usedWeight: bigint
  votes: Map<string, bigint>
}

export function voterFor(branch: VoteBranch): Address {
  if (branch === "boost") return MAINNET.boostVoter
  if (branch === "validators") return MAINNET.validatorsVoter
  return MAINNET.poolsVoter
}

export function assetFor(branch: VoteBranch): "veMEZO" | "veBTC" {
  return branch === "boost" ? "veMEZO" : "veBTC"
}

export function voterSource(branch: VoteBranch): string {
  if (branch === "boost") return "BoostVoter"
  if (branch === "validators") return "ValidatorsVoter"
  return "PoolsVoter"
}
