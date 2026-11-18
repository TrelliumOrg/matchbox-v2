import { beforeEach, describe, expect, it, vi } from "vitest"
import { demoMezoId, fixtureDownMezoId, fixtureResponse } from "./fixture-api"

/**
 * Pro's identity lookup against the API binding: the fixtures answer as
 * the API does, unless a test makes it fail. Three answers, never a throw.
 */

const state = vi.hoisted(() => ({
  env: {} as Record<string, unknown>,
  paths: [] as string[],
  reply: null as (() => Response) | null,
}))

vi.mock("cloudflare:workers", () => ({ env: state.env }))
vi.mock("@tanstack/react-start/server", () => ({
  getRequestHeader: () => undefined,
}))
vi.mock("@matchbox/logger", () => ({
  createLogger: () => ({ error: () => {}, warn: () => {}, info: () => {} }),
}))

const { readIdentity } = await import("./identity.server")

const demo = "0x7c21095156ab25e989c3c084bcb06037c6539e0b"

beforeEach(() => {
  for (const key of Object.keys(state.env)) delete state.env[key]
  state.env.PRO_DATA = "api"
  state.paths.length = 0
  state.reply = null
  state.env.API = {
    fetch: async (request: Request) => {
      const url = new URL(request.url)
      state.paths.push(`${url.pathname}${url.search}`)
      if (state.reply !== null) return state.reply()
      const answer = fixtureResponse(`${url.pathname}${url.search}`, 0)
      return answer.status === 200
        ? Response.json(answer.body)
        : new Response(null, { status: answer.status })
    },
  }
})

describe("readIdentity", () => {
  it("resolves a Mezo ID to its wallet through the API's resolver", async () => {
    expect(await readIdentity(demoMezoId)).toEqual({
      status: "found",
      identity: { address: demo, mezoId: demoMezoId },
    })
    expect(state.paths).toEqual(["/internal/scan/mezo-ids/pyke.mezo"])
  })

  it("asks past every stored answer when fresh", async () => {
    await readIdentity(demoMezoId, { fresh: true })
    expect(state.paths).toEqual(["/internal/scan/mezo-ids/pyke.mezo?fresh=1"])
  })

  it("reads an address's Mezo ID from Pro's identity route", async () => {
    expect(await readIdentity(demo.toUpperCase().replace("0X", "0x"))).toEqual({
      status: "found",
      identity: { address: demo, mezoId: demoMezoId },
    })
    expect(state.paths).toEqual([`/internal/pro/wallets/${demo}/identity`])
  })

  it("tells an unknown ID from a lookup that failed", async () => {
    expect(await readIdentity("nobody.mezo")).toEqual({ status: "not-found" })
    expect(await readIdentity(fixtureDownMezoId)).toEqual({
      status: "unavailable",
    })
  })

  it("answers unavailable, not 'no such ID', when the API is busy or down", async () => {
    for (const status of [429, 500, 503]) {
      state.reply = () =>
        Response.json(
          { error: { code: "rate_limited", message: "Slow down" } },
          { status },
        )
      expect(await readIdentity(demoMezoId), String(status)).toEqual({
        status: "unavailable",
      })
      expect(await readIdentity(demo), String(status)).toEqual({
        status: "unavailable",
      })
    }
    state.reply = () => new Response("<html>", { status: 200 })
    expect((await readIdentity(demoMezoId)).status).toBe("unavailable")
    state.reply = () => {
      throw new TypeError("binding down")
    }
    expect((await readIdentity(demoMezoId)).status).toBe("unavailable")
  })

  it("asks nothing for a key Mezo would refuse", async () => {
    for (const key of ["pyke_1.mezo", "pyke", "a b.mezo", ".mezo"]) {
      expect(await readIdentity(key)).toEqual({ status: "not-found" })
    }
    expect(state.paths).toEqual([])
  })
})
