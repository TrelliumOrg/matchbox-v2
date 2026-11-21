import { describe, expect, it, vi } from "vitest"

/**
 * "0 today so far" only when the copy is known to be current today: the
 * series' meta says the copy is not stale and its last ok run was today
 * (UTC). The series body is the fixture's, its meta replaced per test.
 */

const state = vi.hoisted(() => ({
  meta: undefined as Record<string, unknown> | undefined,
}))
vi.mock("cloudflare:workers", () => ({ env: { SCAN_DATA: "fixtures" } }))
vi.mock("@tanstack/react-start/server", () => ({
  getRequestHeader: () => undefined,
  setResponseHeader: () => undefined,
}))
vi.mock("./read.server", async () => {
  const { scanFixture } = await import("./fixtures")
  return {
    readScan: (
      path: string,
      query: URLSearchParams,
      schema: { parse: (body: unknown) => unknown },
    ) => {
      const answer = scanFixture(path, query, "normal")
      const { meta: _sent, ...body } = answer.body as Record<string, unknown>
      return {
        status: "ok",
        data: schema.parse(
          state.meta === undefined ? body : { ...body, meta: state.meta },
        ),
        skipped: 0,
      }
    },
  }
})

const { readSeries } = await import("./series.server")
const { fixtureNow } = await import("./fixtures/shared")

const midnight = Math.floor(fixtureNow / 86_400) * 86_400
// Five minutes after midnight UTC on the fixtures' day.
const now = midnight + 300
const today = new Date(midnight * 1000).toISOString().slice(0, 10)

async function lastPoint(meta: Record<string, unknown> | undefined) {
  state.meta = meta
  const read = await readSeries({ metric: "musd.repaid", days: 30, now })
  if (read.status !== "ok") throw new Error(read.status)
  return read.data.points.at(-1)
}

const healthy = {
  complete: false,
  asOf: midnight + 120,
  stale: false,
  refillPending: false,
}

describe("a copy-step flow with no row today", () => {
  it("ends at zero so far when the copy ran today and is healthy", async () => {
    expect(await lastPoint(healthy)).toMatchObject({
      day: today,
      decimal: "0",
      partial: true,
    })
  })

  it("adds no zero while copy runs are failing", async () => {
    const last = await lastPoint({ ...healthy, stale: true })
    expect(last?.day).not.toBe(today)
  })

  it("adds no zero while the copy has halted a table", async () => {
    // The API's meta for a halted table and no failing runs.
    const last = await lastPoint({
      ...healthy,
      asOf: midnight - 3_600,
      stale: true,
    })
    expect(last?.day).not.toBe(today)
  })

  it("adds no zero just after midnight, before the first copy run today", async () => {
    const last = await lastPoint({ ...healthy, asOf: midnight - 600 })
    expect(last?.day).not.toBe(today)
  })

  it("adds no zero before the first copy run of all (asOf null)", async () => {
    const last = await lastPoint({ ...healthy, asOf: null })
    expect(last?.day).not.toBe(today)
  })

  it("still adds the zero while only a re-fill is pending", async () => {
    expect(await lastPoint({ ...healthy, refillPending: true })).toMatchObject({
      day: today,
      decimal: "0",
      partial: true,
    })
  })

  it("adds no zero from an API that sends no meta, or meta without the fields", async () => {
    expect((await lastPoint(undefined))?.day).not.toBe(today)
    expect((await lastPoint({ complete: true }))?.day).not.toBe(today)
    expect((await lastPoint({ asOf: midnight + 120 }))?.day).not.toBe(today)
    expect((await lastPoint({ stale: false }))?.day).not.toBe(today)
  })

  it("reads a malformed meta as unknown, not as a failed series", async () => {
    expect((await lastPoint({ asOf: "today", stale: "no" }))?.day).not.toBe(
      today,
    )
  })
})
