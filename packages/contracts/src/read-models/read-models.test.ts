import { describe, expect, it } from "vitest"
import {
  activityCategory,
  activityRowSchema,
  activityTypesIn,
  cardMetaOf,
  chainHeadSchema,
  gaugeCardMetaSchema,
  gaugeCardSchema,
  gaugeConsistencyQuerySchema,
  gaugeConsistencyRankingSchema,
  gaugeDetailsSchema,
  gaugeDirectorySchema,
  gaugeFundingSchema,
  gaugeKindFor,
  gaugeProfileReadModelSchema,
  gaugeQuerySchema,
  gaugeRefSchema,
  headMessageSchema,
  isRetiredGauge,
  isRetiredLock,
  poolKindSchema,
  poolTypeSchema,
  pricesSchema,
  proSummarySchema,
  protocolEpochSchema,
  protocolHistorySchema,
  protocolSchema,
  readModelMetaSchema,
  type ValueBreakdown,
  voteUnitFor,
  walletActivitySchema,
  walletBalancesSchema,
  walletOverviewSchema,
  walletRewardsSchema,
  watchClientIdSchema,
  watchListSchema,
} from "."
import {
  demoActivityRows,
  demoChainHead,
  demoEpoch,
  demoGaugeCards,
  demoGaugeDetails,
  demoGaugeDirectory,
  demoGaugeProfile,
  demoGauges,
  demoKindCards,
  demoMeta,
  demoPrices,
  demoProtocol,
  demoProtocolEpoch,
  demoProtocolHistory,
  demoReadModels,
  demoSummary,
  demoWalletBalances,
  demoWalletOverview,
  demoWalletRewards,
  demoWatchList,
} from "./fixtures"

/** Exact cents from a decimal string with at most two decimals. */
function cents(value: string): bigint {
  const [whole = "0", fraction = ""] = value.split(".")
  expect(fraction.length).toBeLessThanOrEqual(2)
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"))
}

function expectBreakdownAddsUp(breakdown: ValueBreakdown): void {
  const total = breakdown.tokens.reduce(
    (sum, token) => sum + cents(token.usd ?? "0"),
    0n,
  )
  expect(total).toBe(cents(breakdown.usd))
}

