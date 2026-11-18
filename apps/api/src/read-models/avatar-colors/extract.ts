import type { GaugeProfile } from "@matchbox/contracts/gauge-profiles"
import type { Logger } from "@matchbox/logger"
import type { ReadDatabase } from "../store"
import {
  type AvatarColorKey,
  type AvatarColorRow,
  cacheKey,
  readAvatarColors,
  writeAvatarColors,
} from "./cache"
import decodeAvatar from "./decode"
import legibleColor from "./legible"
import pickColor from "./pick"
import { AvatarDecodeError } from "./sample"

// Gauge colours from profile pictures, for the gauge publish cron. Cached
// colours are read in one query; new or changed pictures are fetched,
// decoded and picked within a per-run budget, and the rest wait for the
// next run. Nothing here runs on a request path.

export type AvatarFetch = (url: string, init: RequestInit) => Promise<Response>

export type ExtractBudget = {
  /** Pictures decoded per run. */
  maxImages: number
  /** Wall-clock time per run; checked between pictures. */
  maxMilliseconds: number
  /** Download limit per picture. */
  maxBytes: number
  /** Width times height limit per picture. */
  maxPixels: number
  /** Fetch timeout per picture. */
  timeoutMs: number
}

export const defaultExtractBudget: ExtractBudget = {
  maxImages: 12,
  maxMilliseconds: 15_000,
  maxBytes: 4 * 1024 * 1024,
  maxPixels: 4096 * 4096,
  timeoutMs: 8000,
}

/** Failures worth another try after `retryAfterSeconds`. */
const transientFailures = new Set(["timeout", "network", "http-429"])
const retryAfterSeconds = 24 * 60 * 60

export type AvatarTarget = AvatarColorKey & { gaugeAddress: string }

/** Profiles with an https picture, as extraction targets. */
export function avatarTargets(
  profiles: readonly GaugeProfile[],
): AvatarTarget[] {
  return profiles.flatMap((profile) =>
    profile.avatarUrl?.startsWith("https://")
      ? [
          {
            gaugeAddress: profile.gaugeAddress,
            url: profile.avatarUrl,
            profileUpdatedAt: profile.updatedAt,
          },
        ]
      : [],
  )
}

function isTransient(detail: string): boolean {
  return transientFailures.has(detail) || /^http-5\d\d$/.test(detail)
}

/** The body up to `limit` bytes; null when it is longer. */
async function readLimited(
  response: Response,
  limit: number,
): Promise<Uint8Array | null> {
  const body = response.body
  if (body === null) return new Uint8Array(0)
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > limit) {
      await reader.cancel().catch(() => undefined)
      return null
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

type Outcome =
  | { status: "ok"; color: string; detail: "brand" | "dominant" }
  | { status: "failed"; color: null; detail: string }

function failed(detail: string): Outcome {
  return { status: "failed", color: null, detail }
}

/** Fetches, decodes and picks one picture's colour. */
export async function extractAvatarColor(
  url: string,
  fetcher: AvatarFetch,
  budget: ExtractBudget,
): Promise<Outcome> {
  try {
    const response = await fetcher(url, {
      headers: { Accept: "image/png,image/jpeg,image/webp,image/gif" },
      redirect: "follow",
      signal: AbortSignal.timeout(budget.timeoutMs),
    })
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined)
      return failed(`http-${response.status}`)
    }
    const declared = Number(response.headers.get("content-length") ?? "0")
    if (declared > budget.maxBytes) {
      await response.body?.cancel().catch(() => undefined)
      return failed("too-large")
    }
    const bytes = await readLimited(response, budget.maxBytes)
    if (bytes === null) return failed("too-large")
    const sample = await decodeAvatar(bytes, { maxPixels: budget.maxPixels })
    const picked = pickColor(sample)
    if (picked === null) return failed("transparent")
    return {
      status: "ok",
      color: legibleColor(picked.color),
      detail: picked.kind,
    }
  } catch (error) {
    if (error instanceof AvatarDecodeError) return failed(error.reason)
    if (
      error instanceof Error &&
      (error.name === "TimeoutError" || error.name === "AbortError")
    ) {
      return failed("timeout")
    }
    return failed("network")
  }
}

export type AvatarColorsResult = {
  /** Gauge address → extracted colour. */
  colors: Map<string, string>
  extracted: number
  failed: number
  /** Pictures left for later runs. */
  pending: number
  /** Rows written or deleted. */
  writes: number
}

export type ResolveAvatarColorsOptions = {
  db: ReadDatabase
  targets: readonly AvatarTarget[]
  fetcher: AvatarFetch
  budget: ExtractBudget
  /** Milliseconds since the epoch. */
  now: () => number
  logger: Logger
}

/** Cached colours plus as many new ones as the budget allows. */
export async function resolveAvatarColors(
  options: ResolveAvatarColorsOptions,
): Promise<AvatarColorsResult> {
  const result: AvatarColorsResult = {
    colors: new Map(),
    extracted: 0,
    failed: 0,
    pending: 0,
    writes: 0,
  }
  let cached: AvatarColorRow[]
  try {
    cached = await readAvatarColors(options.db)
  } catch (error) {
    options.logger.warn({ message: "Avatar colour cache unavailable", error })
    return result
  }
  const rows = new Map(cached.map((row) => [cacheKey(row), row]))
  const started = options.now()
  const nowSeconds = Math.floor(started / 1000)
  const wanted = new Map<string, AvatarColorKey>()
  for (const target of options.targets) {
    wanted.set(cacheKey(target), {
      url: target.url,
      profileUpdatedAt: target.profileUpdatedAt,
    })
  }
  const work = [...wanted.entries()]
    .filter(([key]) => {
      const row = rows.get(key)
      if (row === undefined) return true
      return (
        row.status === "failed" &&
        isTransient(row.detail) &&
        nowSeconds - row.extractedAt >= retryAfterSeconds
      )
    })
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
  const written: AvatarColorRow[] = []
  for (const [key, target] of work) {
    if (
      written.length >= options.budget.maxImages ||
      options.now() - started >= options.budget.maxMilliseconds
    ) {
      result.pending += 1
      continue
    }
    const outcome = await extractAvatarColor(
      target.url,
      options.fetcher,
      options.budget,
    )
    const row: AvatarColorRow = {
      ...target,
      ...outcome,
      extractedAt: nowSeconds,
    }
    rows.set(key, row)
    written.push(row)
    if (outcome.status === "ok") result.extracted += 1
    else {
      result.failed += 1
      options.logger.info({
        message: "Avatar colour not extracted",
        url: target.url,
        reason: outcome.detail,
      })
    }
  }
  // Rows no profile points at any more (a new picture or a newer
  // updated_at). Skipped when there are no targets, so a failed profile
  // read never empties the cache.
  const stale =
    options.targets.length === 0
      ? []
      : cached.filter((row) => !wanted.has(cacheKey(row)))
  if (written.length > 0 || stale.length > 0) {
    try {
      await writeAvatarColors(options.db, written, stale)
      result.writes = written.length + stale.length
    } catch (error) {
      options.logger.warn({
        message: "Avatar colour cache write failed",
        error,
      })
    }
  }
  for (const target of options.targets) {
    const row = rows.get(cacheKey(target))
    if (row?.status === "ok") result.colors.set(target.gaugeAddress, row.color)
  }
  return result
}
