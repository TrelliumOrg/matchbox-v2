import type { BlockscoutCaller } from "@matchbox/contracts/blockscout"
import type { RateLimitPolicy } from "@matchbox/contracts/rate-limits"
import { PlatformError, type RateLimitClient } from "@matchbox/server"
import type { ApiContext } from "../context"
import { ifNoneMatchMatches } from "../http"

// Serving one /internal/scan response: a small per-isolate memory and the
// Cache API (its own `scan` namespace) in front of the handler, keyed by
// the request and the version of the data it reads, so an entry stops
// being used the moment the data behind it changes, not on a timer.

/**
 * How long an answer may be reused, and by what it is keyed:
 * - `long`: sealed epochs, settled series ranges, final composed
 *   documents. No version in the key; kept a day (a backfill may still
 *   rewrite them).
 * - `run`: data the Scan copy writes; keyed by the last successful
 *   `scan-copy` run, and for aggregates also by `scan_status.updated_at`
 *   (ScanContext.aggregateVersion) and any input taken from the clock.
 * - `live`: READ_DB Borrow state; keyed by the 5-minute live snapshot slot.
 * - `head`: composed documents with recent chain parts; keyed by the head.
 * - `doc`: a Pro read-model document; keyed by its etag.
 * - `brief`: an outside answer that may soon change (a Mezo ID not found,
 *   a lock read from the chain); keyed by a one-minute slot.
 */
export type ScanCacheClass = "long" | "run" | "live" | "head" | "doc" | "brief"

export const scanCacheControl: Record<ScanCacheClass, string> = {
  long: "public, max-age=86400",
  run: "public, max-age=30",
  live: "public, max-age=60",
  head: "public, max-age=3",
  doc: "public, max-age=60",
  brief: "public, max-age=60",
}

/** Seconds the Cache API keeps an entry (the version retires it sooner). */
const storageSeconds: Record<ScanCacheClass, number> = {
  long: 86_400,
  run: 86_400,
  live: 900,
  head: 300,
  doc: 86_400,
  brief: 60,
}

/** The scan rate-limit class: one bucket per end user, spent on misses. */
export const scanEndUserPolicy: RateLimitPolicy = {
  perMinute: 120,
  perDay: 10_000,
}
export const scanAnonymousPolicy: RateLimitPolicy = {
  perMinute: 600,
  perDay: 100_000,
}

/**
 * The rate-limit call's bound. Past it the call fails open, as it does on
 * an error: a slow limiter must not take Matchscan's 3 s for a document.
 */
export const scanSpendMs = 250

/**
 * A composed document's edge lookup slower than this is a miss: the
 * document is rendered instead (`serveComposed`).
 */
export const scanLookupMs = 200

/**
 * `work`, or a rejection once `ms` pass first. A late `work` that rejects
 * is caught, so it never surfaces as an unhandled rejection.
 */
function within<T>(work: Promise<T>, ms: number): Promise<T> {
  work.catch(() => undefined)
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error("Timed out")), ms)
  })
  return Promise.race([work, late]).finally(() => clearTimeout(timer))
}

export function scanRateLimitKey(caller: BlockscoutCaller): string {
  const client = caller.client ?? "unknown"
  return caller.endUser === null
    ? `scan:caller:${client}:anonymous`
    : `scan:caller:${client}:${caller.endUser}`
}

const keyOrigin = "https://scan.internal"

function keyFor(resource: string, version: string): string {
  return `${keyOrigin}/v1/${version === "" ? "-" : version}/${resource.replace(/^\/+/, "")}`
}
/** The isolate memory's byte budget, as the Blockscout proxy's. */
export const scanMemoryBytes = 8 * 1024 * 1024
/** Bigger answers (whole directories) live only at the edge. */
export const scanMaxMemoryEntryBytes = 256 * 1024

/** Approximate bytes an entry holds in memory (UTF-16 strings). */
function storedBytes(key: string, stored: Stored): number {
  return (key.length + stored.body.length + stored.etag.length) * 2 + 128
}

type Stored = { body: string; etag: string; cacheClass: ScanCacheClass }

export type ScanServeDeps = {
  cache: Cache | null
  rateLimits: RateLimitClient | null
  /** The memory budget in bytes; scanMemoryBytes by default. */
  memoryBytes?: number
}

export class ScanResponder {
  private readonly memory = new Map<string, { stored: Stored; bytes: number }>()
  private bytes = 0

  constructor(private readonly deps: ScanServeDeps) {}

  /** Bytes held in memory, for tests. */
  get heldBytes(): number {
    return this.bytes
  }

