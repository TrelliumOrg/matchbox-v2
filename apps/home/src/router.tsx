import { nonceHeader } from "@matchbox/app-kit/security"
import { createRouter } from "@tanstack/react-router"
import { createIsomorphicFn } from "@tanstack/react-start"
import { getRequestHeader } from "@tanstack/react-start/server"
import { routeTree } from "./routeTree.gen"

/**
 * This response's CSP nonce, which the Worker passes in a request header
 * (src/server.ts). The router puts it on every script it renders. None in
 * the browser: scripts loaded there are trusted through 'strict-dynamic'.
 */
const scriptNonce = createIsomorphicFn()
  .server((): string | undefined => getRequestHeader(nonceHeader) ?? undefined)
  .client((): string | undefined => undefined)

/** One page; its figures go live in the page, not through the router. */
export function getRouter() {
  const nonce = scriptNonce()
  return createRouter({
    routeTree,
    ...(nonce === undefined ? {} : { ssr: { nonce } }),
    defaultStaleTime: Number.POSITIVE_INFINITY,
    scrollRestoration: true,
  })
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
