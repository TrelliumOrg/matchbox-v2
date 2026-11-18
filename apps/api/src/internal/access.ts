import {
  errorResponse,
  sha256Base64Url,
  timingSafeEqualString,
} from "@matchbox/server"
import type { ApiMiddleware } from "../context"

// `/internal/*` is for Matchbox's own Workers (Pro, Stuart, Scan), which
// call it through a service binding. Everyone else gets the same 404 as an
// unknown route, with no CORS headers.
//
// How a binding call is told from a public one (README, "Internal routes"):
//
// 1. Cloudflare only invokes this Worker from the internet for hostnames it
//    routes here (the custom domain and the workers.dev subdomain), and the
//    request URL carries that hostname. A service binding call carries
//    whatever URL the caller built. Exactly the hostnames real callers use
//    are trusted (`bindingHostnames`): Pro and Scan build
//    `https://api.internal`, Stuart `https://matchbox-developer-api`.
//    Neither can be routed on the public internet: `.internal` is reserved
//    by ICANN for private use and never delegated, and a single-label name
//    has no zone. A new caller should bind to the `InternalApi` entrypoint
//    (rule 2) rather than join this list; once every caller has, the list
//    can be emptied.
// 2. The `InternalApi` named entrypoint (src/index.ts) marks its requests
//    as binding calls whatever their URL. Named entrypoints cannot be
//    reached from routes or workers.dev, so a caller that binds to it does
//    not depend on rule 1 at all.
// 3. Development escape: `Authorization: Bearer <INTERNAL_TOKEN>`, compared
//    in constant time, and only when the secret is at least 32 characters
//    and ENVIRONMENT is not `production` (`usableInternalToken`).

export const internalPathPrefix = "/internal"

export type InternalCaller = "binding" | "token" | "denied"

/** Requests that arrived through the `InternalApi` named entrypoint. */
const entrypointRequests = new WeakSet<Request>()

/** Marks a request as a service binding call (named entrypoint only). */
export function markBindingRequest(request: Request): void {
  entrypointRequests.add(request)
}

function hasInternalPrefix(pathname: string): boolean {
  return (
    pathname === internalPathPrefix ||
    pathname.startsWith(`${internalPathPrefix}/`)
  )
}

/**
 * True for `/internal` and below, in raw or percent-decoded form, so an
 * encoded path (`/%69nternal/...`) the router decodes is gated too.
 */
export function isInternalPath(pathname: string): boolean {
  if (hasInternalPrefix(pathname)) return true
  try {
    return hasInternalPrefix(decodeURIComponent(pathname))
  } catch {
    // Malformed escapes; the middleware also checks the router's own
    // decoded path, which decodes the valid escapes one by one.
    return false
  }
}

/**
 * The exact hostnames Matchbox's Workers put in binding requests. Local
 * development needs nothing extra: `wrangler dev` service bindings carry the
 * same URLs, and a direct local call uses the token.
 */
export const bindingHostnames: ReadonlySet<string> = new Set([
  // Pro (apps/pro/src/data/source.server.ts, src/server.ts) and Scan.
  "api.internal",
  // Stuart (apps/stuart/src/query/providers/*).
  "matchbox-developer-api",
])

/** True only for a hostname in `bindingHostnames`. */
export function isBindingHostname(hostname: string): boolean {
  return bindingHostnames.has(hostname.toLowerCase())
}

/** Shortest INTERNAL_TOKEN the development escape accepts. */
export const minimumInternalTokenLength = 32

/**
 * The token the development escape may use: null in production, and null
 * for a secret shorter than 32 characters.
 */
export function usableInternalToken(
  token: string | null,
  environment: string,
): string | null {
  if (token === null || environment === "production") return null
  return token.length >= minimumInternalTokenLength ? token : null
}

function bearerToken(header: string | null): string | null {
  if (header === null) return null
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header)
  return match?.[1] ?? null
}

/**
 * Constant-time comparison of a presented token against the secret. Both
 * sides are hashed first so the comparison never depends on their lengths.
 */
async function tokenMatches(
  presented: string,
  secret: string,
): Promise<boolean> {
  const [left, right] = await Promise.all([
    sha256Base64Url(presented),
    sha256Base64Url(secret),
  ])
  return timingSafeEqualString(left, right)
}

/** Who is calling an `/internal/*` route; `denied` for the public. */
export async function internalCaller(
  request: Request,
  internalToken: string | null,
): Promise<InternalCaller> {
  if (entrypointRequests.has(request)) return "binding"
  if (isBindingHostname(new URL(request.url).hostname)) return "binding"
  const presented = bearerToken(request.headers.get("Authorization"))
  if (
    internalToken === null ||
    internalToken.length < minimumInternalTokenLength
  ) {
    return "denied"
  }
  if (presented === null) return "denied"
  return (await tokenMatches(presented, internalToken)) ? "token" : "denied"
}

export type InternalAccessOptions = {
  /** `INTERNAL_TOKEN`; null closes the development escape. */
  internalToken: string | null
}

/**
 * Gate for `/internal/*`. Mount it before `cors()` and `securityHeaders()`
 * so a denial returns before either runs: a public caller cannot tell an
 * internal route from a missing one, and no CORS header leaks.
 */
export function internalAccess(options: InternalAccessOptions): ApiMiddleware {
  return async function internalAccessMiddleware(c, next) {
    const rawPath = new URL(c.req.url).pathname
    if (!isInternalPath(rawPath) && !isInternalPath(c.req.path)) {
      await next()
      return
    }
    const caller = await internalCaller(c.req.raw, options.internalToken)
    if (caller === "denied") {
      c.set("routeTemplate", "/internal/*")
      return errorResponse(c, "not_found")
    }
    await next()
  }
}
