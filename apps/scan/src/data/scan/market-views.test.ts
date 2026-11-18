import { describe, expect, it } from "vitest"
import {
  btcPart,
  poolRows,
  poolValuesOn,
  pricedSplit,
  splitPart,
  sumParts,
  tokenInPools,
  type UsdDay,
} from "./market-views"
import type { DailyPrices } from "./pricing"
import type { SeriesView } from "./series.server"
import type { SplitSeries } from "./split.server"

const btc = "0x7b7c000000000000000000000000000000000000"
const musd = "0xdd468a1ddc392dcdbef6db6e34e89aa338f9f186"
const mezo = "0x7b7c000000000000000000000000000000000001"
const junk = `0x${"9".repeat(40)}`
/** The BTC/MUSD Volatile pool the catalog tracks. */
const tracked = "0x52e604c44417233b6ccedddc0d640a405caacefb"
const untracked = `0x${"4".repeat(40)}`

const e18 = 10n ** 18n
const usd = (dollars: bigint) => dollars * e18

const prices: DailyPrices = {
  btc: [
    { day: "2026-11-10", price: "100000" },
    { day: "2026-11-11", price: "101000" },
  ],
  // MEZO's history starts a day later.
  mezo: [{ day: "2026-11-11", price: "0.2" }],
}

function series(
  dimension: string,
  token: string,
  points: [string, bigint, boolean?][],
): SplitSeries {
  return {
    dimension,
    token,
    points: points.map(([day, units, partial]) => ({
      day,
      units,
      partial: partial ?? false,
    })),
  }
}

describe("priced splits", () => {
  it("adds each token at its day's close, exactly", () => {
    const priced = pricedSplit(
      [
        series(btc, btc, [
          ["2026-11-10", 2n * e18],
          ["2026-11-11", 3n * e18, true],
        ]),
        series(musd, musd, [
          ["2026-11-10", 1_500n * e18],
          ["2026-11-11", 1_000n * e18, true],
        ]),
      ],
      prices,
    )
    expect(priced.days).toEqual([
      { day: "2026-11-10", usd: usd(201_500n), partial: false },
      { day: "2026-11-11", usd: usd(304_000n), partial: true },
    ])
    expect(priced.unpriced).toEqual([])
  })

  it("names a token with no pricing, and drops a day a token has no close", () => {
    const priced = pricedSplit(
      [
        series(junk, junk, [["2026-11-10", 5n]]),
        series(mezo, mezo, [
          ["2026-11-10", 10n * e18],
          ["2026-11-11", 10n * e18],
        ]),
      ],
      prices,
    )
    // 10 Nov: MEZO has no close yet, so the day is not drawn smaller.
    expect(priced.days).toEqual([
      { day: "2026-11-11", usd: usd(2n), partial: false },
    ])
    expect(priced.unpriced).toEqual(["0x9999…9999"])
  })
})

describe("sums of parts", () => {
  const day = (text: string, dollars: bigint): UsdDay => ({
    day: text,
    usd: usd(dollars),
    partial: false,
  })

  it("counts a part before its first day as zero, and a gap as unknown", () => {
    const total = sumParts([
      {
        // veBTC: starts on the 11th.
        days: [day("2026-11-11", 5n), day("2026-11-13", 7n)],
        firstDay: "2026-11-11",
        knownFrom: "2026-11-10",
      },
      {
        days: [
          day("2026-11-10", 100n),
          day("2026-11-11", 100n),
          day("2026-11-12", 100n),
          day("2026-11-13", 100n),
        ],
        firstDay: "2026-11-10",
        knownFrom: "2026-11-10",
      },
    ])
    // The 12th has no veBTC row after it started: not drawn.
    expect(total).toEqual([
      day("2026-11-10", 100n),
      day("2026-11-11", 105n),
      day("2026-11-13", 107n),
    ])
  })

  it("never counts days before a part was read", () => {
    const total = sumParts([
      {
        days: [day("2026-11-12", 1n)],
        firstDay: null,
        knownFrom: "2026-11-12",
      },
      {
        days: [day("2026-11-11", 3n), day("2026-11-12", 3n)],
        firstDay: "2026-11-11",
        knownFrom: "2026-11-11",
      },
    ])
    expect(total).toEqual([day("2026-11-12", 4n)])
  })
})