describe("read model fixtures", () => {
  it("parse with their schemas", () => {
    expect(walletOverviewSchema.parse(demoWalletOverview)).toEqual(
      demoWalletOverview,
    )
    expect(walletRewardsSchema.parse(demoWalletRewards)).toEqual(
      demoWalletRewards,
    )
    expect(walletActivitySchema.parse(demoReadModels.activity)).toEqual(
      demoReadModels.activity,
    )
    expect(protocolSchema.parse(demoProtocol)).toEqual(demoProtocol)
    expect(gaugeDirectorySchema.parse(demoGaugeDirectory)).toEqual(
      demoGaugeDirectory,
    )
    expect(gaugeProfileReadModelSchema.parse(demoGaugeProfile)).toEqual(
      demoGaugeProfile,
    )
    expect(pricesSchema.parse(demoPrices)).toEqual(demoPrices)
    expect(chainHeadSchema.parse(demoChainHead)).toEqual(demoChainHead)
    expect(readModelMetaSchema.parse(demoMeta)).toEqual(demoMeta)
    expect(walletBalancesSchema.parse(demoWalletBalances)).toEqual(
      demoWalletBalances,
    )
    expect(watchListSchema.parse(demoWatchList)).toEqual(demoWatchList)
    expect(protocolHistorySchema.parse(demoProtocolHistory)).toEqual(
      demoProtocolHistory,
    )
    expect(protocolEpochSchema.parse(demoProtocolEpoch)).toEqual(
      demoProtocolEpoch,
    )
    expect(proSummarySchema.parse(demoSummary)).toEqual(demoSummary)
  })

  it("reads documents written before the new fields existed", () => {
    const { color: _color, ...legacyRef } = demoGauges.kilnLabs
    expect(gaugeRefSchema.parse(legacyRef).color).toBeNull()
    const {
      projected: _projected,
      suggestion: _suggestion,
      ...legacy
    } = demoWalletOverview
    const parsed = walletOverviewSchema.parse({
      ...legacy,
      locks: legacy.locks.map(({ projected: _lockProjected, ...lock }) => lock),
    })
    expect(parsed.projected).toBeNull()
    expect(parsed.suggestion).toBeNull()
    expect(parsed.locks.every((lock) => lock.projected === null)).toBe(true)
  })

  it("keep every USD breakdown equal to its total", () => {
    expectBreakdownAddsUp(demoWalletOverview.claimable)
    for (const lock of demoWalletOverview.locks) {
      expectBreakdownAddsUp(lock.claimable)
    }
    expectBreakdownAddsUp(demoWalletRewards.readyToClaim)
    for (const lock of demoWalletRewards.byLock) {
      expectBreakdownAddsUp(lock.rewards)
      const gaugeTotal = lock.gauges.reduce(
        (sum, gauge) => sum + cents(gauge.usd),
        0n,
      )
      expect(gaugeTotal).toBe(cents(lock.rewards.usd))
    }
    for (const claim of demoWalletRewards.history) {
      expectBreakdownAddsUp(claim.rewards)
    }
    for (const lock of demoWalletOverview.locks) {
      if (lock.projected !== null) expectBreakdownAddsUp(lock.projected)
    }
    if (demoWalletOverview.projected !== null) {
      expectBreakdownAddsUp(demoWalletOverview.projected)
    }
    expectBreakdownAddsUp(
      demoProtocolEpoch.funded.gauges[0]?.incentives ?? {
        usd: "0",
        tokens: [],
      },
    )
    for (const card of demoGaugeDirectory.gauges) {
      expectBreakdownAddsUp(card.incentives)
    }
    for (const funded of demoProtocol.funded.gauges) {
      expectBreakdownAddsUp(funded.incentives)
    }
  })

  it("matches the frames' headline figures", () => {
    expect(demoWalletOverview.claimable.usd).toBe("212.48")
    const byLock = demoWalletOverview.locks.reduce(
      (sum, lock) => sum + cents(lock.claimable.usd),
      0n,
    )
    expect(byLock).toBe(cents("212.48"))
    for (const bar of demoProtocol.incentivesByEpoch) {
      expect(
        cents(bar.vebtcUsd) + cents(bar.validatorsUsd) + cents(bar.poolsUsd),
      ).toBe(cents(bar.totalUsd))
    }
    const last = demoProtocol.incentivesByEpoch.at(-1)
    expect(last?.totalUsd).toBe(demoProtocol.incentives.usd)
  })

  it("numbers the week of Thu 5 Nov 2026 as epoch 47, like the live API", () => {
    expect(demoEpoch(0).start).toBe(Date.UTC(2025, 11, 11) / 1000)
    expect(demoEpoch(38).start).toBe(Date.UTC(2026, 8, 3) / 1000)
    expect(demoEpoch(47)).toEqual({
      number: 47,
      start: Date.UTC(2026, 10, 5) / 1000,
      end: Date.UTC(2026, 10, 12) / 1000,
    })
  })

  it("charts every epoch since Mezo Earn's launch (Epoch 38)", () => {
    expect(
      demoProtocol.incentivesByEpoch.map((bar) => bar.epoch.number),
    ).toEqual([38, 39, 40, 41, 42, 43, 44, 45, 46, 47])
    expect(demoProtocolHistory.epochs).toHaveLength(10)
  })

  it("suggests topping up the near-5x boost gauge the wallet votes for", () => {
    expect(demoWalletOverview.suggestion).toMatchObject({
      type: "boost",
      gauge: { name: "Kiln Labs" },
      missingVotes: "1090000",
    })
  })

  it("lists activity newest first", () => {
    const times = demoActivityRows.map((row) => row.timestamp)
    expect([...times].sort((a, b) => b - a)).toEqual(times)
  })
})

describe("activity categories", () => {
  it("files every type under one tab", () => {
    expect(activityCategory("vote")).toBe("votes")
    expect(activityCategory("lock-merge")).toBe("locks")
    expect(activityTypesIn("locks")).toEqual([
      "lock-create",
      "lock-add",
      "lock-extend",
      "lock-merge",
      "lock-withdraw",
    ])
    expect(activityTypesIn("system")).toEqual(["boost-refresh"])
  })

  it("rejects amounts sent as numbers", () => {
    const [row] = demoActivityRows
    expect(activityRowSchema.safeParse({ ...row, votes: 0.611 }).success).toBe(
      false,
    )
  })
})

