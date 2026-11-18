import { errorBodySchema } from "@matchbox/contracts/errors"
import {
  scanMezoIdLookupSchema,
  scanMezoIdNamesSchema,
} from "@matchbox/contracts/scan"
import { createLogger } from "@matchbox/logger"
import { errorHandler, notFoundHandler, requestId } from "@matchbox/server"
import { Hono } from "hono"
import { getAddress } from "viem"
import { describe, expect, it } from "vitest"
import { z } from "zod"
import type { ApiEnv } from "../context"
import { internalAccess } from "../internal/access"
import { cors } from "../middleware/cors"
import { createMezoIdResolver, type MezoIdResolver } from "./mezo-ids"
import registerScanRoutes from "./routes"

// /internal/scan/mezo-ids/{key} with Mezo's accounts API faked: found,
// unknown, down and late, and keys that must never reach it; and the
// cache-only /internal/scan/mezo-ids?addresses= that lists read.

const base = "https://api.internal/internal/scan"
const upstream = "https://accounts.example.com"
const wallet = "0x741c0225c1f1177cd54ca050b83bc7517a5f2e88"
const checksummed = "0x741c0225c1F1177cd54Ca050B83bC7517a5F2E88"
const other = "0x00000000000000000000000000000000000000a1"
// BIP 173's examples, never a real account's address.
const btc = "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4"
const otherBtc =
  "bc1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qccfmv3"

type Reply =
  | { kind: "json"; status: number; body: unknown }
  | { kind: "throw" }
  /** Answers only when the request is aborted, as a hung upstream. */
  | { kind: "hang" }

const responseSchema = z.object({ data: scanMezoIdLookupSchema })

let cacheNumber = 0

async function harness(
  options: { resolver?: "none"; timeoutMs?: number } = {},
) {
  const replies = new Map<string, Reply>()
  const calls: string[] = []
  const clock = { now: Date.UTC(2026, 10, 13, 12) }
  const logger = createLogger({ sink: () => undefined })
  const fetcher = async (url: string, init: RequestInit) => {
    calls.push(url)
    const reply = replies.get(url.slice(`${upstream}/accounts/`.length)) ?? {
      kind: "json",
      status: 404,
      body: { status: 404, error: "Account not found" },
    }
    if (reply.kind === "throw") throw new TypeError("network down")
    if (reply.kind === "hang") {
      return new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () =>
          reject(init.signal?.reason ?? new Error("aborted")),
        )
      })
    }
    return Response.json(reply.body, { status: reply.status })
  }
  const resolver: MezoIdResolver | null =
    options.resolver === "none"
      ? null
      : createMezoIdResolver({
          fetcher,
          logger,
          baseUrl: upstream,
          ...(options.timeoutMs === undefined
            ? {}
            : { timeoutMs: options.timeoutMs }),
        })
  cacheNumber += 1
  const cache = await caches.open(`mezo-ids-test-${cacheNumber}`)
  const app = new Hono<ApiEnv>()
  app.use(requestId({ logger }))
  app.use(internalAccess({ internalToken: null }))
  app.use(cors())
  app.onError(errorHandler())
  app.notFound(notFoundHandler)
  registerScanRoutes(app, {
    scanDb: null,
    readDb: null,
    network: "mezo",
    cache,
    rateLimits: null,
    readPrices: async () => null,
    proxy: null,
    clock: async () => ({ height: 1, lastActive: 1 }),
    mezoIds: resolver,
    logger,
    now: () => clock.now,
  })
  return {
    calls,
    clock,
    reply(key: string, reply: Reply) {
      replies.set(key, reply)
    },
    get(path: string): Promise<Response> {
      return Promise.resolve(app.request(`${base}/mezo-ids/${path}`))
    },
    names(query: string): Promise<Response> {
      return Promise.resolve(app.request(`${base}/mezo-ids${query}`))
    },
  }
}

