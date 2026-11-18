import { describe, expect, it } from "vitest"
import { dailyMost, sumDecimals, weekLabel, weekly, weekOf } from "./weekly"

type Day = { day: string; partial: boolean; decimal: string }

const dayOf = (seconds: number) =>
  new Date(seconds * 1000).toISOString().slice(0, 10)

/** `count` days ending on `last`, each worth its own number, today partial. */
function days(count: number, last: string, partial = true): Day[] {
  const end = Date.parse(`${last}T00:00:00Z`) / 1000
  return Array.from({ length: count }, (_, index) => ({
    day: dayOf(end - (count - 1 - index) * 86_400),
    partial: partial && index === count - 1,
    decimal: `${index + 1}.5`,
  }))
}

const draw = (point: Day) => ({
  day: point.day,
  value: Number(point.decimal),
  partial: point.partial,
  label: point.day,
  text: point.decimal,
})

const sum = (week: readonly Day[]) => {
  const total = sumDecimals(week.map((each) => each.decimal))
  return { value: Number(total), text: total }
}

describe("weekly buckets", () => {
  it("keeps up to dailyMost days as they are", () => {
    const points = days(dailyMost, "2026-11-16")
    const drawn = weekly(points, "flow", draw, sum)
    expect(drawn).toHaveLength(dailyMost)
    expect(drawn[0]?.text).toBe("1.5")
  })

  it("sums a flow's weeks exactly, Monday first, labelled by what they cover", () => {
    // 560 days to Monday 16 Nov 2026 (today, filling).
    const points = days(560, "2026-11-16")
    const drawn = weekly(points, "flow", draw, sum)
    // 81 calendar weeks: 81 bars, not 560.
    expect(drawn).toHaveLength(81)
    // Every day is counted once: the weeks add up to the days.
    const total = sumDecimals(drawn.map((each) => each.text))
    expect(total).toBe(sumDecimals(points.map((each) => each.decimal)))
    // The first week starts on the first day there is (a Tuesday), so it
    // says which days it holds.
    expect(points[0]?.day).toBe("2025-05-06")
    expect(drawn[0]?.label).toBe("6 to 11 May")
    expect(drawn[0]?.day).toBe("2025-05-06")
    // Six days of seven: dashed, so its short bar is no drop.
    expect(drawn[0]?.partial).toBe(true)
    // A whole week in the middle.
    expect(drawn[1]?.label).toBe("Week of 12 May")
    expect(drawn[1]?.text).toBe(
      sumDecimals(points.slice(6, 13).map((each) => each.decimal)),
    )
    // This week is today alone so far: dashed, and says so.
    const last = drawn.at(-1)
    expect(last?.partial).toBe(true)
    expect(last?.label).toBe("16 Nov so far")
  })

  it("marks a week partial while it fills and names its days", () => {
    // To Wednesday 18 Nov 2026, today.
    const drawn = weekly(days(200, "2026-11-18"), "flow", draw, sum)
    expect(drawn.at(-1)?.label).toBe("16 to 18 Nov so far")
    expect(drawn.at(-1)?.partial).toBe(true)
    expect(drawn.at(-2)?.partial).toBe(false)
  })

  it("dashes a part week at either end of a span, saying so far only for this week", () => {
    // 20 Dec 2025 (a Saturday) to 30 Jun 2026 (a Tuesday), all closed.
    const points = days(193, "2026-06-30", false)
    expect(points[0]?.day).toBe("2025-12-20")
    const drawn = weekly(points, "flow", draw, sum)
    expect(drawn[0]).toMatchObject({ label: "20 to 21 Dec", partial: true })
    expect(drawn.at(-1)).toMatchObject({ label: "29 to 30 Jun", partial: true })
    // The whole weeks between are solid.
    expect(drawn.slice(1, -1).every((week) => !week.partial)).toBe(true)
    expect(drawn.some((week) => week.label.includes("so far"))).toBe(false)
  })

  it("thins a level to each week's last day, as that day", () => {
    const points = days(200, "2026-11-18")
    const drawn = weekly(points, "level", draw, sum)
    // It starts on the series' first day, as the axis says.
    expect(drawn[0]?.day).toBe(points[0]?.day)
    expect(drawn.at(-1)?.day).toBe("2026-11-18")
    expect(drawn.at(-2)?.day).toBe("2026-11-15")
    // The closing value, never a sum.
    expect(drawn.at(-2)?.text).toBe(points.at(-4)?.decimal)
  })

  it("starts weeks on Monday, UTC", () => {
    expect(weekOf("2026-11-16")).toBe("2026-11-16")
    expect(weekOf("2026-11-22")).toBe("2026-11-16")
    expect(weekOf("2026-11-23")).toBe("2026-11-23")
    expect(weekOf("2026-03-01")).toBe("2026-02-23")
  })

  it("says a whole week, part of one, across a month", () => {
    expect(weekLabel("2026-03-02", "2026-03-08", false)).toBe("Week of 2 Mar")
    expect(weekLabel("2026-02-27", "2026-03-01", false)).toBe("27 Feb to 1 Mar")
    expect(weekLabel("2026-03-04", "2026-03-04", false)).toBe("4 Mar")
    expect(weekLabel("2026-03-02", "2026-03-08", true)).toBe(
      "Week of 2 Mar so far",
    )
  })

  it("adds decimals exactly, signs and places mixed", () => {
    expect(sumDecimals(["1.25", "2", "-0.005"])).toBe("3.245")
    expect(sumDecimals(["0.1", "0.2"])).toBe("0.3")
    expect(sumDecimals(["123456789012345678901234567890", "1"])).toBe(
      "123456789012345678901234567891",
    )
    expect(sumDecimals(["-3", "1"])).toBe("-2")
    expect(sumDecimals([])).toBe("0")
  })
})
