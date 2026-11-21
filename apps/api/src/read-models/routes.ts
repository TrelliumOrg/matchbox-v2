import type { NetworkSlug } from "@matchbox/contracts/network"
import {
  type ActivityRow,
  activityCategory,
  activityQuerySchema,
  type GaugeCard,
  type GaugeConsistencyRanking,
  type GaugeDirectory,
  type GaugeFunding,
  type GaugeQuery,
  gaugeConsistencyQuerySchema,
  gaugeQuerySchema,
  isRetiredGauge,
  type LocksAsOf,
  type Prices,
  type ProSummary,
  pricesSchema,
  type ReadModelMeta,
  type WalletOverview,
  watchClientHeader,
  watchClientIdSchema,
  watchKindSchema,
} from "@matchbox/contracts/read-models"
import {
  type HistoryCsvKind,
  historyCsvFileName,
} from "@matchbox/contracts/read-models/history-csv"
import { decimalToScaledBigInt } from "@matchbox/domain"
import type { Logger } from "@matchbox/logger"
import { PlatformError, type RateLimitClient } from "@matchbox/server"
import type { Hono } from "hono"
import { z } from "zod"
import { callerOf } from "../blockscout/endpoint"
import type { ApiContext, ApiEnv } from "../context"
import { ifNoneMatchMatches } from "../http"
import { type BalanceReader, walletBalances } from "./balances"
import {
  type ClaimPrices,
  coverageStamp,
  readClaimPrices,
} from "./claim-prices"
import { withDirectoryIncentives } from "./epoch-incentives"
import { kindTotals } from "./gauges"
import {
  exportAnonymousPolicy,
  exportEndUserPolicy,
  historyCsvStream,
} from "./history-export"
import type { IdentityReader } from "./identity"
import {
  type ClaimableAsOf,
  claimableDeadlineMs,
  type LiveClaimableReader,
  type LockCountReader,
  lockKey,
  overlayClaimable,
  withinDeadline,
} from "./live-claimable"
import {
  type LiveLocks,
  type LiveLocksReader,
  lockCounts,
  reconcileWallet,
} from "./live-locks"
import {
  buildLiveWalletDocuments,
  type LiveWalletDocuments,
  type LiveWalletReader,
} from "./live-wallet"
import proDirectory from "./pro-gauges"
import { repriceWalletOverview, repriceWalletRewards } from "./reprice"
import {
  currentKey,
  type ReadDatabase,
  type ReadModelKind,
  type ReadModelWrite,
  readModelEtag,
  readReadModel,
  readReadModelMeta,
  type StoredReadModel,
  wantsRebuild,
  writeReadModels,
} from "./store"
import { gaugeCardsFrom } from "./wallet-extras"
import {
  afterDocument,
  type HistoryState,
  isHistoryCursor,
  mayBePending,
  parseHistoryCursor,
  readHistoryBackfill,
  readHistoryPage,
  readHistoryState,
} from "./wallet-history"
import {
  addWatchItem,
  readWatchList,
  removeWatchItem,
  requestWallet,
} from "./watchlist"

// `/internal/pro/*`: Matchbox Pro's read models, served from READ_DB with
// the Cache API in front. Public chain data only, so no API key; Pro's
// loaders call these server side and TanStack Query calls them in the
// browser.

export type InternalProDeps = {
  readDb: ReadDatabase | null
  /** Latest prices (KV, written by matchbox-jobs); null when unavailable. */
  readPrices: () => Promise<Prices | null>
  /** The edge cache; null disables it (tests, local dev without a zone). */
  cache: Cache | null
  /** BlockHub namespace for `/internal/pro/head` and `/internal/heads`. */
  heads: DurableObjectNamespace | null
  network: NetworkSlug
  /**
   * Builds a wallet from Mezo RPC when the warehouse sweep has not written
   * it yet; null serves 404 for such wallets instead.
   */
  liveWallet?: LiveWalletReader | null
  /**
   * Reads one wallet's claimable from the chain, to lay over its stored
   * documents. Absent: the stored figures are served as they are.
   */
  liveClaimable?: LiveClaimableReader | null
  /**
   * Reads one wallet's locks from the chain, to lay over its stored
   * documents: the lock set, amounts, unlocks, voting power and votes.
   * Absent: the stored locks are served as they are.
   */
  liveLocks?: LiveLocksReader | null
  /**
   * Counts a wallet's locks on the chain, for a stored document that names
   * none. Absent: such a document is served as it is. Not used when
   * `liveLocks` is set, which answers the same question.
   */
  lockCount?: LockCountReader | null
  /** Live BTC, MEZO and MUSD balances; null disables the route. */
  balances?: BalanceReader | null
  /** Mezo ID lookups (api.mezo.org); null disables the route. */
  identity?: IdentityReader | null
  /**
   * Buckets for the CSV downloads, by Pro's end-user key. Absent or null:
   * not limited (tests, local dev). Fails open, as the API's other limits.
   */
  rateLimits?: RateLimitClient | null
  /** Unix seconds; defaults to the wall clock. */
  nowSeconds?: () => number
  /** Render failures and retries; absent logs nothing. */
  logger?: Logger | null
}

/** Seconds a response may be served from the edge cache and the browser. */
const ttl = {
  wallet: { browser: 15, edge: 30 },
  /**
   * A page of a wallet's stored history that cannot change but for a row
   * rewritten (rare): one with older pages after it, or the last of a
   * complete history. Older rows added by the backfill come after it.
   */
  history: { browser: 600, edge: 3_600 },
  shared: { browser: 30, edge: 60 },
  prices: { browser: 15, edge: 30 },
  /** About one block. */
  balances: { browser: 4, edge: 4 },
} as const

function cacheControl(seconds: { browser: number; edge: number }): string {
  return `public, max-age=${seconds.browser}, s-maxage=${seconds.edge}, stale-while-revalidate=${seconds.edge}`
}

const addressParamSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/)
  .transform((value) => value.toLowerCase())

function addressParam(c: ApiContext, name: string): string {
  const parsed = addressParamSchema.safeParse(c.req.param(name))
  if (!parsed.success) throw new PlatformError("not_found")
  return parsed.data
}

type Rendered = { body: unknown; etag: string; cacheControl: string }

/** Serves a rendered body with a strong ETag and `If-None-Match` support. */
function send(c: ApiContext, rendered: Rendered): Response {
  const etag = `"${rendered.etag}"`
  const headers = { ETag: etag, "Cache-Control": rendered.cacheControl }
  if (ifNoneMatchMatches(c.req.header("If-None-Match"), etag)) {
    c.set("cacheStatus", "not-modified")
    return c.body(null, 304, headers)
  }
  c.set("cacheStatus", "full")
  return c.body(JSON.stringify(rendered.body), 200, {
    ...headers,
    "Content-Type": "application/json; charset=utf-8",
  })
}

function background(c: ApiContext, task: Promise<unknown>): void {
  try {
    c.executionCtx.waitUntil(task)
  } catch {
    // No ExecutionContext in `app.request()` tests; the task runs detached.
  }
}

/**
 * How long a shared route's last good answer is kept beside its cached
 * one, to serve when a render fails (`cached`, `lastGood`).
 */
export const lastGoodSeconds = 86_400

function lastGoodKey(url: string): Request {
  const copy = new URL(url)
  copy.searchParams.set("_matchbox_last_good", "1")
  return new Request(copy.toString(), { method: "GET" })
}

/**
 * A render failure a second try or an earlier answer may cure: anything
 * but a `PlatformError`, which is a deliberate answer (a 404, a refused
 * query, a wallet still building). A D1 error ("Network connection
 * lost", an overloaded database), a document the API's schema rejects
 * (written by a jobs version the API does not know yet) or a bug in a
 * builder is one.
 */