async function lookup(response: Response) {
  expect(response.status).toBe(200)
  return responseSchema.parse(await response.json()).data
}

const found = {
  kind: "json",
  status: 200,
  body: {
    mezoId: "alice.mezo",
    linkedAccounts: [
      {
        type: "wallet",
        btcAddress: btc,
        evmAddress: checksummed,
      },
    ],
  },
} as const

describe("/internal/scan/mezo-ids/{id}", () => {
  it("resolves an ID to its wallet and keeps the answer a day", async () => {
    const h = await harness()
    h.reply("alice.mezo", found)
    const first = await h.get("alice.mezo")
    expect(first.headers.get("Cache-Control")).toBe("public, max-age=86400")
    expect(await lookup(first)).toEqual({
      status: "found",
      mezo_id: "alice.mezo",
      wallets: [wallet],
      btc_address: btc,
    })
    expect(h.calls).toEqual([`${upstream}/accounts/alice.mezo`])
    // Any case is the same ID, and the same cache entry.
    const again = await h.get("Alice.MEZO")
    expect(again.headers.get("X-Cache")).toBe("memory")
    expect((await lookup(again)).status).toBe("found")
    expect(h.calls).toHaveLength(1)
  })

  it("takes only the account's own wallet, never a linked account", async () => {
    const h = await harness()
    // The first linked account is not the account's own wallet.
    h.reply("multi.mezo", {
      kind: "json",
      status: 200,
      body: {
        mezoId: "multi.mezo",
        linkedAccounts: [
          { type: "linked", evmAddress: other },
          { type: "wallet", evmAddress: checksummed },
          { type: "linked", evmAddress: "not an address" },
          { type: "linked", btcAddress: "bc1qonly" },
        ],
      },
    })
    expect(await lookup(await h.get("multi.mezo"))).toEqual({
      status: "found",
      mezo_id: "multi.mezo",
      wallets: [wallet],
      btc_address: null,
    })
    // No wallet of its own, two of them, or only the zero address: none
    // is the account's wallet.
    const cases: Record<string, unknown[]> = {
      "linked.mezo": [{ type: "linked", evmAddress: other }],
      "twice.mezo": [
        { type: "wallet", evmAddress: checksummed },
        { type: "wallet", evmAddress: other },
      ],
      "reserved.mezo": [{ type: "wallet", evmAddress: `0x${"0".repeat(40)}` }],
    }
    for (const [id, linkedAccounts] of Object.entries(cases)) {
      h.reply(id, {
        kind: "json",
        status: 200,
        body: { mezoId: id, linkedAccounts },
      })
      expect((await lookup(await h.get(id))).status, id).toBe("not-found")
    }
  })

  it("is not found when Mezo answers for another ID", async () => {
    const h = await harness()
    h.reply("alice.mezo", {
      ...found,
      body: { ...found.body, mezoId: "bob.mezo" },
    })
    expect(await lookup(await h.get("alice.mezo"))).toEqual({
      status: "not-found",
    })
    h.reply("carol.mezo", {
      ...found,
      body: { ...found.body, mezoId: null },
    })
    expect((await lookup(await h.get("carol.mezo"))).status).toBe("not-found")
    // Nothing was said about the wallet either.
    expect(await names(await h.names(`?addresses=${wallet}`))).toEqual({})
  })

  it("asks Mezo past every stored answer when fresh, and stores what it learns", async () => {
    const h = await harness()
    h.reply("alice.mezo", found)
    await h.get("alice.mezo")
    expect(await names(await h.names(`?addresses=${wallet}`))).toEqual({
      [wallet]: "alice.mezo",
    })
    // Pointed at another wallet upstream since: a fresh read sees it at once.
    h.reply("alice.mezo", {
      kind: "json",
      status: 200,
      body: {
        mezoId: "alice.mezo",
        linkedAccounts: [{ type: "wallet", evmAddress: other }],
      },
    })
    const fresh = await h.get("alice.mezo?fresh=1")
    expect(fresh.headers.get("Cache-Control")).toBe("private, no-store")
    expect(await lookup(fresh)).toEqual({
      status: "found",
      mezo_id: "alice.mezo",
      wallets: [other],
      btc_address: null,
    })
    expect(h.calls).toHaveLength(2)
    // The ID's stored answer is now the new wallet: a display read gets it
    // without asking Mezo.
    const shown = await h.get("alice.mezo")
    expect(shown.headers.get("X-Cache")).toBe("memory")
    expect(await lookup(shown)).toEqual({
      status: "found",
      mezo_id: "alice.mezo",
      wallets: [other],
      btc_address: null,
    })
    expect(h.calls).toHaveLength(2)
    // Lists name the new wallet, and the old one no longer.
    expect(await names(await h.names(`?addresses=${wallet},${other}`))).toEqual(
      { [other]: "alice.mezo" },
    )
    // Each fresh read asks again.
    await h.get("alice.mezo?fresh=1")
    expect(h.calls).toHaveLength(3)
    // An outage on a fresh read is unavailable and changes nothing.
    h.reply("alice.mezo", { kind: "throw" })
    expect(await lookup(await h.get("alice.mezo?fresh=1"))).toEqual({
      status: "unavailable",
    })
    expect((await lookup(await h.get("alice.mezo"))).status).toBe("found")
    // Released upstream: a fresh read drops the stored answer and the
    // wallet's, so the next display read asks Mezo.
    h.reply("alice.mezo", {
      kind: "json",
      status: 404,
      body: { status: 404, error: "Account not found" },
    })
    expect(await lookup(await h.get("alice.mezo?fresh=1"))).toEqual({
      status: "not-found",
    })
    expect(await names(await h.names(`?addresses=${other}`))).toEqual({})
    const calls = h.calls.length
    expect(await lookup(await h.get("alice.mezo"))).toEqual({
      status: "not-found",
    })
    expect(h.calls).toHaveLength(calls + 1)
    for (const query of ["?fresh=0", "?fresh=true", "?fresh=1&fresh=1"]) {
      expect((await h.get(`alice.mezo${query}`)).status, query).toBe(400)
    }
  })

  it("never lets a fresh read replace a wallet's own answer", async () => {
    const h = await harness()
    // The new wallet's own lookup says real.mezo.
    h.reply(getAddress(other), {
      kind: "json",
      status: 200,
      body: {
        mezoId: "real.mezo",
        linkedAccounts: [{ type: "wallet", evmAddress: other }],
      },
    })
    await h.get(other)
    h.reply("alice.mezo", {
      kind: "json",
      status: 200,
      body: {
        mezoId: "alice.mezo",
        linkedAccounts: [{ type: "wallet", evmAddress: other }],
      },
    })
    await h.get("alice.mezo?fresh=1")
    expect(await names(await h.names(`?addresses=${other}`))).toEqual({
      [other]: "real.mezo",
    })
  })

  it("reads Mezo's 'Account has no Mezo ID' as no ID, kept like a miss", async () => {
    const h = await harness()
    h.reply(checksummed, {
      kind: "json",
      status: 500,
      body: { error: "Account has no Mezo ID" },
    })
    const first = await h.get(wallet)
    expect(first.headers.get("Cache-Control")).toBe("public, max-age=60")
    expect(await lookup(first)).toEqual({ status: "not-found" })
    await h.get(wallet)
    expect(h.calls).toHaveLength(1)
    // Any other 500 is an outage, stored nowhere.
    for (const body of [
      { error: "Internal server error" },
      "Account has no Mezo ID",
    ]) {
      h.reply(getAddress(other), { kind: "json", status: 500, body })
      const response = await h.get(other)
      expect(response.headers.get("Cache-Control")).toBe("private, no-store")
      expect(await lookup(response)).toEqual({ status: "unavailable" })
    }
    // The exact error, whatever else the body carries, is no ID.
    h.reply(getAddress(other), {
      kind: "json",
      status: 500,
      body: { status: 500, error: "Account has no Mezo ID" },
    })
    expect(await lookup(await h.get(other))).toEqual({ status: "not-found" })
  })

  it("answers an unknown ID briefly, then asks again", async () => {
    const h = await harness()
    const first = await h.get("nobody.mezo")
    expect(first.headers.get("Cache-Control")).toBe("public, max-age=60")
    expect(await lookup(first)).toEqual({ status: "not-found" })
    await h.get("nobody.mezo")
    expect(h.calls).toHaveLength(1)
    // The next minute's slot: claimed since, it is found.
    h.clock.now += 61_000
    h.reply("nobody.mezo", {
      ...found,
      body: { ...found.body, mezoId: "nobody.mezo" },
    })
    expect((await lookup(await h.get("nobody.mezo"))).status).toBe("found")
    expect(h.calls).toHaveLength(2)
  })

  it("treats a key Mezo refuses (422) as not found", async () => {
    const h = await harness()
    h.reply("a--b.mezo", {
      kind: "json",
      status: 422,
      body: { status: 422, error: "Invalid Mezo ID or address" },
    })
    expect(await lookup(await h.get("a--b.mezo"))).toEqual({
      status: "not-found",
    })
  })

  it("says unavailable, stores nothing, when Mezo's API is down", async () => {
    const h = await harness()
    h.reply("alice.mezo", { kind: "json", status: 502, body: "Bad gateway" })
    const first = await h.get("alice.mezo")
    expect(first.headers.get("Cache-Control")).toBe("private, no-store")
    expect(await lookup(first)).toEqual({ status: "unavailable" })
    h.reply("alice.mezo", { kind: "throw" })
    expect((await lookup(await h.get("alice.mezo"))).status).toBe("unavailable")
    h.reply("alice.mezo", { kind: "json", status: 200, body: "<html>" })
    expect((await lookup(await h.get("alice.mezo"))).status).toBe("unavailable")
    // Nothing was kept: back up, it answers at once.
    h.reply("alice.mezo", found)
    expect((await lookup(await h.get("alice.mezo"))).status).toBe("found")
    expect(h.calls).toHaveLength(4)
  })

  it("gives up on a slow upstream at its deadline", async () => {
    const h = await harness({ timeoutMs: 20 })
    h.reply("slow.mezo", { kind: "hang" })
    const response = await h.get("slow.mezo")
    expect(response.headers.get("Cache-Control")).toBe("private, no-store")
    expect(await lookup(response)).toEqual({ status: "unavailable" })
  })

  it("refuses malformed keys before any upstream request", async () => {
    const h = await harness()
    for (const bad of [
      "a_b.mezo",
      "alice",
      "alice.eth",
      "a.b.mezo",
      "%2E%2E%2Fx.mezo",
      "a%2Fb.mezo",
      "%C3%A9t%C3%A9.mezo",
      `${"a".repeat(64)}.mezo`,
      "0x1234",
    ]) {
      const response = await h.get(bad)
      expect(response.status, bad).toBe(404)
      expect(errorBodySchema.parse(await response.json()).error.code).toBe(
        "not_found",
      )
    }
    const query = await h.get("alice.mezo?x=1")
    expect(query.status).toBe(400)
    expect(h.calls).toEqual([])
  })

  it("answers 503 without a resolver", async () => {
    const h = await harness({ resolver: "none" })
    const response = await h.get("alice.mezo")
    expect(response.status).toBe(503)
  })
})

