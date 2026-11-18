import { env } from "cloudflare:workers"
import {
  blockscoutClientHeader,
  blockscoutEndUserHeader,
} from "@matchbox/contracts/blockscout"
import { errorBodySchema } from "@matchbox/contracts/errors"
import type { RateLimitPolicy } from "@matchbox/contracts/rate-limits"
import { createLogger } from "@matchbox/logger"
import {
  createDurableRateLimitClient,
  createMemoryRateLimitClient,
  errorHandler,
  notFoundHandler,
  type RateLimitClient,
  requestId,
} from "@matchbox/server"
import { Hono } from "hono"
import { beforeEach, describe, expect, it } from "vitest"
import { z } from "zod"
import type { ApiEnv } from "../context"
import { internalAccess } from "../internal/access"
import { cors } from "../middleware/cors"
import registerBlockscoutProxy from "./endpoint"
import address from "./fixtures/address.json"
import addressTokenTransfers from "./fixtures/address-token-transfers.json"
import addressTransactions from "./fixtures/address-transactions.json"
import blocks from "./fixtures/blocks.json"
import mainPageTransactions from "./fixtures/main-page-transactions.json"
import search from "./fixtures/search.json"
import stats from "./fixtures/stats.json"
import transaction from "./fixtures/transaction.json"
import transactionLogs from "./fixtures/transaction-logs.json"
import type { ChainClock } from "./head"
import {
  anonymousRateLimitPolicy,
  createBlockscoutProxy,
  defaultUpstream,
  endUserRateLimitPolicy,
  stuartEndUserRateLimitPolicy,
  stuartRateLimitKey,
  stuartRateLimitPolicy,
  upstreamRateLimitKey,
  upstreamRateLimitPolicy,
} from "./proxy"

const tx = "0x45e0962d6c0fa8ae9d30ba18cf7351ac0fcf3c0487fd231107510ebb0db66988"
const txBlock = 13_118_064
const contract = "0x2ba614a598cffa5a19d683cdca97bac3a49313d1"
const internal = "https://api.internal/internal/blockscout/api/v2"
/** A settled, final transaction (Blockscout filled every enrichment). */
const settledTransaction = {
  ...transaction,
  has_error_in_internal_transactions: false,
}
const endUser = "aGFzaGVkLWlwLXByZWZpeC0wMDE"
const otherEndUser = "aGFzaGVkLWlwLXByZWZpeC0wMDI"

type Reply = {
  status?: number
  body?: unknown
  headers?: Record<string, string>
  /** Resolves the reply only when released (coalescing tests). */
  gate?: Promise<void>
  /** Never answers; the request's signal must end it. */
  hang?: true
}

/** Fake Blockscout: replies per path (a queue; the last one repeats). */
function fakeUpstream() {
  const routes = new Map<string, Reply[]>()
  const calls: string[] = []
  function reply(path: string, ...replies: Reply[]) {
    routes.set(path, replies)
  }
  async function fetcher(url: string, init: RequestInit): Promise<Response> {
    calls.push(url)
    const parsed = new URL(url)
    const path = parsed.pathname.replace("/api/v2/", "")
    const queue = routes.get(path)
    const next = queue && queue.length > 1 ? queue.shift() : queue?.[0]
    if (next === undefined) {
      return Response.json({ message: "Not found" }, { status: 404 })
    }
    if (next.hang === true) {
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () =>
          reject(new DOMException("timed out", "TimeoutError")),
        )
      })
    }
    if (next.gate !== undefined) await next.gate
    return Response.json(next.body ?? {}, {
      status: next.status ?? 200,
      headers: {
        "x-ratelimit-limit": "300",
        "x-ratelimit-remaining": "290",
        "x-ratelimit-reset": "20000",
        ...next.headers,
      },
    })
  }
  return { calls, reply, fetcher }
}

let cacheNumber = 0

type Options = {
  /** false: no Cache API at all (as if it were a no-op). */
  edge?: boolean
  rateLimits?: RateLimitClient | null
  apiKey?: string | null
  memoryBytes?: number
  deadlineMs?: number
}

function harness(options: Options = {}) {
  const upstream = fakeUpstream()
  const state = {
    head: 13_200_000 as number | null,
    lastActive: 13_200_000 as number | null,
    now: 1_794_000_000_000,
    clockReads: 0,
    /** Blockscout's finished_indexing_blocks; null when unreadable. */
    blocksIndexed: true as boolean | null,
    /** Upstream reads already started at each indexing check. */
    indexingAt: [] as number[],
  }
  const logged: string[] = []
  const pending: Promise<unknown>[] = []
  let cache: Cache | null = null
  async function edgeCache(): Promise<Cache | null> {
    if (options.edge === false) return null
    if (cache === null) {
      cacheNumber += 1
      cache = await caches.open(`blockscout-test-${cacheNumber}`)
    }
    return cache
  }
  const logger = createLogger({
    level: "debug",
    sink: (_level, line) => logged.push(line),
  })
  async function build() {
    const proxy = createBlockscoutProxy({
      apiKey: options.apiKey ?? null,
      fetch: upstream.fetcher,
      cache: await edgeCache(),
      clock: async (): Promise<ChainClock> => {
        state.clockReads += 1
        return { height: state.head, lastActive: state.lastActive }
      },
      indexing: async () => {
        state.indexingAt.push(upstream.calls.length)
        return state.blocksIndexed
      },
      rateLimits:
        options.rateLimits === undefined
          ? createMemoryRateLimitClient(() => state.now)
          : options.rateLimits,
      finalityDepth: 30,
      now: () => state.now,
      logger,
      ...(options.memoryBytes === undefined
        ? {}
        : { memoryBytes: options.memoryBytes }),
      ...(options.deadlineMs === undefined
        ? {}
        : { deadlineMs: options.deadlineMs }),
    })
    const app = new Hono<ApiEnv>()
    app.use(requestId({ logger }))
    app.use(internalAccess({ internalToken: null }))
    app.use(cors())
    app.onError(errorHandler())
    app.notFound(notFoundHandler)
    // As in production: the Pro read-model routes, registered first, mark
    // every /internal/* response public (read-models/routes.ts).
    app.use("/internal/*", async (c, next) => {
      c.set("cors", { kind: "public" })
      await next()
    })
    registerBlockscoutProxy(app, proxy)
    return { proxy, app }
  }
  /** One app per "isolate"; `isolate()` makes another over the same cache. */
  let current = build()
  async function get(path: string, init?: RequestInit): Promise<Response> {
    const { app } = await current
    const response = await app.request(`${internal}/${path}`, init, undefined, {
      waitUntil(task: Promise<unknown>) {
        pending.push(task)
      },
      passThroughOnException() {},
      props: {},
    })
    // Let cache writes and background refreshes finish, as they would.
    while (pending.length > 0) await Promise.all(pending.splice(0))
    return response
  }
  async function memoryBytes(): Promise<number> {
    return (await current).proxy.memoryBytes()
  }
  function isolate() {
    current = build()
  }
  function advance(blocks: number, active = true) {
    state.head = (state.head ?? 0) + blocks
    if (active) state.lastActive = state.head
    state.now += blocks * 3_800
  }
  return { upstream, state, logged, get, isolate, advance, memoryBytes }
}