function curable(error: unknown): boolean {
  return !(error instanceof PlatformError)
}

/** A path segment for a log: never an address (a record key). */
function pathSegment(segment: PropertyKey): string {
  if (typeof segment === "number") return String(segment)
  if (typeof segment !== "string") return "?"
  return /^0x/i.test(segment) ? "{address}" : segment.slice(0, 40)
}

/**
 * An error for the log, without what was read: a schema error says which
 * checks failed where (its message would quote the issues, which name
 * record keys), and a JSON error only that the body was not JSON (V8's
 * message quotes the start of it).
 */
function errorText(error: unknown): string {
  if (error instanceof z.ZodError) {
    const issues = error.issues
      .slice(0, 3)
      .map(
        (issue) => `${issue.code} at ${issue.path.map(pathSegment).join(".")}`,
      )
    return `ZodError: ${error.issues.length} issues: ${issues.join("; ")}`.slice(
      0,
      200,
    )
  }
  if (error instanceof SyntaxError) return "SyntaxError: not JSON"
  return error instanceof Error
    ? `${error.name}: ${error.message.slice(0, 200)}`
    : "Unknown"
}

/**
 * `render`, tried once more when it fails in a way a second read may
 * cure (`curable`): one failed D1 read on a cold isolate is no reason to
 * answer 500. Not with `retry: false`, for a route whose reader retries
 * on its own.
 */
async function renderTwice(
  c: ApiContext,
  deps: InternalProDeps,
  render: () => Promise<Rendered>,
  retry: boolean,
): Promise<Rendered> {
  try {
    return await render()
  } catch (error) {
    if (!retry || !curable(error)) throw error
    deps.logger?.warn({
      message: "Read model render failed, retrying",
      route: c.get("routeTemplate") ?? null,
      error: errorText(error),
    })
    return render()
  }
}

/**
 * Edge cache around `render`. The cache key is the URL alone (no
 * conditional headers), so one cached 200 answers every client; the ETag
 * comparison happens here, per request.
 *
 * A render that fails twice in a curable way (`renderTwice`) is answered
 * with the route's last good answer when `lastGood` is set and one is
 * kept (a day, under its own key), marked `no-store` and `X-Cache:
 * stale-if-error`, rather than with a 500. Only for shared documents:
 * they are few, so the extra cache entry each costs is too.
 *
 * `retry: false` leaves out the second try, for a route whose render is a
 * live chain read on a client that retries by itself: a second try would
 * double a failing read's time and its RPC requests.
 */
async function cached(
  c: ApiContext,
  deps: InternalProDeps,
  render: () => Promise<Rendered>,
  options: { lastGood?: boolean; retry?: boolean } = {},
): Promise<Response> {
  const url = new URL(c.req.url).toString()
  const key = new Request(url, { method: "GET" })
  if (deps.cache !== null) {
    const hit = await deps.cache.match(key).catch(() => undefined)
    const etag = hit?.headers.get("ETag")
    if (hit !== undefined && etag !== null && etag !== undefined) {
      c.header("X-Cache", "hit")
      if (ifNoneMatchMatches(c.req.header("If-None-Match"), etag)) {
        c.set("cacheStatus", "not-modified")
        return c.body(null, 304, {
          ETag: etag,
          "Cache-Control": hit.headers.get("Cache-Control") ?? "no-store",
        })
      }
      c.set("cacheStatus", "full")
      return c.body(await hit.text(), 200, {
        ETag: etag,
        "Cache-Control": hit.headers.get("Cache-Control") ?? "no-store",
        "Content-Type": "application/json; charset=utf-8",
      })
    }
  }
  let rendered: Rendered
  try {
    rendered = await renderTwice(c, deps, render, options.retry !== false)
  } catch (error) {
    const fallback =
      options.lastGood === true && deps.cache !== null && curable(error)
        ? await deps.cache.match(lastGoodKey(url)).catch(() => undefined)
        : undefined
    deps.logger?.error({
      message: "Read model render failed",
      route: c.get("routeTemplate") ?? null,
      error: errorText(error),
      served: fallback === undefined ? "error" : "last-good",
    })
    if (fallback === undefined) throw error
    c.header("X-Cache", "stale-if-error")
    c.set("cacheStatus", "full")
    // Counted in the request log (REQUEST_LOG blob11), not only logged.
    c.set("servedFrom", "last-good")
    return c.body(await fallback.text(), 200, {
      ETag: fallback.headers.get("ETag") ?? "",
      "Cache-Control": noStoreControl,
      "Content-Type": "application/json; charset=utf-8",
    })
  }
  // An answer that is behind what the request asked for is not kept.
  if (deps.cache !== null && rendered.cacheControl !== noStoreControl) {
    const body = JSON.stringify(rendered.body)
    const headers = {
      ETag: `"${rendered.etag}"`,
      "Content-Type": "application/json; charset=utf-8",
    }
    background(
      c,
      deps.cache.put(
        key,
        new Response(body, {
          headers: { ...headers, "Cache-Control": rendered.cacheControl },
        }),
      ),
    )
    if (options.lastGood === true) {
      background(
        c,
        deps.cache.put(
          lastGoodKey(url),
          new Response(body, {
            headers: {
              ...headers,
              "Cache-Control": `public, s-maxage=${lastGoodSeconds}`,
            },
          }),
        ),
      )
    }
    c.header("X-Cache", "miss")
  }
  return send(c, rendered)
}

/** `cached` for a shared document: its last good answer is kept. */
function sharedCached(
  c: ApiContext,
  deps: InternalProDeps,
  render: () => Promise<Rendered>,
): Promise<Response> {
  return cached(c, deps, render, { lastGood: true })
}

const noStoreControl = "no-store"

const afterParamSchema = z
  .string()
  .regex(/^[0-9]{1,12}$/)
  .transform(Number)

/**
 * `?after=<block>`: the caller just had a transaction mined in that block
 * and wants an answer that includes it. The answer skips this isolate's
 * memo unless the memo is at least that new, and is kept at the edge only
 * when it is (the query is part of the cache key, so it never meets an
 * answer cached before the transaction). An API that predates the
 * parameter ignores it. Null when absent or malformed.
 */
function afterParam(c: ApiContext): number | null {
  const parsed = afterParamSchema.safeParse(c.req.query("after"))
  return parsed.success ? parsed.data : null
}

/**
 * A shared document's cache lifetime. One that is older than the block the
 * request asked for is served, since it is the newest there is, but not
 * kept: the next request reads again.
 */
function sharedCacheControl(meta: ReadModelMeta, after: number | null): string {
  return after !== null && meta.block < after
    ? noStoreControl
    : cacheControl(ttl.shared)
}

function requireDb(deps: InternalProDeps): ReadDatabase {
  if (deps.readDb === null) throw new PlatformError("service_disabled")
  return deps.readDb
}

/** Seconds a current read model is reused in an isolate. */
const currentMemoSeconds = 10

/**
 * Current read models read in this isolate, per database binding. Each new
 * query string misses the edge cache (the Ctrl K search sends one per
 * keystroke), and re-reading the whole directory from D1 each time cost
 * 0.1 to 0.4 s; snapshots change about once a minute.
 */
const currentReads = new WeakMap<
  ReadDatabase,
  Map<string, { at: number; read: Promise<unknown> }>
>()

