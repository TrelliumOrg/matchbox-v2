import type { GaugeProfile } from "@matchbox/contracts/gauge-profiles"
import {
  gaugeDirectorySchema,
  gaugeProfileReadModelSchema,
} from "@matchbox/contracts/read-models"
import { describe, expect, it } from "vitest"
import {
  fixtureEpoch,
  fixturePrices,
  fixtureRead,
  gauges,
} from "../market/fixtures"
import { buildSnapshot } from "../market/snapshot"
import { createMemoryMarketStore } from "../market/store"
import { gaugeColor } from "./colors"
import { buildGaugeReadModels, type GaugeChainReader } from "./gauges"

const wad = 10n ** 18n
// Inside fixtureEpoch (Thu 24 Sep 2026), like the market harness clock.
const nowSeconds = fixtureEpoch + 3 * 86_400

const kilnProfile: GaugeProfile = {
  profileType: "boost-gauge",
  vebtcTokenId: "2",
  network: "mezo",
  gaugeAddress: gauges.boost,
  displayName: "Kiln Labs",
  description: "Validator ops on Mezo since genesis",
  avatarUrl: "https://cdn.example/kiln.png",
  brandColor: null,
  websiteUrl: "https://kiln.example",
  socialLinks: { x: "https://x.com/kiln", telegram: "http://t.me/kiln" },
  tags: ["Validator"],
  incentiveStrategy: "Weekly, in MEZO",
  votingStrategy: "BTC and MUSD pools",
  isFeatured: false,
  chain: {
    isAlive: true,
    nftOwner: null,
    beneficiary: null,
    poolAddress: null,
    checkedAt: null,
    blockNumber: null,
  },
  updatedAt: "2026-09-20T00:00:00Z",
  createdAt: "2026-09-01T00:00:00Z",
}

const chain: GaugeChainReader = async (tokenIds) => ({
  vemezoTotalVotingPower: 1_000_000n * wad,
  vebtcUnboostedTotal: 100n * wad,
  locks: new Map(
    tokenIds.map((id) => [
      id,
      { unboostedVotingPower: (3n * wad) / 2n, locked: 2n * wad },
    ]),
  ),
  lockInfo: new Map(
    tokenIds.map((id) => [
      id,
      { amount: 2n * wad, end: 0n, isPermanent: true },
    ]),
  ),
})

async function seededMarket() {
  const market = createMemoryMarketStore()
  await market.saveSnapshot(
    buildSnapshot(fixtureRead(), fixturePrices, new Date(nowSeconds * 1000)),
  )
  return market
}

