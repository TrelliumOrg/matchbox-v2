import {
  demoPrices,
  demoWalletOverview,
  demoWalletRewards,
} from "@matchbox/contracts/read-models/fixtures"
import { describe, expect, it } from "vitest"
import { repriceWalletOverview, repriceWalletRewards } from "./reprice"

describe("repricing wallet documents", () => {
  it("leaves the demo figures unchanged at the demo prices", () => {
    const overview = repriceWalletOverview(demoWalletOverview, demoPrices)
    expect(overview.claimable.usd).toBe("212.48")
    expect(overview.locks.map((lock) => lock.claimable.usd)).toEqual([
      "203.78",
      "8.70",
    ])
    expect(overview.locks.map((lock) => lock.locked.usd)).toEqual([
      "84568.00",
      "8832.00",
    ])
  })

  it("moves current values with the price and keeps history", () => {
    const prices = {
      ...demoPrices,
      btc:
        demoPrices.btc === null ? null : { ...demoPrices.btc, usd: "100000" },
    }
    const overview = repriceWalletOverview(demoWalletOverview, prices)
    expect(overview.locks[0]?.locked.usd).toBe("80000.00")
    // 0.000412 BTC at $100,000 is $41.20; MEZO and MUSD are unchanged.
    expect(overview.claimable.usd).toBe("210.13")
    expect(overview.recentActivity).toEqual(demoWalletOverview.recentActivity)

    const rewards = repriceWalletRewards(demoWalletRewards, prices)
    expect(rewards.readyToClaim.usd).toBe("210.13")
    expect(rewards.byLock[0]?.gauges[0]?.usd).toBe("201.43")
    expect(rewards.history).toEqual(demoWalletRewards.history)
  })

  it("drops USD values when prices are missing", () => {
    const overview = repriceWalletOverview(demoWalletOverview, {
      btc: null,
      mezo: null,
    })
    expect(overview.locks[0]?.locked.usd).toBeNull()
    // Only MUSD, valued at $1, stays priced.
    expect(overview.claimable.usd).toBe("19.45")
  })
})
