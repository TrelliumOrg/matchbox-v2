import { env } from "cloudflare:workers"
import {
  createNonce,
  nonceHeader,
  withSecurityHeaders,
} from "@matchbox/app-kit/security"
import { guardRedirect, isPage } from "@matchbox/app-kit/server-entry"
import { feedbackCspSources } from "@matchbox/feedback-ui/csp"
import { publicMezoRpc } from "@matchbox/live/config"
import { headsPath, headsRoute } from "@matchbox/live/heads-route"
import handler, { createServerEntry } from "@tanstack/react-start/server-entry"
import { classicRedirect } from "./classic-paths"
import { links } from "./page/links"
import { searchPath, searchResponse } from "./search"

/**
 * The homepage Worker. `/live/heads` forwards the BlockHub WebSocket from
 * the API Worker so the browser stays same-origin; `/search` sends the
 * Matchscan card's search on to Matchscan (src/search.ts); a path the
 * page does not have goes to Matchbox Classic (src/classic-paths.ts);
 * everything else is TanStack Start. Every response carries the security headers and a
 * fresh script nonce. The page itself is cheap to render: its figures
 * come from the edge snapshot (src/data/figures.server.ts), never from a
 * read the page waits for, so the HTML is not cached.
 */

/** The feedback Worker and Turnstile; nothing when built without them. */
const feedback = feedbackCspSources(import.meta.env.VITE_FEEDBACK_URL)

/**
 * What the page may reach: the Mezo RPC for the head fallback, gauge
 * pictures from wherever their profiles host them, Matchscan, where the
 * card's search form lands (it submits to `/search` here, which redirects
 * there, and form-action covers the redirect too), and the feedback
 * panel's Worker and Turnstile check.
 */
function cspOptions() {
  const rpc = env.MEZO_RPC_URL ?? publicMezoRpc
  return {
    connect: [new URL(rpc).origin, ...feedback.connect],
    images: ["https:"],
    ...(feedback.frames.length > 0 ? { frames: feedback.frames } : {}),
    frameAncestors: "'none'",
  }
}

const scanOrigin = new URL(links.scan).origin

/** The shared policy allows forms to 'self' only; add where search lands. */
export function withScanFormAction(response: Response): Response {
  const policy = response.headers.get("content-security-policy")
  if (policy === null) return response
  const headers = new Headers(response.headers)
  headers.set(
    "content-security-policy",
    policy.replace("form-action 'self'", `form-action 'self' ${scanOrigin}`),
  )
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

/** The time to the response's headers: the loader (scripts/measure.mjs). */
function loaderTiming(ms: number): string {
  return `loader;dur=${Math.max(0, Math.round(ms))}`
}

async function render(request: Request, url: URL, nonce: string) {
  const headers = new Headers(request.headers)
  headers.set(nonceHeader, nonce)
  const started = Date.now()
  const response = await handler.fetch(new Request(request, { headers }))
  if (!isPage(request, url)) return response
  const page = new Headers(response.headers)
  page.set("cache-control", "private, no-cache")
  page.set("server-timing", loaderTiming(Date.now() - started))
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: page,
  })
}

async function respond(request: Request): Promise<Response> {
  const url = new URL(request.url)
  if (url.pathname === headsPath) {
    const blockHub = env.HOME_DATA === "fixtures" ? null : (env.API ?? null)
    return headsRoute(request, blockHub)
  }
  // Only this Worker sets the nonce; a client's header of that name is dropped.
  const clean = new Headers(request.headers)
  clean.delete(nonceHeader)
  const nonce = createNonce()
  if (url.pathname === searchPath) {
    // Its target is Matchscan's fixed origin and a path search.ts built,
    // so it skips guardRedirect, which keeps redirects on this origin.
    return withScanFormAction(
      withSecurityHeaders(searchResponse(request), nonce, cspOptions()),
    )
  }
  const response = await render(
    new Request(request, { headers: clean }),
    url,
    nonce,
  )
  // A path this page lacks goes to Classic, as matchbox.markets always
  // sent it (src/classic-paths.ts). Its target is Classic's fixed origin,
  // so it skips guardRedirect, which keeps redirects on this origin.
  const toClassic = classicRedirect(request, response)
  if (toClassic !== null) {
    return withSecurityHeaders(toClassic, nonce, cspOptions())
  }
  return withScanFormAction(
    withSecurityHeaders(
      guardRedirect(response, url.origin),
      nonce,
      cspOptions(),
    ),
  )
}

export default createServerEntry({
  fetch(request) {
    return respond(request)
  },
})
