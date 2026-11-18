import { demoTokens } from "@matchbox/contracts/read-models/fixtures"
import { describe, expect, it } from "vitest"
import {
  fromRaw,
  mergeTokenAmounts,
  priceBreakdown,
  subtractUsd,
  sumUsd,
  toCents,
  usdValue,
} from "./money"

const prices = {
  btc: {
    usd: "105710",
    change24h: null,
    source: "mezo-oracle" as const,
    updatedAt: 1,
  },
  mezo: {
    usd: "0.184",
    change24h: null,
    source: "aerodrome-cl" as const,
    updatedAt: 1,
  },
}

describe("read model money", () => {
  it("values tokens to the cent, half up", () => {
    expect(usdValue("0.000412", "105710")).toBe("43.55")
    expect(usdValue("0.0005", "105710")).toBe("52.86")
    expect(usdValue("812.40", "0.184")).toBe("149.48")
    expect(usdValue("0", "105710")).toBe("0.00")
  })

  it("adds and subtracts exactly", () => {
    expect(sumUsd(["0.1", "0.2"])).toBe("0.30")
    expect(sumUsd(["43.55", "149.48", "19.45"])).toBe("212.48")
    expect(subtractUsd("13950", "14820")).toBe("-870.00")
    expect(toCents("-1.005")).toBe(-101n)
  })

  it("formats base units without floats", () => {
    expect(fromRaw(412_000_000_000_000n, 18)).toBe("0.000412")
    expect(fromRaw(10n ** 24n, 18)).toBe("1000000")
    expect(fromRaw(1n, 18)).toBe("0.000000000000000001")
  })

  it("prices stablecoins at one dollar and leaves unknown tokens unpriced", () => {
    const breakdown = priceBreakdown(
      [
        { token: demoTokens.musd, amount: "19.45", usd: null },
        { token: demoTokens.btc, amount: "0.000412", usd: null },
        {
          token: {
            address: "0x9999999999999999999999999999999999999999",
            symbol: "FAKE",
            name: "Fake",
            decimals: 18,
          },
          amount: "5",
          usd: "999",
        },
      ],
      prices,
    )
    expect(breakdown.usd).toBe("63.00")
    expect(breakdown.tokens.map((token) => token.usd)).toEqual([
      "19.45",
      "43.55",
      null,
    ])
  })

  it("merges amounts of the same token", () => {
    const merged = mergeTokenAmounts([
      [{ token: demoTokens.mezo, amount: "765.10", usd: null }],
      [
        { token: demoTokens.mezo, amount: "47.30", usd: null },
        { token: demoTokens.musdc, amount: "1.5", usd: null },
      ],
    ])
    expect(merged).toEqual([
      { token: demoTokens.mezo, amount: "812.4", usd: null },
      { token: demoTokens.musdc, amount: "1.5", usd: null },
    ])
  })
})
