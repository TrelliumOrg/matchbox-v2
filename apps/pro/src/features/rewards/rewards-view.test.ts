import { describe, expect, it } from "vitest"
import { earnedRange } from "./rewards-view"

describe("earned range", () => {
  it("never prints a dangling epoch", () => {
    expect(earnedRange({ usd: "1", fromEpoch: 38, toEpoch: 47 })).toBe(
      ", Epoch 38 to 47",
    )
    expect(earnedRange({ usd: "1", fromEpoch: null, toEpoch: 47 })).toBe(
      ", Epoch 47",
    )
    expect(earnedRange({ usd: "1", fromEpoch: 47, toEpoch: 47 })).toBe(
      ", Epoch 47",
    )
    expect(earnedRange({ usd: "0", fromEpoch: null, toEpoch: null })).toBe("")
  })
})
