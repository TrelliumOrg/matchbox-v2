import { describe, expect, it } from "vitest"
import { isKvPublishMinute, percentChange } from "./prices"

describe("percentChange", () => {
  it("rounds to hundredths of a percent without floats", () => {
    expect(percentChange("103841", "105710")).toBe("1.80")
    expect(percentChange("0.18853", "0.184")).toBe("-2.40")
    expect(percentChange("100", "100")).toBe("0.00")
    expect(percentChange("3", "4")).toBe("33.33")
    expect(percentChange("3", "2")).toBe("-33.33")
    expect(percentChange("0", "5")).toBe("0.00")
  })
})

describe("KV publish cadence", () => {
  it("publishes on even minutes only", () => {
    expect(isKvPublishMinute(1_794_138_720)).toBe(true)
    expect(isKvPublishMinute(1_794_138_780)).toBe(false)
  })
})
