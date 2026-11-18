import { endUserKey } from "@matchbox/contracts/blockscout"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { z } from "zod"

/**
 * Pro's API reads carry the caller headers the API's rate limits key on,
 * as Matchscan's do: Pro's name, and the visitor's salted end-user key.
 */

const state = vi.hoisted(() => ({
  env: {} as Record<string, unknown>,
  ip: undefined as string | undefined,
  seen: [] as Headers[],
}))

vi.mock("cloudflare:workers", () => ({ env: state.env }))
vi.mock("@tanstack/react-start/server", () => ({
  getRequestHeader: (name: string) =>
    name === "cf-connecting-ip" ? state.ip : undefined,
}))
vi.mock("@matchbox/logger", () => ({
  createLogger: () => ({ error: () => {}, warn: () => {}, info: () => {} }),
}))

const { readModel } = await import("./source.server")

const salt = "a salt of at least thirty-two bytes, test only"

beforeEach(() => {
  for (const key of Object.keys(state.env)) delete state.env[key]
  state.env.PRO_DATA = "api"
  state.env.API = {
    fetch: async (request: Request) => {
      state.seen.push(request.headers)
      return Response.json({ ok: true })
    },
  }
  state.ip = "203.0.113.7"
  state.seen.length = 0
})

const okSchema = z.object({ ok: z.boolean() })

describe("API reads", () => {
  it("send Pro's name and the visitor's end-user key", async () => {
    state.env.BLOCKSCOUT_CALLER_SALT = salt
    await readModel("/internal/pro/summary", okSchema)
    const [headers] = state.seen
    expect(headers?.get("x-matchbox-client")).toBe("matchbox-pro-v2")
    expect(headers?.get("x-matchbox-end-user")).toBe(
      await endUserKey("203.0.113.7", salt),
    )
    // Never the address itself.
    expect([...(headers?.values() ?? [])].join(" ")).not.toContain("203.0.113")
  })

  it("send no end-user key without a usable salt", async () => {
    for (const short of [undefined, "short"]) {
      state.env.BLOCKSCOUT_CALLER_SALT = short
      await readModel("/internal/pro/summary", okSchema)
    }
    for (const headers of state.seen) {
      expect(headers.get("x-matchbox-client")).toBe("matchbox-pro-v2")
      expect(headers.has("x-matchbox-end-user")).toBe(false)
    }
  })
})