  /**
   * Answers from memory or the edge when `key` (the canonical request plus
   * `version`) has been rendered; otherwise spends the caller's bucket,
   * renders, stores and answers.
   */
  async serve(
    c: ApiContext,
    spec: {
      cacheClass: ScanCacheClass
      /** Path and canonical query. */
      resource: string
      /** Data version; '' for `long`. */
      version: string
      caller: BlockscoutCaller
      render: () => Promise<{
        body: unknown
        cacheClass?: ScanCacheClass
        /**
         * False for an answer that holds something transient (a head
         * read that timed out): answered `private, no-store`, stored
         * nowhere.
         */
        store?: boolean
      }>
    },
  ): Promise<Response> {
    const key = keyFor(spec.resource, spec.version)
    const found = await this.lookup(key)
    if (found !== null) return this.answer(c, found.stored, found.source)
    await this.spend(spec.caller)
    const rendered = await spec.render()
    if (rendered.store === false) {
      const unstored = await storedOf(
        rendered.body,
        rendered.cacheClass ?? spec.cacheClass,
      )
      return this.answer(c, unstored, "miss", "private, no-store")
    }
    const stored = await this.store(
      c,
      key,
      rendered.body,
      rendered.cacheClass ?? spec.cacheClass,
    )
    return this.answer(c, stored, "miss")
  }

  /**
   * An answer that may turn out final once rendered (a composed document,
   * a series range): a final one is stored under a version-free key (kept
   * a day as `long`, served whatever the version); otherwise under the
   * version, as `cacheClass` (`head` by default). One the render calls not
   * `shareable` (a part unavailable for a reason that may not hold for the
   * next caller) is answered `no-store` and stored nowhere.
   */
  async serveComposed(
    c: ApiContext,
    spec: {
      finalKey: { resource: string; version: string }
      resource: string
      version: string
      caller: BlockscoutCaller
      cacheClass?: ScanCacheClass
      render: () => Promise<{
        body: unknown
        final: boolean
        shareable?: boolean
      }>
    },
  ): Promise<Response> {
    const finalKey = keyFor(spec.finalKey.resource, spec.finalKey.version)
    const key = keyFor(spec.resource, spec.version)
    // Each bounded: Matchscan waits 3 s for the document, counted from the
    // request's arrival, as its parts' deadlines are.
    const found =
      (await this.lookup(finalKey, scanLookupMs)) ??
      (await this.lookup(key, scanLookupMs))
    if (found !== null) return this.answer(c, found.stored, found.source)
    await this.spend(spec.caller)
    const rendered = await spec.render()
    const cacheClass = spec.cacheClass ?? "head"
    if (rendered.shareable === false) {
      const stored = await storedOf(rendered.body, cacheClass)
      return this.answer(c, stored, "miss", "private, no-store")
    }
    const stored = rendered.final
      ? await this.store(c, finalKey, rendered.body, "long")
      : await this.store(c, key, rendered.body, cacheClass)
    return this.answer(c, stored, "miss")
  }

  /**
   * The body stored for `resource` at `version` ('' is the version-free
   * key of a final answer), or null. Reads this isolate's memory, then the
   * edge; never renders, stores or spends a bucket.
   */
  async peek(resource: string, version: string): Promise<string | null> {
    const found = await this.lookup(keyFor(resource, version))
    return found === null ? null : found.stored.body
  }

  /** `peek` of the final answer. */
  peekFinal(resource: string): Promise<string | null> {
    return this.peek(resource, "")
  }

  /**
   * Drops what is stored for `resource` at `version` ('' for the final
   * answer), from this isolate's memory and the edge: for an answer known
   * to be out of date.
   */
  async forget(
    c: ApiContext,
    resource: string,
    version: string,
  ): Promise<void> {
    const key = keyFor(resource, version)
    const held = this.memory.get(key)
    if (held !== undefined) {
      this.memory.delete(key)
      this.bytes -= held.bytes
    }
    if (this.deps.cache === null) return
    const removed = this.deps.cache.delete(new Request(key))
    try {
      c.executionCtx.waitUntil(removed.catch(() => false))
    } catch {
      await removed.catch(() => false)
    }
  }

  /**
   * Renders past every stored answer and answers `private, no-store`:
   * for a read that must be current (a Mezo ID about to receive funds).
   * The response itself is stored nowhere; what the render learns, it may
   * store itself. Spends the caller's bucket like any miss.
   */
  async serveFresh(
    c: ApiContext,
    spec: { caller: BlockscoutCaller; render: () => Promise<unknown> },
  ): Promise<Response> {
    await this.spend(spec.caller)
    const stored = await storedOf(await spec.render(), "brief")
    return this.answer(c, stored, "miss", "private, no-store")
  }

  /**
   * Stores `value` as `resource`'s final answer (kept a day as `long`),
   * as serveComposed does for a final render: for an answer learned from
   * another resource's render.
   */
  async keepFinal(
    c: ApiContext,
    resource: string,
    value: unknown,
  ): Promise<void> {
    await this.store(c, keyFor(resource, ""), value, "long")
  }

