import { describe, expect, it } from "vitest"
import { dateIsKnown, dateKeyOf, dateKeys, dateSpans } from "./sourcedDates"

describe("dates in sourcing", () => {
  it("reads the forms Stuart and the model write", () => {
    expect(dateKeys("Since 15 Aug 2026, SNF claimed")).toEqual(["2026-08-15"])
    expect(dateKeys("This lock unlocks Wed 20 Oct 2027.")).toEqual([
      "2027-10-20",
    ])
    expect(dateKeys("on August 15, 2026 and 15 August 2026")).toEqual([
      "2026-08-15",
      "2026-08-15",
    ])
    expect(dateKeys("today's date (2026-11-13)")).toEqual(["2026-11-13"])
    expect(dateKeys("ends 2026-10-29T00:00:00Z")).toEqual(["2026-10-29"])
    expect(dateKeys("before today (13 Nov)")).toEqual(["--11-13"])
    expect(dateKeys("history for March 2026")).toEqual(["2026-03"])
  })

  it("gives a range's first day the year of its last", () => {
    expect(dateKeys("From 1 Oct to 31 Oct 2026, SNF")).toEqual([
      "2026-10-01",
      "2026-10-31",
    ])
    expect(dateKeys("history for 1 to 31 March 2026")).toEqual([
      "2026-03-01",
      "2026-03-31",
    ])
  })

  it("reads no date in prose, numbers or impossible days", () => {
    expect(dateKeys("you may vote 5 may times")).toEqual([])
    expect(dateKeys("8 veMEZO locks, 13 claims and 2 burned")).toEqual([])
    // No such day: only the month is a date, and "31" stays a number.
    expect(dateKeys("on 31 Feb 2026")).toEqual(["2026-02"])
    expect(dateKeys("Oct 2026")).toEqual(["2026-10"])
    expect(dateKeys("Thursday 00:00 to 01:00 UTC")).toEqual([])
  })

  it("matches a written date to known ones as a whole", () => {
    const known = new Set(["2026-08-15", "2027-10-20"])
    const [same] = dateSpans("since Aug 15, 2026")
    const [other] = dateSpans("since 15 Oct 2026")
    const [noYear] = dateSpans("since 15 Aug")
    const [month] = dateSpans("in August 2026")
    if (!same || !other || !noYear || !month) throw new Error("no span")
    expect(dateIsKnown(same, known)).toBe(true)
    expect(dateIsKnown(noYear, known)).toBe(true)
    expect(dateIsKnown(month, known)).toBe(true)
    // Each part is known, the date is not.
    expect(dateIsKnown(other, known)).toBe(false)
  })

  it("holds a written weekday to the date's own", () => {
    const known = new Set(["2027-10-20"])
    const [right] = dateSpans("unlocks Wed 20 Oct 2027")
    const [wrong] = dateSpans("unlocks Thu 20 Oct 2027")
    if (!right || !wrong) throw new Error("no span")
    expect(dateIsKnown(right, known)).toBe(true)
    expect(dateIsKnown(wrong, known)).toBe(false)
  })

  it("never takes a digit that is not part of the date", () => {
    const read = (text: string) => dateSpans(text).map((span) => span.text)
    // An implausible year is not a year: the date stops at the day.
    expect(read("By Nov 19, 5000 MUSD")).toEqual(["Nov 19"])
    expect(read("On 19 Nov, 5000 MUSD")).toEqual(["19 Nov"])
    expect(read("Nov 19 9999 MUSD")).toEqual(["Nov 19"])
    // A plausible year followed by a unit or token is an amount.
    expect(read("By Nov 19, 2026 MUSD")).toEqual(["Nov 19"])
    expect(read("in Nov 2026 BTC")).toEqual([])
    expect(read("By Nov 19, 2026 UTC")).toEqual(["Nov 19, 2026"])
    // A day joined to other digits is no day.
    expect(read("5.19 Nov")).toEqual([])
    expect(read("Nov 19.5 MUSD")).toEqual([])
    expect(read("Nov 5000")).toEqual([])
    // Only a real time belongs to an ISO date.
    expect(read("Due 2026-11-19T5000 MUSD")).toEqual(["2026-11-19"])
    expect(read("at 2026-11-19T09:30:00Z")).toEqual(["2026-11-19T09:30:00Z"])
    expect(read("1.2026-11-19")).toEqual([])
    expect(read("on 3000-11-19")).toEqual([])
  })

  it("keys a timestamp by its UTC day", () => {
    expect(dateKeyOf(new Date("2026-11-13T23:30:00.000Z"))).toBe("2026-11-13")
  })
})
