import type { Address } from "viem"
import { describe, expect, it } from "vitest"
import type { PriceSnapshot } from "./prices"
import { optimizeRewardAllocations } from "./rewardOptimizer"
import {
  lockShare,
  optimizeCapped,
  optimizerGauges,
  priceTarget,
  projectAllocation,
  type VoteTarget,
  veLockState,
} from "./voteMath"

const E18 = 10n ** 18n

// Stuart's deterministic fixtures (worker/query/fakes.ts on feat/pro-rebuild).
const NOW = new Date("2026-10-21T12:00:00.000Z")
const MEZO: Address = "0x7B7c000000000000000000000000000000000001"

const PRICES: PriceSnapshot = {
  btc: {
    priceUsd: "59200",
    source: "skip-oracle",
    fetchedAt: NOW.toISOString(),
  },
  mezo: {
    priceUsd: "0.01",
    source: "aerodrome-cl",
    fetchedAt: NOW.toISOString(),
  },
}

function gauge(index: number): Address {
  return `0x${index.toString(16).padStart(40, "a")}`
}

function bribe(index: number): Address {
  return `0x${index.toString(16).padStart(40, "b")}`
}

function fakeTarget(input: {
  index: number
  name: string
  weight: bigint
  mezo: bigint
  alive?: boolean
}): VoteTarget {
  return {
    targetAddress: gauge(input.index),
    gaugeAddress: gauge(input.index),
    name: input.name,
    nameSource: "profile",
    tokenId: String(200 + input.index),
    isAlive: input.alive ?? true,
    weight: input.weight,
    rewardContracts: [bribe(input.index)],
    incentives: [
      {
        contract: bribe(input.index),
        token: MEZO,
        symbol: "MEZO",
        decimals: 18,
        amount: input.mezo,
      },
    ],
  }
}

describe("optimizer inputs and projection", () => {
  const targets = [
    fakeTarget({
      index: 1,
      name: "A",
      weight: 1_000n * E18,
      mezo: 30_000n * E18,
    }),
    fakeTarget({
      index: 2,
      name: "B",
      weight: 2_000n * E18,
      mezo: 40_000n * E18,
    }),
    fakeTarget({
      index: 3,
      name: "C",
      weight: 3_000n * E18,
      mezo: 20_000n * E18,
    }),
  ]
  const powers = [12_400n * E18, 488n * E18]

  it("projects the optimizer's ballot to the same micro-USD (Vote page parity)", () => {
    const gauges = optimizerGauges(
      targets.map((target) => priceTarget(target, PRICES, 0n)),
    )
    const result = optimizeRewardAllocations({ gauges, votingPowers: powers })
    if (!result) throw new Error("expected an allocation")
    const projection = projectAllocation({
      gauges,
      votingPowers: powers,
      bps: new Map(
        result.allocations.map((allocation) => [
          allocation.id,
          allocation.basisPoints,
        ]),
      ),
    })
    expect(projection.total).toBe(result.projectedRewardMicroUsd)
    for (const allocation of result.allocations) {
      expect(projection.perTarget.get(allocation.id)?.projected).toBe(
        allocation.projectedRewardMicroUsd,
      )
    }
    expect(
      result.allocations.reduce(
        (sum, allocation) => sum + allocation.basisPoints,
        0n,
      ),
    ).toBe(10_000n)
  })

  it("subtracts the selected locks' standing votes from competing weight", () => {
    const own = 400n * E18
    const priced = priceTarget(
      targets[0] ??
        targets[1] ??
        fakeTarget({ index: 9, name: "x", weight: 0n, mezo: 0n }),
      PRICES,
      own,
    )
    expect(priced.existingWeight).toBe(600n * E18)
    const clamped = priceTarget(
      targets[0] ?? fakeTarget({ index: 9, name: "x", weight: 0n, mezo: 0n }),
      PRICES,
      5_000n * E18,
    )
    expect(clamped.existingWeight).toBe(0n)
  })

  it("marks unpriced incentives instead of valuing them at $0", () => {
    const target = {
      ...fakeTarget({ index: 5, name: "D", weight: E18, mezo: E18 }),
      incentives: [
        {
          contract: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb5" as const,
          token: "0x9999999999999999999999999999999999999999" as const,
          symbol: "REKT",
          decimals: 18,
          amount: 5n * E18,
        },
      ],
    }
    const priced = priceTarget(target, PRICES, 0n)
    expect(priced.pricingStatus).toBe("unpriced")
    expect(priced.unpricedTokens).toEqual(["REKT"])
    expect(optimizerGauges([priced])).toEqual([])
  })

  it("caps a ballot at the voter's maxVotingNum", () => {
    const many = Array.from({ length: 40 }, (_, index) =>
      priceTarget(
        fakeTarget({
          index: index + 10,
          name: `G${index}`,
          weight: 0n,
          mezo: BigInt(index + 1) * 1_000n * E18,
        }),
        PRICES,
        0n,
      ),
    )
    const bps = optimizeCapped({
      gauges: optimizerGauges(many),
      votingPowers: [1_000_000n * E18],
      maxTargets: 30,
    })
    if (!bps) throw new Error("expected an allocation")
    expect(bps.size).toBeLessThanOrEqual(30)
    expect([...bps.values()].reduce((sum, value) => sum + value, 0n)).toBe(
      10_000n,
    )
  })

  it("splits a target's projection across locks by power", () => {
    const share = lockShare({
      projected: 1_000_000n,
      voteWeight: 100n,
      lockPower: 100n,
      bps: 10_000n,
    })
    expect(share).toBe(1_000_000n)
    const half = lockShare({
      projected: 1_000_000n,
      voteWeight: 200n,
      lockPower: 100n,
      bps: 10_000n,
    })
    expect(half).toBe(500_000n)
  })
})

describe("veLockState", () => {
  const now = Date.UTC(2026, 10, 9) / 1000
  it("reads expired, withdrawn, auto-max and active locks", () => {
    // veBTC #5678 ended 7 May 2026 and still holds a little BTC.
    const may7 = BigInt(Date.UTC(2026, 4, 7) / 1000)
    expect(
      veLockState(
        { amount: 900_000_000_000_000n, end: may7, isPermanent: false },
        now,
      ),
    ).toBe("expired")
    expect(veLockState({ amount: 0n, end: 0n, isPermanent: false }, now)).toBe(
      "withdrawn",
    )
    expect(veLockState({ amount: 5n, end: 0n, isPermanent: true }, now)).toBe(
      "auto-max",
    )
    expect(
      veLockState(
        { amount: 5n, end: BigInt(now + 86_400), isPermanent: false },
        now,
      ),
    ).toBe("active")
  })
})
