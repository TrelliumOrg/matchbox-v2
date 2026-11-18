import type { GaugeDirectoryResponse } from "@matchbox/contracts/read-models"
import {
  demoBlock,
  demoEpoch,
  demoGaugeCards,
  demoGaugeDirectory,
  demoGaugeProfile,
  demoGauges,
  demoMeta,
  demoPrices,
  demoWalletOverview,
  demoWalletRewards,
} from "@matchbox/contracts/read-models/fixtures"
import { getAddress } from "viem"
import { describe, expect, it } from "vitest"
import { pricesFromReadModel } from "./prices"
import {
  claimableFromRewards,
  fundedEpochsFromProfiles,
  gaugeHistoryFromProfile,
  lockVoteStateFromOverview,
  votingDomainFromDirectory,
  walletEarningsFromReadModels,
  walletLocksFromOverview,
} from "./readModelProviders"
import { fixtureRewardContracts, type RewardContracts } from "./rewardContracts"
import type { VotingDomain } from "./voting"

const E18 = 10n ** 18n
const NOW = new Date("2026-11-08T11:53:00.000Z")
const directory: GaugeDirectoryResponse = {
  data: demoGaugeDirectory,
  meta: demoMeta,
}
const kiln = demoGauges.kilnLabs.address

async function contractsFor(
  branch: VotingDomain["branch"],
  gauges: readonly string[],
): Promise<Map<string, RewardContracts>> {
  return fixtureRewardContracts()(
    branch,
    gauges.map((gauge) => getAddress(gauge)),
  )
}

async function boostDomain(): Promise<VotingDomain> {
  return votingDomainFromDirectory({
    directory,
    branch: "boost",
    rewardContracts: await contractsFor(
      "boost",
      demoGaugeDirectory.gauges.map((card) => card.gauge.address),
    ),
  })
}