async function errorCode(response: Response) {
  return errorBodySchema.parse(await response.json()).error.code
}

function expectServed(
  response: Response,
  expected: { cache: string; cacheClass: string },
) {
  expect(response.status).toBe(200)
  expect(response.headers.get("X-Cache")).toBe(expected.cache)
  expect(response.headers.get("X-Blockscout-Class")).toBe(expected.cacheClass)
}

let h: ReturnType<typeof harness>

beforeEach(() => {
  h = harness()
})

describe("Stuart's client contract", () => {
  it("serves /internal/blockscout/api/v2/<path> with Blockscout field names", async () => {
    h.upstream.reply(`transactions/${tx}`, { body: transaction })
    // The request Stuart's apiBlockscout builds over its binding.
    const response = await h.get(`transactions/${tx}`, {
      headers: { accept: "application/json" },
    })
    expect(response.status).toBe(200)
    const stuartSchema = z.object({
      hash: z.string(),
      status: z.string().nullable(),
      block_number: z.number().nullable(),
      from: z.object({ hash: z.string() }),
    })
    const body = stuartSchema.parse(await response.json())
    expect(body.hash).toBe(tx)
    expect(body.block_number).toBe(txBlock)
    expect(h.upstream.calls).toEqual([`${defaultUpstream}/transactions/${tx}`])
  })

  it("sends no CORS headers on an answer", async () => {
    h.upstream.reply("stats", { body: stats })
    const response = await h.get("stats", {
      headers: { Origin: "https://pro.matchbox.markets" },
    })
    expect(response.status).toBe(200)
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull()
  })

  it("answers the public origin with a bare 404 and no upstream call", async () => {
    const app = new Hono<ApiEnv>()
    app.use(requestId())
    app.use(internalAccess({ internalToken: null }))
    app.use(cors())
    app.onError(errorHandler())
    registerBlockscoutProxy(
      app,
      createBlockscoutProxy({
        apiKey: null,
        fetch: h.upstream.fetcher,
        cache: null,
        clock: async () => ({ height: 1, lastActive: 1 }),
        rateLimits: null,
        finalityDepth: 30,
        logger: createLogger({ sink: () => undefined }),
      }),
    )
    const response = await app.request(
      "https://api.matchbox.markets/internal/blockscout/api/v2/stats",
      { headers: { Origin: "https://evil.example" } },
    )
    expect(response.status).toBe(404)
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull()
    expect(h.upstream.calls).toEqual([])
  })
})

describe("allowlist", () => {
  it("rejects unknown paths and parameters without a fetch", async () => {
    expect((await h.get("config")).status).toBe(404)
    expect((await h.get(`transactions/${tx}/state-changes`)).status).toBe(404)
    expect((await h.get("../v1/health")).status).toBe(404)
    const unknown = await h.get("blocks?limit=5")
    expect(unknown.status).toBe(400)
    expect(await errorCode(unknown)).toBe("invalid_request")
    expect((await h.get("blocks?apikey=stolen")).status).toBe(400)
    expect((await h.get("search")).status).toBe(400)
    // A partial or junk cursor.
    expect((await h.get("transactions?block_number=13116321")).status).toBe(400)
    expect((await h.get("transactions?block_number=1&index=x")).status).toBe(
      400,
    )
    expect((await h.get("blocks?items_count=50")).status).toBe(400)
    expect(h.upstream.calls).toEqual([])
  })

  it("serves GET only", async () => {
    h.upstream.reply("stats", { body: stats })
    expect((await h.get("stats", { method: "POST" })).status).toBe(404)
    expect((await h.get("stats", { method: "HEAD" })).status).toBe(404)
    expect(h.upstream.calls).toEqual([])
  })

  it("keys mixed-case hashes and addresses once", async () => {
    h.upstream.reply(`addresses/${contract}/token-transfers`, {
      body: { items: [], next_page_params: null },
    })
    const token = "0xdD468A1DDc392dcdbEf6db6e34E89AA338F9F186"
    await h.get(
      `addresses/${contract.toUpperCase().replace("0X", "0x")}/token-transfers?token=${token}`,
    )
    expectServed(
      await h.get(
        `addresses/${contract}/token-transfers?token=${token.toLowerCase()}`,
      ),
      { cache: "memory", cacheClass: "swr" },
    )
    expect(h.upstream.calls).toEqual([
      `${defaultUpstream}/addresses/${contract}/token-transfers?token=${token.toLowerCase()}`,
    ])
  })

  it("sends the API key upstream but never into keys, answers or logs", async () => {
    const keyed = harness({ apiKey: "k3y" })
    keyed.upstream.reply("stats", { body: stats })
    const response = await keyed.get("stats")
    expect(response.status).toBe(200)
    expect(keyed.upstream.calls).toEqual([
      `${defaultUpstream}/stats?apikey=k3y`,
    ])
    expect(await response.text()).not.toContain("k3y")
    expect(keyed.logged.join("\n")).not.toContain("k3y")
  })
})

