import {
  BOOST_VOTER_EVENTS_ABI as boostVoterAbi,
  VOTING_REWARD_EVENTS_ABI as bribeVotingRewardAbi,
  NON_POOLS_VOTER_EVENTS_ABI as nonPoolsVoterAbi,
  POOLS_VOTER_EVENTS_ABI as poolsVoterAbi,
} from "@matchbox/chain"
import { type Address, encodeFunctionData } from "viem"
import { describe, expect, it } from "vitest"
import { CLAIM_ABI } from "../../src/decode/calldata"
import { ZERO_ADDRESS } from "../../src/decode/constants"
import { projectBlock } from "../../src/decode/projection"
import { InMemoryStore } from "../../src/decode/store"
import { logEntry } from "./entries"

// The warehouse-only rows decoder v2 adds next to the explorer mirror:
// voter logs before the explorer start, voter bribe claims and deposits,
// reward deposits keyed by epoch, and the INCENTIVE_ADDED epoch.

const BOOST_VOTER: Address = "0x2ba614a598cffa5a19d683cdca97bac3a49313d1"
const POOLS_VOTER: Address = "0x48233ccc97b87ba93bca212cbee48e3210211f03"
const VALIDATORS_VOTER: Address = "0xe99a9ad5ed26bd30e4db25397f378817e9b9515a"
const LEGACY_BRIBE: Address = "0x6f3e2afc81a8fd8e3490ddb032a91d339b371afb"
const GAUGE: Address = "0x00000000000000000000000000000000000aa0e0"
const BRIBE: Address = "0x00000000000000000000000000000000000bb1be"
const MEZO: Address = "0x7b7c000000000000000000000000000000000001"
const ALICE: Address = "0x000000000000000000000000000000000000a11c"
const KEEPER: Address = "0x000000000000000000000000000000000000beef"
const EXPLORER_START = 7_739_500n
// 2026-09-24 00:00 UTC, an epoch start (a multiple of 604,800).
const EPOCH = 1_790_208_000n

function activitiesOf(store: InMemoryStore, actionType: string) {
  return [...store.activities.values()].filter(
    (activity) => activity.actionType === actionType,
  )
}

describe("voters before the explorer start block", () => {
  it("project votes as warehouse-only rows and keep the vote state", () => {
    const store = new InMemoryStore()
    const early = logEntry(
      boostVoterAbi,
      "Voted",
      {
        voter: ALICE,
        gauge: GAUGE,
        tokenId: 7n,
        weight: 5n,
        totalWeight: 9n,
        timestamp: EPOCH,
      },
      { address: BOOST_VOTER, block: 6_300_000n, timestamp: EPOCH },
    )
    const late = logEntry(
      boostVoterAbi,
      "Voted",
      {
        voter: ALICE,
        gauge: GAUGE,
        tokenId: 8n,
        weight: 3n,
        totalWeight: 12n,
        timestamp: EPOCH,
      },
      { address: BOOST_VOTER, block: EXPLORER_START, timestamp: EPOCH + 1n },
    )
    expect(projectBlock([early], store)).toBe(1)
    expect(projectBlock([late], store)).toBe(1)

    const votes = activitiesOf(store, "BOOST_VOTE")
    expect(votes.map((vote) => [vote.tokenId, vote.explorerParity])).toEqual([
      [7n, false],
      [8n, true],
    ])
    expect(store.votes.get(`${BOOST_VOTER}-7-${GAUGE}`)?.currentWeight).toBe(5n)
  })

  it("keeps PoolsVoter.GaugeCreated at the explorer start", () => {
    const store = new InMemoryStore()
    const created = logEntry(
      poolsVoterAbi,
      "GaugeCreated",
      {
        poolFactory: ZERO_ADDRESS,
        votingRewardsFactory: ZERO_ADDRESS,
        gaugeFactory: ZERO_ADDRESS,
        pool: "0x00000000000000000000000000000000000000c4",
        bribeVotingReward: BRIBE,
        feeVotingReward: "0x00000000000000000000000000000000000000c3",
        gauge: GAUGE,
        creator: ALICE,
      },
      { address: POOLS_VOTER, block: 6_000_000n, timestamp: EPOCH },
    )
    const ballot = logEntry(
      poolsVoterAbi,
      "Voted",
      {
        voter: ALICE,
        pool: "0x00000000000000000000000000000000000000c4",
        tokenId: 1n,
        weight: 2n,
        totalWeight: 2n,
        timestamp: EPOCH,
      },
      { address: POOLS_VOTER, block: 6_000_001n, timestamp: EPOCH },
    )
    expect(projectBlock([created], store)).toBe(0)
    expect(store.dataSources.size).toBe(0)
    expect(projectBlock([ballot], store)).toBe(1)
    expect(activitiesOf(store, "BOOST_VOTE")[0]?.explorerParity).toBe(false)
  })
})

