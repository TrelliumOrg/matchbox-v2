import { describe, expect, it } from "vitest"
import type { ActivityEvent } from "../../data/view-models"
import {
  claimHistory,
  earnedGaps,
  earnedRange,
  hasEarlierClaims,
} from "./rewards-view"

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

describe("earned gaps", () => {
  const base = { usd: "40.00", fromEpoch: 1, toEpoch: 48 }

  it("names the claims Earned leaves out, and nothing otherwise", () => {
    expect(earnedGaps(base)).toBeNull()
    expect(
      earnedGaps({ ...base, whenClaimed: { unpriced: 0, pending: 0 } }),
    ).toBeNull()
    expect(
      earnedGaps({
        ...base,
        whenClaimed: { unpriced: 2, pending: 1, settling: 1 },
      }),
    ).toBe("No price for 2 claims, 1 recent claim not included yet")
    expect(
      earnedGaps({ ...base, whenClaimed: { unpriced: 1, pending: 0 } }),
    ).toBe("No price for 1 claim")
    expect(
      earnedGaps({
        ...base,
        whenClaimed: { unpriced: 0, pending: 3, settling: 3 },
      }),
    ).toBe("3 recent claims not included yet")
  })

  it("never calls an older pending claim recent", () => {
    // A leftover estimate past its day, or a day not priced yet.
    expect(
      earnedGaps({
        ...base,
        whenClaimed: { unpriced: 0, pending: 3, settling: 1 },
      }),
    ).toBe("1 recent claim not included yet, 2 older claims not priced yet")
    expect(
      earnedGaps({
        ...base,
        whenClaimed: { unpriced: 1, pending: 1, settling: 0 },
      }),
    ).toBe("No price for 1 claim, 1 older claim not priced yet")
    // A document written before the split: neither word.
    expect(
      earnedGaps({ ...base, whenClaimed: { unpriced: 0, pending: 2 } }),
    ).toBe("2 claims not included yet")
  })
})

function claim(tx: string, at: number, epoch: number, id = tx): ActivityEvent {
  return {
    id,
    status: "confirmed",
    at,
    epoch,
    block: 1,
    tx,
    detail: { kind: "claim", usd: "0.50", tokens: [], locks: [], gauges: [] },
  }
}

describe("claim history", () => {
  const latest = [claim("0xb", 200, 48), claim("0xa", 100, 47)]

  it("adds earlier claims once a transaction, newest first", () => {
    const earlier = [
      // Activity names the same claim by its first event.
      claim("0xa", 100, 47, "0xa-4"),
      claim("0x9", 50, 46, "0x9-4"),
    ]
    expect(claimHistory(latest, earlier).map((event) => event.tx)).toEqual([
      "0xb",
      "0xa",
      "0x9",
    ])
  })

  it("offers earlier claims only when Earned counts older ones", () => {
    const earned = { usd: "1.50", fromEpoch: 46, toEpoch: 48 }
    expect(hasEarlierClaims(earned, latest)).toBe(true)
    expect(hasEarlierClaims({ ...earned, fromEpoch: 47 }, latest)).toBe(false)
    expect(hasEarlierClaims({ ...earned, fromEpoch: null }, latest)).toBe(false)
    expect(hasEarlierClaims(earned, [])).toBe(false)
  })
})