describe("where an answer came from", () => {
  it("tells memory, edge and miss apart", async () => {
    h.upstream.reply("stats", { body: stats })
    expectServed(await h.get("stats"), { cache: "miss", cacheClass: "slow" })
    expectServed(await h.get("stats"), { cache: "memory", cacheClass: "slow" })
    h.isolate()
    expectServed(await h.get("stats"), { cache: "edge", cacheClass: "slow" })
    expectServed(await h.get("stats"), { cache: "memory", cacheClass: "slow" })
    expect(h.upstream.calls).toHaveLength(1)
  })

  it("logs every answer that did not come from memory", async () => {
    h.upstream.reply("stats", { body: stats })
    await h.get("stats")
    await h.get("stats")
    h.isolate()
    await h.get("stats")
    const answers = h.logged
      .filter((line) => line.includes("Blockscout proxy answer"))
      .map((line) => /"cache":"(\w+)"/.exec(line)?.[1] ?? line)
    expect(answers).toEqual(["miss", "edge"])
  })

  it("still holds the budget with no edge cache, per isolate", async () => {
    const bare = harness({ edge: false })
    bare.upstream.reply("stats", { body: stats })
    expectServed(await bare.get("stats"), { cache: "miss", cacheClass: "slow" })
    expectServed(await bare.get("stats"), {
      cache: "memory",
      cacheClass: "slow",
    })
    // A new isolate has nothing to read from.
    bare.isolate()
    expectServed(await bare.get("stats"), { cache: "miss", cacheClass: "slow" })
    expect(bare.upstream.calls).toHaveLength(2)
  })

  it("answers head-independent classes without reading the head", async () => {
    h.upstream.reply("stats", { body: stats })
    h.upstream.reply(`transactions/${tx}/logs`, { body: transactionLogs })
    await h.get("stats")
    await h.get(`transactions/${tx}/logs`)
    const reads = h.state.clockReads
    const slow = await h.get("stats")
    const immutable = await h.get(`transactions/${tx}/logs`)
    expect(immutable.headers.get("X-Blockscout-Class")).toBe("immutable")
    expect(slow.headers.get("X-Blockscout-Head")).toBe("not-read")
    expect(h.state.clockReads).toBe(reads)
  })
})

