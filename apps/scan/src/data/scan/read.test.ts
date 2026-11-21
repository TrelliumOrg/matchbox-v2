import { beforeEach, describe, expect, it, vi } from "vitest"
import { z } from "zod"

/**
 * readScan against a fake API binding: rows the API skipped, a stale
 * cursor restarting the list, and private documents keeping the page out
 * of shared caches.
 */

const state = vi.hoisted(() => ({
  env: {} as Record<string, unknown>,
  response: new Map<string, string>(),
}))

vi.mock("cloudflare:workers", () => ({ env: state.env }))
vi.mock("@tanstack/react-start/server", () => ({
  getRequestHeader: () => undefined,
  setResponseHeader: (name: string, value: string) => {
    state.response.set(name, value)
  },
}))
vi.mock("@matchbox/logger", () => ({
  createLogger: () => ({ error: () => {}, warn: () => {}, info: () => {} }),
}))

const { readScan, privateAnswer, routeOf, skippedOf } = await import(
  "./read.server"
)

const pageSchema = z.object({
  data: z.array(z.number()),
  nextCursor: z.string().nullable(),
  meta: z.object({ skipped: z.number() }).optional(),
})

function api(answer: (url: URL) => Response): URL[] {
  const seen: URL[] = []
  state.env.API = {
    fetch: async (request: Request) => {
      const url = new URL(request.url)
      seen.push(url)
      return answer(url)
    },
  }
  return seen
}

beforeEach(() => {
  for (const key of Object.keys(state.env)) delete state.env[key]
  state.env.SCAN_DATA = "api"
  state.response.clear()
})

describe("readScan", () => {
  it("reports rows the API left out", async () => {
    api(() =>
      Response.json({ data: [1, 2], nextCursor: null, meta: { skipped: 2 } }),
    )
    const read = await readScan("locks", new URLSearchParams(), pageSchema)
    expect(read).toMatchObject({ status: "ok", skipped: 2 })
    expect(state.response.has("x-scan-degraded")).toBe(false)
  })

  it("restarts a list from the top when its cursor is refused", async () => {
    const seen = api((url) =>
      url.searchParams.has("cursor")
        ? Response.json({ error: { code: "invalid_request" } }, { status: 400 })
        : Response.json({
            data: [1],
            nextCursor: "next-1",
            meta: { skipped: 0 },
          }),
    )
    const read = await readScan(
      "locks",
      new URLSearchParams({ escrow: "vebtc", cursor: "old-shape" }),
      pageSchema,
    )
    expect(read).toMatchObject({ status: "ok", restarted: true, skipped: 0 })
    expect(seen.map((url) => url.searchParams.get("cursor"))).toEqual([
      "old-shape",
      null,
    ])
    expect(seen[1]?.searchParams.get("escrow")).toBe("vebtc")
  })

  it("treats a refused query without a cursor as unavailable", async () => {
    api(() => Response.json({}, { status: 400 }))
    const read = await readScan("locks", new URLSearchParams(), pageSchema)
    expect(read).toEqual({ status: "unavailable" })
    expect(state.response.get("x-scan-degraded")).toBe("1")
  })

  it("keeps a page showing a private document out of shared caches", async () => {
    api(() =>
      Response.json(
        { data: [], nextCursor: null },
        { headers: { "cache-control": "private, no-store" } },
      ),
    )
    const read = await readScan(
      "entities/address/0xab",
      new URLSearchParams(),
      pageSchema,
    )
    expect(read.status).toBe("ok")
    expect(state.response.get("x-scan-degraded")).toBe("1")
  })

  it("reads skipped and private from their sources", () => {
    expect(skippedOf({ meta: { skipped: 3 } })).toBe(3)
    expect(skippedOf({ meta: { complete: true } })).toBe(0)
    expect(skippedOf({ data: [] })).toBe(0)
    expect(privateAnswer("public, max-age=3")).toBe(false)
    expect(privateAnswer("private, no-store")).toBe(true)
    expect(privateAnswer(null)).toBe(false)
  })

  it("degrades one read, not the page, when a 200 is not JSON", async () => {
    api(() => new Response("<html>cut off", { status: 200 }))
    const read = await readScan("locks", new URLSearchParams(), pageSchema)
    expect(read).toEqual({ status: "unavailable" })
    expect(state.response.get("x-scan-degraded")).toBe("1")
  })

  it("answers a read the API never finishes as unavailable, at the deadline", async () => {
    // What ended the read is asserted, not how long it took: the timer
    // behind AbortSignal.timeout counts from the event loop's cached time,
    // so after a busy stretch on a slow runner it fires early by the wall
    // clock (2,330 ms was measured for 3,000).
    let reason: unknown
    state.env.API = {
      fetch: (request: Request) =>
        new Promise((_, reject) => {
          request.signal.addEventListener("abort", () => {
            reason = request.signal.reason
            reject(request.signal.reason)
          })
        }),
    }
    const read = await readScan("locks", new URLSearchParams(), pageSchema)
    expect(read).toEqual({ status: "unavailable" })
    expect(reason).toMatchObject({ name: "TimeoutError" })
  }, 10_000)
  it("tries a read that failed in passing once more before giving up", async () => {
    let calls = 0
    api(() => {
      calls += 1
      return calls === 1
        ? Response.json({ error: { code: "internal_error" } }, { status: 500 })
        : Response.json({ data: [7], nextCursor: null })
    })
    const read = await readScan("locks", new URLSearchParams(), pageSchema)
    expect(read).toMatchObject({ status: "ok", data: { data: [7] } })
    expect(calls).toBe(2)
    // Answered in the end: the page may be stored.
    expect(state.response.has("x-scan-degraded")).toBe(false)
  })

  it("tries a read that was unreachable once more", async () => {
    let calls = 0
    state.env.API = {
      fetch: async () => {
        calls += 1
        if (calls === 1) throw new TypeError("Network connection lost")
        return Response.json({ data: [1], nextCursor: null })
      },
    }
    const read = await readScan("locks", new URLSearchParams(), pageSchema)
    expect(read.status).toBe("ok")
    expect(calls).toBe(2)
  })

  it("says unavailable after the second failure, and the page is degraded", async () => {
    const seen = api(() =>
      Response.json({ error: { code: "internal_error" } }, { status: 502 }),
    )
    const read = await readScan("locks", new URLSearchParams(), pageSchema)
    expect(read).toEqual({ status: "unavailable" })
    expect(seen).toHaveLength(2)
    expect(state.response.get("x-scan-degraded")).toBe("1")
  })

  it("does not ask again for a limit, a switched-off route or a 404", async () => {
    for (const [status, expected] of [
      [429, "rate-limited"],
      [503, "disabled"],
      [404, "missing"],
    ] as const) {
      const seen = api(() => Response.json({}, { status }))
      const read = await readScan("locks", new URLSearchParams(), pageSchema)
      expect(read.status).toBe(expected)
      expect(seen).toHaveLength(1)
    }
  })

  it("leaves no time for a retry past the budget", async () => {
    const seen = api(() => Response.json({}, { status: 500 }))
    const read = await readScan(
      "locks",
      new URLSearchParams(),
      pageSchema,
      // Less than a retry needs.
      900,
    )
    expect(read).toEqual({ status: "unavailable" })
    expect(seen).toHaveLength(1)
  })

  it("logs a read's route without its address, hash or number", () => {
    expect(
      routeOf(
        `entities/address/0x${"ab".repeat(20)}/x/0x${"cd".repeat(32)}/locks/vebtc/6033`,
      ),
    ).toBe("entities/address/{address}/x/{hash}/locks/vebtc/{n}")
  })
})