describe("head messages", () => {
  it("accepts heads and stale notices", () => {
    expect(
      headMessageSchema.parse({ type: "head", block: 1, timestamp: 2 }),
    ).toEqual({ type: "head", block: 1, timestamp: 2 })
    expect(headMessageSchema.parse({ type: "stale", since: 5 })).toEqual({
      type: "stale",
      since: 5,
    })
  })
})

describe("gauge query", () => {
  it("defaults to the first 50 by votes", () => {
    expect(gaugeQuerySchema.parse({})).toEqual({ sort: "votes", limit: 50 })
  })

  it("parses filters, an address list and a cursor", () => {
    const parsed = gaugeQuerySchema.parse({
      voter: "boost",
      sort: "apy",
      addresses: `0x${"A".repeat(40)}, 0x${"b".repeat(40)}`,
      funded: "true",
      cursor: "50",
      limit: "25",
    })
    expect(parsed).toEqual({
      voter: "boost",
      sort: "apy",
      addresses: [`0x${"a".repeat(40)}`, `0x${"b".repeat(40)}`],
      funded: true,
      cursor: "50",
      limit: 25,
    })
  })

  it("rejects pages over 100 and junk cursors", () => {
    expect(gaugeQuerySchema.safeParse({ limit: "101" }).success).toBe(false)
    expect(gaugeQuerySchema.safeParse({ cursor: "abc" }).success).toBe(false)
    expect(gaugeQuerySchema.safeParse({ addresses: "0x12" }).success).toBe(
      false,
    )
  })
})

describe("watch list", () => {
  it("accepts URL-safe client ids only", () => {
    expect(watchClientIdSchema.safeParse("c1d2e3f4-abcd").success).toBe(true)
    expect(watchClientIdSchema.safeParse("short").success).toBe(false)
    expect(watchClientIdSchema.safeParse("has space here").success).toBe(false)
  })
})

describe("gauge kinds", () => {
  it("derives a missing kind from the voter in stored documents", () => {
    const stored = {
      address: "0x2ced96e759ab481210d41c567eee5c42edb59a1d",
      voter: "third-party",
      name: "Curve MUSD 2pool",
      vebtcTokenId: null,
      picture: { type: "initials", text: "CM" },
      poolType: null,
    }
    expect(gaugeRefSchema.parse(stored)).toMatchObject({
      kind: "mezo",
      color: null,
      tickSpacing: null,
      coin: null,
    })
    expect(gaugeKindFor("boost")).toBe("vebtc")
    expect(gaugeKindFor("validators")).toBe("validator")
    expect(gaugeKindFor("pools")).toBe("pool")
  })

  it("filters the gauge list by kind and accepts CL pools", () => {
    expect(gaugeQuerySchema.parse({ kind: "mezo" }).kind).toBe("mezo")
    expect(gaugeQuerySchema.safeParse({ kind: "thirdParty" }).success).toBe(
      false,
    )
    expect(poolTypeSchema.parse("cl")).toBe("cl")
  })
})

