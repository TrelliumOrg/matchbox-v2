import { addDays, dayStart } from "@matchbox/api/read-models/claim-prices"
import { describe, expect, it } from "vitest"
import { checkedThrough, historyStartDay } from "./claim-prices"

// 20 Nov 2026, 10:00 UTC: the latest settled day is 17 Nov, and a day
// missing before 10 Nov is over a week settled.
const now = dayStart("2026-11-20") + 10 * 3_600

/** A point every day from `first` to `last`, but for `skip`. */
function points(first: string, last: string, skip: string[] = []) {
  const found = new Map<string, true>()
  for (let day = first; day <= last; day = addDays(day, 1)) {
    if (!skip.includes(day)) found.set(day, true)
  }
  return found
}

const request = {
  from: historyStartDay,
  askFrom: historyStartDay,
  through: "2026-11-17",
}

describe("checked days", () => {
  it("takes a day missing over a week as no price, and stops at a younger one", () => {
    const result = checkedThrough({
      state: null,
      request,
      points: points(historyStartDay, "2026-11-17", [
        "2026-06-02",
        "2026-11-09",
        "2026-11-10",
      ]),
      nowSeconds: now,
    })
    expect(result.missing).toEqual(["2026-06-02", "2026-11-09"])
    expect(result.gap).toBe("2026-11-10")
    expect(result.state).toMatchObject({ through: "2026-11-09" })
    expect(result.state.retryAt).toBeDefined()
  })

  it("never takes the days after an answer's last point as no price", () => {
    // Cut short on 1 Sep: the months after are not a hole, they are asked
    // for again.
    const result = checkedThrough({
      state: null,
      request,
      points: points(historyStartDay, "2026-09-01"),
      nowSeconds: now,
    })
    expect(result.missing).toEqual([])
    expect(result.gap).toBe("2026-09-02")
    expect(result.state.through).toBe("2026-09-01")
  })

  it("takes nothing as no price from an empty answer", () => {
    const result = checkedThrough({
      state: {
        from: historyStartDay,
        through: "2026-10-01",
        pricedFrom: historyStartDay,
      },
      request: { ...request, askFrom: "2026-10-02" },
      points: new Map(),
      nowSeconds: now,
    })
    expect(result.missing).toEqual([])
    expect(result.state.through).toBe("2026-10-01")
  })

  it("never moves the first point later", () => {
    // Known from 1 Apr; this answer's earliest point is 1 May.
    const result = checkedThrough({
      state: {
        from: historyStartDay,
        through: "2026-11-16",
        pricedFrom: "2026-04-01",
      },
      request: { ...request, askFrom: "2026-01-01" },
      points: points("2026-05-01", "2026-11-17"),
      nowSeconds: now,
    })
    expect(result.state.pricedFrom).toBe("2026-04-01")
    expect(result.state.through).toBe("2026-11-17")
  })
})
