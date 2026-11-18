import { describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({
  env: { SCAN_DATA: "fixtures" } as Record<string, unknown>,
}))
vi.mock("cloudflare:workers", () => ({ env: state.env }))
vi.mock("@tanstack/react-start/server", () => ({
  getRequestHeader: () => undefined,
  setResponseHeader: () => undefined,
}))

const { metric } = await import("./series")
const { readSeries } = await import("./series.server")
const { fixtureNow } = await import("./fixtures/shared")

describe("series", () => {
  it("names only registered metrics", () => {
    expect(metric("locks.net")).toBe("locks.net")
    expect(() => metric("locks.nope")).toThrow(/not in the registry/)
  })

  it("reads a series with today in progress and the registry's kind", async () => {
    const read = await readSeries({
      metric: "locks.net",
      dimension: "vebtc",
      days: 30,
      now: fixtureNow,
    })
    expect(read.status).toBe("ok")
    if (read.status !== "ok") return
    expect(read.data.kind).toBe("flow")
    expect(read.data.points).toHaveLength(30)
    expect(read.data.points.at(-1)?.partial).toBe(true)
    expect(read.data.latest?.partial).toBe(true)
    expect(read.data.endsOn).toBeNull()
  })

  it("says where a backfill-only series ends", async () => {
    const read = await readSeries({
      metric: "chain.active_addresses",
      days: 90,
      now: fixtureNow,
    })
    expect(read.status === "ok" && read.data.endsOn).toBe("2026-10-31")
  })

  it("takes a market series' token decimals from the caller", async () => {
    const market = `0x${"6f".repeat(32)}`
    const unknown = await readSeries({
      metric: "morpho.total_borrow",
      dimension: market,
      days: 30,
      now: fixtureNow,
    })
    expect(unknown.status).toBe("unavailable")
    const read = await readSeries({
      metric: "morpho.total_borrow",
      dimension: market,
      days: 30,
      now: fixtureNow,
      tokenDecimals: 18,
    })
    expect(read.status).toBe("ok")
    if (read.status !== "ok") return
    expect(read.data.kind).toBe("level")
    expect(read.data.points).toHaveLength(30)
  })

  it("never draws a token amount without its decimals", async () => {
    const read = await readSeries({
      metric: "incentives.deposited",
      dimension: `0x${"ab".repeat(20)}`,
      days: 30,
      now: fixtureNow,
    })
    expect(read.status).toBe("unavailable")
  })
})
