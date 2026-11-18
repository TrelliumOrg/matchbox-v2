import {
  skipViewTransition,
  trackViewTransitions,
} from "@matchbox/app-kit/view-transitions"
import { createRouter } from "@tanstack/react-router"
import { routeTree } from "./routeTree.gen"

/**
 * The docs router. Pages are static: no loader fetches data and no server
 * function exists, so a client navigation loads the next page's chunk
 * from the static assets and never reaches the Worker. Preloaded on
 * intent; page changes cross-fade with view transitions.
 */
export function getRouter() {
  const router = createRouter({
    routeTree,
    defaultPreload: "intent",
    defaultStaleTime: Number.POSITIVE_INFINITY,
    defaultViewTransition: true,
    scrollRestoration: true,
    defaultHashScrollIntoView: { behavior: "auto", block: "start" },
  })
  if (typeof document !== "undefined") {
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
