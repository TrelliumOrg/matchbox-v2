import { describe, expect, it } from "vitest"
import { matchesGaugeSearch } from "./pool-search"

describe("matchesGaugeSearch", () => {
  it("matches the name, the label and both together", () => {
    expect(matchesGaugeSearch("btc/musd", "BTC/MUSD", "CL200")).toBe(true)
    expect(matchesGaugeSearch("cl200", "BTC/MUSD", "CL200")).toBe(true)
    expect(matchesGaugeSearch("btc/musd cl200", "BTC/MUSD", "CL200")).toBe(true)
    expect(matchesGaugeSearch("btc/musd volatile", "BTC/MUSD", "CL200")).toBe(
      false,
    )
    expect(matchesGaugeSearch("volatile", "BTC/MUSD", "Volatile")).toBe(true)
    expect(matchesGaugeSearch("concentrated", "BTC/MUSD", "CL2000")).toBe(true)
    expect(matchesGaugeSearch("  ", "BTC/MUSD", null)).toBe(true)
    expect(matchesGaugeSearch("stable", "SNF", null)).toBe(false)
    // A tick spacing is a whole word: CL200 is not CL2000.
    expect(matchesGaugeSearch("cl200", "BTC/MUSD", "CL2000")).toBe(false)
    expect(matchesGaugeSearch("cl2000", "BTC/MUSD", "CL2000")).toBe(true)
    expect(matchesGaugeSearch("cl", "BTC/MUSD", "CL2000")).toBe(true)
  })
})
