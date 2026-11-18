import { env } from "cloudflare:workers"
import { dataModeFrom } from "@matchbox/app-kit/read-model"
import { createLogger } from "@matchbox/logger"
import { getRequestHeader } from "@tanstack/react-start/server"
import type { z } from "zod"
import { degrade, fetchApi, fixtureLatency } from "../caller.server"
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

function fromStatus<T>(status: number): ScanRead<T> {
  if (status === 404) return { status: "missing" }
  degrade()
  if (status === 503) return { status: "disabled" }
  if (status === 429) return { status: "rate-limited" }
  return { status: "unavailable" }
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
): Promise<ScanRead<T>> {
  const read = await readOnce(path, query, schema)
  if (read.status !== "invalid") return read
  if (!query.has("cursor")) {
    degrade()
    return { status: "unavailable" }
  }
  // A stale cursor (its list's shape changed): the list from the top.
  const fresh = new URLSearchParams(query)
  fresh.delete("cursor")
  const retried = await readOnce(path, fresh, schema)
  if (retried.status === "invalid") {
    degrade()
    return { status: "unavailable" }
  }
  return retried.status === "ok" ? { ...retried, restarted: true } : retried
}

async function readOnce<T>(
  path: string,
  query: URLSearchParams,
  schema: z.ZodType<T>,
): Promise<ScanRead<T> | { status: "invalid" }> {
  const search = query.toString()
  if (dataModeFrom(env.SCAN_DATA) === "fixtures") {
    await fixtureLatency()
    const fixture = scanFixture(
      path,
      query,
      fixtureScenario(getRequestHeader("x-scan-fixture") ?? null),
    )
    if (fixture.status === 400) return { status: "invalid" }
    if (fixture.status !== 200) return fromStatus(fixture.status)
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
  let response: Response
  try {
    response = await fetchApi(
      `/internal/scan/${path}${search === "" ? "" : `?${search}`}`,
    )
  } catch (error) {
    log.error({
      message: "Scan routes unreachable",
      path,
      error: error instanceof Error ? error.message : String(error),
    })
    degrade()
    return { status: "unavailable" }
  }
  if (response.status === 400) {
    log.warn({ message: "Scan read refused its query", path })
    return { status: "invalid" }
  }
  if (!response.ok) {
    if (response.status !== 404 && response.status !== 503) {
      log.warn({
        message: "Scan read failed",
        path,
        status: response.status,
        ms: Date.now() - started,
      })
    }
    return fromStatus(response.status)
  }
  // A 200 whose body is cut off, HTML or late degrades this read, never
  // the page (an exception here would reject the route's Promise.all).
  let body: unknown
  try {
    body = await response.json()
  } catch (error) {
    log.error({
      message: "Scan body unreadable",
      path,
      error: error instanceof Error ? error.message : String(error),
    })
    degrade()
    return { status: "unavailable" }
  }
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    log.error({
      message: "Scan body failed validation",
      path,
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