async function load<Kind extends ReadModelKind>(
  deps: InternalProDeps,
  kind: Kind,
  key: string,
  /** A memoised document older than this block is read again. */
  after: number | null = null,
): Promise<StoredReadModel<Kind>> {
  const db = requireDb(deps)
  const read = (): Promise<StoredReadModel<Kind> | null> =>
    readReadModel(db, deps.network, kind, key)
  let stored: StoredReadModel<Kind> | null
  // Off with the edge cache (tests, local dev), so reads see every write.
  if (key === currentKey && deps.cache !== null) {
    const reads = currentReads.get(db) ?? new Map()
    currentReads.set(db, reads)
    const id = `${deps.network}:${kind}`
    const now = nowOf(deps)
    const recent = reads.get(id)
    const memoised =
      recent !== undefined && now - recent.at < currentMemoSeconds
        ? ((await recent.read) as StoredReadModel<Kind> | null)
        : undefined
    if (
      memoised !== undefined &&
      (after === null || (memoised?.meta.block ?? 0) >= after)
    ) {
      stored = memoised
    } else {
      const pending = read()
      reads.set(id, { at: now, read: pending })
      pending.then(
        (value) => {
          if (value === null) reads.delete(id)
        },
        () => reads.delete(id),
      )
      stored = await pending
    }
  } else {
    stored = await read()
  }
  if (stored === null) throw new PlatformError("not_found")
  return stored
}

function nowOf(deps: InternalProDeps): number {
  return deps.nowSeconds?.() ?? Math.floor(Date.now() / 1000)
}

type LiveWallet = { documents: LiveWalletDocuments; meta: ReadModelMeta }

/**
 * How long one request waits for a wallet built from the chain: four or
 * five requests in turn, each well under a second on a healthy RPC (0.6 to
 * 0.9 s for a 41-lock wallet's lock read, measured 13 Nov 2026). Past it
 * the request answers 503 with Retry-After and the build goes on: the
 * retry joins it.
 */
export const liveWalletDeadlineMs = 5_000

/** The longest a build may run before it is given up as failed. */
export const liveWalletBuildMs = 30_000

/** Seconds a failed build is remembered, so retries do not start another. */
export const liveWalletFailedSeconds = 15

/** Seconds a request is told to wait before asking again. */
const liveWalletRetrySeconds = 5

/** Live wallet builds in flight, recent (30 s) or failed (15 s), per isolate. */
const liveBuilds = new Map<
  string,
  { at: number; build: Promise<LiveWallet | null>; failedAt: number | null }
>()

/** The 503 a wallet build answers while it runs, or after it failed. */
function stillBuilding(retryAfter: number): PlatformError {
  return new PlatformError("service_disabled", {
    message: "This wallet is still being read from the chain",
    headers: { "Retry-After": String(retryAfter) },
  })
}

/** Test helper. */
export function forgetLiveBuilds(): void {
  liveBuilds.clear()
}

/**
 * A wallet the warehouse has not written yet, from Mezo RPC. Wallets with
 * locks are written to READ_DB (source `live`) and queued so the next
 * warehouse snapshot adds their history; empty wallets are only cached at
 * the edge, so unknown addresses cost no D1 writes.
 */
function liveWallet(
  c: ApiContext,
  deps: InternalProDeps,
  address: string,
): Promise<LiveWallet | null> {
  const reader = deps.liveWallet ?? null
  if (reader === null) return Promise.resolve(null)
  const now = nowOf(deps)
  const key = `${deps.network}:${address}`
  const recent = liveBuilds.get(key)
  if (recent !== undefined) {
    if (recent.failedAt !== null) {
      const left = liveWalletFailedSeconds - (now - recent.failedAt)
      if (left > 0) return Promise.reject(stillBuilding(left))
    } else if (now - recent.at < 30) {
      return waitForBuild(recent.build)
    }
  }
  const build = (async (): Promise<LiveWallet> => {
    const db = requireDb(deps)
    const [directory, { prices }] = await Promise.all([
      readReadModel(db, deps.network, "gauges", currentKey),
      currentPrices(deps),
    ])
    const cards = gaugeCardsFrom(directory?.data ?? null)
    // Bounded: a hung RPC fails the build instead of holding it for the
    // client's minutes of retries.
    const snapshot = await withinDeadline(
      reader(address, cards),
      liveWalletBuildMs,
    )
    const documents = buildLiveWalletDocuments({
      address,
      snapshot,
      cards,
      prices,
      nowSeconds: now,
    })
    const meta: ReadModelMeta = {
      network: deps.network,
      source: "live",
      block: snapshot.block,
      updatedAt: now,
    }
    if (snapshot.locks.length > 0) {
      const base = {
        network: deps.network,
        key: address,
        block: snapshot.block,
        source: "live" as const,
        updatedAt: now,
      }
      const writes: ReadModelWrite<ReadModelKind>[] = [
        { ...base, kind: "wallet-overview", data: documents.overview },
        { ...base, kind: "wallet-rewards", data: documents.rewards },
        { ...base, kind: "wallet-activity", data: documents.activity },
      ]
      background(
        c,
        Promise.all([
          writeReadModels(db, writes),
          requestWallet(db, deps.network, address, now),
        ]).catch(() => undefined),
      )
    }
    return { documents, meta }
  })()
  const entry = { at: now, build, failedAt: null as number | null }
  liveBuilds.set(key, entry)
  if (liveBuilds.size > 200) {
    const oldest = liveBuilds.keys().next().value
    if (oldest !== undefined) liveBuilds.delete(oldest)
  }
  // A failed build is kept for a while, so the retries it causes answer
  // at once instead of each starting another build.
  build.catch(() => {
    entry.failedAt = nowOf(deps)
  })
  return waitForBuild(build)
}

/**
 * A build, waited for at most `liveWalletDeadlineMs`: Pro waits for no
 * answer of its own. Still running: 503 with Retry-After, and the build
 * goes on for the retry to join. Failed: 503 too.
 */
async function waitForBuild(
  build: Promise<LiveWallet | null>,
): Promise<LiveWallet | null> {
  let settled = false
  build.then(
    () => {
      settled = true
    },
    () => {
      settled = true
    },
  )
  try {
    return await withinDeadline(build, liveWalletDeadlineMs)
  } catch (error) {
    if (error instanceof PlatformError) throw error
    throw stillBuilding(
      settled ? liveWalletFailedSeconds : liveWalletRetrySeconds,
    )
  }
}

type WalletKind = "wallet-overview" | "wallet-rewards" | "wallet-activity"

function liveDocument<Kind extends WalletKind>(
  kind: Kind,
  documents: LiveWalletDocuments,
): StoredReadModel<Kind>["data"]
function liveDocument(kind: WalletKind, documents: LiveWalletDocuments) {
  switch (kind) {
    case "wallet-overview":
      return documents.overview
    case "wallet-rewards":
      return documents.rewards
    case "wallet-activity":
      return documents.activity
  }
}

/**
 * Stale wallets someone looks at are put on the warehouse snapshot's list
 * (`wallet_requests`, see `wantsRebuild` in the store). The jobs side takes
 * requested wallets out of the sweep's share of a run, so this never makes
 * a run larger. One isolate asks for a wallet at most this often.
 */
const staleRequestSeconds = 900
const staleRequests = new Map<string, number>()

/** For tests: forget which wallets this isolate asked for. */
export function forgetStaleRequests(): void {
  staleRequests.clear()
}

