import { describe, expect, it } from "vitest"
import {
  coingeckoBudget,
  demoMonthlyCalls,
  demoPlannedCalls,
  poolCallsPerMonth,
  priceCacheMaxAgeSeconds,
  priceCallEveryMinutes,
  priceCallsPerMonth,
  refreshSeconds,
} from "./coingecko-budget"
import { poolDepthChains } from "./crosschain/pools"

const minute = (n: number) => n * 60

describe("CoinGecko call budget", () => {
  it("defaults by plan and keeps a Demo key at 300 s or slower", () => {
    expect(refreshSeconds("demo", false, null)).toBe(90)
    expect(refreshSeconds("pro", true, null)).toBe(90)
    expect(refreshSeconds("demo", true, null)).toBe(360)
    expect(refreshSeconds("demo", true, 90)).toBe(300)
    expect(refreshSeconds("demo", true, 600)).toBe(600)
    expect(refreshSeconds("pro", true, 30)).toBe(30)
  })

  it("rounds the price cadence up to an even minute", () => {
    expect(priceCallEveryMinutes(90)).toBe(2)
    expect(priceCallEveryMinutes(300)).toBe(6)
    expect(priceCallEveryMinutes(360)).toBe(6)
    expect(priceCallEveryMinutes(361)).toBe(8)
    expect(priceCallsPerMonth(360)).toBe(7_440)
    expect(priceCallsPerMonth(300)).toBe(7_440)
  })

  it("plans a Demo key at 8,556 calls in a 31-day month", () => {
    const chains = poolDepthChains().length
    expect(chains).toBe(3)
    expect(poolCallsPerMonth(1, chains)).toBe(2_232)
    expect(poolCallsPerMonth(2, chains)).toBe(1_116)
    for (const configured of [null, 300, 360, 1]) {
      const budget = coingeckoBudget({
        plan: "demo",
        hasKey: true,
        configuredRefreshSeconds: configured,
        poolChains: chains,
      })
      // Hourly pools (9,672) would leave too little margin; two-hourly fit.
      expect(budget.keyedPoolsEveryHours).toBe(2)
      expect(budget.priceCallsPerMonth).toBe(7_440)
      expect(budget.keyedPoolCallsPerMonth).toBe(1_116)
      expect(budget.plannedCallsPerMonth).toBe(8_556)
      expect(budget.plannedCallsPerMonth ?? 0).toBeLessThanOrEqual(
        demoPlannedCalls,
      )
      expect(demoMonthlyCalls - (budget.plannedCallsPerMonth ?? 0)).toBe(1_444)
    }
  })

  it("slows the pools further, or turns them off, when the price job needs more", () => {
    const slow = coingeckoBudget({
      plan: "demo",
      hasKey: true,
      configuredRefreshSeconds: 480,
      poolChains: 3,
    })
    // 8-minute price calls: 5,580, which leaves room for hourly pools.
    expect(slow.priceCallsPerMonth).toBe(5_580)
    expect(slow.keyedPoolsEveryHours).toBe(1)
    const crowded = coingeckoBudget({
      plan: "demo",
      hasKey: true,
      configuredRefreshSeconds: 300,
      poolChains: 50,
    })
    // 50 calls a read: daily (1,550) is the only interval that fits.
    expect(crowded.keyedPoolsEveryHours).toBe(24)
    expect(crowded.plannedCallsPerMonth ?? 0).toBeLessThanOrEqual(
      demoPlannedCalls,
    )
    const full = coingeckoBudget({
      plan: "demo",
      hasKey: true,
      configuredRefreshSeconds: 300,
      poolChains: 60,
    })
    expect(full.keyedPoolsEveryHours).toBeNull()
    expect(full.plannedCallsPerMonth).toBe(7_440)
  })

  it("uses no keyed pool calls without a key, and hourly ones on a paid plan", () => {
    const keyless = coingeckoBudget({
      plan: "demo",
      hasKey: false,
      configuredRefreshSeconds: null,
      poolChains: 3,
    })
    expect(keyless.keyedPoolsEveryHours).toBeNull()
    expect(keyless.keyedPoolCallsPerMonth).toBe(0)
    const pro = coingeckoBudget({
      plan: "pro",
      hasKey: true,
      configuredRefreshSeconds: null,
      poolChains: 3,
    })
    expect(pro.keyedPoolsEveryHours).toBe(1)
    expect(pro.plannedCallsPerMonth).toBeNull()
  })

  it("calls only on a KV publish minute, one cadence after the last read", () => {
    // Simulates the price job for a day with up to 20 s of start jitter:
    // a reading is reused while younger than the max age, and only a
    // publish (even) minute's reading reaches KV for the next run.
    for (const refresh of [90, 300, 360]) {
      let lastRead: number | null = null
      let calls = 0
      for (let m = 0; m < 24 * 60; m += 1) {
        const now = minute(m) + ((m * 7) % 21)
        const maxAge = priceCacheMaxAgeSeconds(now, refresh)
        const reuse = lastRead !== null && now - lastRead < maxAge
        if (!reuse) {
          calls += 1
          expect(m % 2, `refresh ${refresh}, minute ${m}`).toBe(0)
          lastRead = now
        }
      }
      expect(calls).toBe((24 * 60) / priceCallEveryMinutes(refresh))
    }
  })
})