describe("/internal/scan/mezo-ids/{address}", () => {
  it("names an address's Mezo ID, asking with the checksummed address", async () => {
    const h = await harness()
    h.reply(checksummed, found)
    const response = await h.get(wallet.toUpperCase().replace("0X", "0x"))
    expect(await lookup(response)).toEqual({
      status: "found",
      mezo_id: "alice.mezo",
      wallets: [wallet],
      btc_address: btc,
    })
    expect(h.calls).toEqual([`${upstream}/accounts/${checksummed}`])
  })

  it("keeps an account with no ID only briefly", async () => {
    const h = await harness()
    h.reply(checksummed, {
      kind: "json",
      status: 200,
      body: {
        mezoId: null,
        linkedAccounts: [{ type: "wallet", evmAddress: checksummed }],
      },
    })
    const response = await h.get(wallet)
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=60")
    expect(await lookup(response)).toEqual({
      status: "found",
      mezo_id: null,
      wallets: [wallet],
      btc_address: null,
    })
  })

  it("never shows an ID of a shape we would not accept", async () => {
    const h = await harness()
    h.reply(checksummed, {
      kind: "json",
      status: 200,
      body: {
        mezoId: "<b>x</b>.mezo",
        linkedAccounts: [{ type: "wallet", evmAddress: checksummed }],
      },
    })
    expect(await lookup(await h.get(wallet))).toEqual({
      status: "found",
      mezo_id: null,
      wallets: [wallet],
      btc_address: null,
    })
  })

  it("does not name a linked account by the account's ID", async () => {
    const h = await harness()
    h.reply(getAddress(other), {
      kind: "json",
      status: 200,
      body: {
        mezoId: "alice.mezo",
        linkedAccounts: [
          { type: "wallet", evmAddress: checksummed },
          { type: "linked", evmAddress: other },
        ],
      },
    })
    expect(await lookup(await h.get(other))).toEqual({ status: "not-found" })
  })
})

