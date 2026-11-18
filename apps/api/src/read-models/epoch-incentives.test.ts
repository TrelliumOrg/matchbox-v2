import type { GaugeCard, GaugeDirectory } from "@matchbox/contracts/read-models"
import {
  demoGaugeCards,
  demoGaugeDirectory,
  demoProtocol,
  demoTokens,
} from "@matchbox/contracts/read-models/fixtures"
import { describe, expect, it } from "vitest"
import { withDirectoryIncentives } from "./epoch-incentives"
import { sumUsd, toCents } from "./money"

const template: GaugeCard = demoGaugeCards.kilnLabs

function card(
  address: string,
  voter: GaugeCard["gauge"]["voter"],
  usd: string | null,
  isAlive = true,
): GaugeCard {
  return {
    ...template,
    isAlive,
    gauge: { ...template.gauge, address, voter, name: address.slice(0, 6) },
    incentives:
      usd === null
        ? { usd: "0", tokens: [] }
        : {
            usd,
            tokens: [{ token: demoTokens.musd, amount: usd, usd }],
          },
  }
}

const smusd = "0x677817bf3e44b90e8f95222f75e2950b7904a401"
const pool = "0x21d7acb0d128fa039064b6ace8db88c0ade0209e"
const boost = "0x449b06b9b6c9b649b610105d1a5e337e1d6d3d1e"
const validator = "0x96da117eef70240ecd12075d072cb028b32d45f0"
const thirdParty = "0xa8c1261a15bc5be768f4a35453e6b59016a6c8f4"
const unfunded = "0x0000000000000000000000000000000000000001"

/** 11 Nov 2026: the indexer's total was 1,384 while sMUSD alone held 10,000. */
const directory: GaugeDirectory = {
  ...demoGaugeDirectory,
  epoch: demoProtocol.epoch,
  gauges: [
    card(pool, "pools", "442.01"),
    card(smusd, "pools", "10000.00"),
    card(boost, "boost", "338.29"),
    card(validator, "validators", "21.14", false),
    card(thirdParty, "third-party", "5.00"),
    card(unfunded, "boost", null),
  ],
}

const indexed = {
  ...demoProtocol,
  incentives: { usd: "1384.00", previousUsd: "2100.50", changeUsd: "-716.50" },
  funded: {
    count: 1,
    gauges: [
      {
        gauge: card(pool, "pools", "430.00").gauge,
        incentives: card(pool, "pools", "430.00").incentives,
        deposits: 2,
      },
    ],
  },
}

describe("withDirectoryIncentives", () => {
  const protocol = withDirectoryIncentives(indexed, directory)

  it("totals the cards, so no gauge can hold more than the epoch", () => {
    expect(protocol.incentives.usd).toBe("10806.44")
    expect(protocol.incentives.usd).toBe(
      sumUsd(directory.gauges.map((entry) => entry.incentives.usd)),
    )
    for (const entry of directory.gauges) {
      expect(toCents(entry.incentives.usd)).toBeLessThanOrEqual(
        toCents(protocol.incentives.usd),
      )
    }
  })

  it("keeps the previous epoch and recomputes the change against it", () => {
    expect(protocol.incentives.previousUsd).toBe("2100.50")
    expect(protocol.incentives.changeUsd).toBe("8705.94")
    expect(
      withDirectoryIncentives(
        {
          ...indexed,
          incentives: { ...indexed.incentives, previousUsd: null },
        },
        directory,
      ).incentives.changeUsd,
    ).toBeNull()
  })

  it("lists every gauge with rewards, largest first, alive or not", () => {
    expect(protocol.funded.count).toBe(5)
    expect(protocol.funded.gauges.map((entry) => entry.gauge.address)).toEqual([
      smusd,
      pool,
      boost,
      validator,
      thirdParty,
    ])
    expect(protocol.funded.gauges[0]?.incentives).toEqual(
      directory.gauges[1]?.incentives,
    )
  })

  it("keeps the indexer's deposit counts, and null where it has none", () => {
    expect(protocol.funded.gauges.map((entry) => entry.deposits)).toEqual([
      null,
      2,
      null,
      null,
      null,
    ])
  })

  it("rebuilds only the current epoch's bar, split by voter", () => {
    const bars = protocol.incentivesByEpoch
    expect(bars.slice(0, -1)).toEqual(indexed.incentivesByEpoch.slice(0, -1))
    expect(bars.at(-1)).toEqual({
      epoch: indexed.epoch,
      totalUsd: "10806.44",
      vebtcUsd: "338.29",
      validatorsUsd: "21.14",
      poolsUsd: "10442.01",
    })
  })

  it("leaves everything else as the indexer wrote it", () => {
    expect(protocol.stats).toBe(indexed.stats)
    expect(protocol.feed).toBe(indexed.feed)
    expect(protocol.epoch).toBe(indexed.epoch)
  })

  it("does nothing while the two documents are on different epochs", () => {
    const earlier = {
      ...directory,
      epoch: { ...directory.epoch, number: directory.epoch.number - 1 },
    }
    expect(withDirectoryIncentives(indexed, earlier)).toBe(indexed)
  })
})
