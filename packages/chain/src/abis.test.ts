import {
  type Abi,
  type AbiEvent,
  toEventSelector,
  toEventSignature,
} from "viem"
import { describe, expect, it } from "vitest"
import { BRIBE_ABI } from "./abis/rewards"
import {
  BOOST_VOTER_ABI,
  POOLS_VOTER_ABI,
  THIRD_PARTY_VOTER_ABI,
  VALIDATORS_VOTER_ABI,
} from "./abis/voters"
import { VOTING_ESCROW_ABI } from "./abis/voting-escrow"
import {
  CONTRACT_KINDS,
  type ContractKind,
  EVENTS_ABI_BY_KIND,
  INDEXED_EVENTS,
} from "./indexer"

function events(abi: Abi): AbiEvent[] {
  return abi.filter((item): item is AbiEvent => item.type === "event")
}

function fingerprint(event: AbiEvent): string {
  const mask = event.inputs.map((input) => (input.indexed ? "1" : "0"))
  return `${toEventSignature(event)} ${mask.join("")}`
}

// Event names each indexer handler table decodes (handlers/*.ts on Matchbox
// main, wired to a kind in decode/dispatch.ts).
const DECODED_EVENTS: Record<ContractKind, string[]> = {
  votingEscrow: [
    "Deposit",
    "LockPermanent",
    "Merge",
    "UnlockPermanent",
    "Withdraw",
    "Transfer",
    "UpdateBoost",
  ],
  boostVoter: [
    "Abstained",
    "GaugeCreated",
    "Voted",
    "BoostPoked",
    "BoostableTokenBurned",
    "BribesAdded",
    "DistributeReward",
    "GaugeKilled",
    "GaugeRevived",
    "NotifyReward",
  ],
  poolsVoter: [
    "Abstained",
    "GaugeCreated",
    "Voted",
    "DistributeReward",
    "GaugeKilled",
    "GaugeRevived",
    "NotifyReward",
  ],
  thirdPartyVoter: [
    "Abstained",
    "GaugeCreated",
    "Voted",
    "BribesAdded",
    "DistributeReward",
    "GaugeKilled",
    "GaugeRevived",
    "NotifyReward",
    "ThirdPartyGaugeCreated",
  ],
  validatorsVoter: [
    "Abstained",
    "GaugeCreated",
    "Voted",
    "BribesAdded",
    "DistributeReward",
    "GaugeKilled",
    "GaugeRevived",
    "NotifyReward",
    "ValidatorGaugeCreated",
    "ValidatorLeft",
  ],
  splitter: ["PeriodUpdated", "Nudge"],
  minter: ["EpochProcessed", "EmissionsEnabled"],
  rebaseDistributor: ["Claimed", "CheckpointToken"],
  merkleDistributor: ["Claimed", "DistributionAdded"],
  musdSavingsRate: [
    "Deposit",
    "Withdraw",
    "YieldClaimed",
    "ProtocolYieldReceived",
    "StrategyYieldReceived",
  ],
  pcv: ["PCVDistribution", "PCVDebtPayment"],
  poolFactory: ["PoolCreated"],
  pool: ["Mint", "Burn", "Swap"],
  gauge: ["Deposit", "Withdraw", "ClaimRewards"],
  bribeVotingReward: ["NotifyReward", "ClaimRewards"],
  feeVotingReward: ["NotifyReward", "ClaimRewards"],
  voterBribeReward: ["NotifyReward", "ClaimRewards"],
  musdBorrowerOperations: ["TroveUpdated"],
  musdTroveManager: ["TroveUpdated"],
}

