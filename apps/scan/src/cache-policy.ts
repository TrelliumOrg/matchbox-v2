/**
 * Cache-Control for Scan's HTML. Pages carry no per-user markup, so whole
 * pages may be edge cached (scan-plan.md, Efficiency rule 5), but only a
 * whole, successful page: an error, a redirect or a page whose shell or
 * section reads failed (marked by `degradedHeader`) is never stored.
 *
 * Each page's loader names its class (`cacheClassHeader`):
 * - final: a finalized block or transaction; it will not change.
 * - fresh: an address, or a block or transaction not yet final.
 * - list: home and the lists, which move every block.
 * - static: pages with no chain data (section placeholders).
 * - series: daily series a server function answers after first paint
 *   (Borrow's market charts); see `withDataPolicy`.
 */

/** Set by any loader whose read failed; stripped before the response leaves. */
export const degradedHeader = "x-scan-degraded"

/** Set by a page's loader; stripped before the response leaves. */
export const cacheClassHeader = "x-scan-cache"

export type CacheClass = "final" | "fresh" | "list" | "static" | "series"

export const noStore = "no-store"

/** Browser max-age, shared (edge) s-maxage, stale-while-revalidate. */
const classes: Record<CacheClass, readonly [number, number, number]> = {
  final: [60, 86_400, 604_800],
  fresh: [0, 15, 60],
  // About one block: a thousand viewers cost one render per block.
  list: [0, 4, 30],
  static: [0, 300, 3_600],
  series: [0, 60, 300],
}

export function isCacheClass(value: string | null): value is CacheClass {
  return value !== null && value in classes
}

export function pageCacheControl(
  status: number,
  degraded: boolean,
  cacheClass: CacheClass = "static",
): string {
  if (status !== 200 || degraded) return noStore
  const [browser, shared, stale] = classes[cacheClass]
  return `public, max-age=${browser}, s-maxage=${shared}, stale-while-revalidate=${stale}`
}

/** Seconds a shared cache may keep a page under `cacheControl`; 0 for none. */
export function sharedMaxAge(cacheControl: string | null): number {
  if (cacheControl === null || cacheControl.includes(noStore)) return 0
  const match = /s-maxage=(\d+)/.exec(cacheControl)
  return match?.[1] === undefined ? 0 : Number(match[1])
}

/**
 * A server function's response: the internal markers never leave, and one
 * that names a class (only `series` today) gets that class's policy, on
 * the same terms as a page. Others keep the framework's headers.
 */
export function withDataPolicy(response: Response): Response {
  const named = response.headers.get(cacheClassHeader)
  const degraded = response.headers.has(degradedHeader)
  if (named === null && !degraded) return response
  const headers = new Headers(response.headers)
  headers.delete(degradedHeader)
  headers.delete(cacheClassHeader)
  if (named === "series") {
    headers.set(
      "cache-control",
      pageCacheControl(response.status, degraded, "series"),
    )
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

/** Applies the policy and drops the internal markers. */
export function withCachePolicy(response: Response): Response {
  const type = response.headers.get("content-type") ?? ""
  if (!type.includes("text/html")) return response
  const headers = new Headers(response.headers)
  const degraded = headers.has(degradedHeader)
  const named = headers.get(cacheClassHeader)
  headers.delete(degradedHeader)
  headers.delete(cacheClassHeader)
  headers.set(
    "cache-control",
    pageCacheControl(
      response.status,
      degraded,
      isCacheClass(named) ? named : "static",
    ),
  )
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}
