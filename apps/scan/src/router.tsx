import { nonceHeader } from "@matchbox/app-kit/security"
import {
  skipViewTransition,
  trackViewTransitions,
} from "@matchbox/app-kit/view-transitions"
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

export function getRouter() {
  const nonce = scriptNonce()
  const router = createRouter({
    routeTree,
    ...(nonce === undefined ? {} : { ssr: { nonce } }),
    defaultPreload: "intent",
    defaultStaleTime: 15_000,
    defaultViewTransition: true,
    scrollRestoration: true,
  })
  if (typeof document !== "undefined") {
    // A click mid-transition starts the next page at once.
    trackViewTransitions()
    router.subscribe("onBeforeNavigate", skipViewTransition)
  }
  return router
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
