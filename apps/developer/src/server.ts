import handler from "@tanstack/react-start/server-entry"
import { nonceHeader } from "./app/lib/nonce"
import { servePage } from "./execution.server"
import { classicAppRedirect } from "./lib/classic-paths"
import { docsRedirect } from "./lib/docs-redirect"
import { createNonce, documentSecurityHeaders } from "./lib/document-csp"
import worker from "./worker/index"
import { withPageMeta } from "./worker/meta"
import { privacyRedirect } from "./worker/privacy"

export { RateLimiter } from "@matchbox/server/rate-limiter"

/**
 * The Matchbox Developer Worker. `/api/*` goes to the ported Hono console
 * server exactly as before; every other path is a page rendered by
 * TanStack Start, with the old SPA's page meta (worker/meta.ts) and
 * security headers, and a fresh CSP nonce for its inline scripts.
 */

function isApiPath(pathname: string): boolean {
  return pathname === "/api" || pathname.startsWith("/api/")
}

export default {
  fetch(request, env, ctx) {
    const url = new URL(request.url)
    const redirect = privacyRedirect(url)
    if (redirect !== null) return redirect
    const moved = classicAppRedirect(url)
    if (moved !== null) return moved
    const docs = docsRedirect(url, env.DOCS_ORIGIN)
    if (docs !== null) return docs
    if (isApiPath(url.pathname)) return worker.fetch(request, env, ctx)
    const nonce = createNonce()
    return servePage({
      request,
      nonce,
      nonceHeader,
      start: (started) => handler.fetch(started),
      read: async (target, headers) =>
        worker.fetch(
          new Request<unknown, IncomingRequestCfProperties>(target, {
            method: "GET",
            headers,
          }),
          env,
          ctx,
        ),
      documentHeaders: () =>
        documentSecurityHeaders({
          nonce,
          development: env.ENVIRONMENT === "development",
        }),
      rewrite: withPageMeta,
    })
  },
} satisfies ExportedHandler<Cloudflare.Env>
