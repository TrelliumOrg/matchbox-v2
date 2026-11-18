import { describe, expect, it } from "vitest"
import { crossChainPools, tigrisPoolTypes } from "./crosschain"

describe("Tigris pool types", () => {
  it("name only pools the catalog lists, all Tigris pools on Mezo", () => {
    for (const id of Object.keys(tigrisPoolTypes)) {
      const pool = crossChainPools.find((each) => each.id === id)
      expect(pool?.venue).toBe("tigris")
      expect(pool?.chain).toBe("mezo")
    }
  })

  it("cover every Tigris pool, with a tick spacing for each concentrated one", () => {
    const tigris = crossChainPools.filter((pool) => pool.venue === "tigris")
    for (const pool of tigris) {
      const shape = tigrisPoolTypes[pool.id]
      expect(shape).toBeDefined()
      if (shape?.poolType === "cl") expect(shape.tickSpacing).toBeGreaterThan(0)
      else expect(shape?.tickSpacing).toBeNull()
    }
  })
})
