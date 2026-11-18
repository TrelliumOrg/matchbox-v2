import { beforeEach, describe, expect, it, vi } from "vitest"
import { fixtureResponse } from "./fixtures"
import { scanFixture } from "./scan/fixtures"

/**
 * The shell's status read: a failure means the page cannot say whether
 * its data is current, so it is never stored; a 503 (no Scan database)
 * stays storable; halted or stale copies say some data is delayed.
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

const { loadShell } = await import("./shell.server")

/** The API: the shell's head and prices as fixtures, /status as given. */
function api(status: () => Response | Promise<Response>): void {
  state.env.API = {
    fetch: async (request: Request) => {
      const path = new URL(request.url).pathname
      if (path === "/internal/scan/status") return status()
      const answer = fixtureResponse(path)
      return Response.json(answer.body, { status: answer.status })
    },
  }
}

const statusBody = (data: Record<string, unknown>) => {
  const base = (
    scanFixture("status", new URLSearchParams()).body as {
      data: Record<string, unknown>
    }
  ).data
  return Response.json({ data: { ...base, ...data } })
}

beforeEach(() => {
  for (const key of Object.keys(state.env)) delete state.env[key]
  state.env.SCAN_DATA = "api"
  state.response.clear()
})

describe("the shell's status read", () => {
  it("keeps a page whose status read failed out of every cache", async () => {
    for (const failure of [
      () => new Response("oops", { status: 500 }),
      () => new Response("slow down", { status: 429 }),
      () => new Response("<html>", { status: 200 }),
      () => Response.json({ data: { nope: true } }),
      () => {
        throw new DOMException("The operation timed out.", "TimeoutError")
      },
    ]) {
      state.response.clear()
      api(failure)
      const shell = await loadShell()
      expect(shell.delayed).toBe(false)
      expect(shell.degraded).toBe(true)
      expect(state.response.get("x-scan-degraded")).toBe("1")
    }
  })

  it("stores a page while the API has no Scan database (503)", async () => {
    api(() =>
      Response.json({ error: { code: "service_disabled" } }, { status: 503 }),
    )
    const shell = await loadShell()
    expect(shell).toMatchObject({ delayed: false, degraded: false })
    expect(state.response.has("x-scan-degraded")).toBe(false)
  })

  it("says some data is delayed when the copy is stale, not only halted", async () => {
    api(() => statusBody({ halted: false, stale: true }))
    expect((await loadShell()).delayed).toBe(true)
    api(() => statusBody({ halted: true, stale: true }))
    expect((await loadShell()).delayed).toBe(true)
    api(() => statusBody({ halted: false, stale: false }))
    const current = await loadShell()
    expect(current).toMatchObject({ delayed: false, degraded: false })
  })
})
