import { env } from "cloudflare:workers"
import { dataModeFrom } from "@matchbox/app-kit/read-model"
import { createLogger } from "@matchbox/logger"
import { getRequestHeader } from "@tanstack/react-start/server"
import type { z } from "zod"
import {
  apiReadTimeoutMs,
  degrade,
  fetchApi,
  fixtureLatency,
} from "../caller.server"
import { fixtureScenario, scanFixture } from "./fixtures"

/**
 * Reads Matchscan's read routes on the API Worker (`/internal/scan/*`,
 * apps/api README "Scan read routes") over the `API` binding with the
 * caller headers, and validates the body with its schema from
 * `@matchbox/contracts/scan`. Never throws:
 *
 * - 404 `not_found`: "missing" (the entity page's 404).
 * - 503 `service_disabled`: "disabled", the database is not bound yet.
 * - 429 `rate_limited`: "rate-limited".
 * - 400, 5xx, an unreachable API or a body that fails its schema:
 *   "unavailable".
 *
 * Anything but "ok" and "missing" marks the page degraded (never stored).
 *
 * A read that failed in passing (unreachable or late, a 5xx other than
 * 503, a body cut off) is sent once more when at least `minimumRetryMs`
 * of its `readBudgetMs` are left, before the part says "Data
 * unavailable". A read of `slowReadMs` or more, and every retry, is
 * logged with the route (addresses and hashes left out), its time and
 * how it ended.
 *
 * Also:
 * - `skipped`: stored rows the API left out because they failed their
 *   schema (`meta.skipped`); pages say the list is not complete.
 * - A cursor the API no longer accepts (a 400 after its cursor shape
 *   changed, from a cached page) restarts the list from the top:
 *   `restarted`, never an error.
 * - A document the API marks `private` or `no-store` makes the page
 *   no-store too.
 */

const log = createLogger({ fields: { service: "matchscan", area: "scan" } })

export type ScanRead<T> =
  | { status: "ok"; data: T; skipped: number; restarted?: boolean }
  | { status: "missing" }
  | { status: "disabled" }
  | { status: "rate-limited" }
  | { status: "unavailable" }

/**
 * A read and its one retry take at most this long together: Matchscan's
 * 3 s for one read, and one more try when the first failed early or the
 * API was slow to start.
 */
export const readBudgetMs = 4_500
/** A retry is only sent with at least this much of the budget left. */
export const minimumRetryMs = 1_000
/** A read this slow is logged with its time. */
export const slowReadMs = 1_000

/** A read that failed in a way one more try may not: not degraded yet. */
type Passing = { status: "passing"; reason: string }

function fromStatus<T>(status: number): ScanRead<T> | Passing {
  if (status === 404) return { status: "missing" }
  if (status >= 500 && status !== 503) {
    return { status: "passing", reason: `status ${status}` }
  }
  degrade()
  if (status === 503) return { status: "disabled" }
  if (status === 429) return { status: "rate-limited" }
  return { status: "unavailable" }
}

/** A read's path for the logs: no address, hash or number. */
export function routeOf(path: string): string {
  return path
    .replace(/0x[0-9a-fA-F]{64}/g, "{hash}")
    .replace(/0x[0-9a-fA-F]{40}/g, "{address}")
    .replace(/\/[0-9]+(?=\/|$)/g, "/{n}")
}

/** Rows left out of a page or an aggregate (`meta.skipped`), else 0. */
export function skippedOf(body: unknown): number {
  if (body === null || typeof body !== "object" || !("meta" in body)) return 0
  const meta = (body as { meta: unknown }).meta
  if (meta === null || typeof meta !== "object" || !("skipped" in meta))
    return 0
  const skipped = (meta as { skipped: unknown }).skipped
  return typeof skipped === "number" && skipped > 0 ? skipped : 0
}

/** Whether the API said this answer is not for a shared cache. */
export function privateAnswer(cacheControl: string | null): boolean {
  if (cacheControl === null) return false
  return cacheControl
    .split(",")
    .some((part) => ["private", "no-store"].includes(part.trim().toLowerCase()))
}

