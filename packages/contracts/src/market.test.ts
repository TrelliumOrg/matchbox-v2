import { describe, expect, it } from "vitest"
import {
  currentEpochResponse,
  currentEpochResponseSchema,
  epochSeconds,
  epochSelectorSchema,
  voteWindowPaddingSeconds,
} from "./market"

// market.ts had no tests in Matchbox. Its epoch helpers now come from
// @matchbox/domain; these pin the API's view of them.

describe("market epochs", () => {
  const start = 1_788_393_600

  it("keeps the API constants", () => {
    expect(epochSeconds).toBe(604_800)
    expect(voteWindowPaddingSeconds).toBe(3_600)
  })

  it("answers the current epoch endpoint", () => {
    const response = currentEpochResponse(start + 7_200)
    expect(currentEpochResponseSchema.parse(response)).toEqual(response)
    expect(response.data.current).toEqual({
      start,
      end: start + 604_800,
      voteStart: start + 3_600,
      voteEnd: start + 604_800 - 3_600,
      status: "current",
    })
    expect(response.data.next.start).toBe(start + 604_800)
    expect(response.data.next.status).toBe("upcoming")
  })

  it("accepts only epoch starts as a selector", () => {
    expect(epochSelectorSchema.safeParse(String(start)).success).toBe(true)
    expect(epochSelectorSchema.safeParse(String(start + 1)).success).toBe(false)
  })
})