/** Queues a stored wallet for the next run when `wantsRebuild` says so. */
function queueIfStale(
  c: ApiContext,
  deps: InternalProDeps,
  address: string,
  overview: StoredReadModel<"wallet-overview">,
): void {
  const now = nowOf(deps)
  if (!wantsRebuild(overview, now)) return
  const key = `${deps.network}:${address}`
  const asked = staleRequests.get(key)
  if (asked !== undefined && now - asked < staleRequestSeconds) return
  staleRequests.delete(key)
  staleRequests.set(key, now)
  if (staleRequests.size > 1_000) {
    const oldest = staleRequests.keys().next().value
    if (oldest !== undefined) staleRequests.delete(oldest)
  }
  // One row at most per wallet (ON CONFLICT DO NOTHING), never awaited.
  background(
    c,
    requestWallet(requireDb(deps), deps.network, address, now).catch(
      () => undefined,
    ),
  )
}

/** A stored wallet document, else the live build's; 404 without either. */
async function walletDocument<Kind extends WalletKind>(
  c: ApiContext,
  deps: InternalProDeps,
  kind: Kind,
  address: string,
): Promise<StoredReadModel<Kind>> {
  const stored = await readReadModel(
    requireDb(deps),
    deps.network,
    kind,
    address,
  )
  if (stored !== null) return stored
  const live = await liveWallet(c, deps, address)
  if (live === null) throw new PlatformError("not_found")
  const data = liveDocument(kind, live.documents)
  return { data, meta: live.meta, etag: await readModelEtag(data) }
}

/**
 * A stored document that names no locks has nothing for the claimable read
 * to start from. One request asks the escrows how many locks the wallet
 * holds now. None: there is nothing to claim, and that is a live answer,
 * so no "as of" note. Some: the document is older than the wallet's first
 * lock (0x7277…e419 on 12 Nov 2026, stored before the replay), so this
 * view is served from the live wallet path, as a wallet with no stored
 * document is. If the chain does not answer, the stored document stands.
 */
async function lockless(
  c: ApiContext,
  deps: InternalProDeps,
  address: string,
  stored: WalletClaimable,
): Promise<WalletClaimable> {
  const count = deps.lockCount ?? null
  if (count === null) return stored
  try {
    const { locks, block } = await count(address)
    if (locks === 0) {
      return {
        ...stored,
        asOf: { block, source: "live", partial: false },
        locksAsOf: { block, source: "live", partial: false },
      }
    }
    const live = await liveWallet(c, deps, address)
    if (live === null) return stored
    const { overview, rewards } = live.documents
    return {
      overview: {
        data: overview,
        meta: live.meta,
        etag: await readModelEtag(overview),
      },
      rewards: {
        data: rewards,
        meta: live.meta,
        etag: await readModelEtag(rewards),
      },
      asOf: { block: live.meta.block, source: "live", partial: false },
      locksAsOf: { block: live.meta.block, source: "live", partial: false },
    }
  } catch {
    return stored
  }
}

type WalletClaimable = {
  overview: StoredReadModel<"wallet-overview">
  rewards: StoredReadModel<"wallet-rewards">
  asOf: ClaimableAsOf
  locksAsOf: LocksAsOf
}

type ClaimableRead = {
  at: number
  read: Promise<WalletClaimable>
  /** The `after` block the read was started for, if any. */
  after: number | null
  settled: WalletClaimable | null
}

/** Live wallet reads in flight or recent, per isolate. */
const claimableReads = new Map<string, ClaimableRead>()

/**
 * A wallet's live read is reused for this long. With the edge cache (30 s)
 * a change made from another app shows within about a minute.
 */
export const claimableCacheSeconds = 30

/** Test helper. */
export function forgetClaimableReads(): void {
  claimableReads.clear()
}

/** True when both live reads are at or past `block`. */
function includesBlock(wallet: WalletClaimable, block: number): boolean {
  return (
    wallet.locksAsOf.source === "live" &&
    wallet.locksAsOf.block >= block &&
    wallet.asOf.source === "live" &&
    wallet.asOf.block >= block
  )
}

function reusable(
  entry: ClaimableRead,
  now: number,
  after: number | null,
): boolean {
  if (now - entry.at >= claimableCacheSeconds) return false
  if (after === null) return true
  // Started for this transaction or a later one: the requests a page sends
  // together share it.
  if (entry.after !== null && entry.after >= after) return true
  return entry.settled !== null && includesBlock(entry.settled, after)
}

/** The wallet's locks from the chain; null when unread or not configured. */
async function liveLocksOf(
  deps: InternalProDeps,
  address: string,
  overview: WalletOverview,
  deadline: number,
): Promise<LiveLocks | null> {
  const reader = deps.liveLocks ?? null
  if (reader === null) return null
  try {
    return await reader(address, deadline, lockCounts(overview))
  } catch {
    // Throttled, refused, too slow: the stored locks, said to be so.
    return null
  }
}

/**
 * The wallet's overview and rewards as the chain has them now.
 *
 * Two reads are laid over the stored documents, together: the wallet's
 * locks (live-locks.ts: which it owns, amounts, unlocks, voting power and
 * votes) and what they can claim (live-claimable.ts). A page asks for both
 * documents, and several requests arrive together: they share one read,
 * kept for half a minute. A read that fails or passes its deadline changes
 * nothing: the stored figures are returned, marked as stored at their
 * block. Never zero, and a stored lock is never dropped on a failed read.
 *
 * The stored documents are not written: they stay the warehouse's, with
 * their history. A wallet whose lock set differs from its stored document
 * is queued for the next warehouse run.
 */
