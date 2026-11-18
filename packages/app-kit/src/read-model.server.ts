/// <reference path="./env.d.ts" />
import { env } from "cloudflare:workers"
import { createLogger } from "@matchbox/logger"
import type { z } from "zod"

/**
 * Reads the API Worker's internal read models over the `API` service
 * binding (or `API_ORIGIN` in local dev), or from an app's bundled fixtures.
 * Each app makes one client with its path prefix (`/internal/pro`,
 * `/internal/scan`), its fixture source and its logger service name.
 */

export class ReadModelError extends Error {
  readonly status: number
  constructor(path: string, status: number) {
    super(`Read model ${path} failed with ${status}`)
    this.name = "ReadModelError"
    this.status = status
  }
}

export type DataMode = "fixtures" | "api"

/** "fixtures" when the app's data variable says so, else "api". */
export function dataModeFrom(value: string | undefined): DataMode {
  return value === "fixtures" ? "fixtures" : "api"
}

/** A bundled response for a full path (prefix included). */
export type FixtureSource = (
  path: string,
  nowMs: number,
) => { status: number; body: unknown }

export type ReadModelOptions = {
  /** Prepended to every path, for example "/internal/scan". "" for none. */
  prefix: string
  fixtures: FixtureSource
  /** The logger's service field, for example "matchbox-scan". */
  service: string
  /** Read per request, so tests and local dev can switch it. */
  mode: () => DataMode
  /**
   * The longest one read may take, headers and body, after which it
   * rejects (a TimeoutError). None by default.
   */
  timeoutMs?: number
}

export async function fetchApi(
  path: string,
  timeoutMs?: number,
): Promise<Response> {
  const headers: HeadersInit = { accept: "application/json" }
  const init: RequestInit = {
    headers:
      env.INTERNAL_TOKEN === undefined
        ? headers
        : { ...headers, authorization: `Bearer ${env.INTERNAL_TOKEN}` },
    ...(timeoutMs === undefined
      ? {}
      : { signal: AbortSignal.timeout(timeoutMs) }),
  }
  if (env.API !== undefined) {
    return env.API.fetch(new Request(`https://api.internal${path}`, init))
  }
  return fetch(new URL(path, env.API_ORIGIN), init)
}

export type ReadModel = {
  <T>(path: string, schema: z.ZodType<T>, allowMissing: true): Promise<T | null>
  <T>(path: string, schema: z.ZodType<T>, allowMissing?: false): Promise<T>
}

export type ReadModelClient = {
  dataMode: () => DataMode
  /**
   * Reads one read model and validates it. Returns null on 404 when
   * `allowMissing` is set (a gauge address nobody knows).
   */
  readModel: ReadModel
}

export function createReadModelClient(
  options: ReadModelOptions,
): ReadModelClient {
  const log = createLogger({ fields: { service: options.service } })

  function readModel<T>(
    relative: string,
    schema: z.ZodType<T>,
    allowMissing: true,
  ): Promise<T | null>
  function readModel<T>(
    relative: string,
    schema: z.ZodType<T>,
    allowMissing?: false,
  ): Promise<T>
  async function readModel<T>(
    relative: string,
    schema: z.ZodType<T>,
    allowMissing = false,
  ): Promise<T | null> {
    const path = `${options.prefix}${relative}`
    if (options.mode() === "fixtures") {
      const fixture = options.fixtures(path, Date.now())
      if (fixture.status === 404) {
        if (allowMissing) return null
        throw new ReadModelError(path, 404)
      }
      return schema.parse(fixture.body)
    }
    const started = Date.now()
    const response = await fetchApi(path, options.timeoutMs)
    if (response.status === 404 && allowMissing) return null
    if (!response.ok) {
      log.error({
        message: "read model request failed",
        path,
        status: response.status,
        ms: Date.now() - started,
      })
      throw new ReadModelError(path, response.status)
    }
    const parsed = schema.safeParse(await response.json())
    if (!parsed.success) {
      log.error({
        message: "read model failed validation",
        path,
        issues: parsed.error.issues.slice(0, 5),
      })
      throw new ReadModelError(path, 502)
    }
    return parsed.data
  }

  return { dataMode: options.mode, readModel }
}
