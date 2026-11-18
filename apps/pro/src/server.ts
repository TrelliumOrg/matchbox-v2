import { env } from "cloudflare:workers"
import {
  createNonce,
  nonceHeader,
  withSecurityHeaders,
} from "@matchbox/app-kit/security"
import {
  platformAttribute,
  platformFromHeaders,
  platformHintHeaders,
} from "@matchbox/ui/kbd"
import handler, { createServerEntry } from "@tanstack/react-start/server-entry"
import { cspReport, cspReportPath } from "./csp-report.server"
import { readIdentity } from "./data/identity.server"
import { walletRpcUrl } from "./data/inputs.server"
import {
  walletLookupHeader,
  walletLookupMeta,
  walletNamesHeader,
  walletNamesMeta,
} from "./lib/wallet-context"
import {
  encodeNames,
  guardRedirect,
  ownFromCookie,
  parseWalletSegment,
  redirectTarget,
  toPublic,
} from "./lib/wallet-path"
import { linkPreviewTags, ogImageResponse } from "./og/server"
import { proCspOptions } from "./security.server"

/**
 * The Pro Worker. `/live/heads` forwards the BlockHub WebSocket from the API
 * Worker so the browser stays same-origin; everything else is TanStack Start.
 * Every response but the socket leaves with the security headers and a
 * Content Security Policy carrying a fresh script nonce (see `respond`).
 */

function heads(request: Request): Promise<Response> | Response {
  if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
    return new Response("Expected a WebSocket upgrade", { status: 426 })
  }
  if (env.PRO_DATA === "fixtures" || env.API === undefined) {
    return new Response("No BlockHub in this environment", { status: 503 })
  }
  return env.API.fetch(
    new Request("https://api.internal/internal/heads", request),
  )
}

/**
 * Stamps `<html data-platform>` so shortcut hints show the command key or
 * ctrl on the first paint, and asks Chromium for the platform hint next time.
 * Pages also carry, when they rendered, their link preview tags (og and
 * twitter, see og/meta).
 */
function withPlatform(
  request: Request,
  response: Response,
  names: string,
  preview: Promise<string>,
  lookupFailed: boolean,
): Response {
  const type = response.headers.get("content-type") ?? ""
  if (!type.includes("text/html")) return response
  const platform = platformFromHeaders(request.headers)
  const stamped = new HTMLRewriter()
    .on("html", {
      element(element) {
        element.setAttribute(platformAttribute, platform)
      },
    })
    .on("head", {
      element(element) {
        // The Mezo IDs this page's links use (see lib/wallet-context).
        if (names !== "") {
          element.append(
            `<meta name="${walletNamesMeta}" content="${names}">`,
            { html: true },
          )
        }
        // The page's not found state says to try again (shell/errors).
        if (lookupFailed) {
          element.append(
            `<meta name="${walletLookupMeta}" content="unavailable">`,
            { html: true },
          )
        }
        // At </head>, so the head's preloads stream before the figures land.
        if (response.ok) {
          element.onEndTag(async (end) => {
            end.before(await preview, { html: true })
          })
        }
      },
    })
    .transform(response)
  const headers = new Headers(stamped.headers)
  headers.set("accept-ch", platformHintHeaders["accept-ch"])
  headers.append("vary", platformHintHeaders.vary)
  // A Mezo ID link while the lookup is down: not a missing page, and no
  // cache may keep it.
  const unavailable = lookupFailed && stamped.status === 404
  if (unavailable) headers.set("cache-control", "no-store")
  return new Response(stamped.body, {
    status: unavailable ? 503 : stamped.status,
    statusText: unavailable ? "Service Unavailable" : stamped.statusText,
    headers,
  })
}

function isPage(request: Request, url: URL): boolean {
  return (
    request.method === "GET" &&
    !url.pathname.startsWith("/_serverFn") &&
    !url.pathname.startsWith("/assets/") &&
    // Files, not pages ("/pyke.mezo" is a page).
    !/\.(js|mjs|css|svg|png|jpg|ico|woff2?|json|txt|map|webmanifest)$/i.test(
      url.pathname,
    )
  )
}

function redirect(to: URL): Response {
  return new Response(null, {
    status: 301,
    headers: { location: redirectTarget(to) },
  })
}

/**
 * Headers only this Worker may set for the router: a browser that sends
 * them could name any wallet for any Mezo ID.
 */