function walletClaimable(
  c: ApiContext,
  deps: InternalProDeps,
  address: string,
  after: number | null = null,
): Promise<WalletClaimable> {
  const now = nowOf(deps)
  const key = `${deps.network}:${address}`
  const recent = claimableReads.get(key)
  if (recent !== undefined && reusable(recent, now, after)) return recent.read
  const read = (async (): Promise<WalletClaimable> => {
    const [overview, rewards] = await Promise.all([
      walletDocument(c, deps, "wallet-overview", address),
      walletDocument(c, deps, "wallet-rewards", address),
    ])
    queueIfStale(c, deps, address, overview)
    const stored: WalletClaimable = {
      overview,
      rewards,
      // The sweep records the block a stored claimable was read at, which
      // is earlier than the document's own block when it was carried over.
      asOf: {
        block: overview.data.claimableAsOf?.block ?? overview.meta.block,
        source: "stored",
        partial: false,
      },
      locksAsOf: {
        block: overview.meta.block,
        source: "stored",
        partial: false,
      },
    }
    const lockReader = deps.liveLocks ?? null
    const claimReader = deps.liveClaimable ?? null
    const named = overview.data.locks.length
    if (named === 0 && lockReader === null) {
      return lockless(c, deps, address, stored)
    }
    if (claimReader === null && lockReader === null) return stored
    const deadline = Date.now() + claimableDeadlineMs
    const [chain, claimed, directory, { prices }] = await Promise.all([
      liveLocksOf(deps, address, overview.data, deadline),
      claimReader === null || named === 0
        ? null
        : claimReader(overview.data, deadline).catch(() => null),
      readReadModel(requireDb(deps), deps.network, "gauges", currentKey).catch(
        () => null,
      ),
      currentPrices(deps),
    ])
    const cards = gaugeCardsFrom(directory?.data ?? null)
    const reconciled =
      chain === null
        ? null
        : reconcileWallet({
            overview: overview.data,
            rewards: rewards.data,
            live: chain,
            cards,
            prices,
            nowSeconds: now,
          })
    let documents = {
      overview: reconciled?.overview ?? overview.data,
      rewards: reconciled?.rewards ?? rewards.data,
    }
    if (
      reconciled !== null &&
      (reconciled.added.length > 0 || reconciled.removed > 0)
    ) {
      // The stored document is behind the wallet: the next warehouse run
      // rebuilds it first, so its history catches up without waiting for
      // the sweep. One row at most, and none while it is already queued.
      background(
        c,
        requestWallet(requireDb(deps), deps.network, address, now).catch(
          () => undefined,
        ),
      )
    }
    // What the first claimable read could not know: locks the stored
    // document did not name (a new lock has nothing to claim; one that was
    // transferred in may). One more read, of those locks only.
    const added = reconciled?.added ?? []
    const late =
      claimReader === null || added.length === 0
        ? null
        : await claimReader(
            { ...documents.overview, locks: added },
            deadline,
          ).catch(() => null)
    const owned = new Set(documents.overview.locks.map(lockKey))
    const reads = [claimed, late].flatMap((live) =>
      live === null ? [] : [live],
    )
    for (const live of reads) {
      documents = overlayClaimable({
        ...documents,
        // A lock the wallet no longer owns has nothing to show here.
        live: {
          ...live,
          locks: live.locks.filter((lock) => owned.has(lockKey(lock))),
        },
        cards,
        prices,
        nowSeconds: now,
      })
    }
    let asOf: ClaimableAsOf
    if (chain !== null && documents.overview.locks.length === 0) {
      // No locks on the chain: nothing to claim is a live answer.
      asOf = { block: chain.block, source: "live", partial: false }
    } else if (claimReader === null || (named > 0 && claimed === null)) {
      asOf = stored.asOf
    } else {
      asOf = {
        block: Math.min(
          ...(reads.length === 0 ? [chain?.block ?? 0] : []),
          ...reads.map((live) => live.block),
        ),
        source: "live",
        // Also when an added lock's claimable could not be read.
        partial:
          reads.some((live) => live.partial) ||
          (added.length > 0 && late === null),
      }
    }
    return {
      overview: { ...overview, data: documents.overview },
      rewards: { ...rewards, data: documents.rewards },
      asOf,
      locksAsOf:
        chain === null
          ? stored.locksAsOf
          : {
              block: chain.block,
              source: "live",
              partial: chain.capped.length > 0,
            },
    }
  })()
  const entry: ClaimableRead = { at: now, read, after, settled: null }
  claimableReads.set(key, entry)
  if (claimableReads.size > 500) {
    const oldest = claimableReads.keys().next().value
    if (oldest !== undefined) claimableReads.delete(oldest)
  }
  read.then(
    (wallet) => {
      entry.settled = wallet
      // A read still behind the transaction it was made for is not an
      // answer to the next request for that transaction.
      if (
        after !== null &&
        !includesBlock(wallet, after) &&
        claimableReads.get(key) === entry
      ) {
        claimableReads.delete(key)
      }
    },
    () => {
      if (claimableReads.get(key) === entry) claimableReads.delete(key)
    },
  )
  return read
}

/** How long a wallet answer may be kept, given what the request asked. */
function walletCacheControl(
  wallet: WalletClaimable,
  after: number | null,
): string {
  return after !== null && !includesBlock(wallet, after)
    ? noStoreControl
    : cacheControl(ttl.wallet)
}

/** Exact comparison of non-negative decimals, descending; nulls last. */
function compareDecimalDescending(
  left: string | null,
  right: string | null,
): number {
  if (left === null || right === null) {
    if (left === right) return 0
    return left === null ? 1 : -1
  }
  const difference =
    decimalToScaledBigInt(right, 18) - decimalToScaledBigInt(left, 18)
  if (difference === 0n) return 0
  return difference > 0n ? 1 : -1
}

const gaugeOrder: Record<
  GaugeQuery["sort"],
  (left: GaugeCard, right: GaugeCard) => number
> = {
  votes: (left, right) => compareDecimalDescending(left.votes, right.votes),
  apy: (left, right) =>
    compareDecimalDescending(left.apy, right.apy) ||
    compareDecimalDescending(left.votes, right.votes),
  incentives: (left, right) =>
    compareDecimalDescending(left.incentives.usd, right.incentives.usd) ||
    compareDecimalDescending(left.votes, right.votes),
}

function isFunded(card: GaugeCard): boolean {
  return card.isAlive && card.incentives.tokens.length > 0
}

/** Filters, sorts and pages the stored directory. */
export function pageGauges(
  directory: GaugeDirectory,
  query: GaugeQuery,
): GaugeDirectory {
  const needle = query.q?.toLowerCase()
  const wanted = query.addresses === undefined ? null : new Set(query.addresses)
  // Every filter but `kind`, so tabs can show each kind's count.
  const filtered = directory.gauges.filter(
    (card) =>
      (query.voter === undefined || card.gauge.voter === query.voter) &&
      (wanted === null || wanted.has(card.gauge.address)) &&
      (query.funded === undefined || isFunded(card) === query.funded) &&
      (needle === undefined ||
        card.gauge.name.toLowerCase().includes(needle) ||
        card.gauge.address.startsWith(needle)),
  )
  const matching =
    query.kind === undefined
      ? filtered
      : filtered.filter((card) => card.gauge.kind === query.kind)
  // Every order puts veBTC gauges with expired or withdrawn locks last.
  const sorted = [...matching].sort(
    (left, right) =>
      Number(isRetiredGauge(left)) - Number(isRetiredGauge(right)) ||
      gaugeOrder[query.sort](left, right),
  )
  const offset = query.cursor === undefined ? 0 : Number(query.cursor)
  const next = offset + query.limit
  return {
    epoch: directory.epoch,
    gauges: sorted.slice(offset, next),
    totalVotes: directory.totalVotes,
    total: sorted.length,
    kinds: kindTotals(filtered),
    nextCursor: next < sorted.length ? String(next) : null,
  }
}

/** Most consistently funded first: recent window, then streak, then ever. */
export function rankConsistency(
  funding: GaugeFunding,
  directory: GaugeDirectory,
  query: z.output<typeof gaugeConsistencyQuerySchema>,
): GaugeConsistencyRanking {
  const refs = new Map(
    directory.gauges.map((card) => [card.gauge.address, card.gauge]),
  )
  const gauges = Object.entries(funding.gauges)
    .flatMap(([address, counts]) => {
      const gauge = refs.get(address)
      if (gauge === undefined) return []
      if (query.kind !== undefined && gauge.kind !== query.kind) return []
      return [{ gauge, ...counts, window: funding.window }]
    })
    .sort(
      (left, right) =>
        right.recent - left.recent ||
        right.streak - left.streak ||
        right.total - left.total ||
        (left.gauge.address < right.gauge.address ? -1 : 1),
    )
    .slice(0, query.limit)
  return { throughEpoch: funding.throughEpoch, window: funding.window, gauges }
}

/** The signed-out summary: the epoch, its stats and the best APYs. */
export function summaryOf(
  directory: GaugeDirectory,
  protocol: StoredReadModel<"protocol">["data"],
): ProSummary {
  const current = withDirectoryIncentives(protocol, directory)
  return {
    epoch: protocol.epoch,
    incentives: current.incentives,
    stats: protocol.stats,
    topGauges: directory.gauges
      .filter((card) => isFunded(card) && card.apy !== null)
      .sort(gaugeOrder.apy)
      .slice(0, 5),
    gaugeCount: directory.gauges.length,
    fundedCount: current.funded.count,
    totalVotes: directory.totalVotes,
  }
}

const epochParamSchema = z.coerce.number().int().min(0).max(10_000)

function noStore(c: ApiContext, body: unknown): Response {
  c.set("cacheStatus", "full")
  return c.body(JSON.stringify(body), 200, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  })
}

