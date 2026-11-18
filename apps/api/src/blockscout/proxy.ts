import type { BlockscoutCaller } from "@matchbox/contracts/blockscout"
import type { RateLimitPolicy } from "@matchbox/contracts/rate-limits"
import type { Logger } from "@matchbox/logger"
import type { RateLimitClient } from "@matchbox/server"
import { z } from "zod"
import { type ChainClock, createIndexingReader, unknownClock } from "./head"
import {
  type CacheClass,
  checkQuery,
  type HistoryCursor,
  type MatchedRoute,
  matchRoute,
} from "./routes"

// The Blockscout proxy engine, independent of Hono. One request:
//
// 1. Match the path against the allowlist; check and canonicalise the query.
// 2. Look up the one stored answer for that resource: this isolate's memory
//    first, then the Cache API. Each answer records its class, when it was
//    read and at which head, so freshness is decided here, per class
//    (routes.ts), not by the key. Classes that do not depend on the head
//    are answered without reading it.
// 3. Address views (`swr`) past their window are answered from the stored
//    copy at once and refreshed in the background.
// 4. Otherwise one upstream read per resource per isolate: concurrent
//    identical misses share it. A read must pass the isolate backoff (a 429
//    or a low x-ratelimit-remaining), the caller's bucket and the shared
//    `blockscout:upstream` bucket (both in the RateLimiter Durable Object).
// 5. Validate and trim the body with the route's schema, classify it,
//    store it, answer. Upstream errors, 401/403, 429s, backoff, spent
//    buckets and schema failures serve the stored copy when there is one.

export const defaultUpstream = "https://api.explorer.mezo.org/api/v2"

/**
 * The shared bucket every upstream read spends. Blockscout allows 300
 * requests a minute per IP for all our traffic; this leaves a third of it
 * for the API's other Blockscout reads (gauge labels) and for bursts.
 */
export const upstreamRateLimitKey = "blockscout:upstream"
export const upstreamRateLimitPolicy: RateLimitPolicy = {
  perMinute: 200,
  perDay: 150_000,
}

/** One identified end user (client and end-user headers both set). */
export const endUserRateLimitPolicy: RateLimitPolicy = {
  perMinute: 30,
  perDay: 3_000,
}

/**
 * One Stuart visitor. A cold "follow the money" question reads 20 to 35
 * history pages at once, so a visitor gets three such questions a minute,
 * still well inside the shared 200; the daily cap is the same.
 */
export const stuartEndUserRateLimitPolicy: RateLimitPolicy = {
  perMinute: 90,
  perDay: 3_000,
}

/**
 * Every Stuart visitor together, spent beside each visitor's own bucket:
 * three visitors asking cold questions in the same minute would otherwise
 * spend the shared 200 and leave Scan and Pro nothing. This keeps at least
 * 80 a minute of the shared bucket for everyone else.
 */
export const stuartRateLimitKey = "blockscout:client:stuart"
export const stuartRateLimitPolicy: RateLimitPolicy = {
  perMinute: 120,
  perDay: 60_000,
}

/** The end-user bucket for `client`'s visitors. */
export function endUserPolicyFor(client: string | null): RateLimitPolicy {
  return client === "stuart"
    ? stuartEndUserRateLimitPolicy
    : endUserRateLimitPolicy
}

/** Everyone a client sends without an end-user key, together. */
export const anonymousRateLimitPolicy: RateLimitPolicy = {
  perMinute: 60,
  perDay: 20_000,
}

export function callerRateLimitKey(caller: BlockscoutCaller): string {
  const client = caller.client ?? "unknown"
  return caller.endUser === null
    ? `blockscout:caller:${client}:anonymous`
    : `blockscout:caller:${client}:${caller.endUser}`
}

/** Stop reading upstream when x-ratelimit-remaining falls this low. */
export const lowRemainingThreshold = 25
/**
 * Every upstream attempt and the retry delay fit in this, so with the head
 * read (300 ms) and the bucket checks an answer stays inside Stuart's 5 s
 * client timeout.
 */
export const upstreamDeadlineMs = 4_000
const retryDelayMs = 200
/** A retry is only started with at least this much of the deadline left. */
const minimumRetryWindowMs = 1_000
/** Without a usable x-ratelimit-reset, back off this long. */
const defaultBackoffMs = 30_000
const maxBackoffMs = 60_000
/** Mezo's block time; time buckets stand in for an unknown head. */
export const blockMs = 3_800

