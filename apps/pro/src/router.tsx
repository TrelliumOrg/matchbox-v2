// First: zod's eval probe is off before any module builds a schema.
import "./lib/zod-jitless"
import { nonceHeader } from "@matchbox/app-kit/security"
import { createRouter } from "@tanstack/react-router"
import { createIsomorphicFn } from "@tanstack/react-start"
import { getRequestHeader } from "@tanstack/react-start/server"
import { RoutePending } from "./components/pending"
import {
  skipViewTransition,
  trackViewTransitions,
} from "./lib/view-transitions"
import { browserWalletContext, walletNamesHeader } from "./lib/wallet-context"
import {
  decodeNames,
  ownFromCookie,
  toInternal,
  toPublic,
  type WalletContext,
} from "./lib/wallet-path"
import { routeTree } from "./routeTree.gen"

/**
 * Whose wallet a URL names: the request's own-wallet cookie and the Mezo
 * IDs the Worker resolved (a header) on the server, the same from the
 * cookie and a meta tag in the browser.
 */
const walletContext = createIsomorphicFn()
  .server(
    (): WalletContext => ({
      own: ownFromCookie(getRequestHeader("cookie") ?? null),
      names: decodeNames(getRequestHeader(walletNamesHeader) ?? null),
    }),
  )
  .client((): WalletContext => browserWalletContext())

/**
 * This response's CSP nonce, which the Worker passes in a request header
 * (src/server.ts). The router puts it on every script it renders, and the
 * root document on its own inline scripts. None in the browser: scripts
 * loaded there are trusted through 'strict-dynamic'.
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
    // The query runtime owns freshness once it is up; loaders ask it.
    defaultPreloadStaleTime: 0,
    defaultStaleTime: 15_000,
    defaultViewTransition: true,
    defaultPendingComponent: RoutePending,
    scrollRestoration: true,
    // Clean wallet URLs: /pyke.mezo/vote outside, /vote?address=0x… inside.
    rewrite: {
      input: ({ url }) => toInternal(url, walletContext()),
      output: ({ url }) => toPublic(url, walletContext()),
    },
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
