import { describe, expect, it } from "vitest"
import {
  baseUnitsToWhole,
  microToUsd,
  UnitConversionError,
  usdToMicro,
  wholeToBaseUnits,
} from "./units"

const E18 = 10n ** 18n

describe("read model unit conversions", () => {
  it("converts whole units to base units exactly", () => {
    expect(wholeToBaseUnits("6413.04", 18)).toBe(641_304n * 10n ** 16n)
    expect(wholeToBaseUnits("5880000", 18)).toBe(5_880_000n * E18)
    expect(wholeToBaseUnits("0.000412", 18)).toBe(412n * 10n ** 12n)
    expect(wholeToBaseUnits("19.45", 6)).toBe(19_450_000n)
    expect(wholeToBaseUnits("0", 18)).toBe(0n)
    // Trailing zeros past the token's decimals are not precision.
    expect(wholeToBaseUnits("1.50000000", 6)).toBe(1_500_000n)
  })

  it("refuses non-decimals and digits a token cannot hold", () => {
    expect(() => wholeToBaseUnits("1.0000001", 6)).toThrow(UnitConversionError)
    expect(() => wholeToBaseUnits("-1", 18)).toThrow(UnitConversionError)
    expect(() => wholeToBaseUnits("1e18", 18)).toThrow(UnitConversionError)
    expect(() => wholeToBaseUnits("", 18)).toThrow(UnitConversionError)
  })

  it("round-trips base units back to whole units", () => {
    expect(baseUnitsToWhole(641_304n * 10n ** 16n, 18)).toBe("6413.04")
    expect(baseUnitsToWhole(5_880_000n * E18, 18)).toBe("5880000")
    expect(baseUnitsToWhole(-1_500_000n, 6)).toBe("-1.5")
  })

  it("converts USD to micro-USD, rounding half up past six decimals", () => {
    expect(usdToMicro("212.48")).toBe(212_480_000n)
    expect(usdToMicro("0.0000005")).toBe(1n)
    expect(usdToMicro("0.0000004")).toBe(0n)
    expect(microToUsd(212_480_000n)).toBe("212.48")
    expect(microToUsd(0n)).toBe("0")
  })
})
