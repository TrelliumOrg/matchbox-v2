import { dataUriBytes } from "./assets"

/**
 * The Worker side of link previews that every app shares: images cached in
 * the Cache API with a bundled fallback, and a per-isolate memo for the
 * cards behind meta tags. Each app keeps its own targets, cards and meta
 * rules. Dependencies are passed in, so tests run without a Worker.
 */

/** Max age for a card with live figures, and for a fallback. */
export const freshSeconds = 3600
export const fallbackSeconds = 300

export function png(bytes: Uint8Array, maxAge: number): Response {
  return new Response(bytes.slice(), {
    headers: {
      "content-type": "image/png",
      "cache-control": `public, max-age=${maxAge}`,
    },
  })
}

const fallbacks = new Map<string, ArrayBuffer>()

/** A bundled brand card (a `?inline` PNG), for when rendering fails. */
export function fallbackImage(dataUri: string): Response {
  let bytes = fallbacks.get(dataUri)
  if (bytes === undefined) {
    bytes = dataUriBytes(dataUri)
    fallbacks.set(dataUri, bytes)
  }
  return png(new Uint8Array(bytes), fallbackSeconds)
}

/** HEAD gets the same answer without the body. */
export function forMethod(request: Request, response: Response): Response {
  if (request.method !== "HEAD") return response
  return new Response(null, {
    status: response.status,
    headers: response.headers,
  })
}

export type ImageCacheDeps = {
  cache: Pick<Cache, "match" | "put"> | null
  waitUntil: (promise: Promise<unknown>) => void
  log: (entry: { message: string; path: string; error: string }) => void
}

/**
 * Answers an image request from the cache, else from `produce`, storing the
 * answer under `key` (an app keys by path, hour and epoch). A failed
 * `produce` serves `fallback` and is cached too, for its shorter max age.
 */
export async function cachedImage(
  request: Request,
  key: Request,
  produce: () => Promise<Response>,
  fallback: () => Response,
  deps: ImageCacheDeps,
): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed", {
      status: 405,
      headers: { allow: "GET, HEAD" },
    })
  }
  const cached = await deps.cache?.match(key).catch(() => undefined)
  if (cached !== undefined) return forMethod(request, cached)
  let response: Response
  try {
    response = await produce()
  } catch (error) {
    deps.log({
      message: "og render failed",
      path: new URL(request.url).pathname,
      error: error instanceof Error ? error.message : String(error),
    })
    response = fallback()
  }
  if (deps.cache !== null && response.ok) {
    deps.waitUntil(deps.cache.put(key, response.clone()).catch(() => undefined))
  }
  return forMethod(request, response)
}

export type MemoOptions<V> = {
  /** How long a value is reused. Pro uses 5 minutes. */
  ttlMs: number
  /** Cleared when full. Pro uses 500. */
  size: number
  /** A value that should be retried sooner (the API failed), or never. */
  retry?: { after: number; when: (value: V) => boolean }
}

/**
 * Values per isolate, by key: figures move slowly and pages are many.
 * Loads are shared while in flight and never reject (a failed load is
 * null and retried on the next miss).
 */
export function createMemo<V>(
  options: MemoOptions<V>,
): (key: string, load: () => Promise<V>) => Promise<V | null> {
  const memo = new Map<string, { at: number; value: Promise<V | null> }>()
  return function get(key, load) {
    const now = Date.now()
    const hit = memo.get(key)
    if (hit !== undefined && now - hit.at < options.ttlMs) return hit.value
    if (memo.size >= options.size) memo.clear()
    const value = load().catch(() => null)
    memo.set(key, { at: now, value })
    const retry = options.retry
    void value.then((found) => {
      if (found === null || retry?.when(found) === true) {
        const after = retry?.after ?? 0
        memo.set(key, { at: now - options.ttlMs + after, value })
      }
    })
    return value
  }
}

/** `promise`, or `otherwise` after `ms`. */
export function within<T>(
  promise: Promise<T>,
  ms: number,
  otherwise: T,
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => setTimeout(() => resolve(otherwise), ms)),
  ])
}
