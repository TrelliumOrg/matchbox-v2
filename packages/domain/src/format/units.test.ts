import { describe, expect, it } from "vitest"
import { formatGwei, formatUnits, unitsToDecimal } from "./units"

describe("units", () => {
  it("places the decimal point exactly", () => {
    expect(unitsToDecimal("1500000", 6)).toBe("1.500000")
    expect(unitsToDecimal("5", 18)).toBe("0.000000000000000005")
    expect(unitsToDecimal("4000000000000000000000000", 18)).toBe(
      "4000000.000000000000000000",
    )
    expect(unitsToDecimal("-25", 1)).toBe("-2.5")
    expect(unitsToDecimal("7", 0)).toBe("7")
  })

  it("formats token amounts for tables", () => {
    expect(formatUnits("73724538339299012958", 18)).toBe("73.72")
    expect(formatUnits("169306769", 6)).toBe("169.31")
    expect(formatUnits("130711424201618", 18)).toBe("0.000131")
    expect(formatUnits("4", 0)).toBe("4")
    expect(formatUnits("0", 18)).toBe("0.00")
  })

  it("formats gwei", () => {
    expect(formatGwei("5000000")).toBe("0.005 gwei")
    expect(formatGwei("25000000000")).toBe("25 gwei")
    expect(formatGwei("1234567890123")).toBe("1,234.567 gwei")
  })
})