describe("gauge kind metadata", () => {
  it("parses full details for every kind and compacts them for cards", () => {
    for (const details of Object.values(demoGaugeDetails)) {
      const parsed = gaugeDetailsSchema.parse(details)
      const meta = cardMetaOf(parsed)
      expect(meta.kind).toBe(details.kind)
      expect(gaugeCardMetaSchema.parse(meta)).toEqual(meta)
    }
    expect(cardMetaOf(demoGaugeDetails.btcMusdCl)).toEqual({
      kind: "pool",
      poolKind: "cl",
      pool: demoGaugeDetails.btcMusdCl.pool,
      tvlUsd: "412800.00",
      emissionApr: "38.40",
    })
    expect(Object.keys(cardMetaOf(demoGaugeDetails.aerodromeMezoMusd))).toEqual(
      ["kind", "chain", "protocol"],
    )
  })

  it("puts compact metadata on one card of each kind", () => {
    const kinds = [
      demoGaugeCards.kilnLabs,
      ...Object.values(demoKindCards),
    ].map((card) => {
      const parsed = gaugeCardSchema.parse(card)
      expect(parsed.meta?.kind).toBe(parsed.gauge.kind)
      return parsed.gauge.kind
    })
    expect(new Set(kinds)).toEqual(
      new Set(["vebtc", "validator", "pool", "mezo"]),
    )
  })

  it("rejects details whose fields belong to another kind", () => {
    expect(
      gaugeDetailsSchema.safeParse({
        ...demoGaugeDetails.northfieldNodes,
        kind: "pool",
      }).success,
    ).toBe(false)
    expect(poolKindSchema.options).toEqual(["vamm", "samm", "cl", "vault"])
  })

  it("keeps documents written before metadata parseable", () => {
    const { meta: _meta, ...legacyCard } = demoGaugeCards.kilnLabs
    expect(gaugeCardSchema.parse(legacyCard).meta).toBeNull()
    const { details: _details, ...legacyProfile } = demoGaugeProfile
    expect(
      gaugeProfileReadModelSchema.parse(legacyProfile).details,
    ).toBeUndefined()
  })
})

describe("gauge consistency", () => {
  it("ranks gauges by funded epochs, outside the paged gauge list", () => {
    const funding = gaugeFundingSchema.parse({
      window: 8,
      throughEpoch: 46,
      gauges: {
        [demoGauges.kilnLabs.address]: { recent: 8, total: 9, streak: 9 },
      },
    })
    expect(funding.gauges[demoGauges.kilnLabs.address]?.recent).toBe(8)
    expect(
      gaugeConsistencyRankingSchema.parse({
        throughEpoch: 46,
        window: 8,
        gauges: [
          {
            gauge: demoGauges.kilnLabs,
            recent: 8,
            window: 8,
            total: 9,
            streak: 9,
          },
        ],
      }).gauges[0]?.gauge.kind,
    ).toBe("vebtc")
    expect(
      Object.keys(gaugeCardSchema.parse(demoGaugeCards.kilnLabs)),
    ).not.toContain("funding")
    expect(gaugeConsistencyQuerySchema.parse({}).limit).toBe(20)
  })
})

describe("veBTC locks and vote units", () => {
  it("marks expired and withdrawn locks as retired", () => {
    const lock = (state: "active" | "auto-max" | "expired" | "withdrawn") => ({
      state,
      unlocksAt: state === "expired" ? Date.UTC(2026, 4, 7) / 1000 : null,
      amount: "0.0009",
    })
    expect(isRetiredLock(lock("expired"))).toBe(true)
    expect(isRetiredLock(lock("withdrawn"))).toBe(true)
    expect(isRetiredLock(lock("active"))).toBe(false)
    expect(isRetiredLock(lock("auto-max"))).toBe(false)
    expect(isRetiredLock(null)).toBe(false)
    const expiredCard = gaugeCardSchema.parse({
      ...demoGaugeCards.vebtc604,
      meta: {
        kind: "vebtc",
        tokenId: "5678",
        owner: null,
        beneficiary: null,
        lock: lock("expired"),
      },
    })
    expect(isRetiredGauge(expiredCard)).toBe(true)
    expect(isRetiredGauge(demoKindCards.btcMusdCl)).toBe(false)
  })

  it("names what votes are counted in, per kind", () => {
    expect(voteUnitFor("vebtc")).toBe("veMEZO")
    expect(voteUnitFor("mezo")).toBe("veMEZO")
    expect(voteUnitFor("validator")).toBe("veBTC")
    expect(voteUnitFor("pool")).toBe("veBTC")
    for (const card of Object.values(demoKindCards)) {
      expect(card.votesUnit).toBe(voteUnitFor(card.gauge.kind))
    }
    // Cards stored before the field get it from their voter.
    const { votesUnit: _unit, ...legacy } = demoKindCards.btcMusdCl
    expect(gaugeCardSchema.parse(legacy).votesUnit).toBe("veBTC")
  })
})
