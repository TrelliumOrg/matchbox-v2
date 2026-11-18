import { describe, expect, it } from "vitest"
import {
  asOfAt,
  asOfText,
  cardGroups,
  countdownText,
  emptyFigures,
  epochView,
  type HomeFigures,
  mergeFigures,
  type NumberFormat,
  nextEpochAt,
  numeric,
  type ReadTimes,
  scaleSeries,
  sparkPaths,
  staleAfterMs,
  staleSince,
  usdFormat,
  votesFormat,
} from "./figures"
import { fixtureFigures } from "./fixtures"

function format(value: string, options: NumberFormat): string {
  const decimal = numeric(value)
  if (decimal === null) throw new Error(`not a decimal: ${value}`)
  return new Intl.NumberFormat("en-US", options).format(decimal)
}

describe("epoch", () => {
  it("numbers epochs from Thu 11 Dec 2025 00:00 UTC", () => {
    expect(epochView(Date.UTC(2025, 11, 11, 0, 0, 30)).number).toBe(0)
    expect(epochView(Date.UTC(2025, 11, 17, 23, 59)).number).toBe(0)
    expect(epochView(Date.UTC(2025, 11, 18, 0, 0, 1)).number).toBe(1)
    // 47 weeks on: the frames' "Epoch 47".
    expect(epochView(Date.UTC(2026, 10, 5, 12)).number).toBe(47)
  })

  it("counts down in days, hours and minutes, never below a minute", () => {
    expect(countdownText(3 * 1440 + 12 * 60 + 5)).toBe("3d 12h")
    expect(countdownText(2 * 1440)).toBe("2d")
    expect(countdownText(11 * 60 + 20)).toBe("11h 20m")
    expect(countdownText(42)).toBe("42m")
    expect(countdownText(0)).toBe("1m")
    // Sunday 12:00 UTC: Thursday 00:00 is 3 days 12 hours away.
    expect(epochView(Date.UTC(2026, 10, 8, 12)).countdown).toBe("3d 12h")
    expect(epochView(Date.UTC(2026, 10, 11, 23, 59, 30)).countdown).toBe("1m")
  })

  it("puts the next boundary on Thursday 00:00 UTC", () => {
    expect(nextEpochAt(Date.UTC(2026, 10, 8, 12))).toBe(Date.UTC(2026, 10, 12))
  })
})

describe("formats", () => {
  it("writes USD whole below a million and compact from it", () => {
    expect(format("14820.37", usdFormat("14820.37"))).toBe("$14,820")
    expect(format("4130114", usdFormat("4130114"))).toBe("$4.13M")
    expect(format("148450000", usdFormat("148450000"))).toBe("$148.45M")
    expect(format("999999.99", usdFormat("999999.99"))).toBe("$1,000,000")
  })

  it("writes votes in their unit's format", () => {
    expect(format("112.4", votesFormat("112.4", "veBTC"))).toBe("112.40")
    expect(format("5880000", votesFormat("5880000", "veMEZO"))).toBe("5.88M")
    expect(format("22150", votesFormat("22150", "veMEZO"))).toBe("22.15K")
    expect(format("840.6", votesFormat("840.6", "veMEZO"))).toBe("841")
  })
})

describe("sparklines", () => {
  it("scales base-unit levels exactly, beyond float range", () => {
    expect(
      scaleSeries([
        "1000000000000000000000",
        "1500000000000000000000",
        "2000000000000000000000",
      ]),
    ).toEqual([0, 0.5, 1])
    expect(scaleSeries(["5", "5", "5"])).toEqual([0.5, 0.5, 0.5])
    // A move under 0.5% of the latest level is drawn against that 0.5%,
    // centred: 806 to 804 BTC is a slope across half the height.
    expect(scaleSeries(["80600", "80500", "80400"])).toEqual([
      0.7487, 0.5, 0.2512,
    ])
    expect(scaleSeries(["1000", "1020"])).toEqual([0, 1])
    expect(scaleSeries(["1"])).toBeNull()
    expect(scaleSeries(["1", "x"])).toBeNull()
  })

  it("draws the line and closes the area to the bottom", () => {
    const paths = sparkPaths([0, 1], "line")
    expect(paths.line).toBe("M0 40 L300 8")
    expect(paths.area).toBe("M0 40 L300 8 V44 H0Z")
    expect(sparkPaths([0, 1], "step").line).toBe("M0 40 H300 V8 H300")
  })
})

