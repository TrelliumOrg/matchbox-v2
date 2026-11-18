import { describe, expect, it } from "vitest"
import { formatBtc, fromWei } from "./btc"

const text = (value: string, unit: "BTC" | "veBTC" = "veBTC") =>
  formatBtc(value, unit).text

describe("formatBtc", () => {
  it("shows 4 decimals for ordinary amounts", () => {
    expect(text("250.166000859788582573")).toBe("250.1660 veBTC")
    expect(text("0.8")).toBe("0.8000 veBTC")
    expect(text("1060000")).toBe("1,060,000.0000 veBTC")
    expect(text("0.00005", "BTC")).toBe("0.0000500 BTC")
  })

  it("keeps 3 significant figures for small amounts", () => {
    expect(text("0.000228")).toBe("0.000228 veBTC")
    expect(text("0.0000102")).toBe("0.0000102 veBTC")
    expect(text("0.0228")).toBe("0.0228 veBTC")
    expect(text("0.00228")).toBe("0.00228 veBTC")
    expect(text("0.000099996")).toBe("0.000100 veBTC")
  })

  it("rounds half up exactly at the boundaries", () => {
    expect(text("0.00004999")).toBe("0.0000500 veBTC")
    expect(text("1.23455")).toBe("1.2346 veBTC")
    expect(text("9.99995")).toBe("10.0000 veBTC")
  })

  it("floors below 0.000001 with the exact value for the tooltip", () => {
    expect(formatBtc("0.000000999", "veBTC")).toEqual({
      text: "<0.000001 veBTC",
      exact: "0.000000999 veBTC",
    })
    expect(text("0.000001")).toBe("0.00000100 veBTC")
    expect(formatBtc("0.0000001", "BTC").exact).toBe("0.0000001 BTC")
  })

  it("shows zero plainly and rejects anything but a decimal", () => {
    expect(text("0")).toBe("0.0000 veBTC")
    expect(text("-0.5")).toBe("-0.5000 veBTC")
    expect(() => formatBtc("1e-7")).toThrow()
  })

  it("reads wei", () => {
    expect(fromWei("800000000000000000")).toBe("0.800000000000000000")
    expect(fromWei(10n ** 18n * 250n)).toBe("250.000000000000000000")
  })
})