export async function readScan<T>(
  path: string,
  query: URLSearchParams,
  schema: z.ZodType<T>,
  budgetMs = readBudgetMs,
): Promise<ScanRead<T>> {
  const started = Date.now()
  const read = await readTwice(path, query, schema, started, budgetMs)
  if (read.status !== "invalid") return read
  if (!query.has("cursor")) {
    degrade()
    return { status: "unavailable" }
  }
  // A stale cursor (its list's shape changed): the list from the top.
  const fresh = new URLSearchParams(query)
  fresh.delete("cursor")
  const retried = await readTwice(path, fresh, schema, started, budgetMs)
  if (retried.status === "invalid") {
    degrade()
    return { status: "unavailable" }
  }
  return retried.status === "ok" ? { ...retried, restarted: true } : retried
}

/** One read, and once more if it failed in passing and time is left. */
async function readTwice<T>(
  path: string,
  query: URLSearchParams,
  schema: z.ZodType<T>,
  started: number,
  budgetMs: number,
): Promise<ScanRead<T> | { status: "invalid" }> {
  const first = await readOnce(
    path,
    query,
    schema,
    Math.min(apiReadTimeoutMs, budgetMs),
  )
  if (first.status !== "passing") return first
  const left = budgetMs - (Date.now() - started)
  if (left < minimumRetryMs) {
    log.warn({
      message: "Scan read failed",
      route: routeOf(path),
      reason: first.reason,
      retried: false,
      ms: Date.now() - started,
    })
    degrade()
    return { status: "unavailable" }
  }
  const second = await readOnce(
    path,
    query,
    schema,
    Math.min(apiReadTimeoutMs, left),
  )
  log.warn({
    message: "Scan read retried",
    route: routeOf(path),
    reason: first.reason,
    outcome: second.status === "passing" ? second.reason : second.status,
    ms: Date.now() - started,
  })
  if (second.status !== "passing") return second
  degrade()
  return { status: "unavailable" }
}

async function readOnce<T>(
  path: string,
  query: URLSearchParams,
  schema: z.ZodType<T>,
  timeoutMs: number,
): Promise<ScanRead<T> | { status: "invalid" } | Passing> {
  const search = query.toString()
  if (dataModeFrom(env.SCAN_DATA) === "fixtures") {
    await fixtureLatency()
    const fixture = scanFixture(
      path,
      query,
      fixtureScenario(getRequestHeader("x-scan-fixture") ?? null),
    )
    if (fixture.status === 400) return { status: "invalid" }
    if (fixture.status !== 200) {
      const read = fromStatus<T>(fixture.status)
      if (read.status !== "passing") return read
      degrade()
      return { status: "unavailable" }
    }
    const parsed = schema.safeParse(fixture.body)
    if (parsed.success) {
      return {
        status: "ok",
        data: parsed.data,
        skipped: skippedOf(parsed.data),
      }
    }
    log.error({ message: "Scan fixture failed validation", path })
    degrade()
    return { status: "unavailable" }
  }
  const started = Date.now()
  const route = routeOf(path)
  let response: Response
  try {
    response = await fetchApi(
      `/internal/scan/${path}${search === "" ? "" : `?${search}`}`,
      timeoutMs,
    )
  } catch (error) {
    // Unreachable, or past its timeout: one more try may answer.
    const name = error instanceof Error ? error.name : "Error"
    return {
      status: "passing",
      reason: name === "TimeoutError" ? `timeout ${timeoutMs} ms` : name,
    }
  }
  const ms = Date.now() - started
  if (ms >= slowReadMs) {
    log.info({
      message: "Scan read slow",
      route,
      status: response.status,
      ms,
    })
  }
  if (response.status === 400) {
    log.warn({ message: "Scan read refused its query", route })
    return { status: "invalid" }
  }
  if (!response.ok) {
    if (response.status === 429) {
      log.warn({ message: "Scan read limited", route, ms })
    }
    return fromStatus(response.status)
  }
  // A 200 whose body is cut off, HTML or late degrades this read, never
  // the page (an exception here would reject the route's Promise.all).
  let body: unknown
  try {
    body = await response.json()
  } catch (error) {
    return {
      status: "passing",
      reason: `body ${error instanceof Error ? error.name : "unreadable"}`,
    }
  }
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    log.error({
      message: "Scan body failed validation",
      route,
      issues: parsed.error.issues.slice(0, 5).map((issue) => issue.path),
    })
    degrade()
    return { status: "unavailable" }
  }
  // Not for a shared cache (a composed document that is not shareable):
  // the page that shows it is not either.
  if (privateAnswer(response.headers.get("cache-control"))) degrade()
  return { status: "ok", data: parsed.data, skipped: skippedOf(parsed.data) }
}