describe("gauge read models", () => {
  it("builds a directory ordered by votes, with profiles and optimal votes", async () => {
    const writes = await buildGaugeReadModels({
      network: "mezo",
      market: await seededMarket(),
      profiles: [kilnProfile],
      chain,
      avatarColors: new Map(),
      labels: null,
      details: null,
      prices: null,
      nowSeconds,
    })
    const directory = writes.find((write) => write.kind === "gauges")
    const parsed = gaugeDirectorySchema.parse(directory?.data)
    expect(parsed.gauges.map((card) => card.gauge.address)).toEqual([
      gauges.boost,
      gauges.validator,
      gauges.pool,
      gauges.idleBoost,
      gauges.thirdParty,
    ])
    const kiln = parsed.gauges[0]
    expect(kiln?.gauge).toMatchObject({
      name: "Kiln Labs",
      vebtcTokenId: "2",
      picture: { type: "image", url: "https://cdn.example/kiln.png" },
    })
    expect(kiln?.votes).toBe("2000")
    expect(kiln?.boost).toBe("1.5")
    // 1.5 veBTC of 100 veBTC, times 1,000,000 veMEZO.
    expect(kiln?.optimalVotes).toBe("15000")
    expect(kiln?.vebtcWeight).toBe("1.5")
    // The unregistered FAKEBTC reward is left out of the breakdown.
    expect(kiln?.incentives).toEqual({
      usd: "25.00",
      tokens: [
        {
          token: expect.objectContaining({ symbol: "MEZO" }),
          amount: "100",
          usd: "25.00",
        },
      ],
    })
    expect(parsed.totalVotes).toBe("10000")
    expect(parsed.total).toBe(5)
    expect(parsed.nextCursor).toBeNull()
    // Pool gauges draw their pair of official coins, named by the pair.
    const pool = parsed.gauges.find(
      (card) => card.gauge.address === gauges.pool,
    )
    expect(pool?.gauge).toMatchObject({
      name: "BTC/MUSD",
      poolType: "volatile",
      picture: {
        type: "pair",
        tokens: [
          expect.objectContaining({ symbol: "BTC" }),
          expect.objectContaining({ symbol: "MUSD" }),
        ],
      },
      color: "#F7931A",
    })
    for (const card of parsed.gauges) {
      expect(card.gauge.color).toMatch(/^#[0-9A-F]{6}$/)
    }
  })

  it("prefers a profile's curated brand colour", async () => {
    const writes = await buildGaugeReadModels({
      network: "mezo",
      market: await seededMarket(),
      profiles: [{ ...kilnProfile, brandColor: "#12AB34" }],
      chain,
      avatarColors: new Map(),
      labels: null,
      details: null,
      prices: null,
      nowSeconds,
    })
    const directory = writes.find((write) => write.kind === "gauges")
    const parsed = gaugeDirectorySchema.parse(directory?.data)
    const kiln = parsed.gauges.find(
      (card) => card.gauge.address === gauges.boost,
    )
    expect(kiln?.gauge.color).toBe("#12AB34")
  })

  it("ranks curated, picture, pool token and palette colours in that order", async () => {
    const writes = await buildGaugeReadModels({
      network: "mezo",
      market: await seededMarket(),
      profiles: [{ ...kilnProfile, brandColor: "#12AB34" }],
      chain,
      avatarColors: new Map([
        [gauges.boost, "#3355AA"],
        [gauges.pool, "#AA3355"],
      ]),
      labels: null,
      details: null,
      prices: null,
      nowSeconds,
    })
    const directory = gaugeDirectorySchema.parse(
      writes.find((write) => write.kind === "gauges")?.data,
    )
    const colorOf = (address: string) =>
      directory.gauges.find((card) => card.gauge.address === address)?.gauge
        .color
    // Curated beats the picture.
    expect(colorOf(gauges.boost)).toBe("#12AB34")
    // The picture beats the pool's lead token (BTC orange).
    expect(colorOf(gauges.pool)).toBe("#AA3355")
    // No curated colour, no picture: the palette pick.
    expect(colorOf(gauges.thirdParty)).toBe(
      gaugeColor(gauges.thirdParty, "third-party", null),
    )
  })

  it("uses the picture colour when the profile has no curated one", async () => {
    const writes = await buildGaugeReadModels({
      network: "mezo",
      market: await seededMarket(),
      profiles: [kilnProfile],
      chain,
      avatarColors: new Map([[gauges.boost, "#3355AA"]]),
      labels: null,
      details: null,
      prices: null,
      nowSeconds,
    })
    const profile = gaugeProfileReadModelSchema.parse(
      writes.find(
        (write) => write.kind === "gauge-profile" && write.key === gauges.boost,
      )?.data,
    )
    expect(profile.card.gauge.color).toBe("#3355AA")
  })

  it("writes one profile per gauge with history and links", async () => {
    const writes = await buildGaugeReadModels({
      network: "mezo",
      market: await seededMarket(),
      profiles: [kilnProfile],
      chain,
      avatarColors: new Map(),
      labels: null,
      details: null,
      prices: null,
      nowSeconds,
    })
    const profiles = writes.filter((write) => write.kind === "gauge-profile")
    expect(profiles).toHaveLength(5)
    const kiln = gaugeProfileReadModelSchema.parse(
      profiles.find((write) => write.key === gauges.boost)?.data,
    )
    expect(kiln.links).toEqual([
      { kind: "website", url: "https://kiln.example" },
      { kind: "x", url: "https://x.com/kiln" },
    ])
    expect(kiln.owner).toBe("0xc000000000000000000000000000000000000001")
    expect(kiln.locked?.amount).toBe("2")
    expect(kiln.votesHistory.map((entry) => entry.votes)).toEqual(["2000"])
    expect(kiln.incentivesHistory[0]?.status).toBe("upcoming")
  })

  it("leaves chain fields empty when the veBTC reads fail", async () => {
    const writes = await buildGaugeReadModels({
      network: "mezo",
      market: await seededMarket(),
      profiles: [],
      chain: async () => {
        throw new Error("rpc down")
      },
      avatarColors: new Map(),
      labels: null,
      details: null,
      prices: null,
      nowSeconds,
    })
    const directory = gaugeDirectorySchema.parse(
      writes.find((write) => write.kind === "gauges")?.data,
    )
    const boost = directory.gauges.find(
      (card) => card.gauge.address === gauges.boost,
    )
    expect(boost?.optimalVotes).toBeNull()
    expect(boost?.gauge.picture).toEqual({ type: "initials", text: "C0" })
    expect(boost?.gauge.name).toBe("veBTC #2")
  })
})
