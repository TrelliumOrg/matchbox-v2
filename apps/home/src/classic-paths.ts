import { links } from "./page/links"

/**
 * Paths this page does not have, once it answers `matchbox.markets`.
 *
 * Before the homepage, `matchbox.markets` showed a landing page at `/` and
 * sent every other path to Matchbox Classic at the same path
 * (`/dashboard`, `/privacy`, old shared links). This keeps that: a GET or
 * HEAD this app answers with 404 is sent on to Classic, same path and
 * query. Temporary (307), so a page added here later is not shadowed by a
 * redirect a browser remembered.
 *
 * Never an open redirect: the origin is Classic's, fixed at build, and only
 * the request's own path and query are appended.
 */

const classicOrigin = new URL(links.classic).origin

export function classicRedirect(
  request: Request,
  response: Response,
): Response | null {
  if (response.status !== 404) return null
  if (request.method !== "GET" && request.method !== "HEAD") return null
  const url = new URL(request.url)
  // "//host" would read as another origin; a path here starts with one "/".
  const path = `/${url.pathname.replace(/^\/+/, "")}`
  return new Response(null, {
    status: 307,
    headers: {
      location: `${classicOrigin}${path}${url.search}`,
      "cache-control": "no-store",
    },
  })
}
