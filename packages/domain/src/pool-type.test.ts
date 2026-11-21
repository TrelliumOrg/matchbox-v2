import { describe, expect, it } from "vitest"
import {
  nameWithPoolType,
  poolTypeDescription,
  poolTypeLabel,
} from "./pool-type"

describe("poolTypeLabel", () => {
  it("names the five kinds of pool the DEX has", () => {
    expect(poolTypeLabel({ poolType: "volatile" })).toBe("Volatile")
    expect(poolTypeLabel({ poolType: "stable" })).toBe("Stable")
    expect(poolTypeLabel({ poolType: "cl", tickSpacing: 200 })).toBe("CL200")
    expect(poolTypeLabel({ poolType: "cl", tickSpacing: 2000 })).toBe("CL2000")
    expect(poolTypeLabel({ poolType: "cl", tickSpacing: 1 })).toBe("CL1")
  })

  it("never makes up a tick spacing", () => {
    expect(poolTypeLabel({ poolType: "cl", tickSpacing: null })).toBe("CL")
    expect(poolTypeLabel({ poolType: "cl" })).toBe("CL")
    expect(poolTypeLabel({ poolType: "cl", tickSpacing: 0 })).toBe("CL")
    expect(poolTypeLabel({ poolType: "cl", tickSpacing: 2.5 })).toBe("CL")
  })

  it("gives vaults and other gauges no label", () => {
    expect(poolTypeLabel({ poolType: null })).toBeNull()
    expect(poolTypeLabel({ poolType: null, tickSpacing: 200 })).toBeNull()
  })

  it("tells the three BTC/MUSD gauges on mainnet apart", () => {
    const labels = [
      { poolType: "volatile", tickSpacing: null },
      { poolType: "cl", tickSpacing: 200 },
      { poolType: "cl", tickSpacing: 2000 },
    ] as const
    const names = labels.map((source) =>
      nameWithPoolType("BTC/MUSD", poolTypeLabel(source)),
    )
    expect(names).toEqual([
      "BTC/MUSD Volatile",
      "BTC/MUSD CL200",
      "BTC/MUSD CL2000",
    ])
    expect(new Set(names).size).toBe(3)
  })
})

describe("poolTypeDescription", () => {
  it("spells the label out", () => {
    expect(poolTypeDescription({ poolType: "volatile" })).toBe(
      "Basic volatile pool",
    )
    expect(poolTypeDescription({ poolType: "stable" })).toBe(
      "Basic stable pool",
    )
    expect(poolTypeDescription({ poolType: "cl", tickSpacing: 200 })).toBe(
      "Concentrated pool, tick spacing 200",
    )
    expect(poolTypeDescription({ poolType: "cl" })).toBe("Concentrated pool")
    expect(poolTypeDescription({ poolType: null })).toBeNull()
  })
})

describe("nameWithPoolType", () => {
  it("adds the label once", () => {
    expect(nameWithPoolType("BTC/MUSD", "CL200")).toBe("BTC/MUSD CL200")
    expect(nameWithPoolType("Aerodrome MEZO/MUSD CL200", "CL200")).toBe(
      "Aerodrome MEZO/MUSD CL200",
    )
    expect(nameWithPoolType("sMUSD", null)).toBe("sMUSD")
  })

  it("adds nothing for an empty label", () => {
    expect(nameWithPoolType("SNF", "")).toBe("SNF")
    expect(nameWithPoolType("SNF", " ")).toBe("SNF")
  })
})