describe("/internal/scan/mezo-ids/{Bitcoin address}", () => {
  it("leads a linked Bitcoin address to its EVM address, kept a day", async () => {
    const h = await harness()
    h.reply(btc, found)
    const first = await h.get(btc)
    expect(first.headers.get("Cache-Control")).toBe("public, max-age=86400")
    expect(await lookup(first)).toEqual({
      status: "found",
      mezo_id: "alice.mezo",
      wallets: [wallet],
      btc_address: btc,
    })
    expect(h.calls).toEqual([`${upstream}/accounts/${btc}`])
    // Bech32 in upper case is the same address, and the same entry.
    const again = await h.get(btc.toUpperCase())
    expect(again.headers.get("X-Cache")).toBe("memory")
    expect(h.calls).toHaveLength(1)
    // The ID's own wallet: lists and the address page name it too.
    expect(await names(await h.names(`?addresses=${wallet}`))).toEqual({
      [wallet]: "alice.mezo",
    })
    expect(await lookup(await h.get(wallet))).toEqual({
      status: "found",
      mezo_id: "alice.mezo",
      wallets: [wallet],
      btc_address: btc,
    })
    expect(h.calls).toHaveLength(1)
  })

  it("matches the address exactly, and names the ID only for its own wallet", async () => {
    const h = await harness()
    h.reply(otherBtc, {
      kind: "json",
      status: 200,
      body: {
        mezoId: "alice.mezo",
        linkedAccounts: [
          { type: "wallet", btcAddress: btc, evmAddress: checksummed },
          // Mezo's own case does not matter for bech32.
          {
            type: "linked",
            btcAddress: otherBtc.toUpperCase(),
            evmAddress: getAddress(other),
          },
        ],
      },
    })
    const response = await h.get(otherBtc)
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=86400")
    expect(await lookup(response)).toEqual({
      status: "found",
      mezo_id: null,
      wallets: [other],
      btc_address: otherBtc,
    })
    // A linked account is never named by the account's ID.
    expect(await names(await h.names(`?addresses=${other},${wallet}`))).toEqual(
      {},
    )
  })

  it("asks with base58 exactly as typed", async () => {
    const h = await harness()
    const base58 = "1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2"
    h.reply(base58, {
      kind: "json",
      status: 200,
      body: {
        mezoId: "alice.mezo",
        linkedAccounts: [
          { type: "wallet", btcAddress: base58, evmAddress: checksummed },
        ],
      },
    })
    expect(await lookup(await h.get(base58))).toMatchObject({
      status: "found",
      wallets: [wallet],
      btc_address: base58,
    })
    // Base58 is case-sensitive: another case is another address.
    expect((await lookup(await h.get(base58.toLowerCase()))).status).toBe(
      "not-found",
    )
    expect(h.calls).toEqual([
      `${upstream}/accounts/${base58}`,
      `${upstream}/accounts/${base58.toLowerCase()}`,
    ])
  })

  it("is not found, briefly, when no linked account leads anywhere", async () => {
    const h = await harness()
    const first = await h.get(btc)
    expect(first.headers.get("Cache-Control")).toBe("public, max-age=60")
    expect(await lookup(first)).toEqual({ status: "not-found" })
    const cases: Record<string, unknown[]> = {
      // Mezo answered with an account, but not one linked with this address.
      [otherBtc]: [{ type: "wallet", btcAddress: btc, evmAddress: other }],
      // Linked, but with no usable EVM address.
      bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0: [
        {
          type: "wallet",
          btcAddress:
            "bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0",
          evmAddress: `0x${"0".repeat(40)}`,
        },
      ],
      // Two EVM addresses for one Bitcoin address: no answer is safe.
      "3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy": [
        {
          type: "wallet",
          btcAddress: "3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy",
          evmAddress: checksummed,
        },
        {
          type: "linked",
          btcAddress: "3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy",
          evmAddress: other,
        },
      ],
    }
    for (const [key, linkedAccounts] of Object.entries(cases)) {
      h.reply(key, {
        kind: "json",
        status: 200,
        body: { mezoId: "alice.mezo", linkedAccounts },
      })
      const response = await h.get(key)
      expect(response.headers.get("Cache-Control"), key).toBe(
        "public, max-age=60",
      )
      expect((await lookup(response)).status, key).toBe("not-found")
    }
  })

  it("says unavailable, stores nothing, when Mezo's API is down", async () => {
    const h = await harness()
    h.reply(btc, { kind: "throw" })
    const first = await h.get(btc)
    expect(first.headers.get("Cache-Control")).toBe("private, no-store")
    expect(await lookup(first)).toEqual({ status: "unavailable" })
    h.reply(btc, found)
    expect((await lookup(await h.get(btc))).status).toBe("found")
    expect(h.calls).toHaveLength(2)
  })

  it("refuses testnet and malformed addresses before any upstream request", async () => {
    const h = await harness()
    for (const bad of [
      "tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx",
      "bcrt1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080",
      "2MzQwSSnBHWHqSAqtTVQ6v47XtaisrJa1Vc",
      "mipcBbFg9gMiCh81Kj8tqqdgoZub1ZJRfn",
      `bC1q${btc.slice(4)}`,
      btc.slice(0, -1),
      `${btc.slice(0, -1)}b`,
      "1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN0",
      `${btc}%2Fx`,
    ]) {
      const response = await h.get(bad)
      expect(response.status, bad).toBe(404)
    }
    expect(h.calls).toEqual([])
  })
})

