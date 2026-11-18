/**
 * Classic's console docs (/docs, /docs/{page}, /docs/reference) move to the
 * unified Matchbox docs. Until those exist, every Classic docs URL answers
 * a temporary redirect to the docs origin under /developer, keeping the
 * rest of the path and the query: /docs/oidc?x=1 becomes
 * {DOCS_ORIGIN}/developer/oidc?x=1. Change the target here, in one place.
 */

export const defaultDocsOrigin = "https://docs.matchbox.markets"

/** The configured origin when it is a plain https origin, else the default. */
export function docsOrigin(configured: string | undefined): string {
  if (configured === undefined || configured.trim() === "") {
    return defaultDocsOrigin
  }
  try {
    const url = new URL(configured)
    const plain =
      url.protocol === "https:" &&
      url.username === "" &&
      url.password === "" &&
      (url.pathname === "/" || url.pathname === "") &&
      url.search === "" &&
      url.hash === ""
    return plain ? url.origin : defaultDocsOrigin
  } catch {
    return defaultDocsOrigin
  }
}

/** One path segment the docs host may receive: unreserved characters only. */
const segmentPattern = /^[A-Za-z0-9._~-]+$/

/**
 * `/developer` plus the rest of a Classic docs path, or `/developer` alone
 * when the rest is anything but plain segments: no percent-encoding (so no
 * encoded slash, backslash, tab or traversal), no `.` or `..`, no empty
 * segment.
 */
export function docsPath(rest: string): string {
  if (rest === "") return "/developer"
  if (!rest.startsWith("/")) return "/developer"
  const segments = rest.slice(1).split("/")
  const plain = segments.every(
    (segment) =>
      segmentPattern.test(segment) && segment !== "." && segment !== "..",
  )
  return plain ? `/developer${rest}` : "/developer"
}

/** The docs URL for a Classic docs path, or null when it is not one. */
export function docsTarget(
  url: URL,
  configured: string | undefined,
): string | null {
  if (url.pathname !== "/docs" && !url.pathname.startsWith("/docs/")) {
    return null
  }
  const path = docsPath(url.pathname.slice("/docs".length))
  const origin = docsOrigin(configured)
  const target = new URL(`${path}${url.search}`, origin)
  // The origin is fixed: a path can never move the redirect off it.
  if (target.origin !== origin || target.pathname !== path) {
    return `${origin}/developer`
  }
  return target.href
}

/** 302 to the unified docs for a Classic docs URL; null for other paths. */
export function docsRedirect(
  url: URL,
  configured: string | undefined,
): Response | null {
  const target = docsTarget(url, configured)
  if (target === null) return null
  return new Response(null, {
    status: 302,
    headers: { location: target, "cache-control": "no-store" },
  })
}
