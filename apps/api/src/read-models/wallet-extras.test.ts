import {
  demoEpoch,
  demoGaugeCards,
  demoGaugeDirectory,
  demoPrices,
  demoWalletOverview,
} from "@matchbox/contracts/read-models/fixtures"
import { describe, expect, it } from "vitest"
import { gaugeColor, gaugePalette, tokenColor } from "./colors"
import { pairFromSymbol, tokensBySymbol } from "./gauges"
import {
  gaugeCardsFrom,
  projectLockRewards,
  suggestFor,
  totalProjected,
  votesByVoter,
} from "./wallet-extras"

const wad = 10n ** 18n
const cards = gaugeCardsFrom(demoGaugeDirectory)
const kiln = demoGaugeCards.kilnLabs.gauge.address
const vebtc604 = demoGaugeCards.vebtc604.gauge.address
const [lock4120, lock2207] = demoWalletOverview.locks
if (lock4120 === undefined || lock2207 === undefined) throw new Error("fixture")

describe("projected rewards", () => {
  it("pays the lock its share of each gauge's incentives", () => {
    // Lock #2207 puts 70% of 41,260 votes on Kiln and 30% on veBTC #604.
    const projected = projectLockRewards(
      [
        { gauge: kiln, weight: (28_882n * wad) / 1n },
        { gauge: vebtc604, weight: 12_378n * wad },
      ],
      cards,
      demoPrices,
    )
    expect(projected?.tokens).toHaveLength(1)
    const [mezo] = projected?.tokens ?? []
    // 6413.04 × 28882/5880000 + 2822.93 × 12378/2180000
    expect(mezo?.amount.startsWith("47.5")).toBe(true)
    expect(projected?.usd).toBe("8.75")
  })

  it("is null without votes and skips unknown gauges", () => {
    expect(projectLockRewards([], cards, demoPrices)).toBeNull()
    expect(
      projectLockRewards(
        [{ gauge: `0x${"9".repeat(40)}`, weight: wad }],
        cards,
        demoPrices,
      ),
    ).toEqual({ usd: "0.00", tokens: [] })
  })

  it("never pays more than the whole incentive", () => {
    const projected = projectLockRewards(
      [{ gauge: kiln, weight: 10_000_000n * wad }],
      cards,
      demoPrices,
    )
    expect(projected?.tokens[0]?.amount).toBe("6413.04")
  })

  it("totals the locks' projections", () => {
    expect(totalProjected(demoWalletOverview.locks, demoPrices)?.usd).toBe(
      "207.14",
    )
    expect(totalProjected([{ projected: null }], demoPrices)).toBeNull()
  })
})

describe("suggestion", () => {
  const base = {
    cards,
    claimableEpoch: demoEpoch(8),
    claimable: demoWalletOverview.claimable,
  }

  it("suggests the near-5x boost gauge the wallet votes for", () => {
    expect(suggestFor({ ...base, locks: demoWalletOverview.locks })).toEqual(
      demoWalletOverview.suggestion,
    )
  })

  it("puts withdrawing an expired lock first", () => {
    const expired = {
      ...lock4120,
      tab: "expired" as const,
      isWithdrawable: true,
    }
    expect(suggestFor({ ...base, locks: [lock2207, expired] })).toMatchObject({
      type: "withdraw",
      lock: { escrow: "vebtc", tokenId: "4120" },
    })
  })

  it("asks an idle lock to vote before anything else but withdraw", () => {
    const idle = {
      ...lock2207,
      vote: { status: "not-voted" as const, epoch: demoEpoch(9) },
    }
    expect(suggestFor({ ...base, locks: [lock4120, idle] })).toMatchObject({
      type: "vote",
      lock: { escrow: "vemezo", tokenId: "2207" },
      votingPower: "41260",
    })
  })

  it("falls back to claiming, and to nothing", () => {
    expect(suggestFor({ ...base, locks: [lock4120] })).toMatchObject({
      type: "claim",
      claimable: { usd: "212.48" },
    })
    expect(
      suggestFor({
        ...base,
        locks: [lock4120],
        claimable: { usd: "0.40", tokens: [] },
      }),
    ).toBeNull()
  })
})

describe("gauge colours and pairs", () => {
  it("takes pool colours from the lead token and others from the palette", () => {
    expect(tokenColor("BTC")).toBe("#F7931A")
    expect(tokenColor("mUSDC")).toBe("#2775CA")
    expect(tokenColor("REKT")).toBeNull()
    const color = gaugeColor(kiln, "boost", null)
    expect(gaugePalette).toContain(color)
    expect(gaugeColor(kiln, "boost", null)).toBe(color)
  })

  it("reads pairs out of pool symbols", () => {
    const tokens = tokensBySymbol([
      { address: `0x${"1".repeat(40)}`, symbol: "mSolvBTC", decimals: 18 },
    ])
    expect(pairFromSymbol("sAMM-mUSDC/MUSD", tokens)).toMatchObject({
      poolType: "stable",
      tokens: [{ symbol: "mUSDC" }, { symbol: "MUSD" }],
    })
    expect(pairFromSymbol("vAMM-mSolvBTC/MUSD", tokens)?.tokens[0]).toEqual({
      address: `0x${"1".repeat(40)}`,
      symbol: "mSolvBTC",
      name: "mSolvBTC",
      decimals: 18,
    })
    expect(pairFromSymbol("vAMM-REKT/MUSD", tokens)).toBeNull()
    expect(pairFromSymbol("mlvBTC-mUSDC", tokens)).toBeNull()
    expect(pairFromSymbol(null, tokens)).toBeNull()
  })
})

describe("a lock's votes per voter", () => {
  const boostGauge = demoGaugeCards.kilnLabs.gauge
  const second = demoGaugeCards.vebtc604.gauge
  const cross = {
    ...boostGauge,
    voter: "third-party" as const,
    kind: "mezo" as const,
  }

  it("gives each voter its own 100% and its own last vote", () => {
    // Lock #224, 12 Nov 2026: 1,702,812 on BoostVoter over two gauges,
    // 1,451,855 on ThirdPartyVoter on one.
    const byVoter = votesByVoter(
      [
        { gauge: boostGauge, weight: 1_000_000n * wad },
        { gauge: cross, weight: 1_451_855n * wad },
        { gauge: second, weight: 702_812n * wad },
      ],
      (voter) => (voter === "boost" ? 200 : 100),
    )
    expect(byVoter).toEqual([
      {
        voter: "boost",
        votes: "1702812",
        allocations: [
          { gauge: boostGauge, basisPoints: 5873 },
          { gauge: second, basisPoints: 4127 },
        ],
        votedAt: 200,
      },
      {
        voter: "third-party",
        votes: "1451855",
        allocations: [{ gauge: cross, basisPoints: 10_000 }],
        votedAt: 100,
      },
    ])
  })

  it("leaves out a voter the lock has no weight on", () => {
    expect(votesByVoter([], () => 0)).toEqual([])
    expect(votesByVoter([{ gauge: boostGauge, weight: 0n }], () => 0)).toEqual(
      [],
    )
  })
})