// Signature and indexed mask of every fragment in the indexer's
// src/decode/abis/*.ts on Matchbox main, keyed by a kind that used it.
// Decoding depends on the indexed flags, so the merge must keep them.
const INDEXER_FRAGMENTS: Partial<Record<ContractKind, string[]>> = {
  votingEscrow: [
    "Deposit(address,uint256,uint8,uint256,uint256,uint256) 111000",
    "LockPermanent(address,uint256,uint256,uint256) 1100",
    "Merge(address,uint256,uint256,uint256,uint256,uint256,uint256,uint256) 11100000",
    "UnlockPermanent(address,uint256,uint256,uint256) 1100",
    "UpdateBoost(uint256,uint256) 10",
    "Withdraw(address,uint256,uint256,uint256) 1100",
    "Transfer(address,address,uint256) 111",
  ],
  boostVoter: [
    "Abstained(address,address,uint256,uint256,uint256,uint256) 111000",
    "GaugeCreated(address,address,address) 111",
    "Voted(address,address,uint256,uint256,uint256,uint256) 111000",
    "BoostPoked(uint256,uint256) 10",
    "BoostableTokenBurned(uint256,address) 11",
    "BribesAdded(address,address,uint256,address) 1100",
    "DistributeReward(address,address,uint256) 110",
    "GaugeKilled(address) 1",
    "GaugeRevived(address) 1",
    "NotifyReward(address,address,uint256) 110",
  ],
  poolsVoter: [
    "Abstained(address,address,uint256,uint256,uint256,uint256) 111000",
    "GaugeCreated(address,address,address,address,address,address,address,address) 11100000",
    "Voted(address,address,uint256,uint256,uint256,uint256) 111000",
    "DistributeReward(address,address,uint256) 110",
    "GaugeKilled(address) 1",
    "GaugeRevived(address) 1",
    "NotifyReward(address,address,uint256) 110",
  ],
  thirdPartyVoter: [
    "Abstained(address,address,uint256,uint256,uint256,uint256) 111000",
    "BribesAdded(address,address,uint256,address) 1100",
    "DistributeReward(address,address,uint256) 110",
    "GaugeCreated(address,address,address) 111",
    "GaugeKilled(address) 1",
    "GaugeRevived(address) 1",
    "NotifyReward(address,address,uint256) 110",
    "ThirdPartyGaugeCreated(address,address,string) 110",
    "Voted(address,address,uint256,uint256,uint256,uint256) 111000",
    "ValidatorGaugeCreated(address,address,address) 111",
    "ValidatorLeft(address,address) 11",
  ],
  splitter: [
    "Nudge(uint256,uint256,uint256) 100",
    "PeriodUpdated(uint256,uint256,uint256,uint256) 0000",
  ],
  minter: [
    "EmissionsEnabled(uint256) 0",
    "EpochProcessed(uint256,uint256,uint256,uint256,uint256,uint256,address) 1100000",
  ],
  rebaseDistributor: [
    "CheckpointToken(uint256,uint256) 00",
    "Claimed(uint256,uint256,uint256,uint256) 1110",
  ],
  merkleDistributor: [
    "Claimed(uint256,uint256,address,uint256) 1010",
    "DistributionAdded(uint256,bytes32,uint256,address,bytes) 10000",
  ],
  musdSavingsRate: [
    "Deposit(address,uint256) 10",
    "ProtocolYieldReceived(uint256) 0",
    "StrategyYieldReceived(uint256) 0",
    "Withdraw(address,uint256) 10",
    "YieldClaimed(address,uint256) 10",
  ],
  pcv: ["PCVDistribution(address,uint256) 00", "PCVDebtPayment(uint256) 0"],
  poolFactory: ["PoolCreated(address,address,bool,address,uint256) 11100"],
  pool: [
    "Mint(address,uint256,uint256) 100",
    "Burn(address,address,uint256,uint256) 1100",
    "Swap(address,address,uint256,uint256,uint256,uint256) 110000",
  ],
  gauge: [
    "Deposit(address,address,uint256) 110",
    "Withdraw(address,uint256) 10",
    "ClaimRewards(address,uint256) 10",
  ],
  bribeVotingReward: [
    "NotifyReward(address,address,uint256,uint256) 1110",
    "ClaimRewards(address,address,uint256) 110",
  ],
  musdTroveManager: [
    "TroveUpdated(address,uint256,uint256,uint256,uint256,uint16,uint256,uint8) 10000000",
    "TroveUpdated(address,uint256,uint256,uint256,uint256,uint8) 100000",
  ],
}

describe("indexer events", () => {
  it.each(CONTRACT_KINDS)("declares every event %s ingests", (kind) => {
    const declared = new Set(
      events(EVENTS_ABI_BY_KIND[kind]).map((event) => toEventSignature(event)),
    )
    for (const signature of INDEXED_EVENTS[kind]) {
      expect(declared, signature).toContain(signature)
    }
  })

  it.each(CONTRACT_KINDS)("declares every event %s decodes", (kind) => {
    const names = new Set(
      events(EVENTS_ABI_BY_KIND[kind]).map((event) => event.name),
    )
    for (const name of DECODED_EVENTS[kind]) {
      expect(names, name).toContain(name)
    }
  })

  it.each(CONTRACT_KINDS)("keeps the indexer fragments of %s", (kind) => {
    const expected = INDEXER_FRAGMENTS[kind] ?? []
    const actual = new Set(events(EVENTS_ABI_BY_KIND[kind]).map(fingerprint))
    for (const fragment of expected) {
      expect(actual, fragment).toContain(fragment)
    }
  })

  it.each(CONTRACT_KINDS)("has one fragment per topic in %s", (kind) => {
    const topics = events(EVENTS_ABI_BY_KIND[kind]).map((event) =>
      toEventSelector(event),
    )
    expect(new Set(topics).size).toBe(topics.length)
  })

  it("reads ThirdPartyVoter and ValidatorsVoter with one ABI", () => {
    expect(EVENTS_ABI_BY_KIND.thirdPartyVoter).toBe(
      EVENTS_ABI_BY_KIND.validatorsVoter,
    )
  })

  it("reads every voting reward kind with one ABI", () => {
    expect(EVENTS_ABI_BY_KIND.bribeVotingReward).toBe(
      EVENTS_ABI_BY_KIND.feeVotingReward,
    )
    expect(EVENTS_ABI_BY_KIND.voterBribeReward).toBe(
      EVENTS_ABI_BY_KIND.feeVotingReward,
    )
  })
})

describe("merged contract ABIs", () => {
  // Function counts of packages/shared/src/contracts on Matchbox main.
  const merged: [string, Abi, number, ContractKind][] = [
    ["VOTING_ESCROW_ABI", VOTING_ESCROW_ABI, 13, "votingEscrow"],
    ["BOOST_VOTER_ABI", BOOST_VOTER_ABI, 23, "boostVoter"],
    ["POOLS_VOTER_ABI", POOLS_VOTER_ABI, 22, "poolsVoter"],
    ["THIRD_PARTY_VOTER_ABI", THIRD_PARTY_VOTER_ABI, 17, "thirdPartyVoter"],
    ["VALIDATORS_VOTER_ABI", VALIDATORS_VOTER_ABI, 20, "validatorsVoter"],
    ["BRIBE_ABI", BRIBE_ABI, 7, "bribeVotingReward"],
  ]

  it.each(merged)("%s keeps the app functions", (_name, abi, count) => {
    expect(abi.filter((item) => item.type === "function")).toHaveLength(count)
  })

  it.each(merged)("%s carries the indexer events", (_name, abi, _n, kind) => {
    expect(events(abi).map(fingerprint).sort()).toEqual(
      events(EVENTS_ABI_BY_KIND[kind]).map(fingerprint).sort(),
    )
  })
})
