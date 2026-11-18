import {
  type ScanBorrowTotalsResponse,
  scanBorrowTotalsResponseSchema,
} from "@matchbox/contracts/scan"
import { describe, expect, it } from "vitest"
import { borrowFigures } from "./borrow"
import {
  compactAmount,
  emptyFigures,
  type HomeFigures,
  mergeFigures,
  scaleSeries,
  sparkPaths,
} from "./figures"
import { borrowTotalsFixtures, fixtureFigures } from "./fixtures"

const nowMs = Date.UTC(2026, 10, 11, 5)

/** The text the Borrowed slot shows: the rolled digits, suffix and unit. */
function shown(value: string): string {
  const amount = compactAmount(value)
  if (amount === null) return "Not available"
  const digits = new Intl.NumberFormat("en-US", amount.format).format(
    amount.value,
  )
  return `${digits}${amount.suffix} MUSD`
}

function figures(answer: ScanBorrowTotalsResponse) {
  const parsed = scanBorrowTotalsResponseSchema.parse(answer)
  return borrowFigures(parsed)
}

describe("the borrow totals fixtures", () => {
  it("are answers the route's own schema accepts", () => {
    for (const make of Object.values(borrowTotalsFixtures)) {
      expect(
        scanBorrowTotalsResponseSchema.safeParse(make(nowMs)).success,
      ).toBe(true)
    }
  })

  it("leave out a venue the way the route does", () => {
    const answer = borrowTotalsFixtures.missingVenue(nowMs)
    expect(answer.data.total).toBeNull()
    expect(answer.data.missing).toEqual(["troves"])
    expect(answer.data.venues.troves.status).toBe("unavailable")
    expect(answer.data.history.status).toBe("ok")
  })
})

describe("the Borrowed figure", () => {
  it("is whole MUSD from base units with the answer's decimals", () => {
    const normal = figures(borrowTotalsFixtures.normal(nowMs))
    expect(normal?.borrowedMusd).toBe("4055533.400000000000000000")
    // The same total in a unit with 6 decimals is a different amount: the
    // decimals are read from the answer, never assumed.
    const answer = borrowTotalsFixtures.normal(nowMs)
    const six = figures({
      ...answer,
      data: {
        ...answer.data,
        unit: { ...answer.data.unit, decimals: 6 },
        total: "4055533400000",
      },
    })
    expect(six?.borrowedMusd).toBe("4055533.400000")
  })

  it("reads abbreviated, in MUSD and never in dollars", () => {
    expect(shown("4055533.400000000000000000")).toBe("4.06M MUSD")
    expect(shown("55533.4")).toBe("55.53k MUSD")
    expect(shown("690000")).toBe("690k MUSD")
    expect(shown("123456789.5")).toBe("123.5M MUSD")
    expect(shown("2500000000")).toBe("2.50B MUSD")
    expect(shown("553.5")).toBe("554 MUSD")
    expect(shown("0")).toBe("0 MUSD")
    // Rounded to whole MUSD first, then abbreviated: exact past float range.
    expect(shown("999999999999999999999.5")).toBe("1,000,000,000,000.0B MUSD")
    expect(compactAmount("-1")).toBeNull()
    expect(compactAmount("1e6")).toBeNull()
    expect(shown("4055533.4")).not.toContain("$")
  })

  it("gives the Enclaves share as a percent with one decimal", () => {
    expect(figures(borrowTotalsFixtures.normal(nowMs))?.borrowedEnclaves).toBe(
      "98.6",
    )
    const answer = borrowTotalsFixtures.normal(nowMs)
    const all = figures({
      ...answer,
      data: { ...answer.data, enclaves_share: "1000000000000000000" },
    })
    expect(all?.borrowedEnclaves).toBe("100.0")
    const none = figures({
      ...answer,
      data: { ...answer.data, enclaves_share: null },
    })
    expect(none?.borrowedEnclaves).toBeNull()
    expect(none?.borrowedMusd).toBe("4055533.400000000000000000")
  })

  it("has no figures at all when the total is missing, never a partial sum", () => {
    expect(figures(borrowTotalsFixtures.missingVenue(nowMs))).toBeNull()
  })

  it("reads each day out as the stat writes its total, gaps left empty", () => {
    const days = figures(borrowTotalsFixtures.normal(nowMs))?.borrowedDays
    expect(days).toHaveLength(30)
    expect(days?.at(-1)?.label).toBe("Today so far")
    expect(days?.at(-1)?.text).toMatch(/^[\d.]+[kMB]? MUSD$/)
    expect(days?.[0]?.label).toMatch(/^\d{1,2} [A-Z][a-z]{2}$/)
    const gaps = figures(borrowTotalsFixtures.gaps(nowMs))?.borrowedDays
    expect(
      gaps?.flatMap((day, index) => (day === null ? [index] : [])),
    ).toEqual([0, 1, 2, 3, 4, 17])
  })

  it("draws the sparkline from the history, skipping the days with no total", () => {
    const normal = figures(borrowTotalsFixtures.normal(nowMs))
    expect(normal?.borrowedSeries).toHaveLength(30)
    expect(normal?.borrowedSeries?.every((point) => point !== null)).toBe(true)
    const series = figures(borrowTotalsFixtures.gaps(nowMs))?.borrowedSeries
    if (series === null || series === undefined) throw new Error("no series")
    expect(series).toHaveLength(30)
    const gaps = series.flatMap((point, index) =>
      point === null ? [index] : [],
    )
    expect(gaps).toEqual([0, 1, 2, 3, 4, 17])
    // The gaps are not zeros: the lowest day with a value is the floor.
    expect(Math.min(...series.filter((point) => point !== null))).toBe(0)
    const paths = sparkPaths(series, "step")
    // Two pieces, one each side of day 17, starting at day 5.
    expect(paths.line.match(/M/g)).toHaveLength(2)
    expect(paths.line.startsWith(`M${+((5 / 29) * 300).toFixed(2)} `)).toBe(
      true,
    )
  })

  it("draws no sparkline when the history is unavailable or too short", () => {
    const answer = borrowTotalsFixtures.normal(nowMs)
    const unavailable = figures({
      ...answer,
      data: {
        ...answer.data,
        history: { status: "unavailable", reason: "upstream" },
      },
    })
    expect(unavailable?.borrowedSeries).toBeNull()
    expect(unavailable?.borrowedMusd).not.toBeNull()
    if (answer.data.history.status !== "ok") throw new Error("no history")
    const points = answer.data.history.data.points.map((point, index) =>
      index === 29 ? point : { ...point, total: null },
    )
    const one = figures({
      ...answer,
      data: {
        ...answer.data,
        history: {
          status: "ok",
          data: { ...answer.data.history.data, points },
        },
      },
    })
    expect(one?.borrowedSeries).toBeNull()
  })
})