describe("read-model providers", () => {
  it("maps prices and keeps a missing price unpriced", () => {
    const prices = pricesFromReadModel(demoPrices, NOW)
    expect(prices.btc).toEqual({
      priceUsd: "105710",
      source: "skip-oracle",
      fetchedAt: new Date(
        (demoPrices.btc?.updatedAt ?? 0) * 1000,
      ).toISOString(),
    })
    expect(prices.mezo.source).toBe("aerodrome-cl")
    const missing = pricesFromReadModel({ btc: null, mezo: null }, NOW)
    expect(missing.mezo).toEqual({
      priceUsd: null,
      source: "unavailable",
      fetchedAt: NOW.toISOString(),
    })
  })

  it("builds the boost domain in base units at the read model's block", async () => {
    const domain = await boostDomain()
    expect(domain.blockNumber).toBe(BigInt(demoBlock))
    expect(domain.epochStart).toBe(BigInt(demoEpoch(47).start))
    expect(domain.epochNext).toBe(BigInt(demoEpoch(47).end))
    expect(domain.totalWeight).toBe(282_900_000n * E18)
    expect(domain.targets).toHaveLength(demoGaugeDirectory.gauges.length)
    const target = domain.targets.find(
      (entry) => entry.gaugeAddress.toLowerCase() === kiln,
    )
    expect(target).toMatchObject({
      targetAddress: getAddress(kiln),
      name: "Kiln Labs",
      nameSource: "profile",
      tokenId: "7",
      isAlive: true,
      weight: 5_880_000n * E18,
    })
    expect(target?.incentives).toEqual([
      {
        contract: domain.rewardContracts.get(kiln)?.bribe,
        token: getAddress("0x7b7c000000000000000000000000000000000001"),
        symbol: "MEZO",
        decimals: 18,
        amount: 641_304n * 10n ** 16n,
      },
    ])
    expect(domain.pictures.get(kiln)).toEqual({ type: "initials", text: "KL" })
    const derived = domain.targets.find((entry) => entry.tokenId === "604")
    expect(derived?.nameSource).toBe("derived")
  })

  it("votes for the pool behind a pool gauge and drops it when unknown", async () => {
    const pools: GaugeDirectoryResponse = {
      data: {
        ...demoGaugeDirectory,
        gauges: [
          {
            ...demoGaugeCards.kilnLabs,
            gauge: demoGauges.btcMusd,
            boost: null,
            optimalVotes: null,
            vebtcWeight: null,
          },
        ],
      },
      meta: demoMeta,
    }
    const pool = demoGauges.btcMusd.address
    const contracts = await contractsFor("pools", [pool])
    const domain = votingDomainFromDirectory({
      directory: pools,
      branch: "pools",
      rewardContracts: contracts,
    })
    expect(domain.targets[0]?.targetAddress).toBe(contracts.get(pool)?.pool)
    expect(domain.targets[0]?.gaugeAddress).toBe(getAddress(pool))
    expect(domain.totalWeight).toBe(5_880_000n * E18)
    const unknown = votingDomainFromDirectory({
      directory: pools,
      branch: "pools",
      rewardContracts: new Map(),
    })
    expect(unknown.targets).toEqual([])
  })

  it("maps the wallet's locks per escrow, exactly", () => {
    expect(walletLocksFromOverview(demoWalletOverview, "veBTC")).toEqual([
      {
        asset: "veBTC",
        tokenId: 4120n,
        amount: 8n * 10n ** 17n,
        end: BigInt(demoWalletOverview.locks[0]?.unlocksAt ?? 0),
        isPermanent: false,
        votingPower: 611n * 10n ** 15n,
      },
    ])
    expect(walletLocksFromOverview(demoWalletOverview, "veMEZO")).toEqual([
      expect.objectContaining({
        tokenId: 2207n,
        amount: 48_000n * E18,
        votingPower: 41_260n * E18,
      }),
    ])
    expect(walletLocksFromOverview(null, "veMEZO")).toEqual([])
  })

  it("splits this epoch's votes by basis points", async () => {
    const domain = await boostDomain()
    const [state, unknown] = lockVoteStateFromOverview({
      overview: demoWalletOverview,
      domain,
      tokenIds: [2207n, 9999n],
    })
    expect(state?.lastVoted).toBe(
      BigInt(Date.parse("2026-11-05T09:40:00Z") / 1000),
    )
    expect(state?.votes.get(kiln)).toBe((41_260n * E18 * 7_000n) / 10_000n)
    expect(state?.votes.get(demoGauges.vebtc604.address)).toBe(
      (41_260n * E18 * 3_000n) / 10_000n,
    )
    expect(state?.usedWeight).toBe(41_260n * E18)
    expect(unknown).toEqual({
      tokenId: 9999n,
      lastVoted: 0n,
      usedWeight: 0n,
      votes: new Map(),
    })
  })

  it("takes a voter's own votes and time when the lock votes through two", async () => {
    const domain = await boostDomain()
    const [lock] = demoWalletOverview.locks.filter(
      (entry) => entry.tokenId === "2207",
    )
    if (lock === undefined || lock.vote.status !== "voted") {
      throw new Error("fixture")
    }
    const boostAt = Date.parse("2026-11-05T09:40:00Z") / 1000
    const cross = {
      ...demoGauges.kilnLabs,
      address: "0x00000000000000000000000000000000000000c1",
      voter: "third-party" as const,
      kind: "mezo" as const,
    }
    // The same lock also has its full power on a MEZO gauge, voted later.
    const overview = {
      ...demoWalletOverview,
      locks: [
        {
          ...lock,
          vote: {
            ...lock.vote,
            votes: "82520",
            allocations: [
              { gauge: demoGauges.kilnLabs, basisPoints: 3_500 },
              { gauge: demoGauges.vebtc604, basisPoints: 1_500 },
              { gauge: cross, basisPoints: 5_000 },
            ],
            votedAt: boostAt + 3_600,
            byVoter: [
              {
                voter: "boost" as const,
                votes: "41260",
                allocations: lock.vote.allocations,
                votedAt: boostAt,
              },
              {
                voter: "third-party" as const,
                votes: "41260",
                allocations: [{ gauge: cross, basisPoints: 10_000 }],
                votedAt: boostAt + 3_600,
              },
            ],
          },
        },
      ],
    }
    const [state] = lockVoteStateFromOverview({
      overview,
      domain,
      tokenIds: [2207n],
    })
    // BoostVoter's own time, and the full power on its two gauges.
    expect(state?.lastVoted).toBe(BigInt(boostAt))
    expect(state?.usedWeight).toBe(41_260n * E18)
    expect(state?.votes.get(kiln)).toBe((41_260n * E18 * 7_000n) / 10_000n)
    expect(state?.votes.size).toBe(2)
  })

  it("reads claimable rewards per lock with their bribe contracts", async () => {
    const domain = await boostDomain()
    const locks = walletLocksFromOverview(demoWalletOverview, "veMEZO")
    const result = claimableFromRewards({
      rewards: demoWalletRewards,
      domain,
      locks,
    })
    expect(result.skipped).toBe(0)
    expect(result.locks).toHaveLength(1)
    const [lock] = result.locks
    expect(lock).toMatchObject({
      source: "boost_bribes",
      voter: domain.voter,
      tokenId: 2207n,
    })
    expect(lock?.entries.map((entry) => entry.earned)).toEqual([
      3_217n * 10n ** 16n,
      1_513n * 10n ** 16n,
    ])
    expect(lock?.entries[0]?.contract).toBe(
      domain.rewardContracts.get(kiln)?.bribe,
    )
  })

  it("leaves out rewards whose contract is unknown", async () => {
    const domain = votingDomainFromDirectory({
      directory,
      branch: "validators",
      rewardContracts: new Map(),
    })
    const result = claimableFromRewards({
      rewards: demoWalletRewards,
      domain,
      locks: walletLocksFromOverview(demoWalletOverview, "veBTC"),
    })
    expect(result.locks).toEqual([])
    expect(result.skipped).toBe(3)
  })

  it("counts funded completed epochs from gauge profiles", async () => {
    const domain = await boostDomain()
    const funded = fundedEpochsFromProfiles({
      domain,
      window: 8,
      profiles: new Map([[kiln, demoGaugeProfile]]),
    })
    // Epochs 46 and 45 paid incentives; epoch 47 is still open.
    expect(funded.get(kiln)).toBe(2)
    expect(funded.size).toBe(1)
  })

  it("builds a boost gauge's recent epochs, newest first", () => {
    const history = gaugeHistoryFromProfile({
      profile: demoGaugeProfile,
      count: 3,
      currentEpochStart: BigInt(demoEpoch(47).start),
      mezoPriceMicroUsd: 184_000n,
    })
    expect(history.rows.map((row) => row.status)).toEqual([
      "current",
      "sealed",
      "sealed",
    ])
    const [current, previous] = history.rows
    expect(current).toMatchObject({
      epochStart: String(demoEpoch(47).start),
      veMezo: (5_880_000n * E18).toString(),
      boostWad: (44n * 10n ** 17n).toString(),
      incentivesUsd: "1180",
    })
    expect(current?.incentives[0]).toMatchObject({
      symbol: "MEZO",
      amount: (641_304n * 10n ** 16n).toString(),
    })
    // 1180 * 52 / (5,880,000 * 0.184) = 5.67%
    expect(current?.apyBps).toBe("567")
    expect(previous).toMatchObject({ incentivesUsd: "1120", boostWad: null })
  })

  it("derives veMEZO earnings from the overview and rewards", () => {
    const earnings = walletEarningsFromReadModels({
      overview: demoWalletOverview,
      rewards: demoWalletRewards,
      epoch: demoEpoch(47),
    })
    expect(earnings.tokenIds).toEqual(["2207"])
    expect(earnings.current).toMatchObject({
      epochStart: String(demoEpoch(47).start),
      usdNow: "8.75",
    })
    expect(earnings.totals.claimable.usdNow).toBe("8.7")
    // Epoch 46 is unclaimed, so its veMEZO rewards are the last epoch.
    expect(earnings.epochs).toEqual([
      expect.objectContaining({
        epochStart: String(demoEpoch(46).start),
        usdAtEarn: "8.7",
      }),
    ])
    expect(earnings.partial).toBe(false)
    const empty = walletEarningsFromReadModels({
      overview: null,
      rewards: null,
      epoch: demoEpoch(47),
    })
    expect(empty.tokenIds).toEqual([])
    expect(empty.current.usdNow).toBe("0")
  })
})