describe("cache classes", () => {
  it("keeps a final, settled transaction for a year", async () => {
    h.upstream.reply(`transactions/${tx}`, { body: settledTransaction })
    const first = await h.get(`transactions/${tx}`)
    expectServed(first, { cache: "miss", cacheClass: "immutable" })
    expect(first.headers.get("Cache-Control")).toBe(
      "public, max-age=31536000, immutable",
    )
    h.state.now += 200 * 86_400_000
    h.isolate()
    expectServed(await h.get(`transactions/${tx}`), {
      cache: "edge",
      cacheClass: "immutable",
    })
    expect(h.upstream.calls).toHaveLength(1)
  })

  it("re-reads a final transaction with unsettled enrichment after a day", async () => {
    // As recorded, Blockscout has not set has_error_in_internal_transactions.
    h.upstream.reply(`transactions/${tx}`, { body: transaction })
    expectServed(await h.get(`transactions/${tx}`), {
      cache: "miss",
      cacheClass: "final",
    })
    h.state.now += 23 * 3_600_000
    expectServed(await h.get(`transactions/${tx}`), {
      cache: "memory",
      cacheClass: "final",
    })
    h.state.now += 2 * 3_600_000
    h.upstream.reply(`transactions/${tx}`, { body: settledTransaction })
    expectServed(await h.get(`transactions/${tx}`), {
      cache: "miss",
      cacheClass: "immutable",
    })
  })

  it("keeps a recent transaction per block until it is final", async () => {
    h.state.head = txBlock + 3
    h.upstream.reply(`transactions/${tx}`, {
      body: { ...settledTransaction, confirmations: 4 },
    })
    expectServed(await h.get(`transactions/${tx}`), {
      cache: "miss",
      cacheClass: "per-block",
    })
    h.state.head = txBlock + 40
    h.upstream.reply(`transactions/${tx}`, { body: settledTransaction })
    expectServed(await h.get(`transactions/${tx}`), {
      cache: "miss",
      cacheClass: "immutable",
    })
    expect(h.upstream.calls).toHaveLength(2)
  })

  it("reads the latest blocks once per block whatever the traffic", async () => {
    h.upstream.reply("blocks", { body: blocks })
    const first = await h.get("blocks")
    expectServed(first, { cache: "miss", cacheClass: "per-block" })
    expect(first.headers.get("Cache-Control")).toBe("public, max-age=3")
    expect(first.headers.get("X-Blockscout-Head")).toBe("13200000")
    for (let index = 0; index < 5; index += 1) {
      expectServed(await h.get("blocks"), {
        cache: "memory",
        cacheClass: "per-block",
      })
    }
    h.advance(1, false)
    expectServed(await h.get("blocks"), {
      cache: "miss",
      cacheClass: "per-block",
    })
    expect(h.upstream.calls).toHaveLength(2)
  })

  it("keeps the latest transactions over idle blocks only", async () => {
    h.upstream.reply("main-page/transactions", { body: mainPageTransactions })
    await h.get("main-page/transactions")
    // Two settling blocks after the last activity, then idle blocks.
    h.advance(2, false)
    await h.get("main-page/transactions")
    expect(h.upstream.calls).toHaveLength(2)
    h.advance(5, false)
    expectServed(await h.get("main-page/transactions"), {
      cache: "memory",
      cacheClass: "per-block",
    })
    expect(h.upstream.calls).toHaveLength(2)
    h.advance(1, true)
    expectServed(await h.get("main-page/transactions"), {
      cache: "miss",
      cacheClass: "per-block",
    })
  })

  it("serves address views at once and refreshes them in the background", async () => {
    h.upstream.reply(`addresses/${contract}`, { body: address })
    expectServed(await h.get(`addresses/${contract}`), {
      cache: "miss",
      cacheClass: "swr",
    })
    // Within N = 4 blocks: no refresh, however busy the chain.
    h.advance(3, true)
    expectServed(await h.get(`addresses/${contract}`), {
      cache: "memory",
      cacheClass: "swr",
    })
    // Activity one block ago: wait for Blockscout to settle it.
    h.advance(1, true)
    expectServed(await h.get(`addresses/${contract}`), {
      cache: "memory",
      cacheClass: "swr",
    })
    expect(h.upstream.calls).toHaveLength(1)
    // N blocks after that activity: the old copy now, a refresh behind it.
    h.upstream.reply(`addresses/${contract}`, {
      body: { ...address, coin_balance: "5" },
    })
    h.advance(4, false)
    const served = await h.get(`addresses/${contract}`)
    expectServed(served, { cache: "revalidating", cacheClass: "swr" })
    expect(served.headers.get("Cache-Control")).toBe("no-store")
    expect(await served.json()).toMatchObject({ coin_balance: "0" })
    expect(h.upstream.calls).toHaveLength(2)
    const refreshed = await h.get(`addresses/${contract}`)
    expectServed(refreshed, { cache: "memory", cacheClass: "swr" })
    expect(await refreshed.json()).toMatchObject({ coin_balance: "5" })
  })

  it("keeps settled history pages of an address list for a day, never a year", async () => {
    // Every transfer settled (verified contracts, token metadata known).
    const page = {
      ...addressTokenTransfers,
      items: addressTokenTransfers.items.map((item) => ({
        ...item,
        to: { ...item.to, is_verified: true },
        from: { ...item.from, is_verified: true },
      })),
    }
    h.upstream.reply(`addresses/${contract}/token-transfers`, { body: page })
    const older = `addresses/${contract}/token-transfers?type=ERC-20&block_number=13022412&index=0`
    expectServed(await h.get(older), { cache: "miss", cacheClass: "final" })
    // A busy chain and an hour later: still the stored page, no refresh.
    h.advance(40, true)
    h.state.now += 3_600_000
    expectServed(await h.get(older), { cache: "memory", cacheClass: "final" })
    expect(h.upstream.calls).toHaveLength(1)
    // A day later it is read again: Blockscout says "indexed" from 99%, so
    // a page that spanned a gap it backfilled since heals within a day.
    h.state.now += 86_400_000
    expectServed(await h.get(older), { cache: "miss", cacheClass: "final" })
    expect(h.upstream.calls).toHaveLength(2)
    // The first page is the address's newest activity: still an swr view.
    expectServed(
      await h.get(`addresses/${contract}/token-transfers?type=ERC-20`),
      { cache: "miss", cacheClass: "swr" },
    )
    // History whose blocks are not final yet keeps the route's freshness.
    h.state.head = 13_022_420
    expectServed(
      await h.get(
        `addresses/${contract}/token-transfers?type=ERC-20&block_number=13022412&index=1`,
      ),
      { cache: "miss", cacheClass: "swr" },
    )
  })

  it("keeps history pages short while Blockscout backfills blocks or the cursor is not final", async () => {
    const page = {
      ...addressTokenTransfers,
      items: addressTokenTransfers.items.map((item) => ({
        ...item,
        to: { ...item.to, is_verified: true },
        from: { ...item.from, is_verified: true },
      })),
    }
    h.upstream.reply(`addresses/${contract}/token-transfers`, { body: page })
    const older = (index: number, block = 13022412) =>
      `addresses/${contract}/token-transfers?type=ERC-20&block_number=${block}&index=${index}`
    // A catch-up restarted at the head: older pages may span a gap.
    h.state.blocksIndexed = false
    expectServed(await h.get(older(0)), { cache: "miss", cacheClass: "swr" })
    // Unknown indexing state is not trusted either.
    h.state.blocksIndexed = null
    expectServed(await h.get(older(1)), { cache: "miss", cacheClass: "swr" })
    // Every item is final, but the cursor's own block is not.
    h.state.blocksIndexed = true
    expectServed(await h.get(older(2, (h.state.head ?? 0) - 5)), {
      cache: "miss",
      cacheClass: "swr",
    })
    // Indexed and a final cursor: kept a day.
    expectServed(await h.get(older(3)), {
      cache: "miss",
      cacheClass: "final",
    })
    // Each indexing check started before its page's upstream read, beside
    // it rather than after it.
    expect(h.state.indexingAt).toEqual([0, 1, 2, 3])
  })

  it("refreshes address views once per 8N blocks on a busy chain", async () => {
    h.upstream.reply(`addresses/${contract}/counters`, {
      body: {
        transactions_count: "1",
        token_transfers_count: "0",
        gas_usage_count: "0",
        validations_count: "0",
      },
    })
    await h.get(`addresses/${contract}/counters`)
    // Every block has transactions: the view waits up to 32 blocks.
    for (let block = 1; block < 32; block += 1) {
      h.advance(1, true)
      await h.get(`addresses/${contract}/counters`)
    }
    expect(h.upstream.calls).toHaveLength(1)
    h.advance(1, true)
    expectServed(await h.get(`addresses/${contract}/counters`), {
      cache: "revalidating",
      cacheClass: "swr",
    })
    expect(h.upstream.calls).toHaveLength(2)
  })

  it("does not refresh address views over idle blocks", async () => {
    h.upstream.reply(`addresses/${contract}/transactions`, {
      body: addressTransactions,
    })
    await h.get(`addresses/${contract}/transactions`)
    // Read N blocks after the last activity, then 40 idle blocks.
    h.advance(4, false)
    await h.get(`addresses/${contract}/transactions`)
    expect(h.upstream.calls).toHaveLength(2)
    h.advance(40, false)
    expectServed(await h.get(`addresses/${contract}/transactions`), {
      cache: "memory",
      cacheClass: "swr",
    })
    expect(h.upstream.calls).toHaveLength(2)
    // ...but not forever: ten minutes is the cap.
    h.state.now += 600_000
    expectServed(await h.get(`addresses/${contract}/transactions`), {
      cache: "revalidating",
      cacheClass: "swr",
    })
    expect(h.upstream.calls).toHaveLength(3)
  })

  it("keeps not-yet-final chain data over idle blocks", async () => {
    h.state.head = txBlock + 3
    h.state.lastActive = txBlock + 3
    h.upstream.reply(`transactions/${tx}`, {
      body: { ...settledTransaction, confirmations: 4 },
    })
    await h.get(`transactions/${tx}`)
    h.advance(2, false)
    await h.get(`transactions/${tx}`)
    expect(h.upstream.calls).toHaveLength(2)
    h.advance(10, false)
    expectServed(await h.get(`transactions/${tx}`), {
      cache: "memory",
      cacheClass: "per-block",
    })
    expect(h.upstream.calls).toHaveLength(2)
  })

  it("caches search for 45 seconds, not per block", async () => {
    h.upstream.reply("search", { body: search })
    expectServed(await h.get("search?q=MUSD"), {
      cache: "miss",
      cacheClass: "search",
    })
    h.advance(10, true)
    expectServed(await h.get("search?q=MUSD"), {
      cache: "memory",
      cacheClass: "search",
    })
    h.state.now += 46_000
    expectServed(await h.get("search?q=MUSD"), {
      cache: "miss",
      cacheClass: "search",
    })
  })

  it("keeps slow aggregates for their TTL across blocks", async () => {
    h.upstream.reply("stats", { body: stats })
    await h.get("stats")
    h.advance(30, true)
    h.state.now += 120_000
    const later = await h.get("stats")
    expectServed(later, { cache: "memory", cacheClass: "slow" })
    h.state.now += 200_000
    expectServed(await h.get("stats"), { cache: "miss", cacheClass: "slow" })
  })

  it("believes a 404 on a slow route for a minute", async () => {
    const missing = `0x${"9".repeat(40)}`
    expect((await h.get(`tokens/${missing}`)).status).toBe(404)
    h.isolate()
    expect((await h.get(`tokens/${missing}`)).status).toBe(404)
    expect(h.upstream.calls).toHaveLength(1)
    h.state.now += 61_000
    expect((await h.get(`tokens/${missing}`)).status).toBe(404)
    expect(h.upstream.calls).toHaveLength(2)
  })

  it("believes a 404 on chain data for one block", async () => {
    const missing = `0x${"9".repeat(64)}`
    expect((await h.get(`transactions/${missing}`)).status).toBe(404)
    expect((await h.get(`transactions/${missing}`)).status).toBe(404)
    expect(h.upstream.calls).toHaveLength(1)
    h.advance(1, false)
    expect((await h.get(`transactions/${missing}`)).status).toBe(404)
    expect(h.upstream.calls).toHaveLength(2)
  })

  it("falls back to a 3.8 s bucket when the head is unknown", async () => {
    h.state.head = null
    h.upstream.reply("blocks", { body: blocks })
    const first = await h.get("blocks")
    expect(first.headers.get("X-Blockscout-Head")).toBe("unknown")
    expectServed(await h.get("blocks"), {
      cache: "memory",
      cacheClass: "per-block",
    })
    h.state.now += 3_800
    expectServed(await h.get("blocks"), {
      cache: "miss",
      cacheClass: "per-block",
    })
  })
})

