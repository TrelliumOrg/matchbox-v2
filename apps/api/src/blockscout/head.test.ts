import { describe, expect, it, vi } from "vitest"
import { createHeadReader, createIndexingReader, unknownClock } from "./head"

describe("createHeadReader", () => {
  it("treats a head the hub served from storage as unknown", async () => {
    // BlockHub answers its last saved head (stored: true) when its first
    // poll after a sleep is slow or fails: not the current head.
    const clock = createHeadReader({
      read: async () =>
        Response.json({
          data: { block: 7, timestamp: 1, lastActiveBlock: 7, stored: true },
        }),
    })
    expect(await clock()).toEqual(unknownClock)
    const live = createHeadReader({
      read: async () =>
        Response.json({
          data: { block: 8, timestamp: 1, lastActiveBlock: 8, stored: false },
        }),
    })
    expect(await live()).toEqual({ height: 8, lastActive: 8 })
  })

  it("reads BlockHub once per window and shares the read", async () => {
    let now = 0
    let reads = 0
    let block = 100
    const clock = createHeadReader({
      now: () => now,
      read: async () => {
        reads += 1
        return Response.json({
          data: { block, timestamp: 1, lastActiveBlock: block - 3 },
        })
      },
    })
    const first = { height: 100, lastActive: 97 }
    expect(await Promise.all([clock(), clock(), clock()])).toEqual([
      first,
      first,
      first,
    ])
    expect(reads).toBe(1)
    block = 101
    now = 999
    expect(await clock()).toEqual(first)
    now = 1_000
    expect(await clock()).toEqual({ height: 101, lastActive: 98 })
    expect(reads).toBe(2)
  })

  it("reads a hub without lastActiveBlock as activity unknown", async () => {
    const clock = createHeadReader({
      read: async () => Response.json({ data: { block: 7, timestamp: 1 } }),
    })
    expect(await clock()).toEqual({ height: 7, lastActive: null })
  })

  it("answers unknown when BlockHub fails or answers nonsense", async () => {
    let now = 0
    const responses = [
      () => Promise.reject(new Error("down")),
      () => Promise.resolve(new Response("no", { status: 503 })),
      () => Promise.resolve(Response.json({ data: { block: "12" } })),
    ]
    let call = 0
    const clock = createHeadReader({
      now: () => now,
      read: () => {
        const next = responses[call] ?? responses[0]
        call += 1
        if (next === undefined) throw new Error("no response")
        return next()
      },
    })
    for (let index = 0; index < responses.length; index += 1) {
      expect(await clock()).toEqual(unknownClock)
      now += 1_000
    }
  })

  it("gives up on a slow hub after the timeout, without waiting for it", async () => {
    let release: () => void = () => undefined
    const slow = new Promise<void>((resolve) => {
      release = resolve
    })
    const clock = createHeadReader({
      timeoutMs: 20,
      read: async () => {
        await slow
        return Response.json({ data: { block: 5, timestamp: 1 } })
      },
    })
    // The read cannot settle until `release()` below, so an answer at all
    // is the timeout's own: no wall-clock bound needed.
    expect(await clock()).toEqual(unknownClock)
    // The read finishes later and serves the rest of its window.
    release()
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(await clock()).toEqual({ height: 5, lastActive: null })
  })
})

describe("createIndexingReader", () => {
  it("reads Blockscout's block indexing once a minute", async () => {
    let now = 0
    let reads = 0
    let finished = false
    const indexed = createIndexingReader({
      now: () => now,
      read: async () => {
        reads += 1
        return Response.json({
          finished_indexing: false,
          finished_indexing_blocks: finished,
          indexed_blocks_ratio: finished ? "1.00" : "0.97",
        })
      },
    })
    expect(await indexed()).toBe(false)
    finished = true
    now += 59_000
    expect(await indexed()).toBe(false)
    now += 1_000
    expect(await indexed()).toBe(true)
    expect(reads).toBe(2)
  })

  it("answers unknown when a read takes over 500 ms, and reuses it later", async () => {
    vi.useFakeTimers()
    try {
      let release: (response: Response) => void = () => {}
      const indexed = createIndexingReader({
        now: () => 0,
        read: () =>
          new Promise<Response>((resolve) => {
            release = resolve
          }),
      })
      const first = indexed()
      let settled: boolean | null | undefined
      void first.then((value) => {
        settled = value
      })
      await vi.advanceTimersByTimeAsync(499)
      expect(settled).toBeUndefined()
      await vi.advanceTimersByTimeAsync(1)
      expect(settled).toBeNull()
      // The slow read still lands, and the next caller gets it.
      release(Response.json({ finished_indexing_blocks: true }))
      expect(await indexed()).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it("answers unknown on a failure or an unexpected body", async () => {
    const failing = createIndexingReader({
      read: async () => new Response("nope", { status: 503 }),
    })
    expect(await failing()).toBeNull()
    const odd = createIndexingReader({
      read: async () => Response.json({ finished_indexing_blocks: "yes" }),
    })
    expect(await odd()).toBeNull()
    const thrown = createIndexingReader({
      read: () => Promise.reject(new Error("backoff")),
    })
    expect(await thrown()).toBeNull()
  })
})
