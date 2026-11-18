import { platformFromHeaders } from "@matchbox/ui/kbd"
import { sharedMaxAge } from "./cache-policy"

/**
 * Whole Scan pages in the Cache API. The key varies only by path, query and
 * platform class (the key caps stamped on <html>), never by cookies or
 * other headers: pages carry no per-user markup. It also carries the build
 * id, so a deploy never serves a page that names the last build's assets. A stored page keeps the
 * nonce it was rendered with; every serve rewrites it to that response's
 * own nonce, so cached HTML still runs only this response's scripts.
 */

export function cacheKey(request: Request, url: URL, build: string): Request {
  const platform = platformFromHeaders(request.headers)
  return new Request(
    `https://scan-pages.internal/${encodeURIComponent(build)}/${platform}${url.pathname}${url.search}`,
  )
}

/** The copy to store, or null when the page must not be cached. */
export function storableCopy(response: Response): Response | null {
  if (response.status !== 200) return null
  const type = response.headers.get("content-type") ?? ""
  if (!type.includes("text/html")) return null
  const seconds = sharedMaxAge(response.headers.get("cache-control"))
  if (seconds <= 0) return null
  const headers = new Headers(response.headers)
  // The Cache API keeps it for the shared max age; the browser's own
  // Cache-Control is restored from the policy on every serve.
  headers.set("cache-control", `public, max-age=${seconds}`)
  headers.delete("set-cookie")
  headers.delete("server-timing")
  headers.delete("content-security-policy")
  return new Response(response.clone().body, {
    status: 200,
    headers,
  })
}

/** The Server-Timing a rendered page reports for its loaders. */
export function loaderTiming(ms: number): string {
  return `cache;desc=miss, loader;dur=${Math.max(0, Math.round(ms))}`
}

/** Rewrites every nonce in a page to `nonce`. */
export function withNonce(response: Response, nonce: string): Response {
  return new HTMLRewriter()
    .on("[nonce]", {
      element(element) {
        element.setAttribute("nonce", nonce)
      },
    })
    .on('meta[property="csp-nonce"]', {
      element(element) {
        element.setAttribute("content", nonce)
      },
    })
    .transform(response)
}
