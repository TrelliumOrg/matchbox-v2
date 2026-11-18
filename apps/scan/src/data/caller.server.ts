import { env } from "cloudflare:workers"
import {
  blockscoutClientHeader,
  blockscoutEndUserHeader,
} from "@matchbox/contracts/blockscout"
import { createLogger } from "@matchbox/logger"
import {
  getRequest,
  getRequestHeader,
  setResponseHeader,
} from "@tanstack/react-start/server"
import { degradedHeader } from "../cache-policy"
import {
  endUserKey,
  minSaltBytes,
  saltUsable,
  scanClientName,
} from "./blockscout/callers"

/**
 * The API Worker as Scan calls it: over the `API` binding (else
 * API_ORIGIN in local dev), with the caller headers both the Blockscout
 * proxy and the /internal/scan routes read (`X-Matchbox-Client`, this
 * Worker's name, and `X-Matchbox-End-User`, a salted hash of the visitor's
 * IP prefix) and the internal token where one is set.
 */

const log = createLogger({ fields: { service: "matchscan", area: "caller" } })

let saltWarned = false

/**
 * Says once per isolate that the salt is missing or short. The reads still
 * work, keyed to the shared anonymous bucket: fail closed, never a crash
 * and never an unsalted hash.
 */
export function warnMissingSalt(salt: string | undefined): void {
  if (saltUsable(salt) || saltWarned) return
  saltWarned = true
  log.error({
    message: `BLOCKSCOUT_CALLER_SALT is ${salt === undefined || salt === "" ? "missing" : `shorter than ${minSaltBytes} bytes`}: no X-Matchbox-End-User key is sent, every visitor shares the anonymous rate-limit bucket`,
  })
}

/** For tests: forget that the missing salt was reported. */
export function resetSaltWarning(): void {
  saltWarned = false
}

export async function callerHeaders(): Promise<Headers> {
  const headers = new Headers({ accept: "application/json" })
  headers.set(blockscoutClientHeader, scanClientName)
  warnMissingSalt(env.BLOCKSCOUT_CALLER_SALT)
  const key = await endUserKey(
    getRequestHeader("cf-connecting-ip") ?? null,
    env.BLOCKSCOUT_CALLER_SALT,
  )
  if (key !== null) headers.set(blockscoutEndUserHeader, key)
  if (env.INTERNAL_TOKEN !== undefined) {
    headers.set("authorization", `Bearer ${env.INTERNAL_TOKEN}`)
  }
  return headers
}

/**
 * The longest one API read may take, headers and body. Pages do not
 * stream, so one hung read would hold the whole page's first byte. Reads
 * normally answer in tens to a few hundred ms (the gate's loader budget
 * is 250 ms for a page's reads), and the proxy's slow Blockscout
 * endpoints can take 1 to 2 s cold; 3 s lets those finish and caps the
 * worst case, after which the page renders with that part unavailable.
 */
export const apiReadTimeoutMs = 3_000

/**
 * GET `target` (a path from /internal) on the API Worker. Rejects (a
 * TimeoutError) after `apiReadTimeoutMs`, whether the headers or the
 * body are late; callers map that to "unavailable".
 */
export async function fetchApi(
  target: string,
  timeoutMs = apiReadTimeoutMs,
): Promise<Response> {
  const init = {
    headers: await callerHeaders(),
    signal: AbortSignal.timeout(timeoutMs),
  }
  if (env.API !== undefined) {
    return env.API.fetch(new Request(`https://api.internal${target}`, init))
  }
  return fetch(new URL(target, env.API_ORIGIN), init)
}

/** Marks the page degraded so it is never stored (cache-policy). */
export function degrade(): void {
  try {
    setResponseHeader(degradedHeader, "1")
  } catch {
    // Outside a request (tests): nothing to mark.
  }
}

/**
 * Fixtures answer after SCAN_FIXTURE_LATENCY_MS, like a real read, so the
 * gate's loader timing sees a loader that reads one after another.
 *
 * A request's reads started together (in one turn of the event loop: a
 * Worker's clock does not move within one) share one timer, as parallel
 * fetches overlap. With a timer each, workerd on Windows fired them one
 * clock tick (about 15.6 ms) apart, and ten parallel reads timed like
 * four serial ones.
 */
const latencies = new WeakMap<
  Request,
  { startedAt: number; done: Promise<void> }
>()

export async function fixtureLatency(): Promise<void> {
  const ms = Number(env.SCAN_FIXTURE_LATENCY_MS ?? 0)
  if (!Number.isFinite(ms) || ms <= 0) return
  const wait = () =>
    new Promise<void>((resolve) => setTimeout(resolve, Math.min(ms, 2000)))
  let request: Request | null = null
  try {
    request = getRequest()
  } catch {
    // Outside a request (tests): a timer of its own.
  }
  if (request === null) return wait()
  const startedAt = Date.now()
  let shared = latencies.get(request)
  if (shared === undefined || shared.startedAt !== startedAt) {
    shared = { startedAt, done: wait() }
    latencies.set(request, shared)
  }
  return shared.done
}

/** Every value a route keys on, sorted, as the API canonicalises them. */
export function canonicalQuery(
  query: Readonly<Record<string, string | number | boolean | null | undefined>>,
): URLSearchParams {
  const params = new URLSearchParams()
  for (const key of Object.keys(query).sort()) {
    const value = query[key]
    if (value === undefined || value === null) continue
    params.set(key, String(value))
  }
  return params
}
