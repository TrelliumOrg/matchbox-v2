import { env, waitUntil } from "cloudflare:workers"
import {
  createNonce,
  nonceHeader,
  walletConnectFrames,
  walletConnectSources,
  withSecurityHeaders,
} from "@matchbox/app-kit/security"
import {
  guardRedirect,
  isPage,
  withPlatform,
} from "@matchbox/app-kit/server-entry"
import { feedbackCspSources } from "@matchbox/feedback-ui/csp"
import { publicMezoRpc } from "@matchbox/live/config"
import { headsPath, headsRoute } from "@matchbox/live/heads-route"
import handler, { createServerEntry } from "@tanstack/react-start/server-entry"
import { withCachePolicy, withDataPolicy } from "./cache-policy"
import { cacheKey, loaderTiming, storableCopy, withNonce } from "./html-cache"
import { withShareCard } from "./share-card"

/**
 * The Matchscan Worker. `/live/heads` forwards the BlockHub WebSocket from
 * the API Worker so the browser stays same-origin; everything else is
 * TanStack Start. Pages are stamped with the platform (key caps) and may
 * not be framed. Every redirect's final Location passes guardRedirect, so a
 * request such as //evil.com can never answer with another site.
 */

/** The feedback Worker and Turnstile; nothing when built without them. */
const feedback = feedbackCspSources(import.meta.env.VITE_FEEDBACK_URL)

/**
 * What pages may reach: the wallet's reads go to the Mezo RPC (or
 * MEZO_RPC_URL), the live head socket is this origin's /live/heads (named
 * too, since older WebKit does not let 'self' cover wss:), WalletConnect
 * uses its relay, its connection screen's hosts and its verify frame (the
 * set Matchbox ID allows), and token icons come from wherever Blockscout
 * lists them. Reown's web fonts (fonts.reown.com) stay blocked, as on
 * Matchbox ID, so that screen draws in the browser's default font. The
 * feedback panel talks to its Worker and frames Turnstile's check.
 */
function cspOptions(url: URL) {
  const rpc = env.MEZO_RPC_URL ?? publicMezoRpc
  const socket = `${url.protocol === "https:" ? "wss:" : "ws:"}//${url.host}`
  return {
    connect: [
      new URL(rpc).origin,
      socket,
      ...walletConnectSources,
      ...feedback.connect,
    ],
    // blob: for the WalletConnect screen's wallet icons and QR code.
    images: ["https:", "blob:"],
    frames: [...walletConnectFrames, ...feedback.frames],
    frameAncestors: "'none'",
  }
}

/**
 * Every response leaves through here: security headers with a fresh
 * script nonce (also on HEAD, errors, server functions and redirects), the
 * page cache policy, and the final-Location guard.
 */
async function render(
  request: Request,
  url: URL,
  nonce: string,
): Promise<Response> {
  const headers = new Headers(request.headers)
  headers.set(nonceHeader, nonce)
  const forwarded = new Request(request, { headers })
  const response = await handler.fetch(forwarded)
  if (!isPage(request, url)) return withDataPolicy(response)
  return withCachePolicy(
    withShareCard(withPlatform(request, response), url.pathname),
  )
}

/** The Cache API, where the runtime has one. */
async function pageCache(): Promise<Cache | null> {
  return typeof caches === "undefined" ? null : caches.open("scan-pages")
}

/** The browser's Cache-Control, kept beside the Cache API's own. */
const policyHeader = "x-scan-cache-control"

/**
 * A page from the page cache when there is one, else rendered and stored
 * (see html-cache). Either way it leaves with this response's nonce.
 */
async function page(request: Request, url: URL, nonce: string) {
  const cache = await pageCache()
  const key = cacheKey(request, url, __SCAN_BUILD_ID__)
  const hit = await cache?.match(key).catch(() => undefined)
  if (hit !== undefined) {
    const headers = new Headers(hit.headers)
    headers.set("cache-control", headers.get(policyHeader) ?? "no-store")
    headers.delete(policyHeader)
    headers.set("x-scan-page-cache", "hit")
    headers.set("server-timing", "cache;desc=hit")
    const served = new Response(hit.body, { status: hit.status, headers })
    return withNonce(served, nonce)
  }
  // The time to the response's headers: the route's loaders, which all
  // finish before the first byte (pages do not stream), and the gate's
  // loader timing (scripts/measure.mjs).
  const started = Date.now()
  const response = await render(request, url, nonce)
  const loaderMs = Date.now() - started
  const copy = cache === null ? null : storableCopy(response)
  if (cache !== null && copy !== null) {
    copy.headers.set(policyHeader, response.headers.get("cache-control") ?? "")
    waitUntil(cache.put(key, copy).catch(() => undefined))
  }
  const headers = new Headers(response.headers)
  headers.set("x-scan-page-cache", "miss")
  headers.set("server-timing", loaderTiming(loaderMs))
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

async function respond(request: Request, url: URL): Promise<Response> {
  if (url.pathname === headsPath) {
    const blockHub = env.SCAN_DATA === "fixtures" ? null : (env.API ?? null)
    return headsRoute(request, blockHub)
  }
  const nonce = createNonce()
  // Fixtures mode only: a page asking for a scenario (`x-scan-fixture`,
  // the smoke tests' 503, 429 and still-filling pages) is never cached.
  const scenario =
    env.SCAN_DATA === "fixtures" && request.headers.has("x-scan-fixture")
  const response =
    request.method === "GET" && isPage(request, url) && !scenario
      ? await page(request, url, nonce)
      : await render(request, url, nonce)
  return withSecurityHeaders(
    guardRedirect(response, url.origin),
    nonce,
    cspOptions(url),
  )
}

export default createServerEntry({
  fetch(request) {
    return respond(request, new URL(request.url))
  },
})