/** Default N for `swr`: refresh an address view at most every 4 blocks. */
export const defaultRevalidateBlocks = 4
/** Transaction lists stay fresh over idle blocks once Blockscout had two. */
const latestSettleBlocks = 2
/** An `swr` entry kept over idle blocks is still re-read after this. */
export const swrIdleMaxMs = 600_000
/** On a busy chain an `swr` entry waits at most this many windows. */
const swrMaxWaitWindows = 8
/** `final`: chain data whose enrichment may still change. */
const finalMs = 86_400_000
/** A 404 on a TTL route (search, slow) is believed this long. */
const negativeTtlMs = 60_000

/** Seconds the Cache API keeps an answer (beyond freshness: stale copies). */
const storageSeconds = {
  immutable: 31_536_000,
  other: 86_400,
  negative: 60,
} as const

/** Isolate memory: a byte budget, and nothing larger than one entry cap. */
export const defaultMemoryBytes = 8 * 1024 * 1024
export const maxMemoryEntryBytes = 256 * 1024

/** Bumped when a schema or entry format changes. */
const keyVersion = "v2"
const keyOrigin = "https://blockscout-proxy.internal"

/**
 * - `memory`, `edge`: fresh, from this isolate or the Cache API.
 * - `miss`: read upstream now; `coalesced`: shared another request's read.
 * - `revalidating`: an address view past its window, served while a
 *   background read refreshes it.
 * - `stale`: the stored copy, because the upstream could not be read.
 */
export type ProxyCacheStatus =
  | "memory"
  | "edge"
  | "miss"
  | "coalesced"
  | "revalidating"
  | "stale"

export type ProxyAnswer =
  | {
      kind: "ok"
      body: string
      cacheClass: CacheClass
      cacheStatus: ProxyCacheStatus
      cacheControl: string
      /** The head freshness was judged at, `unknown`, or `not-read`. */
      head: string
      template: string
    }
  | { kind: "not-found"; template: string | null }
  | { kind: "invalid"; template: string }
  /** Upstream down, refused, rate limited or malformed, and no copy. */
  | {
      kind: "unavailable"
      reason: "upstream" | "rate-limited" | "schema"
      retryAfterSeconds: number
      template: string
    }

export type BlockscoutProxyDeps = {
  upstream?: string
  /** Blockscout API key, sent as `apikey`; null sends none. */
  apiKey: string | null
  fetch: (url: string, init: RequestInit) => Promise<Response>
  /** The edge cache; null leaves only the isolate memory. */
  cache: Cache | null
  /** Head and last active block (createHeadReader); unknown on failure. */
  clock: () => Promise<ChainClock>
  /**
   * Whether Blockscout reports every block indexed; null when unknown.
   * Default: `main-page/indexing-status` upstream, once a minute.
   */
  indexing?: () => Promise<boolean | null>
  /** The RateLimiter client; null skips both buckets. */
  rateLimits: RateLimitClient | null
  finalityDepth: number
  /** N for `swr` routes (default 4 blocks, about 15 s). */
  revalidateBlocks?: number
  logger: Logger
  /** Epoch milliseconds. */
  now?: () => number
  /** Isolate memory budget in bytes (default 8 MiB). */
  memoryBytes?: number
  /** Total upstream deadline (default upstreamDeadlineMs). */
  deadlineMs?: number
}

type Entry = {
  status: 200 | 404
  body: string
  cacheClass: CacheClass
  /** Epoch ms the upstream answered. */
  fetchedAt: number
  /** The head when it was read, or null when unknown. */
  head: number | null
}

const entryHeadersSchema = z.object({
  status: z
    .enum(["200", "404"])
    .transform((value): 200 | 404 => (value === "200" ? 200 : 404)),
  cacheClass: z.enum([
    "immutable",
    "final",
    "per-block",
    "swr",
    "search",
    "slow",
  ]),
  fetchedAt: z.coerce.number().int().nonnegative(),
  head: z
    .string()
    .transform((value) => (value === "" ? null : Number.parseInt(value, 10))),
})

