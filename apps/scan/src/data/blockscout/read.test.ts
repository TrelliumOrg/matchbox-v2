import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { z } from "zod"

/**
 * The proxy reader over a fake API binding: caller headers on every read,
 * and a failed, rate-limited or malformed read marks the page degraded
 * (never cached) and comes back as that section's state, never a throw.
 */

const state = vi.hoisted(() => ({
  env: {} as Record<string, unknown>,
  responseHeaders: new Map<string, string>(),
  requestHeaders: new Map<string, string>(),
  request: null as Request | null,
}))

vi.mock("cloudflare:workers", () => ({ env: state.env }))
vi.mock("@tanstack/react-start/server", () => ({
  getRequest: () => {
    if (state.request === null) throw new Error("No request")
    return state.request
  },
  getRequestHeader: (name: string) => state.requestHeaders.get(name),
  setResponseHeader: (name: string, value: string) => {
    state.responseHeaders.set(name, value)
  },
}))
const logged = vi.hoisted(() => ({ errors: [] as string[] }))
vi.mock("@matchbox/logger", () => ({
  createLogger: () => ({
    error: (entry: { message: string }) => logged.errors.push(entry.message),
    warn: () => {},
    info: () => {},
  }),
}))

const { canonicalQuery, readBlockscout } = await import("./read.server")
const { fetchApi, resetSaltWarning } = await import("../caller.server")

const schema = z.object({ height: z.number() })

function api(answer: (request: Request) => Response | Promise<Response>) {
  const seen: Request[] = []
  state.env.API = {
    fetch: async (request: Request) => {
      seen.push(request)
      return answer(request)
    },
  }
  return seen
}

beforeEach(() => {
  for (const key of Object.keys(state.env)) delete state.env[key]
  state.env.SCAN_DATA = "api"
  state.env.API_ORIGIN = "https://api.test"
  state.responseHeaders.clear()
  state.requestHeaders.clear()
})

afterEach(() => {
  vi.useRealTimers()
})

