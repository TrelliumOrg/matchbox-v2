import type { GaugeIncentives } from "@matchbox/contracts/market"
import { gaugeDirectorySchema } from "@matchbox/contracts/read-models"
import {
  demoGaugeCards,
  demoGaugeDirectory,
  demoGaugeProfile,
} from "@matchbox/contracts/read-models/fixtures"
import type { PublicClient } from "viem"
import { describe, expect, it } from "vitest"
import {
  applyGaugeVotes,
  changedVotes,
  createGaugeVotesReader,
  type GaugeVotes,
  profileWithCard,
} from "./gauge-votes"

const wad = 10n ** 18n
const kiln = demoGaugeCards.kilnLabs
const untouched = new Map(
  demoGaugeDirectory.gauges.map((card) => [
    card.gauge.address,
    BigInt(card.votes) * wad,
  ]),
)

/** The chain after a vote: Kiln Labs at `votes`, the rest as stored. */
function chain(votes: bigint, boostTotal: bigint | null = null): GaugeVotes {
  return {
    block: 13_203_300,
    weights: new Map([...untouched, [kiln.gauge.address, votes]]),
    boostTotal,
  }
}

const none = { incentives: new Map(), prices: null, boosts: new Map() }

describe("gauge votes read from the chain over the directory", () => {
  it("finds nothing to write when no vote changed", () => {
    const votes = chain(BigInt(kiln.votes) * wad)
    expect(changedVotes(demoGaugeDirectory, votes)).toEqual([])
    const { directory, changed } = applyGaugeVotes(
      demoGaugeDirectory,
      votes,
      none,
    )
    expect(changed).toEqual([])
    expect(directory.gauges).toEqual(demoGaugeDirectory.gauges)
  })

  it("gives the voted gauge its new votes and a lower APY", () => {
    // 5,880,000 votes at 2.56% become 11,760,000: half the APY.
    const votes = chain(11_760_000n * wad)
    expect(
      changedVotes(demoGaugeDirectory, votes).map((card) => card.gauge.name),
    ).toEqual(["Kiln Labs"])
    const { directory, changed } = applyGaugeVotes(
      demoGaugeDirectory,
      votes,
      none,
    )
    expect(changed).toHaveLength(1)
    const card = directory.gauges.find(
      (each) => each.gauge.address === kiln.gauge.address,
    )
    expect(card?.votes).toBe("11760000")
    expect(card?.apy).toBe("1.28")
    // Incentives, names and metadata belong to the publish: untouched.
    expect(card?.incentives).toEqual(kiln.incentives)
    expect(card?.gauge).toEqual(kiln.gauge)
    // Every other card is the stored one.
    const others = (cards: typeof directory.gauges) =>
      cards
        .filter((each) => each.gauge.address !== kiln.gauge.address)
        .sort((left, right) =>
          left.gauge.address < right.gauge.address ? -1 : 1,
        )
    expect(others(directory.gauges)).toEqual(others(demoGaugeDirectory.gauges))
    gaugeDirectorySchema.parse(directory)
  })

  it("computes the APY as the publish does when the market has the gauge", () => {
    const incentives: GaugeIncentives = {
      network: "mezo",
      voter: "boost",
      gaugeAddress: kiln.gauge.address,
      epochStart: demoGaugeDirectory.epoch.start,
      isAlive: true,
      weight: null,
      rewards: [],
      totalUsd: "1180",
      unpricedRewards: 0,
      aprPercent: null,
    }
    const { changed } = applyGaugeVotes(
      demoGaugeDirectory,
      chain(10_000_000n * wad),
      {
        incentives: new Map([[kiln.gauge.address, incentives]]),
        prices: {
          btcUsd: { usd: "100000", source: "skip-oracle" },
          mezoUsd: { usd: "0.2", source: "coingecko" },
        },
        boosts: new Map(),
      },
    )
    // 1180 * 52 / (10,000,000 * 0.2) * 100.
    expect(changed[0]?.apy).toBe("3.06")
  })

  it("has no APY for a gauge left with no votes", () => {
    const { changed } = applyGaugeVotes(demoGaugeDirectory, chain(0n), none)
    expect(changed[0]?.votes).toBe("0")
    expect(changed[0]?.apy).toBeNull()
  })

  it("takes the boost and the total from the chain, and keeps the order", () => {
    const { directory, changed } = applyGaugeVotes(
      demoGaugeDirectory,
      chain(900_000_000n * wad, 1_177_020_000n * wad),
      {
        ...none,
        boosts: new Map([[kiln.gauge.vebtcTokenId ?? "", 5n * wad]]),
      },
    )
    expect(changed[0]?.boost).toBe("5")
    expect(directory.totalVotes).toBe("1177020000")
    // Most votes first.
    expect(directory.gauges[0]?.gauge.name).toBe("Kiln Labs")
  })

  it("leaves a gauge whose read failed as stored", () => {
    const votes = chain(1n * wad)
    votes.weights.delete(kiln.gauge.address)
    expect(changedVotes(demoGaugeDirectory, votes)).toEqual([])
  })

  it("carries the new card into the profile of the gauge", () => {
    const { changed } = applyGaugeVotes(
      demoGaugeDirectory,
      chain(11_760_000n * wad),
      { ...none, boosts: new Map([[kiln.gauge.vebtcTokenId ?? "", 5n * wad]]) },
    )
    const [card] = changed
    if (card === undefined) throw new Error("no change")
    const profile = profileWithCard(
      {
        ...demoGaugeProfile,
        details: {
          kind: "vebtc",
          tokenId: "7",
          owner: null,
          beneficiary: null,
          lock: null,
          vebtcWeight: "3.1047",
          boost: "4.4",
          optimalVotes: "6970000",
          locked: null,
        },
      },
      card,
      demoGaugeDirectory.epoch.number,
    )
    expect(profile.card).toEqual(card)
    expect(profile.votesHistory.at(-1)?.votes).toBe("11760000")
    // Earlier epochs are history.
    expect(profile.votesHistory.slice(0, -1)).toEqual(
      demoGaugeProfile.votesHistory.slice(0, -1),
    )
    expect(profile.details).toMatchObject({ kind: "vebtc", boost: "5" })
    expect(profile.description).toBe(demoGaugeProfile.description)
  })
})

