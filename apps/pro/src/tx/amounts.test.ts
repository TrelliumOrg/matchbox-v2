import { describe, expect, it } from "vitest"
import {
  amountLabel,
  feeLabel,
  parseAmount,
  toDecimal,
  usdValue,
} from "./amounts"

describe("amounts", () => {
  it("parses typed amounts exactly", () => {
    expect(parseAmount("6000.5", 18)).toBe(6_000_500_000_000_000_000_000n)
    expect(parseAmount("0.000000000000000001", 18)).toBe(1n)
    expect(parseAmount("", 18)).toBeNull()
    expect(parseAmount("0", 18)).toBeNull()
    expect(parseAmount("1.2.3", 18)).toBeNull()
    expect(toDecimal(1_500_000_000_000_000_000n, 18)).toBe("1.5")
  })

  it("labels amounts in the house formats", () => {
    expect(amountLabel(6000n * 10n ** 18n, 18, "MEZO")).toBe("6,000.00")
    expect(amountLabel(10n ** 17n, 18, "BTC")).toBe("0.1000")
  })

  it("prices amounts in micro-dollars", () => {
    expect(usdValue(6000n * 10n ** 18n, 18, "0.184")).toBe("1104.000000")
    expect(usdValue(1n, 18, null)).toBeNull()
  })

  it("never shows a fee as free", () => {
    expect(feeLabel(10n ** 11n, "105710")).toBe("About $0.01")
    expect(feeLabel(10n ** 9n, "105710")).toBe("Under $0.01")
    expect(feeLabel(10n ** 9n, null)).toBeNull()
  })
})
