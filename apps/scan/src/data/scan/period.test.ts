import { describe, expect, it } from "vitest"
import { periodInput, periodSearch, spanOf } from "../../explorer/voting/range"
import { isDay, spanText } from "../../explorer/voting/span-text"
import {
  firstDataDay,
  periodName,
  periodOf,
  periodPoints,
  periodSeries,
  periodView,
  readBuckets,
} from "./period"
import type { SeriesView } from "./series.server"

// Monday 16 Nov 2026, 12:00 UTC.
const now = Date.parse("2026-11-16T12:00:00Z") / 1000

describe("a panel's period", () => {
  it("is 30d unless the input names 90d or All", () => {
    expect(periodOf({}, now)).toEqual({
      range: "30d",
      from: "2026-10-18",
      to: "2026-11-16",
      days: 30,
      read: 30,
    })
    expect(periodOf({ range: "90d" }, now).days).toBe(90)
    expect(periodOf({ range: "All" }, now)).toMatchObject({
      range: "All",
      days: 730,
      read: 730,
    })
    expect(periodOf({ range: "constructor" }, now).range).toBe("30d")
    expect(periodOf(null, now).range).toBe("30d")
  })

  it("takes a custom span, reading back past its first day by a bucket", () => {
    expect(
      periodOf({ range: "90d", from: "2026-01-01", to: "2026-03-31" }, now),
    ).toEqual({
      range: null,
      from: "2026-01-01",
      to: "2026-03-31",
      days: 90,
      read: 365,
    })
    // 21 days back read 30; 92, 180; 367 and more, 730; 365, 365.
    const reads = ["2026-10-27", "2026-08-17", "2025-11-15", "2025-06-01"].map(
      (from) => periodOf({ from, to: from }, now).read,
    )
    expect(reads).toEqual([30, 180, 730, 730])
    expect(periodOf({ from: "2025-11-17", to: "2026-01-01" }, now).read).toBe(
      365,
    )
    for (let back = 1; back <= 800; back += 1) {
      const from = new Date((now - back * 86_400) * 1000)
        .toISOString()
        .slice(0, 10)
      expect(readBuckets).toContain(periodOf({ from, to: from }, now).read)
    }
  })

  it("puts a reversed span in order and clamps it to what can be read", () => {
    expect(
      periodOf({ from: "2026-03-31", to: "2026-01-01" }, now),
    ).toMatchObject({ from: "2026-01-01", to: "2026-03-31" })
    // Past today: today. Before the first day there is: that day, the
    // form's own min (mainnet, not the All range's 17 Nov 2024).
    const wide = periodOf({ from: "1999-01-01", to: "2099-12-31" }, now)
    expect(wide).toMatchObject({
      range: null,
      from: firstDataDay,
      to: "2026-11-16",
      days: 560,
      read: 730,
    })
    expect(wide.from).toBe(periodView(wide, now).min)
    // A span wholly in the past is the first day alone.
    expect(
      periodOf({ from: "2019-01-01", to: "2020-01-01" }, now),
    ).toMatchObject({ from: firstDataDay, to: firstDataDay, days: 1 })
    // A span wholly in the future is today alone.
    expect(
      periodOf({ from: "2030-01-01", to: "2030-02-01" }, now),
    ).toMatchObject({ from: "2026-11-16", to: "2026-11-16", days: 1, read: 30 })
  })

  it("ignores a span that is not two real days", () => {
    for (const span of [
      { from: "2026-02-30", to: "2026-03-01" },
      { from: "2026-1-1", to: "2026-03-01" },
      { from: "2026-01-01" },
      { from: 20260101, to: "2026-03-01" },
      { from: "2026-01-01T00:00", to: "2026-03-01" },
      { from: "<script>", to: "2026-03-01" },
    ]) {
      expect(periodOf({ range: "90d", ...span }, now).range).toBe("90d")
    }
  })

  it("names a span tersely, with a year only where it is not this one", () => {
    const today = "2026-11-16"
    expect(spanText("2026-01-01", "2026-03-31", today)).toBe("1 Jan to 31 Mar")
    expect(spanText("2025-01-01", "2025-03-31", today)).toBe(
      "1 Jan to 31 Mar 2025",
    )
    expect(spanText("2025-12-01", "2026-01-31", today)).toBe(
      "1 Dec 2025 to 31 Jan 2026",
    )
    expect(spanText("2026-05-04", "2026-05-04", today)).toBe("4 May")
    const span = periodOf({ from: "2026-01-01", to: "2026-03-31" }, now)
    expect(periodName(span, now)).toBe("1 Jan to 31 Mar")
    expect(periodView(span, now)).toEqual({
      range: null,
      from: "2026-01-01",
      to: "2026-03-31",
      min: firstDataDay,
      max: "2026-11-16",
      text: "1 Jan to 31 Mar",
    })
    expect(periodView(periodOf({ range: "All" }, now), now).text).toBe("All")
  })

  it("keeps a span's days, or a range's back from the last day there is", () => {
    const points = ["2026-01-01", "2026-02-01", "2026-03-31", "2026-04-01"].map(
      (day) => ({ day }),
    )
    const span = periodOf({ from: "2026-01-15", to: "2026-03-31" }, now)
    expect(periodPoints(points, span).map((point) => point.day)).toEqual([
      "2026-02-01",
      "2026-03-31",
    ])
    // A backfill that ends in the past counts back from where it ends:
    // 90 days to 1 Apr start on 2 Jan.
    const range = periodOf({ range: "90d" }, now)
    expect(periodPoints(points, range).map((point) => point.day)).toEqual([
      "2026-02-01",
      "2026-03-31",
      "2026-04-01",
    ])
  })

  it("cuts a series to a span, its latest the span's last", () => {
    const view: SeriesView = {
      metric: "chain.transactions",
      kind: "flow",
      unit: "count",
      points: ["2026-03-30", "2026-03-31", "2026-04-01"].map((day) => ({
        day,
        value: 1,
        text: day,
        decimal: "1",
        partial: false,
      })),
      latest: { text: "2026-04-01", partial: false },
      firstDay: "2025-05-06",
      endsOn: null,
    }
    const cut = periodSeries(
      { status: "ok", data: view },
      periodOf({ from: "2026-01-01", to: "2026-03-31" }, now),
    )
    if (cut.status !== "ok") throw new Error("not ok")
    expect(cut.data.points).toHaveLength(2)
    expect(cut.data.latest).toEqual({ text: "2026-03-31", partial: false })
    expect(
      periodSeries({ status: "unavailable" }, periodOf({}, now)).status,
    ).toBe("unavailable")
  })
})

