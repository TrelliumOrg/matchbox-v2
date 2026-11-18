import { env } from "cloudflare:workers"
import { dataModeFrom } from "@matchbox/app-kit/read-model"
import { createLogger } from "@matchbox/logger"
import type { z } from "zod"
import {
  canonicalQuery,
  degrade,
  fetchApi,
  fixtureLatency,
} from "../caller.server"
import { blockscoutFixture } from "./fixtures"

/**
 * Reads the API Worker's Blockscout proxy
 * (`/internal/blockscout/api/v2/<path>`) over the `API` binding, with the
 * caller headers, and validates the body with its schema from
 * `@matchbox/contracts/blockscout`. Never throws: a missing resource is
 * "missing" (the page's 404), and a failed or rate-limited read degrades
 * only the section that asked, and marks the page so it is not cached.
 */

const log = createLogger({
  fields: { service: "matchscan", area: "blockscout" },
})

export type Read<T> =
  | { status: "ok"; data: T }
  | { status: "missing" }
  | { status: "unavailable" }
  | { status: "rate-limited" }

export { canonicalQuery }

async function fetchProxy(path: string, query: URLSearchParams) {
  const search = query.toString()
  return fetchApi(
    `/internal/blockscout/api/v2/${path}${search === "" ? "" : `?${search}`}`,
  )
}

export async function readBlockscout<T>(
  path: string,
  query: URLSearchParams,
  schema: z.ZodType<T>,
): Promise<Read<T>> {
  if (dataModeFrom(env.SCAN_DATA) === "fixtures") {
    await fixtureLatency()
    const fixture = blockscoutFixture(path, query)
    if (fixture.status === 404) return { status: "missing" }
    if (fixture.status !== 200) {
      degrade()
      return fixture.status === 429
        ? { status: "rate-limited" }
        : { status: "unavailable" }
    }
    const parsed = schema.safeParse(fixture.body)
    if (parsed.success) return { status: "ok", data: parsed.data }
    log.error({ message: "Blockscout fixture failed validation", path })
    degrade()
    return { status: "unavailable" }
  }
  const started = Date.now()
  let response: Response
  try {
    response = await fetchProxy(path, query)
  } catch (error) {
    log.error({
      message: "Blockscout proxy unreachable",
      path,
      error: error instanceof Error ? error.message : String(error),
    })
    degrade()
    return { status: "unavailable" }
  }
  if (response.status === 404) return { status: "missing" }
  if (!response.ok) {
    log.warn({
      message: "Blockscout proxy read failed",
      path,
      status: response.status,
      ms: Date.now() - started,
    })
    degrade()
    return response.status === 429
      ? { status: "rate-limited" }
      : { status: "unavailable" }
  }
  // A 200 whose body is cut off, HTML or late degrades this read, never
  // the page.
  let body: unknown
  try {
    body = await response.json()
  } catch (error) {
    log.error({
      message: "Blockscout proxy body unreadable",
      path,
      error: error instanceof Error ? error.message : String(error),
    })
    degrade()
    return { status: "unavailable" }
  }
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    log.error({
      message: "Blockscout proxy body failed validation",
      path,
      issues: parsed.error.issues.slice(0, 5).map((issue) => issue.path),
    })
    degrade()
    return { status: "unavailable" }
  }
  return { status: "ok", data: parsed.data }
}