describe("As of", () => {
  const at = Date.UTC(2026, 10, 5, 14, 5)

  it("says the time, or the day and time past a day", () => {
    expect(asOfText(at, at + 6 * 60_000, "UTC")).toBe("As of 14:05")
    expect(asOfText(at, at + 2 * 86_400_000, "UTC")).toBe(
      "As of Thu 5 Nov, 14:05",
    )
  })

  // Every figure read at `at`, on a clock the test sets.
  const allAt = (time: number): ReadTimes => ({
    summary: time,
    gauges: time,
    vebtcSeries: time,
    blocks: time,
    borrow: time,
  })

  it("says nothing while every figure on the card is within its threshold", () => {
    const now = at + 2 * 60_000
    expect(staleSince(allAt(at), cardGroups.pro, now)).toBeNull()
    expect(staleSince(allAt(at), cardGroups.scan, now)).toBeNull()
  })

  it("shows the old time when the read succeeded but the figures did not move on", () => {
    // The edge answered, with the values it last read an hour ago.
    const now = at + 60 * 60_000
    expect(asOfAt(allAt(at), cardGroups.pro, now, false)).toBe(at)
    expect(asOfAt(allAt(at), cardGroups.scan, now, false)).toBe(at)
  })

  it("lets one stale figure raise its card's note, and only its card's", () => {
    // Only the blocks stopped answering, four minutes ago.
    const now = at + 10 * 60_000
    const times = { ...allAt(now), blocks: now - 4 * 60_000 }
    expect(staleSince(times, cardGroups.scan, now)).toBe(now - 4 * 60_000)
    expect(staleSince(times, cardGroups.pro, now)).toBeNull()
  })

  it("gives each figure a threshold that fits how often it changes", () => {
    const now = at + 2 * 86_400_000
    const just = (group: keyof ReadTimes, age: number): ReadTimes => ({
      ...allAt(now),
      [group]: now - age,
    })
    for (const group of [
      "summary",
      "gauges",
      "vebtcSeries",
      "blocks",
      "borrow",
    ] as const) {
      const limit = staleAfterMs[group]
      expect(staleSince(just(group, limit), [group], now)).toBeNull()
      expect(staleSince(just(group, limit + 1), [group], now)).toBe(
        now - limit - 1,
      )
    }
    expect(staleAfterMs.blocks).toBeLessThan(staleAfterMs.summary)
    expect(staleAfterMs.summary).toBeLessThan(staleAfterMs.vebtcSeries)
  })

  it("shows the oldest stale read, and never for a figure never read", () => {
    const now = at + 2 * 86_400_000
    const times: ReadTimes = {
      summary: now - 10 * 60_000,
      gauges: now - 20 * 60_000,
      vebtcSeries: null,
      blocks: null,
      borrow: null,
    }
    expect(staleSince(times, cardGroups.pro, now)).toBe(now - 20 * 60_000)
    expect(
      staleSince(
        { ...times, summary: null, gauges: null },
        cardGroups.pro,
        now,
      ),
    ).toBeNull()
  })

  it("waits for the first fresh request before saying anything", () => {
    const now = at + 60 * 60_000
    expect(asOfAt(allAt(at), cardGroups.pro, now, true)).toBeNull()
  })
})

describe("mergeFigures", () => {
  it("keeps a slot's value when a fresh read has none", () => {
    const known = fixtureFigures(Date.UTC(2026, 10, 11, 5))
    const fresh: HomeFigures = {
      ...emptyFigures,
      pro: { incentivesUsd: "15000", gauges: null },
      at: { ...emptyFigures.at, summary: Date.UTC(2026, 10, 11, 6) },
    }
    const merged = mergeFigures(known, fresh)
    expect(merged.pro.incentivesUsd).toBe("15000")
    expect(merged.pro.gauges).toEqual(known.pro.gauges)
    expect(merged.scan.blocks).toEqual(known.scan.blocks)
    // Only the group that was read moves on; the others keep their time.
    expect(merged.at.summary).toBe(Date.UTC(2026, 10, 11, 6))
    expect(merged.at.gauges).toBe(known.at.gauges)
    expect(merged.at.blocks).toBe(known.at.blocks)
  })

  it("never steps a group back to an older read that lands late", () => {
    const known = fixtureFigures(Date.UTC(2026, 10, 11, 6))
    const late = fixtureFigures(Date.UTC(2026, 10, 11, 5))
    const merged = mergeFigures(known, late)
    expect(merged.scan.blocks).toEqual(known.scan.blocks)
    expect(merged.at).toEqual(known.at)
  })

  it("never invents a value for a slot that never had one", () => {
    const merged = mergeFigures(emptyFigures, emptyFigures)
    expect(merged).toEqual(emptyFigures)
  })
})
