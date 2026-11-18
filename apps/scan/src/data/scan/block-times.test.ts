import { describe, expect, it } from "vitest"
import {
  averageBlockTime,
  blockTimes,
  secondsText,
  tookSeconds,
} from "./block-times"

/** Block times from timestamps: whole seconds, newest first, gaps kept. */

const rows = [
  { height: 105, timestamp: 1019 },
  { height: 104, timestamp: 1015 },
  { height: 103, timestamp: 1012 },
  { height: 102, timestamp: 1004 },
  { height: 100, timestamp: 996 },
]

describe("block times", () => {
  it("writes one decimal from whole numbers", () => {
    expect(secondsText(19, 5)).toBe("3.8s")
    expect(secondsText(4, 1)).toBe("4.0s")
  })

  it("times a block only against its parent", () => {
    expect(tookSeconds(rows)).toEqual([4, 3, 8, null, null])
  })

  it("averages over the span, gaps included", () => {
    expect(averageBlockTime(rows)).toBe("4.6s")
    expect(averageBlockTime(rows.slice(0, 1))).toBeNull()
    expect(
      averageBlockTime([
        { height: 2, timestamp: null },
        { height: 1, timestamp: 5 },
      ]),
    ).toBeNull()
  })

  it("names the slowest and fastest and marks slow bars", () => {
    const times = blockTimes(rows)
    expect(times?.average).toBe("4.6s")
    expect(times?.slowest).toEqual({ height: "103", took: "8s" })
    expect(times?.fastest).toEqual({ height: "104", took: "3s" })
    expect(times?.counted).toBe(3)
    expect(times?.bars.map((bar) => [bar.height, bar.slow])).toEqual([
      [103, true],
      [104, false],
      [105, false],
    ])
    expect(times?.most).toBe(8)
  })

  it("has a panel from one block time, none without", () => {
    expect(blockTimes(rows.slice(0, 2))?.average).toBe("4.0s")
    expect(blockTimes(rows.slice(3))).toBeNull()
  })
})