  /**
   * `key`'s stored answer from memory, else the edge. With `ms`, an edge
   * lookup that takes longer, or fails, is a miss.
   */
  private async lookup(
    key: string,
    ms?: number,
  ): Promise<{ stored: Stored; source: "memory" | "edge" } | null> {
    const remembered = this.memory.get(key)
    if (remembered !== undefined) {
      // Refresh its place in the LRU order.
      this.memory.delete(key)
      this.memory.set(key, remembered)
      return { stored: remembered.stored, source: "memory" }
    }
    const cache = this.deps.cache
    if (cache === null) return null
    const read = async (): Promise<Stored | null> => {
      const hit = await cache.match(new Request(key))
      if (hit === undefined) return null
      return {
        body: await hit.text(),
        etag: hit.headers.get("ETag") ?? "",
        cacheClass: cacheClassOf(hit.headers.get("X-Scan-Class")),
      }
    }
    const stored =
      ms === undefined
        ? await read()
        : await within(read(), ms).catch(() => null)
    if (stored === null) return null
    this.remember(key, stored)
    return { stored, source: "edge" }
  }

  private async store(
    c: ApiContext,
    key: string,
    value: unknown,
    cacheClass: ScanCacheClass,
  ): Promise<Stored> {
    const stored = await storedOf(value, cacheClass)
    const body = stored.body
    this.remember(key, stored)
    if (this.deps.cache !== null) {
      const response = new Response(body, {
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": `public, max-age=${storageSeconds[cacheClass]}`,
          ETag: stored.etag,
          "X-Scan-Class": cacheClass,
        },
      })
      const put = this.deps.cache.put(new Request(key), response)
      try {
        c.executionCtx.waitUntil(put.catch(() => undefined))
      } catch {
        await put.catch(() => undefined)
      }
    }
    return stored
  }

  private async spend(caller: BlockscoutCaller): Promise<void> {
    if (this.deps.rateLimits === null) return
    let allowed = true
    let retryAfter = 1
    try {
      const verdict = await within(
        this.deps.rateLimits.consume(
          scanRateLimitKey(caller),
          caller.endUser === null ? scanAnonymousPolicy : scanEndUserPolicy,
        ),
        scanSpendMs,
      )
      allowed = verdict.allowed
      retryAfter = Math.max(1, verdict.retryAfterSeconds)
    } catch {
      // Fails open, as the rest of the API's limits do; also when the
      // limiter is slower than `scanSpendMs`.
    }
    if (!allowed) {
      throw new PlatformError("rate_limited", {
        headers: { "Retry-After": String(retryAfter) },
      })
    }
  }

  private answer(
    c: ApiContext,
    stored: Stored,
    source: "memory" | "edge" | "miss",
    cacheControl = scanCacheControl[stored.cacheClass],
  ): Response {
    const headers = {
      "Cache-Control": cacheControl,
      ETag: stored.etag,
      "X-Cache": source,
      "X-Scan-Class": stored.cacheClass,
    }
    if (ifNoneMatchMatches(c.req.header("If-None-Match"), stored.etag)) {
      c.set("cacheStatus", "not-modified")
      return c.body(null, 304, headers)
    }
    c.set("cacheStatus", "full")
    return c.body(stored.body, 200, {
      ...headers,
      "Content-Type": "application/json; charset=utf-8",
    })
  }

  /** A byte-budgeted LRU, as the Blockscout proxy's memory. */
  private remember(key: string, stored: Stored): void {
    const previous = this.memory.get(key)
    if (previous !== undefined) {
      this.memory.delete(key)
      this.bytes -= previous.bytes
    }
    const bytes = storedBytes(key, stored)
    if (bytes > scanMaxMemoryEntryBytes) return
    this.memory.set(key, { stored, bytes })
    this.bytes += bytes
    const budget = this.deps.memoryBytes ?? scanMemoryBytes
    while (this.bytes > budget) {
      const oldest = this.memory.entries().next().value
      if (oldest === undefined) break
      this.memory.delete(oldest[0])
      this.bytes -= oldest[1].bytes
    }
  }
}

async function storedOf(
  value: unknown,
  cacheClass: ScanCacheClass,
): Promise<Stored> {
  const body = JSON.stringify(value)
  return { body, etag: `"${await shortHash(body)}"`, cacheClass }
}

function cacheClassOf(value: string | null): ScanCacheClass {
  switch (value) {
    case "long":
    case "run":
    case "live":
    case "head":
    case "doc":
    case "brief":
      return value
    default:
      return "run"
  }
}

async function shortHash(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  )
  return [...new Uint8Array(digest).slice(0, 12)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
}