/** Prices with a stable stamp for ETags; empty prices when KV has none. */
async function currentPrices(
  deps: InternalProDeps,
): Promise<{ prices: Prices; stamp: string }> {
  const prices = (await deps.readPrices()) ?? { btc: null, mezo: null }
  const stamp = `${prices.btc?.usd ?? "-"}:${prices.mezo?.usd ?? "-"}`
  return { prices, stamp }
}

async function shortHash(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  )
  return [...new Uint8Array(digest).slice(0, 8)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
}

function envelope(data: unknown, meta: ReadModelMeta) {
  return { data, meta }
}

const pageSize = { default: 25, max: 100 }

/**
 * A wallet's stored history state; null without one, or without the table
 * (READ_DB before migration 0007), when paging ends with the document.
 */
async function historyState(
  deps: InternalProDeps,
  address: string,
): Promise<HistoryState | null> {
  try {
    return await readHistoryState(requireDb(deps), deps.network, address)
  } catch {
    return null
  }
}

/** The backfill setting, read only where an answer may say `pending`. */
async function historyBackfill(
  deps: InternalProDeps,
  state: HistoryState | null,
): Promise<boolean> {
  return mayBePending(state)
    ? readHistoryBackfill(requireDb(deps), deps.network)
    : false
}

/**
 * What a stored-history page depends on besides its cursor: how far back
 * the history is stored, whether that is all, and whether more is coming.
 * Rows added at the top of the history do not change a page below them.
 */
function historyEtag(state: HistoryState | null, backfill: boolean): string {
  return state === null
    ? "h0"
    : `h${state.low.ts}${state.complete ? "c" : ""}${backfill ? "b" : ""}`
}

/** Cursor = the id of the last row on the previous page. */
function pageActivity(
  rows: readonly ActivityRow[],
  query: z.output<typeof activityQuerySchema>,
): { rows: ActivityRow[]; nextCursor: string | null } {
  const filtered =
    query.category === undefined
      ? rows
      : rows.filter((row) => activityCategory(row.type) === query.category)
  let start = 0
  if (query.cursor !== undefined) {
    const index = filtered.findIndex((row) => row.id === query.cursor)
    if (index === -1) throw new PlatformError("invalid_request")
    start = index + 1
  }
  const limit = Math.min(query.limit, pageSize.max)
  const page = filtered.slice(start, start + limit)
  const last = page.at(-1)
  const more = start + limit < filtered.length
  return {
    rows: page,
    nextCursor: more && last !== undefined ? last.id : null,
  }
}

/** A download costs one from the visitor's bucket; a refusal is a 429. */
async function spendExport(c: ApiContext, deps: InternalProDeps) {
  if (deps.rateLimits === undefined || deps.rateLimits === null) return
  const caller = callerOf(c)
  const client = caller.client ?? "unknown"
  let allowed = true
  let retryAfter = 1
  try {
    const verdict = await deps.rateLimits.consume(
      `pro-export:${client}:${caller.endUser ?? "anonymous"}`,
      caller.endUser === null ? exportAnonymousPolicy : exportEndUserPolicy,
    )
    allowed = verdict.allowed
    retryAfter = Math.max(1, verdict.retryAfterSeconds)
  } catch {
    // Fails open, as the rest of the API's limits do.
  }
  if (!allowed) {
    throw new PlatformError("rate_limited", {
      headers: { "Retry-After": String(retryAfter) },
    })
  }
}

/**
 * A wallet's whole stored activity, or its claims, as a CSV download
 * (history-export.ts). The same wallet rules as the activity route (its
 * document, else the live build), the edge cache in front, the wallet
 * TTLs, and an ETag over what the file depends on, so a repeat download
 * of an unchanged history is a 304 that reads no page.
 *
 * A download that misses the edge costs one from the visitor's bucket,
 * before anything is read: a refused one reads nothing, and a 404 costs
 * one too. Only a request with `If-None-Match` reads first, as a matching
 * one is a free 304. A HEAD reads nothing and costs nothing: it gets the
 * file's headers without its ETag.
 */