describe("the gauge votes reader", () => {
  type Call = { functionName: string; args?: readonly unknown[] }
  const pool = "0xb4D498029af77680cD1eF828b967f010d06C51CC"
  const poolGauge = "0x677817bf3e44b90e8f95222f75e2950b7904a401"

  function client() {
    const requests: Call[][] = []
    const fake = {
      async multicall(input: { contracts: readonly Call[] }) {
        requests.push([...input.contracts])
        return input.contracts.map((call) => {
          const [first] = call.args ?? []
          switch (call.functionName) {
            case "getBlockNumber":
              return { status: "success", result: 13_203_300n }
            case "totalWeight":
              return { status: "success", result: 500n * wad }
            case "poolForGauge":
              return { status: "success", result: pool }
            case "weights":
              return String(first).toLowerCase() === pool.toLowerCase()
                ? { status: "success", result: 7n * wad }
                : String(first).toLowerCase() === kiln.gauge.address
                  ? { status: "success", result: 9n * wad }
                  : { status: "failure", error: new Error("reverted") }
            case "getBoost":
              return { status: "success", result: 3n * wad }
            default:
              return { status: "failure", error: new Error("unknown") }
          }
        })
      },
    }
    return {
      // A clock that never moves: the deadline below is never reached.
      readers: createGaugeVotesReader(fake as unknown as PublicClient, {
        now: () => 0,
        wait: async () => undefined,
      }),
      requests,
    }
  }

  const gauges = [
    { address: kiln.gauge.address, voter: "boost" as const },
    { address: poolGauge, voter: "pools" as const },
    { address: `0x${"12".repeat(20)}`, voter: "validators" as const },
  ]

  it("reads a pool gauge by its pool, asked for once", async () => {
    const { readers, requests } = client()
    const deadline = 1_000
    const votes = await readers.votes(gauges, deadline)
    expect(votes.block).toBe(13_203_300)
    expect(votes.boostTotal).toBe(500n * wad)
    // The validator gauge did not answer: absent, never zero.
    expect(votes.weights).toEqual(
      new Map([
        [kiln.gauge.address, 9n * wad],
        [poolGauge, 7n * wad],
      ]),
    )
    expect(requests).toHaveLength(2)
    await readers.votes(gauges, deadline)
    // The pool is remembered: one request the second time.
    expect(requests).toHaveLength(3)
  })

  it("reads boosts by veBTC lock", async () => {
    const { readers } = client()
    expect(await readers.boosts(["7"], 1_000)).toEqual(
      new Map([["7", 3n * wad]]),
    )
  })
})
