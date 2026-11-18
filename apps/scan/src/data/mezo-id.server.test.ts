import { beforeEach, describe, expect, it, vi } from "vitest"
import { scanFixture } from "./scan/fixtures"
import { fixtureBtc } from "./scan/fixtures/mezo-ids"
import { wallet } from "./scan/fixtures/world"

/**
 * Mezo IDs through the API: the query is validated here before any read,
 * a miss or a failure reads as no match, and the address page's wait for
 * an ID gives up (and keeps the page out of the cache) when the API is
 * late.
 */

const state = vi.hoisted(() => ({
  env: {} as Record<string, unknown>,
  response: new Map<string, string>(),
  paths: [] as string[],
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

const { mezoIdMatch, mezoIdOfAddress } = await import("./mezo-id.server")

/** The API answering /internal/scan/mezo-ids from the fixtures, or `reply`. */
function api(reply?: () => Promise<Response>): void {
  state.env.API = {
    fetch: async (request: Request) => {
      const path = new URL(request.url).pathname.replace("/internal/scan/", "")
      state.paths.push(path)
      if (reply !== undefined) return reply()
      const answer = scanFixture(path, new URLSearchParams())
      return Response.json(answer.body, { status: answer.status })
    },
  }
}

beforeEach(() => {
  for (const key of Object.keys(state.env)) delete state.env[key]
  state.response.clear()
  state.paths.length = 0
})

describe("mezoIdMatch", () => {
  it("finds an ID's wallets, typed in full or bare", async () => {
    api()
    expect(await mezoIdMatch("Alice.mezo")).toEqual({
      mezoId: "alice.mezo",
      wallets: [wallet],
    })
    expect(await mezoIdMatch("alice")).toEqual({
      mezoId: "alice.mezo",
      wallets: [wallet],
    })
    expect(state.paths).toEqual(["mezo-ids/alice.mezo", "mezo-ids/alice.mezo"])
  })

  it("never reads for a query that is not an ID", async () => {
    api()
    for (const q of [
      "../x.mezo",
      "a/b.mezo",
      "a_b",
      "47",
      "",
      "x".repeat(200),
    ]) {
      expect(await mezoIdMatch(q), q).toBeNull()
    }
    expect(state.paths).toEqual([])
  })

  it("reads unknown, down and busy all as no match", async () => {
    api()
    expect(await mezoIdMatch("nobody.mezo")).toBeNull()
    expect(await mezoIdMatch("down.mezo")).toBeNull()
    api(async () =>
      Response.json(
        { error: { code: "rate_limited", message: "Rate limited" } },
        { status: 429 },
      ),
    )
    expect(await mezoIdMatch("alice.mezo")).toBeNull()
    api(async () => {
      throw new TypeError("unreachable")
    })
    expect(await mezoIdMatch("alice.mezo")).toBeNull()
  })
})

describe("mezoIdMatch, for a Bitcoin address", () => {
  it("finds the EVM address Mezo links with it", async () => {
    api()
    expect(await mezoIdMatch(` ${fixtureBtc.alice.toUpperCase()} `)).toEqual({
      mezoId: "alice.mezo",
      wallets: [wallet],
      btcAddress: fixtureBtc.alice,
    })
    expect(state.paths).toEqual([`mezo-ids/${fixtureBtc.alice}`])
  })

  it("says Mezo has no account for it, and stays quiet when Mezo is down", async () => {
    api()
    expect(await mezoIdMatch(fixtureBtc.none)).toEqual({
      mezoId: null,
      wallets: [],
      btcAddress: fixtureBtc.none,
    })
    expect(await mezoIdMatch(fixtureBtc.down)).toBeNull()
  })

  it("never reads a testnet address as an ID or an address", async () => {
    api()
    expect(
      await mezoIdMatch("tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx"),
    ).toBeNull()
    // Read as a bare name, it is "…kxpjzsx.mezo": an ID no one has.
    expect(state.paths).toEqual([
      "mezo-ids/tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx.mezo",
    ])
  })
})

describe("mezoIdOfAddress", () => {
  it("names an address's ID and linked Bitcoin address, and nothing for one without", async () => {
    api()
    expect(await mezoIdOfAddress(wallet)).toEqual({
      mezoId: "alice.mezo",
      btcAddress: fixtureBtc.alice,
    })
    expect(await mezoIdOfAddress(`0x${"12".repeat(20)}`)).toEqual({
      mezoId: null,
      btcAddress: null,
    })
    expect(state.response.has("x-scan-degraded")).toBe(false)
  })

  it("asks nothing for a malformed address", async () => {
    api()
    const none = { mezoId: null, btcAddress: null }
    expect(await mezoIdOfAddress("alice.mezo")).toEqual(none)
    expect(await mezoIdOfAddress(wallet.toUpperCase())).toEqual(none)
    expect(state.paths).toEqual([])
  })

  it("renders without the ID, and is not stored, when the API is late", async () => {
    vi.useFakeTimers()
    try {
      api(() => new Promise<Response>(() => undefined))
      const pending = mezoIdOfAddress(wallet, 500)
      await vi.advanceTimersByTimeAsync(500)
      expect(await pending).toEqual({ mezoId: null, btcAddress: null })
      expect(state.response.get("x-scan-degraded")).toBe("1")
    } finally {
      vi.useRealTimers()
    }
  })
})