async function exportCsv(
  c: ApiContext,
  deps: InternalProDeps,
  address: string,
  kind: HistoryCsvKind,
): Promise<Response> {
  const key = new Request(new URL(c.req.url).toString(), { method: "GET" })
  const conditional = c.req.header("If-None-Match")
  if (deps.cache !== null) {
    const hit = await deps.cache.match(key)
    const etag = hit?.headers.get("ETag")
    if (hit !== undefined && etag !== null && etag !== undefined) {
      c.header("X-Cache", "hit")
      if (ifNoneMatchMatches(conditional, etag)) {
        c.set("cacheStatus", "not-modified")
        return c.body(null, 304, { ETag: etag })
      }
      c.set("cacheStatus", "full")
      return new Response(hit.body, { status: 200, headers: hit.headers })
    }
  }
  const fileName = historyCsvFileName(address, kind, nowOf(deps))
  if (c.req.method === "HEAD") {
    c.set("cacheStatus", "full")
    return c.body(null, 200, {
      "Cache-Control": "no-store",
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${fileName}"`,
    })
  }
  if (conditional === undefined) await spendExport(c, deps)
  const db = requireDb(deps)
  let stored: Awaited<ReturnType<typeof walletDocument<"wallet-activity">>>
  try {
    stored = await walletDocument(c, deps, "wallet-activity", address)
  } catch (error) {
    // A 404 costs a download too.
    if (conditional !== undefined) await spendExport(c, deps)
    throw error
  }
  const state = await historyState(deps, address)
  const backfill = await historyBackfill(deps, state)
  let prices: ClaimPrices | null
  try {
    prices = await readClaimPrices(db, deps.network)
  } catch {
    // Claims not valued yet say so in the file.
    prices = null
  }
  const etag = `"csv-${await shortHash(
    [
      kind,
      stored.etag,
      historyEtag(state, backfill),
      state?.high.ts ?? "-",
      prices === null ? "x" : coverageStamp(prices),
      fileName,
    ].join(":"),
  )}"`
  const headers = {
    ETag: etag,
    "Cache-Control": cacheControl(ttl.wallet),
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="${fileName}"`,
  }
  if (ifNoneMatchMatches(conditional, etag)) {
    c.set("cacheStatus", "not-modified")
    return c.body(null, 304, { ETag: etag })
  }
  if (conditional !== undefined) await spendExport(c, deps)
  const body = historyCsvStream({
    db,
    network: deps.network,
    wallet: address,
    kind,
    documentRows: stored.data.rows,
    state,
    backfill,
    prices,
    nowSeconds: nowOf(deps),
  })
  c.set("cacheStatus", "full")
  if (deps.cache === null) return c.body(body, 200, headers)
  const [served, kept] = body.tee()
  background(c, deps.cache.put(key, new Response(kept, { headers })))
  c.header("X-Cache", "miss")
  return c.body(served, 200, headers)
}

export default function registerInternalProRoutes(
  app: Hono<ApiEnv>,
  deps: InternalProDeps,
): void {
  app.use("/internal/*", async function internalCors(c, next) {
    c.set("cors", { kind: "public" })
    await next()
  })

  app.get("/internal/pro/prices", (c) => {
    c.set("routeTemplate", "/internal/pro/prices")
    return cached(c, deps, async () => {
      const prices = pricesSchema.parse(
        (await deps.readPrices()) ?? { btc: null, mezo: null },
      )
      return {
        body: { data: prices },
        etag: await shortHash(JSON.stringify(prices)),
        cacheControl: cacheControl(ttl.prices),
      }
    })
  })

  app.get("/internal/pro/head", async (c) => {
    c.set("routeTemplate", "/internal/pro/head")
    if (deps.heads === null) throw new PlatformError("service_disabled")
    const hub = deps.heads.get(deps.heads.idFromName(deps.network))
    const response = await hub.fetch("https://block-hub/head")
    return new Response(response.body, {
      status: response.status,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      },
    })
  })

  app.get("/internal/heads", async (c) => {
    c.set("routeTemplate", "/internal/heads")
    if (deps.heads === null) throw new PlatformError("service_disabled")
    if (c.req.header("Upgrade")?.toLowerCase() !== "websocket") {
      throw new PlatformError("invalid_request", {
        message: "Expected a WebSocket upgrade.",
      })
    }
    const hub = deps.heads.get(deps.heads.idFromName(deps.network))
    return hub.fetch(c.req.raw)
  })

  app.get("/internal/pro/protocol", (c) => {
    c.set("routeTemplate", "/internal/pro/protocol")
    return sharedCached(c, deps, async () => {
      // The directory too: this epoch's incentives come from its cards.
      const [stored, directory] = await Promise.all([
        load(deps, "protocol", currentKey),
        load(deps, "gauges", currentKey),
      ])
      return {
        body: envelope(
          withDirectoryIncentives(
            stored.data,
            proDirectory(directory.data, deps.network),
          ),
          stored.meta,
        ),
        etag: await shortHash(
          `${stored.etag}-${stored.meta.updatedAt}-${directory.etag}-${directory.meta.updatedAt}`,
        ),
        cacheControl: cacheControl(ttl.shared),
      }
    })
  })

  app.get("/internal/pro/gauges", (c) => {
    c.set("routeTemplate", "/internal/pro/gauges")
    const query = gaugeQuerySchema.safeParse(c.req.query())
    if (!query.success) throw new PlatformError("invalid_request")
    const after = afterParam(c)
    return sharedCached(c, deps, async () => {
      const stored = await load(deps, "gauges", currentKey, after)
      return {
        body: envelope(
          pageGauges(proDirectory(stored.data, deps.network), query.data),
          stored.meta,
        ),
        etag: `${stored.etag}-${stored.meta.updatedAt}-${await shortHash(c.req.url)}`,
        cacheControl: sharedCacheControl(stored.meta, after),
      }
    })
  })

  app.get("/internal/pro/gauges/consistency", (c) => {
    c.set("routeTemplate", "/internal/pro/gauges/consistency")
    const query = gaugeConsistencyQuerySchema.safeParse(c.req.query())
    if (!query.success) throw new PlatformError("invalid_request")
    return sharedCached(c, deps, async () => {
      const [funding, directory] = await Promise.all([
        load(deps, "gauge-funding", currentKey),
        load(deps, "gauges", currentKey),
      ])
      return {
        body: envelope(
          rankConsistency(
            funding.data,
            proDirectory(directory.data, deps.network),
            query.data,
          ),
          funding.meta,
        ),
        etag: `${funding.etag}-${directory.etag}-${await shortHash(c.req.url)}`,
        cacheControl: cacheControl(ttl.shared),
      }
    })
  })

  app.get("/internal/pro/wallets/:address/identity", (c) => {
    c.set("routeTemplate", "/internal/pro/wallets/{address}/identity")
    const address = addressParam(c, "address")
    return cached(c, deps, async () => {
      if (deps.identity === null || deps.identity === undefined) {
        throw new PlatformError("service_disabled")
      }
      const identity = await deps.identity(address)
      return {
        body: {
          data: identity,
          meta: { source: "mezo-accounts", checkedAt: nowOf(deps) },
        },
        etag: await shortHash(JSON.stringify(identity)),
        // A found Mezo ID is cached a day; misses and outages briefly.
        cacheControl:
          identity.status === "found"
            ? "public, max-age=3600, s-maxage=86400"
            : "public, max-age=60, s-maxage=300",
      }
    })
  })

  app.get("/internal/pro/summary", (c) => {
    c.set("routeTemplate", "/internal/pro/summary")
    return sharedCached(c, deps, async () => {
      const [directory, protocol] = await Promise.all([
        load(deps, "gauges", currentKey),
        load(deps, "protocol", currentKey),
      ])
      const meta =
        directory.meta.updatedAt >= protocol.meta.updatedAt
          ? directory.meta
          : protocol.meta
      return {
        body: envelope(
          summaryOf(proDirectory(directory.data, deps.network), protocol.data),
          meta,
        ),
        etag: await shortHash(
          `${directory.etag}-${directory.meta.updatedAt}-${protocol.etag}-${protocol.meta.updatedAt}`,
        ),
        cacheControl: cacheControl(ttl.shared),
      }
    })
  })

  // The latest activity of everyone, paged and filtered like a wallet's.
  // The Protocol page paints with the 20 rows in the protocol document
  // and asks here for more, or for one category.
  app.get("/internal/pro/protocol/activity", (c) => {
    c.set("routeTemplate", "/internal/pro/protocol/activity")
    const query = activityQuerySchema.safeParse(c.req.query())
    if (!query.success) throw new PlatformError("invalid_request")
    return sharedCached(c, deps, async () => {
      const stored = await load(deps, "protocol-activity", currentKey)
      return {
        body: envelope(pageActivity(stored.data.rows, query.data), stored.meta),
        etag: `${stored.etag}-${await shortHash(c.req.url)}`,
        cacheControl: cacheControl(ttl.shared),
      }
    })
  })

  app.get("/internal/pro/protocol/epochs", (c) => {
    c.set("routeTemplate", "/internal/pro/protocol/epochs")
    return sharedCached(c, deps, async () => {
      const stored = await load(deps, "protocol-history", currentKey)
      return {
        body: envelope(stored.data, stored.meta),
        etag: `${stored.etag}-${stored.meta.updatedAt}`,
        cacheControl: cacheControl(ttl.shared),
      }
    })
  })

  app.get("/internal/pro/protocol/epochs/:number", (c) => {
    c.set("routeTemplate", "/internal/pro/protocol/epochs/{number}")
    const number = epochParamSchema.safeParse(c.req.param("number"))
    if (!number.success) throw new PlatformError("not_found")
    return sharedCached(c, deps, async () => {
      const stored = await load(deps, "protocol-epoch", String(number.data))
      return {
        body: envelope(stored.data, stored.meta),
        etag: `${stored.etag}-${stored.meta.updatedAt}`,
        cacheControl: cacheControl(ttl.shared),
      }
    })
  })

  app.get("/internal/pro/gauges/:address", (c) => {
    c.set("routeTemplate", "/internal/pro/gauges/{address}")
    const address = addressParam(c, "address")
    const after = afterParam(c)
    return sharedCached(c, deps, async () => {
      const [stored, history] = await Promise.all([
        load(deps, "gauge-profile", address),
        readReadModel(requireDb(deps), deps.network, "gauge-history", address),
      ])
      const data = { ...stored.data, history: history?.data.epochs ?? [] }
      return {
        body: envelope(data, stored.meta),
        etag: `${stored.etag}-${history?.etag ?? "none"}-${stored.meta.updatedAt}`,
        cacheControl: sharedCacheControl(stored.meta, after),
      }
    })
  })

  app.get("/internal/pro/wallets/:address/overview", (c) => {
    c.set("routeTemplate", "/internal/pro/wallets/{address}/overview")
    const address = addressParam(c, "address")
    const after = afterParam(c)
    return cached(c, deps, async () => {
      const [wallet, { prices, stamp }] = await Promise.all([
        walletClaimable(c, deps, address, after),
        currentPrices(deps),
      ])
      const { overview: stored, asOf, locksAsOf } = wallet
      const data = {
        ...repriceWalletOverview(stored.data, prices),
        claimableAsOf: asOf,
        locksAsOf,
      }
      return {
        body: envelope(data, stored.meta),
        // What was served: the locks and claimable as read, and where from.
        etag: `${await readModelEtag(data)}-${await shortHash(`${stamp}:${asOf.source}:${asOf.block}:${locksAsOf.source}:${locksAsOf.block}`)}`,
        cacheControl: walletCacheControl(wallet, after),
      }
    })
  })

  app.get("/internal/pro/wallets/:address/rewards", (c) => {
    c.set("routeTemplate", "/internal/pro/wallets/{address}/rewards")
    const address = addressParam(c, "address")
    const after = afterParam(c)
    return cached(c, deps, async () => {
      const [wallet, { prices, stamp }] = await Promise.all([
        walletClaimable(c, deps, address, after),
        currentPrices(deps),
      ])
      const { rewards: stored, asOf } = wallet
      const data = {
        ...repriceWalletRewards(stored.data, prices),
        claimableAsOf: asOf,
      }
      return {
        body: envelope(data, stored.meta),
        // What was served: the claimable as read, and where from. The
        // stored etag covers Earned's claims, which its USD alone does not.
        etag: `${await readModelEtag(data)}-${await shortHash(`${stamp}:${asOf.source}:${asOf.block}:${stored.etag}`)}`,
        cacheControl: walletCacheControl(wallet, after),
      }
    })
  })

  // The wallet's document first, then its stored history (wallet-history.ts)
  // for a wallet with more rows than the document holds.
  app.get("/internal/pro/wallets/:address/activity", (c) => {
    c.set("routeTemplate", "/internal/pro/wallets/{address}/activity")
    const address = addressParam(c, "address")
    const query = activityQuerySchema.safeParse(c.req.query())
    if (!query.success) throw new PlatformError("invalid_request")
    const historyAt =
      query.data.cursor !== undefined && isHistoryCursor(query.data.cursor)
        ? parseHistoryCursor(query.data.cursor)
        : undefined
    if (historyAt === null) throw new PlatformError("invalid_request")
    return cached(c, deps, async () => {
      if (historyAt !== undefined) {
        // A page of the stored history: the document's body is not read,
        // only its meta, for the envelope.
        const state = await historyState(deps, address)
        const backfill = await historyBackfill(deps, state)
        const page =
          state === null
            ? { rows: [], nextCursor: null, pending: false }
            : await readHistoryPage(requireDb(deps), {
                network: deps.network,
                wallet: address,
                category: query.data.category,
                cursor: historyAt,
                limit: query.data.limit,
                state,
                backfill,
              })
        const meta =
          (await readReadModelMeta(
            requireDb(deps),
            deps.network,
            "wallet-activity",
            address,
          )) ?? (await walletDocument(c, deps, "wallet-activity", address)).meta
        const settled =
          state !== null && (page.nextCursor !== null || state.complete)
        return {
          body: envelope({ address, ...page }, meta),
          etag: `${historyEtag(state, backfill)}-${await shortHash(c.req.url)}`,
          cacheControl: cacheControl(settled ? ttl.history : ttl.wallet),
        }
      }
      const stored = await walletDocument(c, deps, "wallet-activity", address)
      const etag = `${stored.etag}-${await shortHash(c.req.url)}`
      const page = pageActivity(stored.data.rows, query.data)
      if (page.nextCursor !== null) {
        return {
          body: envelope({ address, ...page }, stored.meta),
          etag,
          cacheControl: cacheControl(ttl.wallet),
        }
      }
      // The document's last page: older rows may be stored past it.
      const state = await historyState(deps, address)
      const backfill = await historyBackfill(deps, state)
      const after = afterDocument(
        stored.data.rows.at(-1)?.timestamp ?? null,
        state,
        backfill,
      )
      return {
        body: envelope(
          {
            address,
            rows: page.rows,
            ...after,
          },
          stored.meta,
        ),
        // Where the history ends against the document decides the cursor.
        etag: `${etag}-${historyEtag(state, backfill)}${state === null ? "" : `.${state.high.ts}`}`,
        cacheControl: cacheControl(ttl.wallet),
      }
    })
  })

  // The whole stored history as CSV, beside the history routes.
  app.get("/internal/pro/wallets/:address/activity.csv", (c) => {
    c.set("routeTemplate", "/internal/pro/wallets/{address}/activity.csv")
    return exportCsv(c, deps, addressParam(c, "address"), "activity")
  })
  app.get("/internal/pro/wallets/:address/rewards.csv", (c) => {
    c.set("routeTemplate", "/internal/pro/wallets/{address}/rewards.csv")
    return exportCsv(c, deps, addressParam(c, "address"), "rewards")
  })

  app.get("/internal/pro/wallets/:address/balances", (c) => {
    c.set("routeTemplate", "/internal/pro/wallets/{address}/balances")
    const address = addressParam(c, "address")
    const reader = deps.balances ?? null
    if (reader === null) throw new PlatformError("service_disabled")
    // The reader's client retries each RPC itself (15 s per endpoint).
    return cached(
      c,
      deps,
      async () => {
        const [raw, { prices }] = await Promise.all([
          reader(address),
          currentPrices(deps),
        ])
        const data = walletBalances(address, raw, prices)
        const meta: ReadModelMeta = {
          network: deps.network,
          source: "live",
          block: raw.block,
          updatedAt: nowOf(deps),
        }
        return {
          body: envelope(data, meta),
          etag: await shortHash(`${raw.block}-${JSON.stringify(data)}`),
          cacheControl: cacheControl(ttl.balances),
        }
      },
      { retry: false },
    )
  })

  app.get("/internal/pro/wallets/:address/watchlist", async (c) => {
    c.set("routeTemplate", "/internal/pro/wallets/{address}/watchlist")
    const owner = addressParam(c, "address")
    return noStore(c, {
      data: await readWatchList(requireDb(deps), deps.network, owner),
    })
  })

  /** `PUT` adds and `DELETE` removes one item; both answer the list. */
  async function writeWatch(c: ApiContext, action: "add" | "remove") {
    c.set(
      "routeTemplate",
      "/internal/pro/wallets/{address}/watchlist/{kind}/{target}",
    )
    const owner = addressParam(c, "address")
    const target = addressParam(c, "target")
    const kind = watchKindSchema.safeParse(c.req.param("kind"))
    if (!kind.success) throw new PlatformError("not_found")
    // TODO(matchbox-id): require a signed-in Matchbox ID session; the
    // unsigned client id only records who added an item.
    const clientId = watchClientIdSchema.safeParse(
      c.req.header(watchClientHeader),
    )
    if (!clientId.success) {
      throw new PlatformError("invalid_request", {
        message: `Send a client id in ${watchClientHeader}.`,
      })
    }
    const db = requireDb(deps)
    const write = {
      network: deps.network,
      owner,
      kind: kind.data,
      address: target,
    }
    if (action === "add") {
      const result = await addWatchItem(db, {
        ...write,
        clientId: clientId.data,
        nowSeconds: nowOf(deps),
      })
      if (result === "full") {
        throw new PlatformError("invalid_request", {
          message: "The watch list is full.",
        })
      }
    } else {
      await removeWatchItem(db, write)
    }
    return noStore(c, {
      data: await readWatchList(db, deps.network, owner),
    })
  }

  app.put("/internal/pro/wallets/:address/watchlist/:kind/:target", (c) =>
    writeWatch(c, "add"),
  )
  app.delete("/internal/pro/wallets/:address/watchlist/:kind/:target", (c) =>
    writeWatch(c, "remove"),
  )
}