describe("readBlockscout", () => {
  it("reads the proxy path with the caller headers", async () => {
    state.env.BLOCKSCOUT_CALLER_SALT = "s".repeat(32)
    state.requestHeaders.set("cf-connecting-ip", "203.0.113.7")
    const seen = api(() => Response.json({ height: 7, extra: true }))
    const read = await readBlockscout(
      "blocks/7",
      canonicalQuery({ b: 2, a: 1, none: null }),
      schema,
    )
    expect(read).toEqual({ status: "ok", data: { height: 7 } })
    const request = seen[0]
    expect(request?.url).toBe(
      "https://api.internal/internal/blockscout/api/v2/blocks/7?a=1&b=2",
    )
    expect(request?.headers.get("x-matchbox-client")).toBe("matchscan-v2")
    expect(request?.headers.get("x-matchbox-end-user")).toMatch(
      /^[A-Za-z0-9_-]{22,64}$/,
    )
    expect(request?.headers.get("x-matchbox-end-user")).not.toContain("203")
    expect(state.responseHeaders.size).toBe(0)
  })

  it("is missing on a 404 without degrading the page", async () => {
    api(() => new Response("{}", { status: 404 }))
    expect(
      await readBlockscout("blocks/1", new URLSearchParams(), schema),
    ).toEqual({ status: "missing" })
    expect(state.responseHeaders.has("x-scan-degraded")).toBe(false)
  })

  it("degrades on a rate limit, an error, a throw or a bad body", async () => {
    const cases: [() => Response | Promise<Response>, string][] = [
      [() => new Response("", { status: 429 }), "rate-limited"],
      [() => new Response("", { status: 502 }), "unavailable"],
      [() => Promise.reject(new Error("binding down")), "unavailable"],
      [() => Response.json({ height: "seven" }), "unavailable"],
    ]
    for (const [answer, status] of cases) {
      state.responseHeaders.clear()
      api(answer)
      const read = await readBlockscout(
        "blocks/1",
        new URLSearchParams(),
        schema,
      )
      expect(read.status).toBe(status)
      expect(state.responseHeaders.get("x-scan-degraded")).toBe("1")
    }
  })

  it("serves recorded fixtures after the configured latency", async () => {
    state.env.SCAN_DATA = "fixtures"
    state.env.SCAN_FIXTURE_LATENCY_MS = "40"
    vi.useFakeTimers()
    let settled = false
    const pending = readBlockscout(
      "blocks/404404",
      new URLSearchParams(),
      schema,
    ).then((read) => {
      settled = true
      return read
    })
    await vi.advanceTimersByTimeAsync(39)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(await pending).toEqual({ status: "missing" })
  })

  it("times one request's parallel fixture reads with one timer", async () => {
    state.env.SCAN_DATA = "fixtures"
    state.env.SCAN_FIXTURE_LATENCY_MS = "40"
    state.request = new Request("https://scan.test/")
    vi.useFakeTimers()
    try {
      const read = () =>
        readBlockscout("blocks/404404", new URLSearchParams(), schema)
      const together = Promise.all([read(), read(), read()])
      expect(vi.getTimerCount()).toBe(1)
      await vi.advanceTimersByTimeAsync(40)
      expect(await together).toHaveLength(3)
      // A read after them waits a latency of its own.
      let settled = false
      const after = read().then(() => {
        settled = true
      })
      await vi.advanceTimersByTimeAsync(39)
      expect(settled).toBe(false)
      await vi.advanceTimersByTimeAsync(1)
      await after
    } finally {
      state.request = null
    }
  })

  it("degrades on a recorded rate limit in fixtures mode", async () => {
    state.env.SCAN_DATA = "fixtures"
    const read = await readBlockscout(
      `addresses/0x${"0b".repeat(20)}/transactions`,
      new URLSearchParams(),
      schema,
    )
    expect(read).toEqual({ status: "rate-limited" })
    expect(state.responseHeaders.get("x-scan-degraded")).toBe("1")
  })

  it("fails closed without a salt: no key, one clear log line", async () => {
    resetSaltWarning()
    logged.errors.length = 0
    state.requestHeaders.set("cf-connecting-ip", "203.0.113.7")
    const seen = api(() => Response.json({ height: 7 }))
    await readBlockscout("blocks/7", new URLSearchParams(), schema)
    await readBlockscout("blocks/8", new URLSearchParams(), schema)
    expect(seen[0]?.headers.get("x-matchbox-end-user")).toBeNull()
    expect(seen[0]?.headers.get("x-matchbox-client")).toBe("matchscan-v2")
    expect(
      logged.errors.filter((line) => line.includes("BLOCKSCOUT_CALLER_SALT")),
    ).toHaveLength(1)
  })

  it("degrades one read, not the page, when a 200 is not JSON", async () => {
    api(
      () =>
        new Response("<html>Bad gateway</html>", {
          headers: { "content-type": "text/html" },
        }),
    )
    const read = await readBlockscout("blocks", new URLSearchParams(), schema)
    expect(read).toEqual({ status: "unavailable" })
    expect(state.responseHeaders.get("x-scan-degraded")).toBe("1")
  })
})

describe("fetchApi", () => {
  it("rejects a read that never answers at its deadline", async () => {
    state.env.API = {
      fetch: (request: Request) =>
        new Promise((_, reject) => {
          request.signal.addEventListener("abort", () =>
            reject(request.signal.reason),
          )
        }),
    }
    // The read only settles when its signal aborts, so a missing deadline
    // never settles at all; the time only shows the deadline did it, and
    // a timer never fires early, however loaded the machine.
    const started = performance.now()
    await expect(fetchApi("/internal/scan/gauges", 30)).rejects.toMatchObject({
      name: "TimeoutError",
    })
    expect(performance.now() - started).toBeGreaterThanOrEqual(25)
  })
})
