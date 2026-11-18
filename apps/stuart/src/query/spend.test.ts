import { describe, expect, it } from "vitest"
import { emptyUsage, estimateCostMicroUsd } from "./claude"
import { createSpendMeter, memorySpendBucket, spendKey } from "./spend"

const NOW = Date.parse("2026-11-08T23:59:00.000Z")

describe("daily spend cap", () => {
  it("prices a turn from the current rate cards, in micro-USD", () => {
    const usage = {
      ...emptyUsage(),
      input: 1_000,
      output: 500,
      cacheWrite: 2_000,
      cacheRead: 10_000,
    }
    // Opus 5.5: 1000*4000 + 500*20000 + 2000*5000 + 10000*200 nano-USD.
    expect(estimateCostMicroUsd("claude-opus-5-5", usage)).toBe(26_000n)
    // Sonnet 5.5: 1000*2000 + 500*10000 + 2000*2500 + 10000*100.
    expect(estimateCostMicroUsd("claude-sonnet-5-5", usage)).toBe(13_000n)
    expect(estimateCostMicroUsd("claude-haiku-5-5", usage)).toBe(700n)
    // Unknown models are metered at the dearest rate.
    expect(estimateCostMicroUsd("claude-next", usage)).toBe(26_000n)
  })

  it("caps once the day's budget is spent and fills the bucket on overflow", async () => {
    const bucket = memorySpendBucket(() => NOW)
    const meter = createSpendMeter({
      bucket,
      budgetMicroUsd: 50_000n,
      forced: false,
      now: () => NOW,
    })
    expect(await meter.check()).toEqual({ capped: false })
    await meter.record(30_000n)
    expect(await meter.check()).toEqual({ capped: false })
    // 30k + 30k overflows 50k: the bucket fills to the budget.
    await meter.record(30_000n)
    const capped = await meter.check()
    expect(capped).toEqual({ capped: true, retryAfterSeconds: 60 })
    const snapshot = await bucket.peek(spendKey(NOW))
    expect(snapshot.state.day?.count).toBe(50_000)
    expect(spendKey(NOW)).toBe("stuart-spend:2026-11-08")
  })

  it("forces the cap with the flag", async () => {
    const meter = createSpendMeter({
      bucket: memorySpendBucket(() => NOW),
      budgetMicroUsd: 25_000_000n,
      forced: true,
      now: () => NOW,
    })
    expect(await meter.check()).toMatchObject({ capped: true })
  })

  it("caps one IP prefix at its own budget, leaving the day's for others", async () => {
    const bucket = memorySpendBucket(() => NOW)
    const meterFor = (key: string) =>
      createSpendMeter({
        bucket,
        budgetMicroUsd: 25_000_000n,
        visitor: { key, budgetMicroUsd: 3_000_000n },
        forced: false,
        now: () => NOW,
      })
    const busy = meterFor("203.0.113.0/24")
    await busy.record(2_000_000n)
    expect(await busy.check()).toEqual({ capped: false })
    // Over its 3 USD: this prefix is capped until the next UTC day.
    await busy.record(2_000_000n)
    expect(await busy.check()).toEqual({ capped: true, retryAfterSeconds: 60 })
    // Another prefix still has the day's budget.
    expect(await meterFor("198.51.100.0/24").check()).toEqual({
      capped: false,
    })
    // The day's bucket counted both turns.
    const day = await bucket.peek(spendKey(NOW))
    expect(day.state.day?.count).toBe(4_000_000)
    expect(spendKey(NOW, "203.0.113.0/24")).toBe(
      "stuart-spend:2026-11-08:ip:203.0.113.0/24",
    )
  })
})
