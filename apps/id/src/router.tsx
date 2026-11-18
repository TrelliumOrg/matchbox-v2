import { createRouter } from "@tanstack/react-router"
import { createIsomorphicFn } from "@tanstack/react-start"
import { getRequestHeader } from "@tanstack/react-start/server"
import { nonceHeader } from "./app/lib/nonce"
import { routeTree } from "./routeTree.gen"

/**
 * The page's CSP nonce: the Worker's request header on the server (see
 * server.ts), the `csp-nonce` meta the router writes in the browser.
 */
const cspNonce = createIsomorphicFn()
  .server((): string | undefined => getRequestHeader(nonceHeader))
  .client(
    (): string | undefined =>
      document
        .querySelector<HTMLMetaElement>('meta[property="csp-nonce"]')
        ?.getAttribute("content") ?? undefined,
  )

export function getRouter() {
  const nonce = cspNonce()
  return createRouter({
    routeTree,
    defaultPreload: "intent",
    defaultPreloadStaleTime: 0,
    defaultViewTransition: true,
    scrollRestoration: true,
    ...(nonce === undefined ? {} : { ssr: { nonce } }),
  })
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
