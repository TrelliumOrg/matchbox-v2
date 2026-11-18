import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({
  env: { SCAN_DATA: "fixtures" } as Record<string, unknown>,
  headers: new Map<string, string>(),
}))
vi.mock("cloudflare:workers", () => ({ env: state.env }))
vi.mock("@tanstack/react-start/server", () => ({
  getRequestHeader: () => undefined,
  setResponseHeader: (name: string, value: string) => {
    state.headers.set(name, value)
  },
}))

const { gaugesPage } = await import("./gauges.server")
const { epochsPage } = await import("./epochs.server")
const { lockPage } = await import("./locks.server")
const { nowSeconds } = await import("./clock.server")
const { epochStart, fixtureNow } = await import("./scan/fixtures/shared")
const { gauges } = await import("./scan/fixtures/world")

/**
 * Which epoch a voting page shows, at the Thursday rollover and on any
 * real date in fixtures mode: one source of truth per page, never Pro's
 * epoch beside Scan's clock.
 */

describe("the gauges directory at the Thursday rollover", () => {
  // 30 s into Epoch 48, while Pro's directory still holds Epoch 47.
  const boundary = epochStart(48) + 30

  // The clock itself stands on the boundary too, whatever today is.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(boundary * 1000)
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it("takes voters from the directory's epoch, not the clock's", async () => {
    const page = await gaugesPage({ type: "all", sort: "votes" }, boundary)
    expect(page.directory.status).toBe("ok")
    if (page.directory.status !== "ok") return
    const view = page.directory.data
    expect(view.epoch.number).toBe(47)
    const kiln = view.rows.find((row) => row.gauge.address === gauges.kilnLabs)
    expect(kiln?.voters).toBe("41")
  })

  it("says the epoch closed instead of a negative countdown", async () => {
    const page = await gaugesPage({ type: "all", sort: "votes" }, boundary)
    if (page.directory.status !== "ok") throw new Error("no directory")
    expect(page.directory.data.epoch.closesIn).toBeNull()
  })

  it("marks the directory's epoch as current in emissions", async () => {
    const page = await gaugesPage({ type: "all", sort: "votes" }, boundary)
    if (page.emissions.status !== "ok" || page.emissions.data === null) {
      throw new Error("no emissions")
    }
    const current = page.emissions.data.bars.find((bar) => bar.current)
    expect(current?.epoch).toBe(47)
  })
})

describe("fixtures mode on a later real date", () => {
  // Thu 19 Nov 2026, Epoch 48 by the clock; the fixture world is Epoch 47.
  const later = epochStart(48) + 7 * 86_400 - 3_600

  it("pins the server's now to the fixture world's", () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(later * 1000)
    try {
      expect(nowSeconds()).toBe(fixtureNow)
    } finally {
      vi.useRealTimers()
    }
  })

  it("shows Epoch 47 on the epochs, gauges and lock pages", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(later * 1000)
    try {
      const epochs = await epochsPage({ cursor: null })
      expect(
        epochs.current.status === "ok" && epochs.current.data,
      ).toMatchObject({ computed: true, span: { number: 47 } })
      const directory = await gaugesPage({ type: "all", sort: "votes" })
      expect(
        directory.directory.status === "ok" &&
          directory.directory.data.epoch.closesIn,
      ).not.toBeNull()
      const lock = await lockPage({ escrow: "vemezo", id: "2207" })
      expect(lock.epoch).toBe(47)
    } finally {
      vi.useRealTimers()
    }
  })
})
