import { beforeEach, describe, expect, it, vi } from "vitest"
import { scanFixture } from "./fixtures"
import { wallet } from "./fixtures/world"

/**
 * One cache-only read per page: the page's bare wallets in one sorted
 * request, nothing when it shows none, and the page as it was when the
 * read is late or fails.
 */

const state = vi.hoisted(() => ({
  env: {} as Record<string, unknown>,
  requests: [] as string[],
}))

vi.mock("cloudflare:workers", () => ({ env: state.env }))
vi.mock("@tanstack/react-start/server", () => ({
  getRequestHeader: () => undefined,
  setResponseHeader: () => undefined,
}))
vi.mock("@matchbox/logger", () => ({
  createLogger: () => ({ error: () => {}, warn: () => {}, info: () => {} }),
}))

const { withMezoIds } = await import("./mezo-names.server")

const sender = "0xf35c1a20303ddca464ebf5b3b023588cf3181c8a"

function view(address: string) {
  return { address, name: null, contract: false }
}

/** The API answering from the fixtures, or `reply`. */
function api(reply?: () => Promise<Response>): void {
  state.env.API = {
    fetch: async (request: Request) => {
      const url = new URL(request.url)
      state.requests.push(`${url.pathname}${url.search}`)
      if (reply !== undefined) return reply()
      const answer = scanFixture(
        url.pathname.replace("/internal/scan/", ""),
        url.searchParams,
      )
      return Response.json(answer.body, {
        status: answer.status,
        headers: { "cache-control": "public, max-age=60" },
      })
    },
  }
}

beforeEach(() => {
  for (const key of Object.keys(state.env)) delete state.env[key]
  state.requests.length = 0
})

describe("withMezoIds", () => {
  it("names a page's wallets with one sorted read", async () => {
    api()
    const page = {
      items: [
        { from: view(wallet), to: view(sender) },
        { from: view(sender), to: view(wallet) },
      ],
    }
    const named = await withMezoIds(page)
    expect(named.items[0]?.from).toEqual({
      ...view(wallet),
      label: { name: "alice.mezo", kind: "mezo-id", tags: [] },
    })
    expect(named.items[0]?.to).toEqual(view(sender))
    expect(state.requests).toEqual([
      `/internal/scan/mezo-ids?addresses=${encodeURIComponent(
        [sender, wallet].sort().join(","),
      )}`,
    ])
  })

  it("reads nothing for a page without a bare wallet", async () => {
    api()
    const page = { status: "unavailable" }
    expect(await withMezoIds(page)).toBe(page)
    expect(state.requests).toEqual([])
  })

  it("keeps the page as it was when the read fails or is late", async () => {
    const page = { items: [view(wallet)] }
    api(async () => new Response("down", { status: 502 }))
    expect(await withMezoIds(page)).toBe(page)
    api(() => new Promise<Response>(() => undefined))
    expect(await withMezoIds(page, 10)).toBe(page)
  })
})
