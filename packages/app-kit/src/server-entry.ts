/// <reference path="./env.d.ts" />
import {
  platformAttribute,
  platformFromHeaders,
  platformHintHeaders,
} from "@matchbox/ui/kbd"

/**
 * Pieces of a TanStack Start server entry every Matchbox frontend shares:
 * which requests are pages, and the HTMLRewriter pass that stamps the
 * platform and adds head tags on the way out.
 */

export function isPage(request: Request, url: URL): boolean {
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

export type PageStamp = {
  /** Markup appended to `<head>` at once (meta tags). "" for none. */
  headTags: string
  /**
   * Markup added just before `</head>` once it resolves, only on OK pages
   * (link preview tags). Null for none.
   */
  preview: Promise<string> | null
  /** Response headers to set, for example a content security policy. */
  headers: Record<string, string>
}

const noStamp: PageStamp = { headTags: "", preview: null, headers: {} }

/**
 * Stamps `<html data-platform>` so shortcut hints show the command key or
 * ctrl on the first paint, and asks Chromium for the platform hint next time.
 * Pages also carry `stamp`'s head tags, preview tags and headers.
 */
export function withPlatform(
  request: Request,
  response: Response,
  stamp: Partial<PageStamp> = noStamp,
): Response {
  const type = response.headers.get("content-type") ?? ""
  if (!type.includes("text/html")) return response
  const { headTags, preview, headers: extra } = { ...noStamp, ...stamp }
  const platform = platformFromHeaders(request.headers)
  const stamped = new HTMLRewriter()
    .on("html", {
      element(element) {
        element.setAttribute(platformAttribute, platform)
      },
    })
    .on("head", {
      element(element) {
        if (headTags !== "") element.append(headTags, { html: true })
        // At </head>, so the head's preloads stream before the figures land.
        if (response.ok && preview !== null) {
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
  for (const [name, value] of Object.entries(extra)) headers.set(name, value)
  return new Response(stamped.body, {
    status: stamped.status,
    statusText: stamped.statusText,
    headers,
  })
}

/**
 * A same-origin `Location` for a redirect: path, query and hash, with any
 * run of leading slashes or backslashes cut to one. A request for
 * `//evil.com?address=` must never answer `Location: //evil.com`, which a
 * browser reads as another site. Cloudflare does not normalise the slashes,
 * and `/\evil.com` reaches the Worker as `//evil.com`. Encoded slashes
 * (`/%2F%2Fevil.com`) stay encoded, so they stay a path. The same function
 * and expression as Pro's (`apps/pro/src/lib/wallet-path.ts`, 44b59bc), so
 * Pro can adopt this package without a change in behaviour.
 */
export function redirectTarget(url: URL): string {
  const path = url.pathname.replace(/^[/\\]+/, "/")
  return `${path}${url.search}${url.hash}`
}

/** A 301 to the same origin, keeping the query and hash. */
export function redirect(to: URL): Response {
  return new Response(null, {
    status: 301,
    headers: { location: redirectTarget(to) },
  })
}

/**
 * The guard on the final `Location` of any redirect a Worker returns,
 * whoever built it (the router's canonical redirects, a loader's): a
 * relative target gets the same cut to one leading slash; an absolute one
 * is kept only when it is this origin, as its path, and otherwise becomes
 * `/`. Other responses pass through untouched.
 */
export function guardRedirect(response: Response, origin: string): Response {
  const location = response.headers.get("location")
  if (location === null || response.status < 300 || response.status > 399) {
    return response
  }
  let target: string
  if (/^[a-z][a-z0-9+.-]*:/i.test(location)) {
    const absolute = new URL(location)
    target = absolute.origin === origin ? redirectTarget(absolute) : "/"
  } else {
    // Relative: keep its own path text, cut leading slashes and backslashes.
    target = location.replace(/^[/\\]+/, "/")
    if (!target.startsWith("/")) target = `/${target}`
  }
  if (target === location) return response
  const headers = new Headers(response.headers)
  headers.set("location", target)
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}