describe("series with gaps", () => {
  it("keeps a day with no value as null and scales the others", () => {
    expect(scaleSeries([null, "10", null, "20", "15"])).toEqual([
      null,
      0,
      null,
      1,
      0.5,
    ])
    expect(scaleSeries([null, "7", null, "7"])).toEqual([null, 0.5, null, 0.5])
    expect(scaleSeries([null, "7", null])).toBeNull()
    expect(scaleSeries([null, null])).toBeNull()
  })

  it("draws each run on its own and never drops a gap to the bottom", () => {
    const step = sparkPaths([null, 0, 1, null, 0.5], "step")
    expect(step.line).toBe("M75 40 H150 V8 H225 M300 24 H300")
    expect(step.area).toBe(
      "M75 40 H150 V8 H225 V44 H75Z M300 24 H300 V44 H300Z",
    )
    // A line needs two days: the lone last day draws nothing.
    const line = sparkPaths([null, 0, 1, null, 0.5], "line")
    expect(line.line).toBe("M75 40 L150 8")
    expect(line.area).toBe("M75 40 L150 8 V44 H75Z")
    // A lone day between gaps is a short step at its level.
    expect(sparkPaths([0, null, 1, null, 0], "step").line).toBe(
      "M0 40 H75 M150 8 H225 M300 40 H300",
    )
  })
})

describe("merging the Borrowed figures", () => {
  const known = fixtureFigures(nowMs)
  const later = nowMs + 120_000

  function read(
    scan: Partial<HomeFigures["scan"]>,
    at: number | null,
  ): HomeFigures {
    return {
      ...emptyFigures,
      scan: { ...emptyFigures.scan, ...scan },
      at: { ...emptyFigures.at, borrow: at },
    }
  }

  it("keeps all three, and their time, when the read did not answer", () => {
    const merged = mergeFigures(known, read({}, null))
    expect(merged.scan.borrowedMusd).toBe(known.scan.borrowedMusd)
    expect(merged.scan.borrowedEnclaves).toBe(known.scan.borrowedEnclaves)
    expect(merged.scan.borrowedSeries).toEqual(known.scan.borrowedSeries)
    expect(merged.at.borrow).toBe(nowMs)
  })

  it("takes all three from an answer, a missing share or sparkline too", () => {
    const merged = mergeFigures(
      known,
      read({ borrowedMusd: "12.5", borrowedEnclaves: null }, later),
    )
    expect(merged.scan.borrowedMusd).toBe("12.5")
    expect(merged.scan.borrowedEnclaves).toBeNull()
    expect(merged.scan.borrowedSeries).toBeNull()
    expect(merged.at.borrow).toBe(later)
  })

  it("never steps back to an older answer that lands late", () => {
    const merged = mergeFigures(
      known,
      read({ borrowedMusd: "12.5" }, nowMs - 60_000),
    )
    expect(merged.scan.borrowedMusd).toBe(known.scan.borrowedMusd)
    expect(merged.at.borrow).toBe(nowMs)
  })
})
