import handler from "@tanstack/react-start/server-entry"
import { nonceHeader } from "./app/lib/nonce"
import { servePage } from "./execution.server"
import { createNonce, documentSecurityHeaders } from "./shared/csp"
import worker from "./worker/index"

export { RateLimiter } from "@matchbox/server/rate-limiter"

/**
 * The Matchbox ID Worker. `/api/*`, `/oauth/*` and `/.well-known/*` go to
 * the ported Hono OIDC server exactly as before; every other path is a page
 * or server function handled by TanStack Start (see `servePage`), with a
 * fresh CSP nonce and the security headers the old SPA's `_headers` set.
 */

const workerPathPrefixes = ["/api/", "/oauth/", "/.well-known/"]

function isWorkerPath(pathname: string): boolean {
  return workerPathPrefixes.some((prefix) => pathname.startsWith(prefix))
}

export default {
  fetch(request, env, ctx) {
    if (isWorkerPath(new URL(request.url).pathname)) {
      return worker.fetch(request, env, ctx)
    }
    const nonce = createNonce()
    return servePage({
      request,
      nonce,
      nonceHeader,
      start: (started) => handler.fetch(started),
      read: async (url, headers) =>
        worker.fetch(
          new Request<unknown, IncomingRequestCfProperties>(url, {
            method: "GET",
            headers,
          }),
          env,
          ctx,
        ),
      documentHeaders: (pathname) =>
        documentSecurityHeaders({
          pathname,
          nonce,
          development: env.ENVIRONMENT === "development",
        }),
    })
  },
  scheduled: worker.scheduled,
} satisfies ExportedHandler<Cloudflare.Env>
