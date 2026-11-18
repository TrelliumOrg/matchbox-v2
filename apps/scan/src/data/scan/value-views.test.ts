import { describe, expect, it } from "vitest"
import { tokenBySymbol } from "./pricing"
import type { SeriesView } from "./series.server"
import { dollarsOverTime, valueOnMezo } from "./value-views"

function view(
  points: [day: string, decimal: string, partial?: boolean][],
  kind: "flow" | "level" = "flow",
): SeriesView {
  return {
    metric: "test",
    kind,
    unit: "amount",
    points: points.map(([day, decimal, partial = false]) => ({
      day,
      decimal,
      value: Number(decimal),
      text: decimal,
      partial,
    })),
    latest: null,
    firstDay: points[0]?.[0] ?? null,
    endsOn: null,
  }
}

describe("tokens by symbol", () => {
  it("find the registry's priced tokens", () => {
    expect(tokenBySymbol("MUSD")).toBe(
      "0xdd468a1ddc392dcdbef6db6e34e89aa338f9f186",
    )
    expect(tokenBySymbol("SATS")).toBeNull()
  })
})

describe("value on Mezo", () => {
  it("sums the priced tokens, folds the smallest, and names the unpriced", () => {
    const value = valueOnMezo(
      [
        { symbol: "BTC", ticker: "BTC", amount: "1000", usd: "100000000" },
        { symbol: "MEZO", ticker: "MEZO", amount: "50000000", usd: "10000000" },
        { symbol: "mUSDC", ticker: "mUSDC", amount: "1000", usd: "1000" },
        { symbol: "MUSD", ticker: "MUSD", amount: "19000000", usd: null },
      ],
      2,
    )
    expect(value?.figure).toBe("$110.0M")
    expect(value?.parts.map((part) => [part.label, part.share])).toEqual([
      ["BTC", "90.9%"],
      ["2 more", "9.1%"],
    ])
    expect(value?.uncounted).toEqual(["MUSD"])
  })
})

describe("stablecoins over time", () => {
  it("draws only the days every token has, at today's prices", () => {
    const history = dollarsOverTime([
      {
        symbol: "MUSD",
        price: "0.99",
        view: view(
          [
            ["2026-11-01", "100"],
            ["2026-11-02", "200"],
          ],
          "level",
        ),
      },
      {
        symbol: "mUSDC",
        price: "1",
        view: view([["2026-11-02", "50"]], "level"),
      },
    ])
    expect(history?.points.map((point) => [point.day, point.decimal])).toEqual([
      ["2026-11-02", "248.000000000000000000"],
    ])
    expect(history?.firstDay).toBe("2026-11-02")
  })
})
