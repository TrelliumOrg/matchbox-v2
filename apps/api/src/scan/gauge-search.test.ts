import { demoKindCards } from "@matchbox/contracts/read-models/fixtures"
import { describe, expect, it } from "vitest"
import { gaugeSearchEntry, matchGaugeNames } from "./gauge-search"

const entries = Object.values(demoKindCards).map(gaugeSearchEntry)

describe("gauge name search", () => {
  it("names a pool gauge with its pool type", () => {
    expect(gaugeSearchEntry(demoKindCards.btcMusdCl).name).toBe(
      "BTC/MUSD CL200",
    )
    expect(gaugeSearchEntry(demoKindCards.northfieldNodes).name).toBe(
      "Northfield Nodes",
    )
    expect(gaugeSearchEntry(demoKindCards.aerodromeMezoMusd).name).toBe(
      "Aerodrome MEZO/MUSD CL200",
    )
  })

  it("finds pools by pair, by type and by both", () => {
    const names = (query: string) =>
      matchGaugeNames(entries, query, 10).map((hit) => hit.name)
    expect(names("btc/musd")).toEqual(["BTC/MUSD CL200"])
    expect(names("cl200")).toContain("BTC/MUSD CL200")
    expect(names("BTC/MUSD CL200")).toEqual(["BTC/MUSD CL200"])
    expect(names("btc/musd volatile")).toEqual([])
    expect(names("northfield")).toEqual(["Northfield Nodes"])
  })

  it("keeps to the limit", () => {
    expect(matchGaugeNames(entries, "", 2)).toHaveLength(2)
  })
})
