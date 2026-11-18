import { demoGaugeProfile } from "@matchbox/contracts/read-models/fixtures"
import { describe, expect, it } from "vitest"
import * as adapt from "../data/adapters"
import type { GaugeProfile, GaugeSummary, Protocol } from "../data/view-models"
import { defaultCard, gaugeCard, protocolCard } from "./model"

const base = adapt.gaugeProfile(demoGaugeProfile)
const wei = (whole: number) => `${BigInt(whole) * 10n ** 18n}`

function profile(gauge: Partial<GaugeSummary>): GaugeProfile {
  return { ...base, gauge: { ...base.gauge, ...gauge } }
}

describe("gauge card", () => {
  it("names the gauge, its lock id and its type with the weight", () => {
    const card = gaugeCard(
      profile({ name: "SNF", tokenId: "6033", expired: false }),
      47,
    )
    expect(card.name).toBe("SNF")
    expect(card.id).toBe("#6033")
    expect(card.typeLine).toMatch(/^veBTC gauge, [\d.]+ veBTC$/)
  })

  it("keeps the band green and full at or past optimal, never red", () => {
    for (const votes of [700, 1000, 5000]) {
      const card = gaugeCard(
        profile({ votes: wei(votes), optimalVotes: wei(700) }),
        47,
      )
      expect(card.band).toEqual({ fill: 1, atMax: true })
      expect(card.boost).toEqual({ label: "5×", atMax: true })
    }
  })

  it("fills the band toward optimal below it", () => {
    const card = gaugeCard(
      profile({ votes: wei(350), optimalVotes: wei(700) }),
      47,
    )
    expect(card.band).toEqual({ fill: 0.5, atMax: false })
    expect(card.boost).toEqual({ label: "3.0×", atMax: false })
  })

  it("shows no band, boost or APY for an expired lock", () => {
    const card = gaugeCard(profile({ expired: true, apyBps: 900 }), 47)
    expect(card.band).toBeNull()
    expect(card.boost).toBeNull()
    expect(card.apyBps).toBeNull()
  })

  it("pictures pool gauges by their pair and says the pair once", () => {
    const card = gaugeCard(
      profile({
        kind: "pool",
        name: "mUSDC/MUSD",
        tokenId: null,
        optimalVotes: null,
        picture: { kind: "initials", initials: "MU", hue: 10 },
        meta: {
          kind: "pool",
          pair: ["mUSDC", "MUSD"],
          poolKind: "cl",
          tvlUsd: null,
        },
      }),
      47,
    )
    expect(card.picture).toEqual({ kind: "pair", tokens: ["mUSDC", "MUSD"] })
    expect(card.typeLine).toBe("Pool gauge, Concentrated")
    expect(card.boost).toBeNull()
    expect(card.band).toBeNull()
  })

  it("leaves the id off when the name already carries it", () => {
    const card = gaugeCard(profile({ name: "veBTC #604", tokenId: "604" }), 47)
    expect(card.id).toBeNull()
  })
})

const bars = Array.from({ length: 20 }, (_, index) => ({
  epoch: 28 + index,
  all: `${100 + index}.00`,
  vebtc: "0",
  validators: "0",
  pools: "0",
}))

function protocol(epoch: number): Protocol {
  return {
    epoch,
    latestEpoch: 47,
    browsableEpochs: bars.map((bar) => bar.epoch),
    incentivesUsd: "1366.52",
    incentivesChangeUsd: "401.70",
    stats: {
      veMezoLocked: wei(282_800_000),
      lockers: 10,
      veBtcLocked: "804.30",
      veBtcLockedUsd: null,
      veBtcVoteWeight: "0",
      votesThisEpoch: 0,
      medianApyBps: null,
    },
    incentivesByEpoch: bars,
    funded: [],
    fundedTotal: 0,
    events: [],
    eventsTotal: 0,
  }
}

describe("protocol card", () => {
  it("shows the last 12 epochs with the current one selected", () => {
    const card = protocolCard(protocol(47))
    expect(card.bars.map((bar) => bar.epoch)).toEqual(
      Array.from({ length: 12 }, (_, index) => 36 + index),
    )
    expect(card.bars.filter((bar) => bar.selected)).toEqual([
      { epoch: 47, usd: "119.00", selected: true },
    ])
  })

  it("ends the window at a past epoch", () => {
    const card = protocolCard(protocol(40))
    expect(card.bars.at(-1)).toMatchObject({ epoch: 40, selected: true })
    expect(card.bars).toHaveLength(12)
  })

  it("keeps 12 bars for the first epochs", () => {
    const card = protocolCard(protocol(30))
    expect(card.bars[0]?.epoch).toBe(28)
    expect(card.bars).toHaveLength(12)
    expect(card.bars.find((bar) => bar.selected)?.epoch).toBe(30)
  })
})

describe("default card", () => {
  it("takes the figures from Protocol and the countdown from the head", () => {
    const card = defaultCard(
      {
        block: { number: 1, timestamp: 1000 },
        epoch: { number: 47, startsAt: 0, endsAt: 4600 },
        prices: { btc: null, mezo: null },
      },
      protocol(47),
      0,
      1000,
    )
    expect(card).toEqual({
      kind: "default",
      epoch: 47,
      endsIn: 3600,
      incentivesUsd: "1366.52",
      veMezoLocked: wei(282_800_000),
      veBtcLocked: "804.30",
    })
  })

  it("keeps the clock's epoch when nothing loaded", () => {
    expect(defaultCard(null, null, 47, 0)).toMatchObject({
      epoch: 47,
      endsIn: null,
      incentivesUsd: null,
    })
  })
})