describe("memory", () => {
  it("is bounded by bytes and skips large bodies", async () => {
    const probe = harness({ edge: false })
    probe.upstream.reply("stats", { body: stats })
    await probe.get("stats")
    const statsBytes = await probe.memoryBytes()
    expect(statsBytes).toBeGreaterThan(0)
    // Room for stats and a little more, not for stats and blocks.
    const budget = statsBytes + 500
    const small = harness({ memoryBytes: budget, edge: false })
    small.upstream.reply("stats", { body: stats })
    small.upstream.reply("blocks", { body: blocks })
    await small.get("stats")
    expect(await small.memoryBytes()).toBe(statsBytes)
    await small.get("blocks")
    expect(await small.memoryBytes()).toBeLessThanOrEqual(budget)
    // stats was evicted to make room.
    expectServed(await small.get("stats"), {
      cache: "miss",
      cacheClass: "slow",
    })

    const huge = harness({ edge: false })
    const items = Array.from({ length: 400 }, () => blocks.items[0])
    huge.upstream.reply("blocks", { body: { ...blocks, items } })
    await huge.get("blocks")
    expect(await huge.memoryBytes()).toBe(0)
  })
})

describe("coalescing", () => {
  it("shares one upstream read between concurrent identical misses", async () => {
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    h.upstream.reply("main-page/blocks", { body: blocks.items, gate })
    const responses = Promise.all(
      Array.from({ length: 5 }, () => h.get("main-page/blocks")),
    )
    await new Promise((resolve) => setTimeout(resolve, 10))
    release()
    const served = await responses
    expect(h.upstream.calls).toHaveLength(1)
    const statuses = served.map((response) => response.headers.get("X-Cache"))
    expect(statuses.filter((status) => status === "miss")).toHaveLength(1)
    expect(statuses.filter((status) => status === "coalesced")).toHaveLength(4)
  })
})