describe("voter bribe rewards", () => {
  function createdGauge(store: InMemoryStore, block: bigint) {
    projectBlock(
      [
        logEntry(
          boostVoterAbi,
          "GaugeCreated",
          { gauge: GAUGE, bribeVotingReward: BRIBE, creator: ALICE },
          { address: BOOST_VOTER, block, timestamp: EPOCH },
        ),
      ],
      store,
    )
  }

  it("registers the bribe and attributes its claims to the gauge", () => {
    const store = new InMemoryStore()
    createdGauge(store, 8_000_000n)
    expect(store.dataSources.get(BRIBE)).toEqual({
      network: "mezo",
      address: BRIBE,
      template: "VoterBribeReward",
      createdBlock: 8_000_000n,
      voterSource: "BOOST_VOTER",
      gauge: GAUGE,
    })
    // PAIR_CREATED itself is an explorer row at this block.
    expect(activitiesOf(store, "PAIR_CREATED")[0]?.explorerParity).toBe(true)

    const input = encodeFunctionData({
      abi: CLAIM_ABI,
      functionName: "claimBribes",
      args: [[BRIBE], [[MEZO]], 111n],
    })
    const claim = logEntry(
      bribeVotingRewardAbi,
      "ClaimRewards",
      { from: ALICE, reward: MEZO, amount: 40n },
      {
        address: BRIBE,
        block: 8_000_100n,
        timestamp: EPOCH + 700_000n,
        to: BOOST_VOTER,
        input,
      },
    )
    expect(projectBlock([claim], store)).toBe(1)
    const [claimed] = activitiesOf(store, "VOTE_BRIBE_CLAIMED")
    expect(claimed).toMatchObject({
      explorerParity: false,
      source: "BRIBE_VOTING_REWARD",
      boostContext: "MEZO_VEBTC_PAIR_BOOST",
      actor: ALICE,
      gauge: GAUGE,
      pool: null,
      rewardContract: BRIBE,
      rewardType: "Bribe",
      token: MEZO,
      amount: 40n,
      tokenId: 111n,
    })
  })

  it("records deposits by the bribe's epoch without an activity row", () => {
    const store = new InMemoryStore()
    createdGauge(store, 8_000_000n)
    const notify = logEntry(
      bribeVotingRewardAbi,
      "NotifyReward",
      { from: BOOST_VOTER, reward: MEZO, epoch: EPOCH, amount: 80_000n },
      {
        address: BRIBE,
        block: 8_000_200n,
        timestamp: EPOCH + 10n,
        from: KEEPER,
        to: BOOST_VOTER,
      },
    )
    expect(projectBlock([notify], store)).toBe(1)
    expect(activitiesOf(store, "INCENTIVE_ADDED")).toHaveLength(0)
    expect(store.rewardDeposits).toMatchObject([
      {
        rewardContract: BRIBE,
        rewardType: "Bribe",
        voterSource: "BOOST_VOTER",
        gauge: GAUGE,
        pool: null,
        token: MEZO,
        epochStart: EPOCH,
        amount: 80_000n,
        depositor: BOOST_VOTER,
        txFrom: KEEPER,
      },
    ])
  })

  it("covers bribes of validator gauges with their voter's context", () => {
    const store = new InMemoryStore()
    projectBlock(
      [
        logEntry(
          nonPoolsVoterAbi,
          "GaugeCreated",
          { gauge: GAUGE, bribeVotingReward: BRIBE, creator: ALICE },
          { address: VALIDATORS_VOTER, block: 6_400_000n, timestamp: EPOCH },
        ),
        logEntry(
          bribeVotingRewardAbi,
          "ClaimRewards",
          { from: ALICE, reward: MEZO, amount: 1n },
          { address: BRIBE, block: 6_400_000n, timestamp: EPOCH },
        ),
      ],
      store,
    )
    expect(activitiesOf(store, "GAUGE_CREATED")[0]?.explorerParity).toBe(false)
    expect(activitiesOf(store, "VOTE_BRIBE_CLAIMED")[0]).toMatchObject({
      boostContext: "UNKNOWN",
      gauge: GAUGE,
      tokenId: null,
    })
  })

  it("ignores claims on an unregistered bribe", () => {
    const store = new InMemoryStore()
    const claim = logEntry(
      bribeVotingRewardAbi,
      "ClaimRewards",
      { from: ALICE, reward: MEZO, amount: 1n },
      { address: BRIBE, block: 8_000_000n, timestamp: EPOCH },
    )
    expect(projectBlock([claim], store)).toBe(0)
  })
})

