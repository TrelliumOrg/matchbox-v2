import { describe, expect, it } from "vitest"
import {
  changeOver,
  changeStat,
  compactAmount,
  compactUsd,
  countAverage,
  countPeak,
  flowSum,
  lastDays,
  levelChange,
  priceFacts,
  pricePanel,
  priceRange,
  scaledDecimal,
  signedCompact,
  signedCount,
  statWindow,
  usdValue,
  wholeAmount,
} from "./network-views"
import type { SeriesView } from "./series.server"

/**
 * The Network and Tokens figures from one series at a time: bigint sums,
 * averages and changes on the points' exact decimals, USD at a daily price.
 */

function view(
  decimals: readonly string[],
  options: { partialLast?: boolean; endsOn?: string | null } = {},
): SeriesView {
  const points = decimals.map((decimal, index) => ({
    day: `2026-10-${String(index + 1).padStart(2, "0")}`,
    value: Number(decimal),
    text: decimal,
    decimal,
    partial: options.partialLast === true && index === decimals.length - 1,
  }))
  return {
    metric: "chain.transactions",
    kind: "flow",
    unit: "count",
    points,
    latest: null,
    firstDay: points[0]?.day ?? null,
    endsOn: options.endsOn ?? null,
  }
}

describe("network views", () => {
  it("scales decimals exactly", () => {
    expect(scaledDecimal("1.5", 2)).toBe(150n)
    expect(scaledDecimal("-0.000001", 6)).toBe(-1n)
    expect(scaledDecimal("12", 0)).toBe(12n)
    expect(scaledDecimal("1.999", 2)).toBe(199n)
  })

  it("sums and averages complete days only", () => {
    const flow = view(["10", "20", "30", "5"], { partialLast: true })
    expect(flowSum(flow, 2)).toBe(50n)
    expect(flowSum(flow, 30)).toBe(60n)
    expect(countAverage(flow, 30)).toBe(20n)
    // 10 + 20 + 31 = 61, 20.33 rounds to 20; 10 + 21 = 31, 15.5 rounds up.
    expect(countAverage(view(["10", "20", "31"]), 30)).toBe(20n)
    expect(countAverage(view(["10", "21"]), 30)).toBe(16n)
    expect(countPeak(flow, 30)).toBe(30n)
    expect(flowSum(view([]), 7)).toBeNull()
  })

  it("sums amounts at their places", () => {
    expect(flowSum(view(["1.25", "2.5"]), 7, 18)).toBe(
      3_750_000_000_000_000_000n,
    )
  })

  it("counts a backfill's window back from where it ends", () => {
    const days = Array.from({ length: 31 }, (_, index) => String(index))
    const read = lastDays(
      { status: "ok", data: view(days, { endsOn: "2026-10-31" }) },
      7,
    )
    expect(read.status).toBe("ok")
    if (read.status !== "ok") return
    expect(read.data.points.map((point) => point.day)).toEqual([
      "2026-10-25",
      "2026-10-26",
      "2026-10-27",
      "2026-10-28",
      "2026-10-29",
      "2026-10-30",
      "2026-10-31",
    ])
    expect(read.data.latest).toEqual({ text: "30", partial: false })
    expect(lastDays({ status: "disabled" }, 7)).toEqual({ status: "disabled" })
  })

  it("changes a level against the last point far enough back", () => {
    const level = view(["100", "110", "125", "160"])
    expect(levelChange(level, 2)).toBe(50n)
    expect(levelChange(level, 3)).toBe(60n)
    expect(levelChange(level, 4)).toBeNull()
    expect(levelChange(view(["2.5", "1"]), 1, 18)).toBe(
      -1_500_000_000_000_000_000n,
    )
  })

  it("gives a change only when the series reaches back that far", () => {
    // Four days from 1 Oct: a 3 day change exists, a 7 or 30 day one not.
    const young = view(["100", "110", "125", "160"])
    expect(changeOver(young, 3)).toEqual({ status: "ok", value: 60n })
    expect(changeOver(young, 7)).toEqual({ status: "short" })
    expect(changeStat("New 7d", changeOver(young, 7), String)).toEqual({
      label: "New 7d",
      value: "Not enough history yet",
    })
    expect(changeStat("New 3d", changeOver(young, 3), String)).toEqual({
      label: "New 3d",
      value: "60",
      tone: "pos",
    })
    // Old enough, but nothing read that far back (a gap): no stat.
    const gappy = { ...young, firstDay: "2026-01-01" }
    expect(changeOver(gappy, 7)).toEqual({ status: "none" })
    expect(changeStat("New 7d", changeOver(gappy, 7), String)).toBeNull()
    expect(changeOver({ ...young, firstDay: null }, 1)).toEqual({
      status: "short",
    })
  })

  it("reads a week more than the period, within one request", () => {
    expect(statWindow(30)).toBe(38)
    expect(statWindow(90)).toBe(98)
    expect(statWindow(730)).toBe(730)
  })

  it("formats signed and whole figures", () => {
    expect(signedCount(1284n)).toBe("+1,284")
    expect(signedCount(-12n)).toBe("-12")
    expect(signedCount(0n)).toBe("0")
    expect(signedCompact(833_400n * 10n ** 18n, 18, "MUSD")).toBe(
      "+833.4k MUSD",
    )
    expect(signedCompact(-(5n * 10n ** 18n), 18, "MEZO")).toBe("-5 MEZO")
    expect(wholeAmount("19043276.98", "MUSD")).toBe("19,043,276 MUSD")
  })

  it("prices an amount exactly", () => {
    expect(usdValue("1946.8", "105710")).toBe(`205796228.${"0".repeat(36)}`)
    expect(compactUsd(usdValue("1946.8", "105710"))).toBe("$205.8M")
    expect(compactUsd(usdValue("412600000", "0.184"))).toBe("$75.92M")
    expect(compactUsd("8400.4")).toBe("$8,400")
  })

  it("reads a daily price's changes and range", () => {
    const points = Array.from({ length: 31 }, (_, index) => ({
      day: `2026-10-${String(index + 1).padStart(2, "0")}`,
      price: index === 30 ? "0.20" : index === 23 ? "0.25" : "0.16",
      partial: index === 30,
    }))
    const facts = priceFacts(points, "2026-10-01")
    expect(facts?.price).toBe("$0.2000")
    expect(facts?.day).toEqual({ text: "+25.0%", tone: "pos" })
    expect(facts?.week).toEqual({ text: "-20.0%", tone: "neg" })
    expect(facts?.month).toEqual({ text: "+25.0%", tone: "pos" })
    expect(priceRange(points, 30)).toEqual({ low: "$0.1600", high: "$0.2500" })
    const panel = pricePanel(points, 7, "2026-10-01")
    expect(panel.computed).toBe(true)
    expect(panel.points).toHaveLength(7)
    expect(panel.figure).toBe("$0.2000")
    expect(panel.partial).toBe(true)
    expect(panel.endLabel).toBe("31 Oct")
    expect(priceFacts([], null)).toBeNull()
    // As live when daily prices began: one day, so no week to compare.
    const today = points.slice(-1)
    expect(priceFacts(today, "2026-10-31")).toMatchObject({
      day: null,
      week: "short",
      month: "short",
    })
    // A history that reaches back with a missing day is no change, not new.
    expect(priceFacts(today, "2026-09-01")?.week).toBeNull()
    // No price row anywhere: not computed, so never "no price".
    expect(pricePanel([], 7, null)).toMatchObject({
      computed: false,
      figure: null,
    })
  })
})

describe("compact amounts", () => {
  it("never read a fraction of a token as zero", () => {
    expect(compactAmount("0.5", "mcbBTC")).toBe("0.5000 mcbBTC")
    expect(compactAmount("0.0000004", "MEZO")).toBe("<0.01 MEZO")
    expect(compactAmount("950.25", "MUSD")).toBe("950.25 MUSD")
    expect(compactAmount("95002.4", "MEZO")).toBe("95k MEZO")
  })
})
