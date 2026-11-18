import { canonicalMezoId } from "@matchbox/domain/mezo-id"

/**
 * Clean wallet URLs (decided 9 Nov). Your own wallet uses plain paths
 * (`/vote`); another wallet is a path prefix, its Mezo ID when it has one,
 * else the full address (`/pyke.mezo/vote`, `/0x5959…/rewards`). Inside the
 * router everything stays `?address=0x…`, so loaders do not change: the
 * router's rewrite maps public to internal on the way in and back on the
 * way out. Pure, so both directions are tested.
 */

export type WalletContext = {
  /** The connected wallet (its plain paths), lower case, or null. */
  own: string | null
  /** Known Mezo IDs: name to address and address to name, lower case. */
  names: ReadonlyMap<string, string>
}

const addressPattern = /^0x[0-9a-fA-F]{40}$/

/** First segments that are pages, never a wallet. */
const reserved = new Set(["gauges", "protocol", "live", "assets", "_serverFn"])

export type WalletPrefix =
  | { kind: "address"; address: string }
  | { kind: "name"; name: string }

/** A Mezo ID by Mezo's rules (@matchbox/domain/mezo-id), as typed. */
function isMezoId(value: string): boolean {
  return canonicalMezoId(value) === value
}

export function parseWalletSegment(segment: string): WalletPrefix | null {
  let decoded: string
  try {
    decoded = decodeURIComponent(segment)
  } catch {
    // A malformed escape ("/%E0/vote") is no wallet: the page's not found.
    return null
  }
  if (addressPattern.test(decoded)) {
    return { kind: "address", address: decoded.toLowerCase() }
  }
  const name = decoded.toLowerCase()
  if (isMezoId(name) && !reserved.has(name)) {
    return { kind: "name", name }
  }
  return null
}

/** Public URL to the router's: `/pyke.mezo/vote` to `/vote?address=0x…`. */
export function toInternal(url: URL, context: WalletContext): URL {
  const next = new URL(url.href)
  if (next.searchParams.has("address")) return next
  const [, first = "", ...rest] = next.pathname.split("/")
  const prefix = parseWalletSegment(first)
  if (prefix !== null) {
    const address =
      prefix.kind === "address"
        ? prefix.address
        : (context.names.get(prefix.name) ?? null)
    if (address !== null) {
      next.pathname = `/${rest.join("/")}`
      next.searchParams.set("address", address)
      return next
    }
    return next
  }
  // Your own wallet is the viewer on every page, gauge pages included.
  if (context.own !== null) next.searchParams.set("address", context.own)
  return next
}

/** The router's URL to the public one: `/vote?address=0x…` to `/pyke.mezo/vote`. */
export function toPublic(url: URL, context: WalletContext): URL {
  const next = new URL(url.href)
  const raw = next.searchParams.get("address")
  if (raw === null) return next
  next.searchParams.delete("address")
  // An empty or malformed address is no wallet: drop it, add no prefix.
  if (!addressPattern.test(raw)) return next
  const address = raw.toLowerCase()
  if (address === context.own) return next
  const prefix = context.names.get(address) ?? address
  next.pathname = `/${prefix}${next.pathname === "/" ? "" : next.pathname}`
  return next
}

/**
 * A same-origin `Location` for a redirect: path, query and hash, with any
 * run of leading slashes or backslashes cut to one. A request for
 * `//evil.com?address=` must never answer `Location: //evil.com`, which a
 * browser reads as another site.
 */
export function redirectTarget(url: URL): string {
  const path = url.pathname.replace(/^[/\\]+/, "/")
  return `${path}${url.search}${url.hash}`
}

/**
 * Any redirect this Worker answers stays on this site, whoever built it
 * (the router's trailing-slash and canonical redirects included). A
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
    const absolute = URL.canParse(location) ? new URL(location) : null
    target =
      absolute !== null && absolute.origin === origin
        ? redirectTarget(absolute)
        : "/"
  } else {
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

/** "pyke.mezo=0x…" pairs, for the meta tag and the request header. */
export function encodeNames(names: ReadonlyMap<string, string>): string {
  return [...names]
    .filter(([key]) => key.endsWith(".mezo"))
    .map(([name, address]) => `${name}=${address}`)
    .join(" ")
}

export function decodeNames(value: string | null): Map<string, string> {
  const names = new Map<string, string>()
  for (const pair of (value ?? "").split(/\s+/)) {
    const [name = "", address = ""] = pair.split("=")
    if (isMezoId(name) && addressPattern.test(address)) {
      names.set(name.toLowerCase(), address.toLowerCase())
      names.set(address.toLowerCase(), name.toLowerCase())
    }
  }
  return names
}

export const ownWalletCookie = "mbx-wallet"

/** The own-wallet cookie's address, from a Cookie header or document.cookie. */
export function ownFromCookie(cookie: string | null): string | null {
  for (const part of (cookie ?? "").split(";")) {
    const [key, value = ""] = part.trim().split("=")
    if (key === ownWalletCookie && addressPattern.test(value)) {
      return value.toLowerCase()
    }
  }
  return null
}