/** Approximate bytes an entry holds in memory (UTF-16 strings). */
function entryBytes(key: string, entry: Entry): number {
  return (key.length + entry.body.length) * 2 + 128
}

/** Isolate memory (a byte-budgeted LRU) in front of the Cache API. */
class EntryStore {
  private readonly memory = new Map<string, { entry: Entry; bytes: number }>()
  private bytes = 0

  constructor(
    private readonly cache: Cache | null,
    private readonly budget: number,
  ) {}

  /** Bytes held in memory, for tests and logs. */
  get heldBytes(): number {
    return this.bytes
  }

  fromMemory(key: string): Entry | null {
    const held = this.memory.get(key)
    if (held === undefined) return null
    // Refresh its place in the LRU order.
    this.memory.delete(key)
    this.memory.set(key, held)
    return held.entry
  }

  async fromEdge(key: string): Promise<Entry | null> {
    if (this.cache === null) return null
    const hit = await this.cache.match(new Request(key))
    if (hit === undefined) return null
    const headers = entryHeadersSchema.safeParse({
      status: hit.headers.get("X-Entry-Status"),
      cacheClass: hit.headers.get("X-Entry-Class"),
      fetchedAt: hit.headers.get("X-Entry-Fetched-At"),
      head: hit.headers.get("X-Entry-Head") ?? "",
    })
    if (!headers.success) return null
    const entry: Entry = { ...headers.data, body: await hit.text() }
    this.remember(key, entry)
    return entry
  }

  /** Stores in memory now; returns the Cache API write for waitUntil. */
  put(key: string, entry: Entry, seconds: number): Promise<void> {
    this.remember(key, entry)
    if (this.cache === null) return Promise.resolve()
    const response = new Response(entry.body, {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": storageCacheControl(entry.cacheClass, seconds),
        "X-Entry-Status": String(entry.status),
        "X-Entry-Class": entry.cacheClass,
        "X-Entry-Fetched-At": String(entry.fetchedAt),
        "X-Entry-Head": entry.head === null ? "" : String(entry.head),
      },
    })
    return this.cache.put(new Request(key), response)
  }

  private remember(key: string, entry: Entry): void {
    const previous = this.memory.get(key)
    if (previous !== undefined) {
      this.memory.delete(key)
      this.bytes -= previous.bytes
    }
    const bytes = entryBytes(key, entry)
    // Large bodies (big pages, ABIs) live only at the edge.
    if (bytes > maxMemoryEntryBytes) return
    this.memory.set(key, { entry, bytes })
    this.bytes += bytes
    while (this.bytes > this.budget) {
      const oldest = this.memory.entries().next().value
      if (oldest === undefined) break
      this.memory.delete(oldest[0])
      this.bytes -= oldest[1].bytes
    }
  }
}

/** Cache-Control on the stored copy: how long the Cache API keeps it. */
function storageCacheControl(cacheClass: CacheClass, seconds: number): string {
  const base = `public, max-age=${seconds}, s-maxage=${seconds}`
  return cacheClass === "immutable" ? `${base}, immutable` : base
}

type Upstream =
  | { kind: "ok"; raw: unknown }
  | { kind: "not-found" }
  | { kind: "rejected" }
  | { kind: "rate-limited"; retryAfterSeconds: number }
  | { kind: "failed" }

class UpstreamError extends Error {
  constructor(readonly status: number) {
    super(`Blockscout answered ${status}`)
    this.name = "UpstreamError"
  }
}

export type BlockscoutProxy = {
  handle: (
    path: string,
    query: URLSearchParams,
    caller: BlockscoutCaller,
    background: (task: Promise<unknown>) => void,
  ) => Promise<ProxyAnswer>
  /** Bytes held in isolate memory. */
  memoryBytes: () => number
}

