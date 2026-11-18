import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  asOfAt,
  cardGroups,
  emptyFigures,
  type HomeFigures,
} from "../data/figures"
import { fixtureFigures } from "../data/fixtures"
import {
  createPollLink,
  createRefresher,
  type LiveFigures,
  refreshAfterMs,
} from "./live"

/**
 * The refresh rules on a controlled clock: the fake timers drive the 5 s
 * deadline and the test's own `now` drives the 30 s spacing, so nothing
 * here depends on how fast the machine is.
 */

type Harness = {
  state: () => LiveFigures
  reads: () => number
  answer: (figures: HomeFigures) => void
  fail: () => void
  refresher: ReturnType<typeof createRefresher>
  advance: (ms: number) => void
  hide: () => void
}

function harness(seed: HomeFigures = emptyFigures): Harness {
  let state: LiveFigures = { figures: seed, waiting: true }
  let clock = 1_000_000
  let hidden = false
  const pending: {
    resolve: (figures: HomeFigures) => void
    reject: (error: Error) => void
  }[] = []
  const refresher = createRefresher({
    read: () =>
      new Promise<HomeFigures>((resolve, reject) => {
        pending.push({ resolve, reject })
      }),
    apply: (update) => {
      state = update(state)
    },
    visible: () => !hidden,
    timers: { now: () => clock },
  })
  return {
    state: () => state,
    reads: () => pending.length,
    answer: (figures) => pending.at(-1)?.resolve(figures),
    fail: () => pending.at(-1)?.reject(new Error("upstream")),
    refresher,
    advance: (ms) => {
      clock += ms
      vi.advanceTimersByTime(ms)
    },
    hide: () => {
      hidden = true
    },
  }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe("createRefresher", () => {
  it("swaps in the fresh figures and keeps slots the read did not fill", async () => {
    const seed = fixtureFigures(Date.UTC(2026, 10, 11, 5))
    const h = harness(seed)
    h.refresher.request("first")
    expect(h.reads()).toBe(1)
    h.answer({
      ...emptyFigures,
      pro: { incentivesUsd: "15000", gauges: null },
      at: { ...emptyFigures.at, summary: Date.UTC(2026, 10, 11, 6) },
    })
    await vi.waitFor(() =>
      expect(h.state().figures.pro.incentivesUsd).toBe("15000"),
    )
    expect(h.state().figures.pro.gauges).toEqual(seed.pro.gauges)
    expect(h.state().waiting).toBe(false)
  })

  it("keeps the old read times when the fresh request answers with old figures", async () => {
    // The edge's own upstream reads gave up, so it answered with the
    // values it read at 05:00; the request itself succeeded at 07:00.
    const readAt = Date.UTC(2026, 10, 11, 5)
    const now = Date.UTC(2026, 10, 11, 7)
    const h = harness(fixtureFigures(readAt))
    h.refresher.request("first")
    h.answer(fixtureFigures(readAt))
    await vi.waitFor(() => expect(h.state().waiting).toBe(false))
    const { figures, waiting } = h.state()
    expect(figures.at.summary).toBe(readAt)
    expect(asOfAt(figures.at, cardGroups.pro, now, waiting)).toBe(readAt)
    expect(asOfAt(figures.at, cardGroups.scan, now, waiting)).toBe(readAt)
  })

  it("re-reads on a new block only once the figures are 30 s old", async () => {
    const h = harness()
    h.refresher.request("first")
    h.answer(emptyFigures)
    await vi.waitFor(() => expect(h.reads()).toBe(1))
    h.advance(refreshAfterMs - 1)
    h.refresher.request("block")
    expect(h.reads()).toBe(1)
    h.advance(1)
    h.refresher.request("block")
    expect(h.reads()).toBe(2)
  })

  it("never asks twice at once", () => {
    const h = harness()
    h.refresher.request("first")
    h.refresher.request("epoch")
    expect(h.reads()).toBe(1)
  })

  it("does not re-read while the tab is hidden", () => {
    const h = harness()
    h.hide()
    h.advance(refreshAfterMs * 2)
    h.refresher.request("block")
    h.refresher.request("epoch")
    expect(h.reads()).toBe(0)
  })

  it("stops waiting at the 5 s deadline, then takes a late answer", async () => {
    const h = harness()
    h.refresher.request("first")
    h.advance(4_999)
    expect(h.state().waiting).toBe(true)
    h.advance(1)
    expect(h.state().waiting).toBe(false)
    h.answer({ ...emptyFigures, pro: { incentivesUsd: "1", gauges: null } })
    await vi.waitFor(() =>
      expect(h.state().figures.pro.incentivesUsd).toBe("1"),
    )
    expect(h.state().waiting).toBe(false)
  })

  it("stops waiting when the read fails", async () => {
    const h = harness()
    h.refresher.request("first")
    h.fail()
    await vi.waitFor(() => expect(h.state().waiting).toBe(false))
  })

  it("serves the head poll and the new block it reports with one read", async () => {
    // The fallback poll (no socket) learns the head from the figures
    // read; the head it reports must not cause a second read.
    const h = harness()
    const link = createPollLink(() => Promise.reject(new Error("unused")))
    link.attach(() => h.refresher.poll())
    h.advance(refreshAfterMs * 2)
    const head = link.pollLatest()
    expect(h.reads()).toBe(1)
    const fresh = fixtureFigures(Date.UTC(2026, 10, 11, 5))
    h.answer(fresh)
    const number = await head
    expect(number).toBe(fresh.scan.blocks?.[0]?.number)
    // What the poll's caller does next: set the head, which asks for a
    // re-read on the new block.
    h.refresher.request("block")
    expect(h.reads()).toBe(1)
    expect(h.state().figures.scan.blocks).toEqual(fresh.scan.blocks)
  })

  it("shares a read already out with a poll that comes during it", async () => {
    const h = harness()
    const link = createPollLink(() => Promise.reject(new Error("unused")))
    link.attach(() => h.refresher.poll())
    h.refresher.request("first")
    const head = link.pollLatest()
    expect(h.reads()).toBe(1)
    const fresh = fixtureFigures(Date.UTC(2026, 10, 11, 5))
    h.answer(fresh)
    await expect(head).resolves.toBe(fresh.scan.blocks?.[0]?.number)
  })

  it("lets a failed poll keep the last head", async () => {
    const h = harness()
    const link = createPollLink(() => Promise.reject(new Error("unused")))
    link.attach(() => h.refresher.poll())
    const head = link.pollLatest()
    h.fail()
    await expect(head).rejects.toThrow()
  })

  it("reads on its own before the cards attach, and after they detach", async () => {
    const fresh = fixtureFigures(Date.UTC(2026, 10, 11, 5))
    let reads = 0
    const link = createPollLink(() => {
      reads += 1
      return Promise.resolve(fresh)
    })
    await expect(link.pollLatest()).resolves.toBe(
      fresh.scan.blocks?.[0]?.number,
    )
    const detach = link.attach(() => Promise.resolve(null))
    detach()
    await link.pollLatest()
    expect(reads).toBe(2)
  })

  it("applies nothing once stopped", async () => {
    const h = harness()
    h.refresher.request("first")
    h.refresher.stop()
    h.answer({ ...emptyFigures, pro: { incentivesUsd: "1", gauges: null } })
    h.advance(10_000)
    await Promise.resolve()
    expect(h.state().figures.pro.incentivesUsd).toBeNull()
    expect(h.state().waiting).toBe(true)
  })
})
