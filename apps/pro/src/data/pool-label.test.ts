import {
  demoGauges,
  demoKindCards,
} from "@matchbox/contracts/read-models/fixtures"
import { describe, expect, it } from "vitest"
import { gaugeName } from "../lib/gauge-name"
import { gaugeRef, gaugeSummary } from "./adapters"
import { fixtureGaugeDirectory } from "./fixture-gauges"

describe("pool types from the API's gauge references", () => {
  it("labels each pool by its type and tick spacing", () => {
    expect(gaugeRef(demoGauges.btcMusd).poolLabel).toBe("Volatile")
    expect(gaugeRef(demoGauges.musdcMusd).poolLabel).toBe("Stable")
    expect(gaugeRef(demoGauges.btcMusdCl).poolLabel).toBe("CL200")
    expect(gaugeRef(demoGauges.smusd).poolLabel).toBeNull()
    expect(gaugeRef(demoGauges.kilnLabs).poolLabel).toBeNull()
    expect(gaugeRef(demoGauges.aerodromeMezoMusd).poolLabel).toBeNull()
  })

  it("names a pool gauge with its type wherever text names it", () => {
    expect(gaugeName(gaugeRef(demoGauges.btcMusdCl))).toBe("BTC/MUSD CL200")
    expect(gaugeName(gaugeRef(demoGauges.kilnLabs))).toBe("Kiln Labs")
    expect(gaugeName({ name: "Old fixture" })).toBe("Old fixture")
  })

  it("spells the type out on the card's line when a pool has no tagline", () => {
    expect(gaugeSummary(demoKindCards.btcMusdCl).tagline).toBe(
      "Concentrated pool, tick spacing 200",
    )
  })

  it("tells every BTC/MUSD gauge in the fixture directory apart", () => {
    const names = fixtureGaugeDirectory.gauges
      .map(gaugeSummary)
      .filter((gauge) => gauge.name === "BTC/MUSD")
      .map(gaugeName)
    expect(names.length).toBeGreaterThanOrEqual(3)
    expect(new Set(names).size).toBe(names.length)
  })
})
