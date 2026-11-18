import { useMatch } from "@tanstack/react-router"
import { lazy, type ReactNode, Suspense } from "react"
import type { PendingRoute } from "../features/pending"

const PendingScreen = lazy(() => import("../features/pending"))

const byRoute: Record<string, PendingRoute> = {
  "/": "overview",
  "/vote/": "vote",
  "/vote/$type": "vote",
  "/rewards": "rewards",
  "/activity": "activity",
  "/protocol/": "protocol",
  "/protocol/$epoch": "protocol",
  "/gauges/$address": "gauge",
}

/**
 * The router's pending screen: the skeleton for the route being loaded,
 * fetched on demand, so no route preloads a pending chunk of its own.
 */
export function RoutePending(): ReactNode {
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