describe("incentive epochs", () => {
  it("dates BribesAdded to the epoch of its block", () => {
    const store = new InMemoryStore()
    projectBlock(
      [
        logEntry(
          boostVoterAbi,
          "BribesAdded",
          { sender: ALICE, gauge: GAUGE, amount: 5n, token: MEZO },
          {
            address: BOOST_VOTER,
            block: EXPLORER_START + 10n,
            timestamp: EPOCH + 3n * 86_400n,
          },
        ),
      ],
      store,
    )
    expect(activitiesOf(store, "INCENTIVE_ADDED")[0]).toMatchObject({
      explorerParity: true,
      epochStart: EPOCH,
    })
  })

  it("takes a pool bribe's epoch from its NotifyReward and records the deposit", () => {
    const store = new InMemoryStore()
    projectBlock(
      [
        logEntry(
          bribeVotingRewardAbi,
          "NotifyReward",
          { from: ALICE, reward: MEZO, epoch: EPOCH, amount: 9n },
          { address: LEGACY_BRIBE, block: 5_231_392n, timestamp: EPOCH + 5n },
        ),
      ],
      store,
    )
    expect(activitiesOf(store, "INCENTIVE_ADDED")[0]).toMatchObject({
      explorerParity: true,
      epochStart: EPOCH,
      source: "POOLS_VOTER",
    })
    expect(store.rewardDeposits).toMatchObject([
      {
        voterSource: "POOLS_VOTER",
        rewardType: "Bribe",
        pool: "0x10906a9e9215939561597b4c8e4b98f93c02031a",
        gauge: "0x4887fa1c88f8927932e5e1545b3b29a1a29656e7",
        epochStart: EPOCH,
        amount: 9n,
      },
    ])
  })
})

describe("the sMUSD gauge, missing from the explorer's legacy table", () => {
  const SMUSD_GAUGE: Address = "0x677817bf3e44b90e8f95222f75e2950b7904a401"
  const SMUSD_POOL: Address = "0xb4d498029af77680cd1ef828b967f010d06c51cc"
  const SMUSD_BRIBE: Address = "0x7d98f38a020a94b08eec295bfb6f4e86d581e607"
  const SMUSD_FEES: Address = "0x33b8b1162f0b86d68cad418d96246ee2c5164a01"
  const MUSD: Address = "0xdd468a1ddc392dcdbef6db6e34e89aa338f9f186"
  // Epoch 47 (2026-11-05 00:00 UTC): NotifyReward at block 13,006,492, tx
  // 0x0a756bc7…414c, log 5, 10,000 MUSD sent by the gauge's fee claim.
  const EPOCH_47 = 1_793_836_800n

  it("records the epoch 47 fee deposit for the sMUSD gauge and pool", () => {
    const store = new InMemoryStore()
    const handled = projectBlock(
      [
        logEntry(
          bribeVotingRewardAbi,
          "NotifyReward",
          {
            from: SMUSD_GAUGE,
            reward: MUSD,
            epoch: EPOCH_47,
            amount: 10_000n * 10n ** 18n,
          },
          {
            address: SMUSD_FEES,
            block: 13_006_492n,
            timestamp: EPOCH_47 + 3_600n,
          },
        ),
      ],
      store,
    )
    expect(handled).toBe(1)
    expect(store.rewardDeposits).toMatchObject([
      {
        rewardContract: SMUSD_FEES,
        rewardType: "Fee",
        voterSource: "POOLS_VOTER",
        gauge: SMUSD_GAUGE,
        pool: SMUSD_POOL,
        token: MUSD,
        epochStart: EPOCH_47,
        amount: 10_000n * 10n ** 18n,
        depositor: SMUSD_GAUGE,
      },
    ])
    // The explorer never indexed it, so the row is warehouse-only.
    expect(activitiesOf(store, "INCENTIVE_ADDED")).toMatchObject([
      {
        explorerParity: false,
        gauge: SMUSD_GAUGE,
        pool: SMUSD_POOL,
        rewardType: "Fee",
        epochStart: EPOCH_47,
      },
    ])
    expect(store.rewardMappings.get(SMUSD_FEES)).toEqual({
      id: SMUSD_FEES,
      poolAddress: SMUSD_POOL,
      gaugeAddress: SMUSD_GAUGE,
    })
  })

  it("records its bribe deposits from the gauge's creation block", () => {
    const store = new InMemoryStore()
    // Block 5,407,624: the only NotifyReward on the bribe contract so far.
    projectBlock(
      [
        logEntry(
          bribeVotingRewardAbi,
          "NotifyReward",
          { from: ALICE, reward: MEZO, epoch: 1_765_411_200n, amount: 3n },
          {
            address: SMUSD_BRIBE,
            block: 5_407_624n,
            timestamp: 1_765_411_200n + 5n,
          },
        ),
      ],
      store,
    )
    expect(store.rewardDeposits).toMatchObject([
      { rewardType: "Bribe", gauge: SMUSD_GAUGE, pool: SMUSD_POOL },
    ])
  })
})