describe("a period's search params", () => {
  it("keeps a span only when both days have a day's shape", () => {
    expect(spanOf({ from: "2026-01-01", to: "2026-03-31" })).toEqual({
      from: "2026-01-01",
      to: "2026-03-31",
    })
    expect(spanOf({ from: "2026-01-01" })).toBeUndefined()
    // A day's shape only (this loads with every page): whoever names a
    // span's days checks they are real (period.ts, the rewards chart).
    expect(isDay("2026-02-28")).toBe(true)
    expect(isDay("2024-02-29")).toBe(true)
    for (const day of [
      "2026-02-31",
      "2026-02-29",
      "2026-04-31",
      "2026-13-01",
    ]) {
      expect(isDay(day)).toBe(false)
    }
    expect(isDay(20260101)).toBe(false)
    expect(spanOf({ from: "x", to: "2026-03-31" })).toBeUndefined()
    expect(
      periodSearch({ range: "All", from: "2026-01-01", to: "2026-03-31" }),
    ).toEqual({ range: "All", from: "2026-01-01", to: "2026-03-31" })
    expect(periodSearch({ range: "30d", to: "2026-03-31" })).toEqual({})
    expect(periodInput({})).toEqual({ range: "30d" })
    expect(periodInput({ from: "2026-01-01", to: "2026-03-31" })).toEqual({
      range: "30d",
      from: "2026-01-01",
      to: "2026-03-31",
    })
  })
})