describe("upstream failures", () => {
  it("retries a 5xx once, then serves the stored copy", async () => {
    h.upstream.reply("blocks", { body: blocks }, { status: 502 })
    await h.get("blocks")
    h.advance(1, true)
    h.isolate()
    const stale = await h.get("blocks")
    expectServed(stale, { cache: "stale", cacheClass: "per-block" })
    expect(stale.headers.get("Cache-Control")).toBe("no-store")
    expect(h.upstream.calls).toHaveLength(3)
  })

  it("recovers on the retry after one 5xx", async () => {
    h.upstream.reply("stats", { status: 503 }, { body: stats })
    expectServed(await h.get("stats"), { cache: "miss", cacheClass: "slow" })
    expect(h.upstream.calls).toHaveLength(2)
  })

  it("does not retry other 4xx", async () => {
    h.upstream.reply("blocks", { status: 422, body: { errors: [] } })
    expect((await h.get("blocks")).status).toBe(400)
    expect(h.upstream.calls).toHaveLength(1)
  })

  it("treats a refused API key as an outage, logged as an error", async () => {
    h.upstream.reply("stats", { body: stats })
    await h.get("stats")
    h.state.now += 301_000
    h.upstream.reply("stats", { status: 401 })
    expectServed(await h.get("stats"), { cache: "stale", cacheClass: "slow" })
    const fresh = harness()
    fresh.upstream.reply("stats", { status: 403 })
    const refused = await fresh.get("stats")
    expect(refused.status).toBe(503)
    expect(await errorCode(refused)).toBe("service_disabled")
    expect(fresh.logged.join("\n")).toMatch(
      /"level":"error".*refused the proxy's credentials|refused the proxy's credentials/,
    )
    expect(fresh.upstream.calls).toHaveLength(1)
  })

  it("answers 503 without a copy and leaks nothing upstream-specific", async () => {
    h.upstream.reply("stats", { status: 500, body: { message: "boom db" } })
    const response = await h.get("stats")
    expect(response.status).toBe(503)
    expect(response.headers.get("Retry-After")).toBe("5")
    expect(await response.text()).not.toContain("boom")
  })

  it("gives up within the deadline, retry included", async () => {
    const slow = harness({ deadlineMs: 150 })
    slow.upstream.reply("stats", { hang: true })
    // The upstream never answers, so a 503 at all is the deadline's own
    // abort: no wall-clock bound needed.
    const response = await slow.get("stats")
    expect(response.status).toBe(503)
    // A timeout is not retried.
    expect(slow.upstream.calls).toHaveLength(1)
  })

  it("skips the retry when too little of the deadline is left", async () => {
    const tight = harness({ deadlineMs: 900 })
    tight.upstream.reply("stats", { status: 502 })
    expect((await tight.get("stats")).status).toBe(503)
    expect(tight.upstream.calls).toHaveLength(1)
  })

  it("backs off on a 429 and serves stored copies meanwhile", async () => {
    h.upstream.reply("blocks", { body: blocks })
    await h.get("blocks")
    h.upstream.reply("blocks", {
      status: 429,
      headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "20000" },
    })
    h.advance(1, true)
    expectServed(await h.get("blocks"), {
      cache: "stale",
      cacheClass: "per-block",
    })
    h.upstream.reply("stats", { body: stats })
    const limited = await h.get("stats")
    expect(limited.status).toBe(429)
    expect(limited.headers.get("Retry-After")).toBe("20")
    expect(h.upstream.calls).toHaveLength(2)
    h.state.now += 21_000
    expectServed(await h.get("stats"), { cache: "miss", cacheClass: "slow" })
  })

  it("backs off before the limit when remaining runs low", async () => {
    h.upstream.reply("stats", {
      body: stats,
      headers: { "x-ratelimit-remaining": "10", "x-ratelimit-reset": "8000" },
    })
    await h.get("stats")
    h.upstream.reply("blocks", { body: blocks })
    expect((await h.get("blocks")).status).toBe(429)
    expect(h.upstream.calls).toHaveLength(1)
    expect(h.logged.join("\n")).toContain("nearly spent")
  })

  it("fails a schema change in one place with a generic error", async () => {
    h.upstream.reply("stats", { body: { ...stats, total_blocks: 5 } })
    const response = await h.get("stats")
    expect(response.status).toBe(503)
    expect(await errorCode(response)).toBe("service_disabled")
    const log = h.logged.join("\n")
    expect(log).toContain("Blockscout response failed its schema")
    expect(log).toContain("total_blocks")
  })
})

