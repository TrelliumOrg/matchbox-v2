import { env } from "cloudflare:workers"
import {
  blockscoutClientHeader,
  blockscoutEndUserHeader,
  endUserKey,
  minSaltBytes,
  saltUsable,
} from "@matchbox/contracts/blockscout"
import { createLogger } from "@matchbox/logger"
import { getRequestHeader } from "@tanstack/react-start/server"
import type { z } from "zod"
import { type FixtureOptions, fixtureResponse } from "./fixture-api"

export const log = createLogger({ fields: { service: "matchbox-pro" } })

export class ReadModelError extends Error {
  readonly status: number
  constructor(path: string, status: number) {
    super(`Read model ${path} failed with ${status}`)
    this.name = "ReadModelError"
    this.status = status
  }
}

/**
 * The header a request sends to ask the fixtures for the gauge directory
 * at mainnet's size (`scripts/measure.mjs` does, to measure what Vote
 * inlines). Read in fixtures mode only: the API never sees it.
 */
export const fixtureDirectoryHeader = "x-pro-fixture-directory"

function fixtureOptions(): FixtureOptions {
  try {
    return getRequestHeader(fixtureDirectoryHeader) === "live"
      ? { directory: "live" }
      : {}
  } catch {
    // Outside a request (a test calling the reader directly).
    return {}
  }
}

export type DataMode = "fixtures" | "api"

export function dataMode(): DataMode {
  return env.PRO_DATA === "fixtures" ? "fixtures" : "api"
}

/** This Worker's name (wrangler.jsonc), sent as `X-Matchbox-Client`. */
export const proClientName = "matchbox-pro-v2"

let saltWarned = false

/** The visitor's address, or null outside a request (tests, background). */
function visitorIp(): string | null {
  try {
    return getRequestHeader("cf-connecting-ip") ?? null
  } catch {
    return null
  }
}

/**
 * The caller headers the API's rate limits key on, as Matchscan sends them
 * (@matchbox/contracts/blockscout): Pro's name, and the visitor's end-user
 * key (a salted hash of their IP prefix) when BLOCKSCOUT_CALLER_SALT is
 * set. Without the salt no key is sent, and Pro's reads share Pro's own
 * anonymous bucket, never a hash of the bare prefix.
 */
export async function apiHeaders(): Promise<Headers> {
  const headers = new Headers({ accept: "application/json" })
  headers.set(blockscoutClientHeader, proClientName)
  const salt = env.BLOCKSCOUT_CALLER_SALT
  if (!saltUsable(salt) && !saltWarned) {
    saltWarned = true
    log.error({
      message: `BLOCKSCOUT_CALLER_SALT is ${salt === undefined || salt === "" ? "missing" : `shorter than ${minSaltBytes} bytes`}: no X-Matchbox-End-User key is sent, every visitor shares Pro's anonymous rate-limit bucket`,
    })
  }
  const key = await endUserKey(visitorIp(), salt)
  if (key !== null) headers.set(blockscoutEndUserHeader, key)
  if (env.INTERNAL_TOKEN !== undefined) {
    headers.set("authorization", `Bearer ${env.INTERNAL_TOKEN}`)
  }
  return headers
}

async function fetchApi(path: string): Promise<Response> {
  const init: RequestInit = { headers: await apiHeaders() }
  if (env.API !== undefined) {
    return env.API.fetch(new Request(`https://api.internal${path}`, init))
  }
  return fetch(new URL(path, env.API_ORIGIN), init)
}

/**
 * Reads one `/internal/pro/*` read model and validates it. Returns null on
 * 404 when `allowMissing` is set (a gauge address nobody knows).
 */
export async function readModel<T>(
  path: string,
  schema: z.ZodType<T>,
  allowMissing: true,
): Promise<T | null>
export async function readModel<T>(
  path: string,
  schema: z.ZodType<T>,
  allowMissing?: false,
): Promise<T>
export async function readModel<T>(
  path: string,
  schema: z.ZodType<T>,
  allowMissing = false,
): Promise<T | null> {
  if (dataMode() === "fixtures") {
    const fixture = fixtureResponse(path, Date.now(), fixtureOptions())
    if (fixture.status === 404) {
      if (allowMissing) return null
      throw new ReadModelError(path, 404)
    }
    return schema.parse(fixture.body)
  }
  const started = Date.now()
  const response = await fetchApi(path)
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
