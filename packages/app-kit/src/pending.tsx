import { useMatch } from "@tanstack/react-router"
import {
  type ComponentType,
  type LazyExoticComponent,
  lazy,
  type ReactNode,
  Suspense,
} from "react"

/**
 * The router's pending screen: the skeleton for the route being loaded,
 * fetched on demand, so no route preloads a pending chunk of its own.
 * `byRoute` maps route ids ("/vote/$type") to the app's screen names, and
 * `load` imports the module whose default export draws them.
 */
export function createRoutePending<R extends string>(
  byRoute: Readonly<Record<string, R>>,
  load: () => Promise<{ default: ComponentType<{ route: R }> }>,
): () => ReactNode {
  const PendingScreen: LazyExoticComponent<ComponentType<{ route: R }>> =
    lazy(load)
  // biome-ignore lint/correctness/noComponentHookFactories: built once per app at module scope, like React.lazy
  function RoutePending(): ReactNode {
    // Rendered by the pending match itself, so the nearest match is the route.
    const routeId: string | undefined = useMatch({
      strict: false,
      select: (match) => match.routeId,
    })
    const route = routeId === undefined ? undefined : byRoute[routeId]
    if (route === undefined) return null
    return (
      <Suspense fallback={null}>
        <PendingScreen route={route} />
      </Suspense>
    )
  }
  return RoutePending
}
