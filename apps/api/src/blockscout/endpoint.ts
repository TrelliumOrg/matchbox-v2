import {
  type BlockscoutCaller,
  blockscoutClientHeader,
  blockscoutClientSchema,
  blockscoutEndUserHeader,
  blockscoutEndUserSchema,
} from "@matchbox/contracts/blockscout"
import { PlatformError, requestLogger } from "@matchbox/server"
import type { Hono } from "hono"
import type { z } from "zod"
import type { ApiContext, ApiEnv } from "../context"
import type { BlockscoutProxy } from "./proxy"

// `GET /internal/blockscout/api/v2/<path>`: the allowlisted, cached
// Blockscout proxy (src/blockscout/proxy.ts). Internal callers only; the
// /internal/* gate in app.ts runs first. The body is Blockscout's own JSON,
// trimmed by the route's schema, so a client written against Blockscout
// (Stuart's) parses it. Headers say how it was served: `X-Cache` (memory,
// edge, miss, coalesced, revalidating, stale), `X-Blockscout-Class` and
// `X-Blockscout-Head` (the head freshness was judged at). Callers identify
// themselves with `X-Matchbox-Client` and `X-Matchbox-End-User`
// (@matchbox/contracts/blockscout) for their own upstream bucket.

export const blockscoutPrefix = "/internal/blockscout/api/v2/"

function background(c: ApiContext): (task: Promise<unknown>) => void {
  return function runAfterResponse(task) {
    const settled = task.catch(() => undefined)
    try {
      c.executionCtx.waitUntil(settled)
    } catch {
      // No ExecutionContext in `app.request()` tests; it runs detached.
    }
  }
}

/** The caller headers; a malformed one is a 400, an absent one null. */
export function callerOf(c: ApiContext): BlockscoutCaller {
  function read(name: string, schema: z.ZodType<string>): string | null {
    const raw = c.req.header(name)
    if (raw === undefined) return null
    const parsed = schema.safeParse(raw)
    if (!parsed.success) throw new PlatformError("invalid_request")
    return parsed.data
  }
  return {
    client: read(blockscoutClientHeader, blockscoutClientSchema),
    endUser: read(blockscoutEndUserHeader, blockscoutEndUserSchema),
  }
}

export default function registerBlockscoutProxy(
  app: Hono<ApiEnv>,
  proxy: BlockscoutProxy | null,
): void {
  app.on(["GET", "HEAD"], "/internal/blockscout/*", async (c) => {
    c.set("routeTemplate", "/internal/blockscout/*")
    if (c.req.method !== "GET") throw new PlatformError("not_found")
    // The raw path, never the router's decoded one.
    const url = new URL(c.req.url)
    if (!url.pathname.startsWith(blockscoutPrefix)) {
      throw new PlatformError("not_found")
    }
    // Only Workers call this; no browser needs to read it cross-origin.
    c.set("cors", { kind: "anonymous" })
    if (proxy === null) throw new PlatformError("service_disabled")
    const caller = callerOf(c)
    const path = url.pathname.slice(blockscoutPrefix.length)
    const result = await proxy.handle(
      path,
      url.searchParams,
      caller,
      background(c),
    )
    if (result.template !== null) {
      c.set("routeTemplate", `/internal/blockscout/api/v2/${result.template}`)
    }
    switch (result.kind) {
      case "not-found":
        throw new PlatformError("not_found")
      case "invalid":
        throw new PlatformError("invalid_request")
      case "unavailable":
        throw new PlatformError(
          result.reason === "rate-limited"
            ? "rate_limited"
            : "service_disabled",
          {
            headers: {
              "Retry-After": String(Math.max(1, result.retryAfterSeconds)),
            },
          },
        )
      case "ok":
        c.set("cacheStatus", "full")
        // One line per answer that did not come from isolate memory, so a
        // live test (`wrangler tail`) can count misses against edge hits.
        if (result.cacheStatus !== "memory") {
          requestLogger(c).info({
            message: "Blockscout proxy answer",
            route: result.template,
            cache: result.cacheStatus,
            cacheClass: result.cacheClass,
          })
        }
        return c.body(result.body, 200, {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": result.cacheControl,
          "X-Cache": result.cacheStatus,
          "X-Blockscout-Class": result.cacheClass,
          "X-Blockscout-Head": result.head,
        })
    }
  })
}