describe("budgets", () => {
  function counting() {
    const spent: { key: string; policy: RateLimitPolicy }[] = []
    let now = 0
    const memory = createMemoryRateLimitClient(() => now)
    const client: RateLimitClient = {
      consume(key, policy) {
        spent.push({ key, policy })
        return memory.consume(key, policy)
      },
      refund: (key) => memory.refund(key),
    }
    return { spent, client, memory, tick: (ms: number) => (now += ms) }
  }

  it("gives back what earlier buckets spent when a later one refuses", async () => {
    const { client, memory } = counting()
    const busy = harness({ rateLimits: client })
    const as = (user: string, caller = "stuart") => ({
      headers: {
        [blockscoutClientHeader]: caller,
        [blockscoutEndUserHeader]: user,
      },
    })
    const used = async (key: string) =>
      (await memory.peek(key)).state.day?.count ?? 0
    // Two visitors spend the Stuart-wide minute between them.
    for (let page = 0; page < stuartRateLimitPolicy.perMinute; page += 1) {
      busy.upstream.reply("search", { body: search })
      const user = page % 2 === 0 ? endUser : otherEndUser
      expect((await busy.get(`search?q=w${page}`, as(user))).status).toBe(200)
    }
    // A third visitor is refused by the Stuart-wide bucket: its own
    // quota is given back, not spent on reads it never got.
    const third = "aGFzaGVkLWlwLXByZWZpeC0wMDM"
    for (let page = 0; page < 5; page += 1) {
      const refused = await busy.get(`search?q=t${page}`, as(third))
      expect(refused.status).toBe(429)
    }
    expect(await used(`blockscout:caller:stuart:${third}`)).toBe(0)
    expect(await used(stuartRateLimitKey)).toBe(stuartRateLimitPolicy.perMinute)
    // Scan still gets the rest of the shared bucket (the next test has a
    // Stuart read refused there giving back both Stuart buckets).
    const left =
      upstreamRateLimitPolicy.perMinute - stuartRateLimitPolicy.perMinute
    for (let page = 0; page < left; page += 1) {
      busy.upstream.reply("search", { body: search })
      const user = `c2Nhbi12aXNpdG9yLTAw${String(page).padStart(3, "0")}`
      expect(
        (await busy.get(`search?q=s${page}`, as(user, "scan"))).status,
      ).toBe(200)
    }
    expect(await used(upstreamRateLimitKey)).toBe(
      upstreamRateLimitPolicy.perMinute,
    )
  })

  it("refunds a Stuart read the shared bucket refuses", async () => {
    const { client, memory, tick } = counting()
    const busy = harness({ rateLimits: client })
    const scan = (user: string) => ({
      headers: {
        [blockscoutClientHeader]: "scan",
        [blockscoutEndUserHeader]: user,
      },
    })
    // Scan alone spends the shared minute.
    for (let page = 0; page < upstreamRateLimitPolicy.perMinute; page += 1) {
      busy.upstream.reply("search", { body: search })
      const user = `c2Nhbi12aXNpdG9yLTAw${String(page % 7).padStart(3, "0")}`
      expect((await busy.get(`search?q=s${page}`, scan(user))).status).toBe(200)
    }
    const stuart = {
      headers: {
        [blockscoutClientHeader]: "stuart",
        [blockscoutEndUserHeader]: endUser,
      },
    }
    for (let page = 0; page < 10; page += 1) {
      expect((await busy.get(`search?q=x${page}`, stuart)).status).toBe(429)
    }
    expect(
      (await memory.peek(`blockscout:caller:stuart:${endUser}`)).state.day
        ?.count ?? 0,
    ).toBe(0)
    expect((await memory.peek(stuartRateLimitKey)).state.day?.count ?? 0).toBe(
      0,
    )
    // Next minute the visitor reads as normal.
    tick(60_000)
    busy.upstream.reply("search", { body: search })
    expect((await busy.get("search?q=after", stuart)).status).toBe(200)
  })

  it("refunds nothing for a bucket that failed open", async () => {
    const refunded: string[] = []
    const client: RateLimitClient = {
      async consume(key, policy) {
        // The visitor's bucket is down (fails open); the shared one refuses.
        if (key.startsWith("blockscout:caller:stuart:")) {
          throw new Error("limiter down")
        }
        if (key === upstreamRateLimitKey) {
          return { allowed: false, retryAfterSeconds: 5 } as Awaited<
            ReturnType<RateLimitClient["consume"]>
          >
        }
        return createMemoryRateLimitClient(() => 0).consume(key, policy)
      },
      async refund(key) {
        refunded.push(key)
      },
    }
    const busy = harness({ rateLimits: client })
    const response = await busy.get("search?q=down", {
      headers: {
        [blockscoutClientHeader]: "stuart",
        [blockscoutEndUserHeader]: endUser,
      },
    })
    expect(response.status).toBe(429)
    // Only Stuart's own bucket spent, so only it is given back.
    expect(refunded).toEqual([stuartRateLimitKey])
  })

  it("refunds through the RateLimiter Durable Object", async () => {
    const limits = createDurableRateLimitClient(env.RATE_LIMITER)
    const key = "test:refund"
    const policy = { perMinute: 2, perDay: 10 }
    await limits.consume(key, policy)
    await limits.consume(key, policy)
    expect((await limits.consume(key, policy)).allowed).toBe(false)
    await limits.refund(key)
    expect((await limits.peek(key)).state.minute?.count).toBe(1)
    expect((await limits.consume(key, policy)).allowed).toBe(true)
  })

  it("spends the caller's bucket, then the shared one, on misses only", async () => {
    const { spent, client } = counting()
    const counted = harness({ rateLimits: client })
    counted.upstream.reply("stats", { body: stats })
    const headers = {
      [blockscoutClientHeader]: "scan",
      [blockscoutEndUserHeader]: endUser,
    }
    await counted.get("stats", { headers })
    await counted.get("stats", { headers })
    expect(spent).toEqual([
      {
        key: `blockscout:caller:scan:${endUser}`,
        policy: endUserRateLimitPolicy,
      },
      { key: upstreamRateLimitKey, policy: upstreamRateLimitPolicy },
    ])
  })

  it("stops one end user from draining the shared bucket", async () => {
    const { client } = counting()
    const shared = harness({ rateLimits: client })
    const as = (user: string) => ({
      headers: {
        [blockscoutClientHeader]: "scan",
        [blockscoutEndUserHeader]: user,
      },
    })
    // Thirty distinct searches: each one a miss.
    for (let index = 0; index < endUserRateLimitPolicy.perMinute; index += 1) {
      shared.upstream.reply("search", { body: search })
      const ok = await shared.get(`search?q=bust${index}`, as(endUser))
      expect(ok.status).toBe(200)
    }
    const limited = await shared.get("search?q=bust-more", as(endUser))
    expect(limited.status).toBe(429)
    // Someone else is unaffected.
    expect((await shared.get("search?q=other", as(otherEndUser))).status).toBe(
      200,
    )
  })

  it("gives a Stuart visitor room for a cold trace question", async () => {
    const { spent, client } = counting()
    const traced = harness({ rateLimits: client })
    const as = {
      headers: {
        [blockscoutClientHeader]: "stuart",
        [blockscoutEndUserHeader]: endUser,
      },
    }
    // A cold since-April trace reads about 35 pages: past Scan's 30.
    for (let index = 0; index < 40; index += 1) {
      traced.upstream.reply("search", { body: search })
      const ok = await traced.get(`search?q=page${index}`, as)
      expect(ok.status).toBe(200)
    }
    expect(spent[0]).toEqual({
      key: `blockscout:caller:stuart:${endUser}`,
      policy: stuartEndUserRateLimitPolicy,
    })
    expect(stuartEndUserRateLimitPolicy.perMinute).toBeLessThan(
      upstreamRateLimitPolicy.perMinute,
    )
    expect(stuartEndUserRateLimitPolicy.perDay).toBe(
      endUserRateLimitPolicy.perDay,
    )
  })

  it("caps Stuart's visitors together so Scan and Pro keep the shared bucket", async () => {
    const { client } = counting()
    const busy = harness({ rateLimits: client })
    const visitors = [endUser, otherEndUser, "aGFzaGVkLWlwLXByZWZpeC0wMDM"]
    const as = (user: string, caller = "stuart") => ({
      headers: {
        [blockscoutClientHeader]: caller,
        [blockscoutEndUserHeader]: user,
      },
    })
    // Three visitors, two cold questions each in one minute: 70 reads
    // apiece, 210 together, more than the shared 200.
    const statuses: number[] = []
    for (let page = 0; page < 70; page += 1) {
      for (const [index, user] of visitors.entries()) {
        busy.upstream.reply("search", { body: search })
        const response = await busy.get(`search?q=p${index}x${page}`, as(user))
        statuses.push(response.status)
      }
    }
    expect(statuses.filter((status) => status === 200)).toHaveLength(
      stuartRateLimitPolicy.perMinute,
    )
    expect(statuses.filter((status) => status === 429)).toHaveLength(
      210 - stuartRateLimitPolicy.perMinute,
    )
    // Scan's visitors still read: at least 80 a minute are left.
    for (let page = 0; page < 3; page += 1) {
      for (let index = 0; index < 26; index += 1) {
        busy.upstream.reply("search", { body: search })
        const user = `c2Nhbi12aXNpdG9yLTAw${String.fromCharCode(65 + page)}${String.fromCharCode(65 + index)}`
        const response = await busy.get(
          `search?q=s${page}x${index}`,
          as(user, "scan"),
        )
        expect(response.status).toBe(200)
      }
    }
    expect(
      upstreamRateLimitPolicy.perMinute - stuartRateLimitPolicy.perMinute,
    ).toBeGreaterThanOrEqual(80)
  })

  it("puts callers without an end-user key in one anonymous bucket", async () => {
    const { spent, client } = counting()
    const anonymous = harness({ rateLimits: client })
    anonymous.upstream.reply("stats", { body: stats })
    await anonymous.get("stats")
    expect(spent[0]).toEqual({
      key: "blockscout:caller:unknown:anonymous",
      policy: anonymousRateLimitPolicy,
    })
  })

  it("rejects malformed caller headers", async () => {
    expect(
      (
        await h.get("stats", {
          headers: { [blockscoutEndUserHeader]: "1.2.3.4" },
        })
      ).status,
    ).toBe(400)
    expect(
      (await h.get("stats", { headers: { [blockscoutClientHeader]: "Scan!" } }))
        .status,
    ).toBe(400)
    expect(h.upstream.calls).toEqual([])
  })

  it("answers 429 when the shared bucket is spent", async () => {
    const denied = harness({
      rateLimits: {
        consume: async (key) =>
          key === upstreamRateLimitKey
            ? {
                allowed: false,
                limit: 200,
                remaining: 0,
                resetAt: 0,
                retryAfterSeconds: 12,
              }
            : {
                allowed: true,
                limit: 60,
                remaining: 59,
                resetAt: 0,
                retryAfterSeconds: 0,
              },
      },
    })
    denied.upstream.reply("stats", { body: stats })
    const response = await denied.get("stats")
    expect(response.status).toBe(429)
    expect(response.headers.get("Retry-After")).toBe("12")
    expect(denied.upstream.calls).toEqual([])
  })

  it("fails open when the limiter is down", async () => {
    const broken = harness({
      rateLimits: {
        consume: async () => {
          throw new Error("limiter down")
        },
      },
    })
    broken.upstream.reply("stats", { body: stats })
    expect((await broken.get("stats")).status).toBe(200)
  })
})