export function createBlockscoutProxy(
  deps: BlockscoutProxyDeps,
): BlockscoutProxy {
  const now = deps.now ?? (() => Date.now())
  const upstream = (deps.upstream ?? defaultUpstream).replace(/\/+$/, "")
  const revalidateBlocks = deps.revalidateBlocks ?? defaultRevalidateBlocks
  const deadlineMs = deps.deadlineMs ?? upstreamDeadlineMs
  const store = new EntryStore(
    deps.cache,
    deps.memoryBytes ?? defaultMemoryBytes,
  )
  const inFlight = new Map<string, Promise<ProxyAnswer>>()
  let backoffUntil = 0
  const log = deps.logger
  const blocksIndexed =
    deps.indexing ??
    createIndexingReader({
      now,
      read: () => {
        if (now() < backoffUntil) {
          return Promise.reject(new Error("Blockscout backoff"))
        }
        return readOnce(
          upstreamUrl("main-page/indexing-status"),
          AbortSignal.timeout(2_000),
        )
      },
    })

  function key(resource: string): string {
    return `${keyOrigin}/${keyVersion}/${resource}`
  }

  /** Classes whose freshness never depends on the head. */
  function clockFree(entry: Entry, route: MatchedRoute): boolean {
    if (entry.status === 404) return route.route.freshness.kind === "ttl"
    return (
      entry.cacheClass === "immutable" ||
      entry.cacheClass === "final" ||
      entry.cacheClass === "search" ||
      entry.cacheClass === "slow"
    )
  }

  function sameBlock(entry: Entry, clock: ChainClock): boolean {
    if (entry.head !== null && clock.height !== null) {
      return entry.head >= clock.height
    }
    return now() - entry.fetchedAt < blockMs
  }

  /** Read at least `settle` blocks after the last possible activity. */
  function idleSince(entry: Entry, clock: ChainClock, settle: number) {
    return (
      entry.head !== null &&
      clock.lastActive !== null &&
      entry.head >= clock.lastActive + settle
    )
  }

  /**
   * An address view is fresh while it is under N blocks old; or when it
   * was read N blocks after the last activity (nothing newer to see), for
   * up to ten minutes; or while the latest activity is under N blocks old
   * (Blockscout's balance and token fetchers settle it), for up to 8N
   * blocks. So activity costs one read N blocks after it (two when the
   * copy is over 8N blocks old), and a busy chain one read per 8N blocks.
   */
  function swrFresh(entry: Entry, clock: ChainClock, age: number): boolean {
    const n = revalidateBlocks
    if (entry.head === null || clock.height === null) {
      return age < n * blockMs
    }
    const blocksOld = clock.height - entry.head
    if (blocksOld < n) return true
    if (clock.lastActive === null) return false
    if (entry.head >= clock.lastActive + n) return age < swrIdleMaxMs
    return (
      clock.height < clock.lastActive + n && blocksOld < swrMaxWaitWindows * n
    )
  }

  function isFresh(
    entry: Entry,
    route: MatchedRoute,
    clock: ChainClock,
  ): boolean {
    const age = now() - entry.fetchedAt
    const freshness = route.route.freshness
    if (entry.status === 404) {
      return freshness.kind === "ttl"
        ? age < negativeTtlMs
        : sameBlock(entry, clock)
    }
    switch (entry.cacheClass) {
      case "immutable":
        return true
      case "final":
        return age < finalMs
      case "search":
      case "slow":
        return freshness.kind === "ttl" && age < freshness.seconds * 1000
      case "per-block":
        // Transaction lists and not-yet-final chain data change only when
        // a block has transactions; block lists change every block.
        return (
          sameBlock(entry, clock) ||
          ((freshness.kind === "chain" ||
            (freshness.kind === "per-block" && freshness.skipIdle)) &&
            idleSince(entry, clock, latestSettleBlocks))
        )
      case "swr":
        return swrFresh(entry, clock, age)
    }
  }

  /** Cache-Control on the answer, for whoever caches it next. */
  function answerCacheControl(
    entry: Entry,
    status: ProxyCacheStatus,
    route: MatchedRoute,
  ): string {
    if (status === "stale" || status === "revalidating") return "no-store"
    const secondsLeft = (ms: number) =>
      Math.max(1, Math.floor((ms - (now() - entry.fetchedAt)) / 1000))
    const freshness = route.route.freshness
    switch (entry.cacheClass) {
      case "immutable":
        return `public, max-age=${storageSeconds.immutable}, immutable`
      case "final":
        return `public, max-age=${Math.min(3_600, secondsLeft(finalMs))}`
      case "per-block":
      case "swr":
        return "public, max-age=3"
      case "search":
      case "slow":
        return freshness.kind === "ttl"
          ? `public, max-age=${secondsLeft(freshness.seconds * 1000)}`
          : "no-store"
    }
  }

  function answer(
    entry: Entry,
    status: ProxyCacheStatus,
    route: MatchedRoute,
    clock: ChainClock | null,
  ): ProxyAnswer {
    if (entry.status === 404) {
      return { kind: "not-found", template: route.route.template }
    }
    const cacheControl = answerCacheControl(entry, status, route)
    return {
      kind: "ok",
      body: entry.body,
      cacheClass: entry.cacheClass,
      cacheStatus: status,
      cacheControl,
      head:
        clock === null
          ? "not-read"
          : clock.height === null
            ? "unknown"
            : String(clock.height),
      template: route.route.template,
    }
  }

  function noteRateHeaders(response: Response): void {
    const remaining = Number.parseInt(
      response.headers.get("x-ratelimit-remaining") ?? "",
      10,
    )
    if (response.status === 429) {
      backoffUntil = now() + backoffMs(response)
      log.warn({
        message: "Blockscout rate limited the proxy",
        backoffMs: backoffUntil - now(),
      })
      return
    }
    if (Number.isFinite(remaining) && remaining <= lowRemainingThreshold) {
      backoffUntil = now() + backoffMs(response)
      log.warn({
        message: "Blockscout rate limit nearly spent; backing off",
        remaining,
        backoffMs: backoffUntil - now(),
      })
    }
  }

  /** x-ratelimit-reset read as milliseconds until the window resets. */
  function backoffMs(response: Response): number {
    const reset = Number.parseInt(
      response.headers.get("x-ratelimit-reset") ?? "",
      10,
    )
    if (!Number.isFinite(reset) || reset <= 0) return defaultBackoffMs
    return Math.min(Math.max(reset, 1_000), maxBackoffMs)
  }

  /**
   * Blockscout documents no header form for API v2 keys, so the key goes
   * in the query (`apikey`). This URL is never logged by the proxy.
   */
  function upstreamUrl(resource: string): string {
    if (deps.apiKey === null) return `${upstream}/${resource}`
    const separator = resource.includes("?") ? "&" : "?"
    return `${upstream}/${resource}${separator}apikey=${encodeURIComponent(deps.apiKey)}`
  }

  async function readOnce(url: string, signal: AbortSignal) {
    const response = await deps.fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal,
    })
    noteRateHeaders(response)
    if (response.status >= 500) {
      await response.body?.cancel()
      throw new UpstreamError(response.status)
    }
    return response
  }

  async function spend(
    limits: RateLimitClient,
    bucket: string,
    policy: RateLimitPolicy,
  ): Promise<{ wait: number | null; spent: boolean }> {
    try {
      const verdict = await limits.consume(bucket, policy)
      return verdict.allowed
        ? { wait: null, spent: true }
        : { wait: Math.max(1, verdict.retryAfterSeconds), spent: false }
    } catch (error) {
      // The limiter fails open, as the rest of the API does; nothing was
      // spent, so nothing is refunded for it.
      log.warn({ message: "Blockscout limiter unavailable", error })
      return { wait: null, spent: false }
    }
  }

  /**
   * Gives back what the earlier buckets spent on a read a later one
   * refused, so a refusal costs nothing: a Stuart visitor refused by the
   * Stuart-wide bucket keeps its own quota, and a Scan surge that empties
   * the shared bucket does not burn Stuart's daily quota. Best effort.
   */
  async function refundAll(limits: RateLimitClient, keys: readonly string[]) {
    if (limits.refund === undefined) return
    await Promise.all(
      keys.map((key) =>
        limits.refund?.(key).catch((error: unknown) => {
          log.warn({ message: "Blockscout limiter refund failed", error })
        }),
      ),
    )
  }

  /** The caller's bucket, Stuart's, then the shared one; refused: wait. */
  async function spendBuckets(
    limits: RateLimitClient,
    caller: BlockscoutCaller,
  ): Promise<number | null> {
    const buckets: Array<[string, RateLimitPolicy]> = [
      [
        callerRateLimitKey(caller),
        caller.endUser === null
          ? anonymousRateLimitPolicy
          : endUserPolicyFor(caller.client),
      ],
      ...(caller.client === "stuart"
        ? [
            [stuartRateLimitKey, stuartRateLimitPolicy] as [
              string,
              RateLimitPolicy,
            ],
          ]
        : []),
      [upstreamRateLimitKey, upstreamRateLimitPolicy],
    ]
    const spent: string[] = []
    for (const [key, policy] of buckets) {
      const result = await spend(limits, key, policy)
      if (result.wait !== null) {
        await refundAll(limits, spent)
        return result.wait
      }
      if (result.spent) spent.push(key)
    }
    return null
  }

  async function fetchUpstream(
    template: string,
    resource: string,
    caller: BlockscoutCaller,
  ): Promise<Upstream> {
    if (now() < backoffUntil) {
      return {
        kind: "rate-limited",
        retryAfterSeconds: Math.ceil((backoffUntil - now()) / 1000),
      }
    }
    if (deps.rateLimits !== null) {
      const wait = await spendBuckets(deps.rateLimits, caller)
      if (wait !== null) {
        return { kind: "rate-limited", retryAfterSeconds: wait }
      }
    }
    const url = upstreamUrl(resource)
    const started = Date.now()
    const deadline = AbortSignal.timeout(deadlineMs)
    let response: Response
    try {
      try {
        response = await readOnce(url, deadline)
      } catch (error) {
        // One retry, only for an upstream 5xx (GETs are idempotent), and
        // only with enough of the deadline left for it to finish.
        if (!(error instanceof UpstreamError)) throw error
        const left = deadlineMs - (Date.now() - started) - retryDelayMs
        if (left < minimumRetryWindowMs) throw error
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs))
        response = await readOnce(url, deadline)
      }
    } catch (error) {
      log.warn({
        message: "Blockscout upstream failed",
        route: template,
        status: error instanceof UpstreamError ? error.status : null,
        timeout:
          error instanceof Error &&
          (error.name === "TimeoutError" || error.name === "AbortError"),
      })
      return { kind: "failed" }
    }
    if (response.status === 404) {
      await response.body?.cancel()
      return { kind: "not-found" }
    }
    if (response.status === 429) {
      await response.body?.cancel()
      return {
        kind: "rate-limited",
        retryAfterSeconds: Math.ceil((backoffUntil - now()) / 1000),
      }
    }
    if (response.status === 401 || response.status === 403) {
      await response.body?.cancel()
      // Our credentials (BLOCKSCOUT_API_KEY) were refused: an outage for
      // callers, not their mistake.
      log.error({
        message: "Blockscout refused the proxy's credentials",
        route: template,
        status: response.status,
      })
      return { kind: "failed" }
    }
    if (!response.ok) {
      await response.body?.cancel()
      log.warn({
        message: "Blockscout rejected a proxied request",
        route: template,
        status: response.status,
      })
      return { kind: "rejected" }
    }
    try {
      const raw: unknown = await response.json()
      return { kind: "ok", raw }
    } catch {
      log.error({
        message: "Blockscout answered invalid JSON",
        route: template,
      })
      return { kind: "failed" }
    }
  }

  type Lookup = {
    route: MatchedRoute
    resource: string
    caller: BlockscoutCaller
    /** The stored copy, for stale-if-error. */
    stored: Entry | null
    /** A page past the first of a list (keyset cursor given), or null. */
    cursor: HistoryCursor | null
    readClock: () => Promise<ChainClock>
    background: (task: Promise<unknown>) => void
  }

  async function load(lookup: Lookup): Promise<ProxyAnswer> {
    const { route, resource, stored } = lookup
    const template = route.route.template
    // An older history page also needs Blockscout's indexing state: read
    // it beside the page, not after it, so it adds no latency. It spends
    // neither bucket (at most one read a minute per isolate).
    const indexing =
      lookup.cursor !== null && route.route.historyPages
        ? blocksIndexed().catch(() => null)
        : Promise.resolve(null)
    const result = await fetchUpstream(template, resource, lookup.caller)
    function fallBack(
      reason: "upstream" | "rate-limited" | "schema",
      retryAfterSeconds: number,
    ): ProxyAnswer {
      if (stored !== null && stored.status === 200) {
        return answer(stored, "stale", route, null)
      }
      return { kind: "unavailable", reason, retryAfterSeconds, template }
    }
    if (result.kind === "rate-limited") {
      return fallBack("rate-limited", result.retryAfterSeconds)
    }
    if (result.kind === "failed") return fallBack("upstream", 5)
    if (result.kind === "rejected") return { kind: "invalid", template }
    const clock =
      route.route.freshness.kind === "ttl" ? null : await lookup.readClock()
    if (result.kind === "not-found") {
      // A miss may exist soon (a pending transaction), so a 404 is believed
      // for one block, or a minute on search and slow routes, under the key
      // every lookup of this resource reads.
      const entry: Entry = {
        status: 404,
        body: "",
        cacheClass: "per-block",
        fetchedAt: now(),
        head: clock?.height ?? null,
      }
      lookup.background(
        store.put(key(resource), entry, storageSeconds.negative),
      )
      return { kind: "not-found", template }
    }
    const indexed = await indexing
    const decoded = route.route.decode(
      result.raw,
      {
        height: clock?.height ?? null,
        finalityDepth: deps.finalityDepth,
        blocksIndexed: indexed,
      },
      lookup.cursor,
    )
    if (!decoded.ok) {
      log.error({
        message: "Blockscout response failed its schema",
        route: template,
        issues: decoded.error.issues.slice(0, 10).map((issue) => ({
          path: issue.path.join("."),
          code: issue.code,
        })),
      })
      return fallBack("schema", 30)
    }
    const entry: Entry = {
      status: 200,
      body: JSON.stringify(decoded.body),
      cacheClass: decoded.cacheClass,
      fetchedAt: now(),
      head: clock?.height ?? null,
    }
    lookup.background(
      store.put(
        key(resource),
        entry,
        decoded.cacheClass === "immutable"
          ? storageSeconds.immutable
          : storageSeconds.other,
      ),
    )
    return answer(entry, "miss", route, clock)
  }

  /** One upstream read per resource per isolate at a time. */
  function coalesced(lookup: Lookup): {
    shared: boolean
    loading: Promise<ProxyAnswer>
  } {
    const pending = inFlight.get(lookup.resource)
    if (pending !== undefined) return { shared: true, loading: pending }
    const loading = load(lookup).finally(() => inFlight.delete(lookup.resource))
    inFlight.set(lookup.resource, loading)
    return { shared: false, loading }
  }

  return {
    memoryBytes: () => store.heldBytes,
    async handle(path, query, caller, background) {
      const canonicalPath = path.toLowerCase()
      const matched = matchRoute(canonicalPath)
      if (matched === null) return { kind: "not-found", template: null }
      const template = matched.route.template
      const checked = checkQuery(matched.route, query)
      if (!checked.ok) return { kind: "invalid", template }
      const resource =
        checked.canonical === ""
          ? canonicalPath
          : `${canonicalPath}?${checked.canonical}`
      const entryKey = key(resource)

      const route: MatchedRoute | null = matched
      let clock: ChainClock | null = null
      async function readClock(): Promise<ChainClock> {
        clock ??= await deps.clock().catch(() => unknownClock)
        return clock
      }
      async function fresh(entry: Entry): Promise<boolean> {
        if (route === null) return false
        if (clockFree(entry, route)) return isFresh(entry, route, unknownClock)
        return isFresh(entry, route, await readClock())
      }

      const memory = store.fromMemory(entryKey)
      if (memory !== null && (await fresh(memory))) {
        return answer(memory, "memory", matched, clock)
      }
      const edge = await store.fromEdge(entryKey)
      if (edge !== null && (await fresh(edge))) {
        return answer(edge, "edge", matched, clock)
      }
      const stored =
        memory === null
          ? edge
          : edge === null || memory.fetchedAt >= edge.fetchedAt
            ? memory
            : edge
      const lookup: Lookup = {
        route: matched,
        resource,
        caller,
        stored,
        cursor: checked.cursored
          ? { block: checked.cursorBlock ?? null }
          : null,
        readClock,
        background,
      }
      // Address views: answer now, refresh behind the answer.
      if (
        stored !== null &&
        stored.status === 200 &&
        stored.cacheClass === "swr" &&
        now() - stored.fetchedAt < storageSeconds.other * 1000
      ) {
        background(coalesced(lookup).loading.catch(() => undefined))
        return answer(stored, "revalidating", matched, clock)
      }
      const { shared, loading } = coalesced(lookup)
      const result = await loading
      return shared && result.kind === "ok" && result.cacheStatus === "miss"
        ? { ...result, cacheStatus: "coalesced" }
        : result
    },
  }
}