const workerHeaders = [walletNamesHeader, walletLookupHeader]

function withoutWorkerHeaders(request: Request): Request {
  if (!workerHeaders.some((name) => request.headers.has(name))) return request
  const headers = new Headers(request.headers)
  for (const name of workerHeaders) headers.delete(name)
  return new Request(request, { headers })
}

type Routed = { request: Request; names: string; lookupFailed: boolean }

/**
 * Clean wallet URLs (decided 9 Nov): your wallet on plain paths, another
 * by Mezo ID or address (`/pyke.mezo/vote`). Old `?address=` links and
 * addresses that have a Mezo ID redirect (301) to the clean form; a Mezo ID
 * resolves to its address (the API's Mezo ID resolver, data/identity.server)
 * for the router through a request header.
 */
async function wallets(request: Request, url: URL): Promise<Response | Routed> {
  const own = ownFromCookie(request.headers.get("cookie"))
  const names = new Map<string, string>()
  const remember = (found: { address: string; mezoId: string | null }) => {
    if (found.mezoId === null) return
    names.set(found.mezoId, found.address)
    names.set(found.address, found.mezoId)
  }
  // Old links: the address moves into the path, as an address (looking up
  // its Mezo ID first would hold up the redirect).
  const old = url.searchParams.get("address")
  if (old !== null) return redirect(toPublic(url, { own, names }))
  const [, first = ""] = url.pathname.split("/")
  const prefix = parseWalletSegment(first)
  if (prefix === null || prefix.kind === "address") {
    return { request, names: "", lookupFailed: false }
  }
  // An unknown ID leaves the path unresolved: the router answers its not
  // found page. A lookup that failed says so there, as a 503 to retry.
  const found = await readIdentity(prefix.name)
  if (found.status === "not-found") {
    return { request, names: "", lookupFailed: false }
  }
  const headers = new Headers(request.headers)
  if (found.status === "unavailable") {
    headers.set(walletLookupHeader, "unavailable")
    return {
      request: new Request(request, { headers }),
      names: "",
      lookupFailed: true,
    }
  }
  remember(found.identity)
  const encoded = encodeNames(names)
  headers.set(walletNamesHeader, encoded)
  return {
    request: new Request(request, { headers }),
    names: encoded,
    lookupFailed: false,
  }
}

/** The request for Start, carrying this response's nonce to the router. */
function withNonce(request: Request, nonce: string): Request {
  const headers = new Headers(request.headers)
  headers.set(nonceHeader, nonce)
  return new Request(request, { headers })
}

async function route(
  request: Request,
  url: URL,
  nonce: string,
): Promise<Response> {
  if (url.pathname.startsWith("/og/")) return ogImageResponse(request)
  if (url.pathname === cspReportPath) {
    return cspReport(request, env.PRO_CSP === "report-only")
  }
  if (!isPage(request, url)) {
    return guardRedirect(
      await handler.fetch(withNonce(request, nonce)),
      url.origin,
    )
  }
  const routed = await wallets(request, url)
  if (routed instanceof Response) return guardRedirect(routed, url.origin)
  const preview = linkPreviewTags(url)
  return withPlatform(
    routed.request,
    guardRedirect(
      await handler.fetch(withNonce(routed.request, nonce)),
      url.origin,
    ),
    routed.names,
    preview,
    routed.lookupFailed,
  )
}

/**
 * Pages, server functions, redirects, errors, HEAD and link preview images
 * all leave with the security headers and this response's CSP. Static
 * files are served before the Worker runs and get theirs from
 * public/_headers. `PRO_CSP=report-only` reports the policy instead of
 * enforcing it (framing stays enforced), a switch for a wallet it breaks.
 */
async function respond(request: Request, url: URL): Promise<Response> {
  const nonce = createNonce()
  const response = await route(request, url, nonce)
  return withSecurityHeaders(
    response,
    nonce,
    proCspOptions({
      url,
      rpcUrl: walletRpcUrl(),
      stuartUrl: import.meta.env.VITE_STUART_URL,
      feedbackUrl: import.meta.env.VITE_FEEDBACK_URL,
      reportOnly: env.PRO_CSP === "report-only",
    }),
  )
}

export default createServerEntry({
  fetch(incoming) {
    const request = withoutWorkerHeaders(incoming)
    const url = new URL(request.url)
    if (url.pathname === "/live/heads") return heads(request)
    return respond(request, url)
  },
})
