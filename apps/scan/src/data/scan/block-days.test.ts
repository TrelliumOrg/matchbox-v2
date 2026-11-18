import { describe, expect, it } from "vitest"
import { blockDays, spanName } from "./block-days"

const point = (day: string, decimal: string) => ({ day, decimal })

/** Unix seconds of a day's start. */
const at = (day: string) => Date.parse(`${day}T00:00:00Z`) / 1000

describe("block time between daily head reads", () => {
  it("divides the real seconds between two reads by their blocks", () => {
    // Reads at 00:28 on the 12th and 00:21 on the 13th: 23.9 hours.
    const heights = [
      point("2026-11-12", "13180000"),
      point("2026-11-13", "13202523"),
    ]
    const times = [
      point("2026-11-12", String(at("2026-11-12") + 1_680)),
      point("2026-11-13", String(at("2026-11-13") + 1_260)),
    ]
    const days = blockDays(heights, times)
    expect(days?.latest).toEqual({
      label: "13 Nov",
      hours: "23.9",
      name: "Last day",
      blocks: "22,523",
      // 85,980 seconds over 22,523 blocks, never over 86,400.
      average: "3.8s",
    })
    expect(days?.span).toEqual({ days: "1", blocks: "22,523", average: "3.8s" })
  })

  it("adds spans by their seconds and blocks, and marks a slow one", () => {
    const heights = [
      point("2026-11-11", "1000"),
      point("2026-11-12", "9640"),
      point("2026-11-13", "38440"),
    ]
    const times = heights.map((each) => point(each.day, String(at(each.day))))
    const days = blockDays(heights, times)
    expect(days?.bars.map((bar) => [bar.text, bar.slow])).toEqual([
      ["10.0s", true],
      ["3.0s", false],
    ])
    // 172,800 seconds over 37,440 blocks.
    expect(days?.span).toEqual({
      days: "2",
      blocks: "37,440",
      average: "4.6s",
    })
  })

  it("leaves out reads stored without a time", () => {
    const heights = [
      point("2026-11-11", "1000"),
      point("2026-11-12", "23600"),
      point("2026-11-13", "46200"),
    ]
    // The 11th was read before head times were kept.
    const times = [
      point("2026-11-12", String(at("2026-11-12"))),
      point("2026-11-13", String(at("2026-11-13") + 3_600)),
    ]
    const days = blockDays(heights, times)
    expect(days?.bars).toHaveLength(1)
    expect(days?.latest.hours).toBe("25")
    expect(days?.latest.name).toBe("Last day")
    expect(blockDays(heights.slice(0, 2), times.slice(0, 1))).toBeNull()
    expect(blockDays([], [])).toBeNull()
  })

  it("names a span after a missed read by its hours, not a day", () => {
    expect(spanName(86_000n)).toBe("Last day")
    expect(spanName(172_440n)).toBe("Last 47.9h")
    expect(spanName(18n * 3_600n)).toBe("Last 18h")
  })
})
