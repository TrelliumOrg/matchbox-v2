import { describe, expect, it } from "vitest"
import {
  formatBlock,
  formatBoost,
  formatBps,
  formatCompact,
  formatShare,
  formatToken,
  formatUsd,
  formatWhole,
  shareBps,
  usdDelta,
} from "./format"

describe("format", () => {
  it("formats 6-dp USD without floats", () => {
    expect(formatUsd("1180.000000")).toBe("$1,180.00")
    expect(formatUsd("2.835000")).toBe("$2.84")
    expect(formatUsd("89854.400000")).toBe("$89,854")
    expect(formatUsd("-2.100000")).toBe("−$2.10")
    expect(formatUsd("2.830000", { signed: true })).toBe("+$2.83")
    expect(formatUsd("0.000000", { signed: true })).toBe("$0.00")
  })

  it("subtracts USD strings exactly", () => {
    expect(usdDelta("11.580000", "8.750000")).toBe("2.830000")
    expect(usdDelta("1.000000", "8.750000")).toBe("-7.750000")
  })

  it("formats token amounts per asset", () => {
    expect(
      formatToken({ raw: "800000000000000000", decimals: 18, symbol: "BTC" }),
    ).toBe("0.8000 BTC")
    expect(
      formatToken({
        raw: "48000000000000000000000",
        decimals: 18,
        symbol: "MEZO",
      }),
    ).toBe("48,000.00 MEZO")
  })

  it("formats votes compact and whole", () => {
    expect(formatCompact("1090000000000000000000000", 18)).toBe("1.09M")
    expect(formatCompact("22150000000000000000000", 18)).toBe("22.15k")
    expect(formatCompact("6970000000000000000000000", 18)).toBe("6.97M")
    expect(formatCompact("512000000000000000000", 18)).toBe("512.00")
    expect(formatWhole("5880000000000000000000000", 18)).toBe("5,880,000")
  })

  it("formats percents, shares, boosts and blocks", () => {
    expect(formatBps(330)).toBe("3.30%")
    expect(formatBps(31, { signed: true })).toBe("+0.31%")
    expect(formatShare(7000)).toBe("70%")
    expect(formatShare(3350)).toBe("33.5%")
    expect(formatShare(-1000)).toBe("−10%")
    expect(formatBoost("4400000000000000000")).toBe("4.4×")
    expect(formatBlock("13078795")).toBe("13,078,795")
    expect(shareBps("5880000", "6970000")).toBe(8436)
    expect(shareBps("1", "0")).toBe(0)
  })
})