const namesSchema = z.object({ data: scanMezoIdNamesSchema })

async function names(response: Response) {
  expect(response.status).toBe(200)
  expect(response.headers.get("Cache-Control")).toBe("public, max-age=60")
  return namesSchema.parse(await response.json()).data
}

describe("/internal/scan/mezo-ids?addresses=", () => {
  it("answers only what is cached, and never asks Mezo", async () => {
    const h = await harness()
    h.reply(checksummed, found)
    expect(await names(await h.names(`?addresses=${wallet},${other}`))).toEqual(
      {},
    )
    expect(h.calls).toEqual([])
    // The address page looks the wallet up: from then on it is cached.
    await h.get(wallet)
    expect(h.calls).toHaveLength(1)
    const upper = wallet.toUpperCase().replace("0X", "0x")
    expect(
      await names(await h.names(`?addresses=${upper},${other},${wallet}`)),
    ).toEqual({ [wallet]: "alice.mezo" })
    expect(h.calls).toHaveLength(1)
  })

  it("names the wallet an ID lookup found", async () => {
    const h = await harness()
    h.reply("alice.mezo", found)
    await h.get("alice.mezo")
    expect(await names(await h.names(`?addresses=${wallet}`))).toEqual({
      [wallet]: "alice.mezo",
    })
    // The stored answer is the one the address lookup would give.
    const direct = await h.get(wallet)
    expect(direct.headers.get("X-Cache")).toBe("memory")
    expect(await lookup(direct)).toEqual({
      status: "found",
      mezo_id: "alice.mezo",
      wallets: [wallet],
      btc_address: btc,
    })
    expect(h.calls).toEqual([`${upstream}/accounts/alice.mezo`])
  })

  it("never replaces an address's own answer with an ID's", async () => {
    const h = await harness()
    // The address's own lookup: real.mezo.
    h.reply(checksummed, {
      ...found,
      body: { ...found.body, mezoId: "real.mezo" },
    })
    expect((await lookup(await h.get(wallet))).status).toBe("found")
    // An ID claiming the same wallet does not overwrite it.
    h.reply("alice.mezo", found)
    expect((await lookup(await h.get("alice.mezo"))).status).toBe("found")
    expect(await names(await h.names(`?addresses=${wallet}`))).toEqual({
      [wallet]: "real.mezo",
    })
    const direct = await h.get(wallet)
    expect(direct.headers.get("X-Cache")).toBe("memory")
    expect(await lookup(direct)).toEqual({
      status: "found",
      mezo_id: "real.mezo",
      wallets: [wallet],
      btc_address: btc,
    })
  })

  it("keeps an address's own 'no ID yet' for its minute", async () => {
    const h = await harness()
    h.reply(checksummed, {
      kind: "json",
      status: 200,
      body: {
        mezoId: null,
        linkedAccounts: [{ type: "wallet", evmAddress: checksummed }],
      },
    })
    await h.get(wallet)
    h.reply("alice.mezo", found)
    await h.get("alice.mezo")
    expect(await names(await h.names(`?addresses=${wallet}`))).toEqual({})
    expect(await lookup(await h.get(wallet))).toEqual({
      status: "found",
      mezo_id: null,
      wallets: [wallet],
      btc_address: null,
    })
    expect(h.calls).toHaveLength(2)
  })

  it("leaves out misses, addresses without an ID and outages", async () => {
    const h = await harness()
    h.reply(checksummed, {
      kind: "json",
      status: 200,
      body: { mezoId: null, linkedAccounts: [] },
    })
    await h.get(wallet)
    await h.get(other)
    h.reply("alice.mezo", { kind: "throw" })
    await h.get("alice.mezo")
    expect(await names(await h.names(`?addresses=${wallet},${other}`))).toEqual(
      {},
    )
  })

  it("refuses anything but up to 100 addresses", async () => {
    const h = await harness()
    const many = Array.from(
      { length: 101 },
      (_, index) => `0x${index.toString(16).padStart(40, "0")}`,
    )
    for (const query of [
      "",
      "?addresses=",
      "?addresses=alice.mezo",
      `?addresses=${wallet},0x1234`,
      `?addresses=${wallet}&x=1`,
      `?addresses=${many.join(",")}`,
    ]) {
      expect((await h.names(query)).status, query).toBe(400)
    }
    // A hundred is a page's worth; repeats count once.
    const hundred = many.slice(0, 100)
    expect(
      await names(
        await h.names(
          `?addresses=${[...hundred, hundred[0], hundred[0]].join(",")}`,
        ),
      ),
    ).toEqual({})
    expect(h.calls).toEqual([])
  })
})