describe("TVL history parts", () => {
  const view = (points: [string, string][], firstDay: string | null) =>
    ({
      metric: "escrow.supply",
      kind: "level",
      unit: "amount",
      points: points.map(([day, decimal]) => ({
        day,
        value: Number(decimal),
        text: decimal,
        decimal,
        partial: false,
      })),
      latest: null,
      firstDay,
      endsOn: null,
    }) satisfies SeriesView
  const closes: DailyPrices = {
    btc: [
      { day: "2026-11-10", price: "100000" },
      { day: "2026-11-11", price: "100000" },
      { day: "2026-11-12", price: "100000" },
    ],
    mezo: [{ day: "2026-11-12", price: "1" }],
  }

  it("never counts the DEX part as zero on days it has no priced row", () => {
    // MEZO's closes start on the 12th: the pools' first two days drop out
    // of the priced split, and must not read as an empty DEX.
    const balances = {
      kind: "level" as const,
      from: "2026-11-10",
      series: [
        series(mezo, mezo, [
          ["2026-11-10", 1_000_000n * e18],
          ["2026-11-11", 1_000_000n * e18],
          ["2026-11-12", 1_000_000n * e18],
        ]),
      ],
    }
    const dex = pricedSplit(balances.series, closes)
    const vebtc = view(
      [
        ["2026-11-10", "0.00005"],
        ["2026-11-11", "0.00005"],
        ["2026-11-12", "0.00005"],
      ],
      "2025-05-19",
    )
    const total = sumParts([
      btcPart(vebtc, closes, "2026-11-10"),
      splitPart(balances, dex),
    ])
    expect(total).toEqual([
      { day: "2026-11-12", usd: usd(1_000_005n), partial: false },
    ])
  })

  it("knows nothing of a split with no priced day", () => {
    const empty = { kind: "level" as const, from: "2026-11-10", series: [] }
    const total = sumParts([
      btcPart(view([["2026-11-11", "1"]], "2025-05-19"), closes, "2026-11-10"),
      splitPart(empty, pricedSplit([], closes)),
    ])
    expect(total).toEqual([])
  })

  it("never counts a BTC part as zero before its first stored day", () => {
    // Troves stored from the 11th (no history backfill): the 10th is
    // unknown, not zero.
    const troves = view([["2026-11-11", "1"]], "2026-11-11")
    const vebtc = view(
      [
        ["2026-11-10", "2"],
        ["2026-11-11", "2"],
      ],
      "2025-05-19",
    )
    const total = sumParts([
      btcPart(vebtc, closes, "2026-11-10"),
      btcPart(troves, closes, "2026-11-10"),
    ])
    expect(total).toEqual([
      { day: "2026-11-11", usd: usd(300_000n), partial: false },
    ])
  })
})

describe("pools", () => {
  const split = [
    series(`${tracked}:${btc}`, btc, [["2026-11-11", e18]]),
    series(`${tracked}:${musd}`, musd, [["2026-11-11", 50_000n * e18]]),
    series(`${untracked}:${musd}`, musd, [["2026-11-11", 9_000n * e18]]),
    series(`${untracked}:${junk}`, junk, [["2026-11-11", 3n]]),
  ]

  it("names a tracked pool by its title and links it", () => {
    const rows = poolRows(split)
    expect(rows.get(tracked)).toMatchObject({
      name: "BTC/MUSD Volatile",
      href: `/pools/${tracked}`,
    })
    expect(rows.get(untracked)).toMatchObject({
      name: "MUSD/0x9999…9999",
      href: null,
    })
  })

  it("prices each pool's volume in by token, as the figure sums it", () => {
    // Volume in is one side a swap: a pool's priced side is counted and
    // the unpriced token named, so the pools add up to the day's figure.
    const values = poolValuesOn(split, "2026-11-11", prices)
    expect(values.pools.map((pool) => [pool.name, pool.usd])).toEqual([
      ["BTC/MUSD Volatile", usd(151_000n)],
      ["MUSD/0x9999…9999", usd(9_000n)],
    ])
    expect(values.unpriced).toEqual(["0x9999…9999"])
    const figure = pricedSplit(
      [
        series(btc, btc, [["2026-11-11", e18]]),
        series(musd, musd, [["2026-11-11", 59_000n * e18]]),
        series(junk, junk, [["2026-11-11", 3n]]),
      ],
      prices,
    )
    expect(figure.days[0]?.usd).toBe(
      values.pools.reduce((sum, pool) => sum + pool.usd, 0n),
    )
  })

  it("lists one token's balance in each pool, largest first", () => {
    expect(
      tokenInPools(split, musd, "2026-11-11").map((pool) => [
        pool.name,
        pool.units,
      ]),
    ).toEqual([
      ["BTC/MUSD Volatile", 50_000n * e18],
      ["MUSD/0x9999…9999", 9_000n * e18],
    ])
  })
})
