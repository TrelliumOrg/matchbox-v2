import { describe, expect, it } from "vitest"
import { InvalidIdError, idSegment } from "./ids"

describe("server function ids", () => {
  it("accepts UUIDs only, so inputs cannot rewrite internal paths", () => {
    const id = "2b5a2814-a844-4572-aa2e-75650fd3841c"
    expect(idSegment(id)).toBe(id)
    for (const value of ["..", "../apps", `${id}/..`, "%2e%2e", "", 1, null]) {
      expect(() => idSegment(value)).toThrow(InvalidIdError)
    }
  })
})
