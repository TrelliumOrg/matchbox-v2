import { describe, expect, it } from "vitest"
import { expiryAt } from "./manage-key-sheet"

const now = Date.parse("2026-11-09T12:00:00.000Z")

describe("key expiry", () => {
  it("offers Classic's choices: keep, 30 d, 90 d, 1 y and now", () => {
    expect(expiryAt("keep", now)).toBeNull()
    expect(expiryAt("now", now)).toBe("2026-11-09T12:00:00.000Z")
    expect(expiryAt("30d", now)).toBe("2026-12-09T12:00:00.000Z")
    expect(expiryAt("90d", now)).toBe("2027-02-07T12:00:00.000Z")
    expect(expiryAt("365d", now)).toBe("2027-11-09T12:00:00.000Z")
  })
})
