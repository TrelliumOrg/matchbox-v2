import type { ChainHead, Prices } from "@matchbox/contracts/read-models"
import { describe, expect, it, vi } from "vitest"
import {
  type MarketReads,
  type MarketTiming,
  readMarketInputs,
} from "./market-inputs"

const live: ChainHead = { block: 13_100_000, timestamp: 1_794_000_000 }
const indexed: ChainHead = { block: 13_099_930, timestamp: 1_793_999_700 }
const prices: Prices = { btc: null, mezo: null }

/** A clock the test moves: `wait(ms)` resolves when `advance` passes it. */
function clock() {
  let now = 0
  const sleepers: { at: number; wake: () => void }[] = []
  const timing: MarketTiming = {
    hedgeAfterMs: 150,
    deadlineMs: 450,
    wait: (ms) =>
      new Promise((resolve) => {
        sleepers.push({ at: now + ms, wake: resolve })
      }),
  }
  async function advance(ms: number): Promise<void> {
    now += ms
    for (const sleeper of sleepers.filter((entry) => entry.at <= now)) {
      sleepers.splice(sleepers.indexOf(sleeper), 1)
      sleeper.wake()
    }
    // Let the code that was waiting run.
    for (let turn = 0; turn < 10; turn += 1) await Promise.resolve()
  }
  return { timing, advance }
}

/** A read the test answers by hand. */
function pending<T>() {
  let resolve: (value: T) => void = () => {}
  let reject: (reason: unknown) => void = () => {}
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

function reads(overrides: Partial<MarketReads> = {}): MarketReads {
  return {
    head: async () => live,
    prices: async () => prices,
    indexedHead: vi.fn(async () => indexed),
    ...overrides,
  }
}

const unavailable = async (): Promise<never> => {
  throw new Error("Read model /internal/pro/head failed with 503")
}

describe("readMarketInputs", () => {
  it("uses a prompt live head and never asks for the indexed one", async () => {
    const all = reads()
    expect(await readMarketInputs(all, clock().timing)).toEqual({
      head: live,
      prices,
      degraded: [],
    })
    expect(all.indexedHead).not.toHaveBeenCalled()
  })

  it("starts from the last indexed block when the live head fails", async () => {
    expect(
      await readMarketInputs(reads({ head: unavailable }), clock().timing),
    ).toEqual({ head: indexed, prices, degraded: ["head"] })
  })

  it("does not wait for a live head that is waking up", async () => {
    const { timing, advance } = clock()
    const slow = pending<ChainHead>()
    const all = reads({ head: () => slow.promise })
    let result: Awaited<ReturnType<typeof readMarketInputs>> | null = null
    void readMarketInputs(all, timing).then((value) => {
      result = value
    })
    await advance(149)
    expect(all.indexedHead).not.toHaveBeenCalled()
    // Past the hedge: the indexed head is read alongside.
    await advance(1)
    expect(all.indexedHead).toHaveBeenCalledTimes(1)
    expect(result).toBeNull()
    // Past the deadline: the page goes without the live head.
    await advance(300)
    expect(result).toEqual({ head: indexed, prices, degraded: ["head"] })
    // The live head arriving later changes nothing and breaks nothing.
    slow.resolve(live)
    await advance(0)
    expect(result).toEqual({ head: indexed, prices, degraded: ["head"] })
  })

  it("still takes a live head that arrives before the deadline", async () => {
    const { timing, advance } = clock()
    const slow = pending<ChainHead>()
    const all = reads({ head: () => slow.promise })
    let result: Awaited<ReturnType<typeof readMarketInputs>> | null = null
    void readMarketInputs(all, timing).then((value) => {
      result = value
    })
    await advance(200)
    expect(all.indexedHead).toHaveBeenCalledTimes(1)
    slow.resolve(live)
    await advance(0)
    expect(result).toEqual({ head: live, prices, degraded: [] })
  })

  it("covers a live head that fails after the hedge began", async () => {
    const { timing, advance } = clock()
    const slow = pending<ChainHead>()
    let result: Awaited<ReturnType<typeof readMarketInputs>> | null = null
    void readMarketInputs(reads({ head: () => slow.promise }), timing).then(
      (value) => {
        result = value
      },
    )
    await advance(200)
    slow.reject(new Error("503"))
    await advance(0)
    expect(result).toEqual({ head: indexed, prices, degraded: ["head"] })
  })

  it("shows no prices when they cannot be read", async () => {
    expect(
      await readMarketInputs(reads({ prices: unavailable }), clock().timing),
    ).toEqual({
      head: live,
      prices: { btc: null, mezo: null },
      degraded: ["prices"],
    })
  })

  it("covers both reads failing at once", async () => {
    expect(
      await readMarketInputs(
        reads({ head: unavailable, prices: unavailable }),
        clock().timing,
      ),
    ).toEqual({
      head: indexed,
      prices: { btc: null, mezo: null },
      degraded: ["head", "prices"],
    })
  })

  it("rejects when no head can be read at all", async () => {
    await expect(
      readMarketInputs(
        reads({ head: unavailable, indexedHead: unavailable }),
        clock().timing,
      ),
    ).rejects.toThrow("503")
  })

  it("leaves no unhandled rejection when the indexed read fails but is not needed", async () => {
    const { timing, advance } = clock()
    const slow = pending<ChainHead>()
    let result: Awaited<ReturnType<typeof readMarketInputs>> | null = null
    void readMarketInputs(
      reads({ head: () => slow.promise, indexedHead: unavailable }),
      timing,
    ).then((value) => {
      result = value
    })
    await advance(200)
    slow.resolve(live)
    await advance(0)
    expect(result).toEqual({ head: live, prices, degraded: [] })
  })
})
