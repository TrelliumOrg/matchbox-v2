import { useState, useSyncExternalStore } from "react"

/**
 * Whether this component mounted after the page had hydrated (a client
 * navigation) and not as part of hydrating the server's HTML. One that
 * hydrates must render what the server sent; one that mounts later may
 * use what this tab already loaded, such as the card picture the profile
 * draws underneath its own (see gauge-view).
 *
 * Asked of React itself, per component: while it hydrates a component,
 * `useSyncExternalStore` hands it the server snapshot. The first version
 * was a flag the root set in an effect, but a route's view hydrates after
 * the root has committed (its code arrives later), so the flag was already
 * set and the profile rendered the extra picture the server had not sent:
 * a hydration error on every first load of a gauge with a picture, which
 * threw the page's server markup away (13 Nov 2026).
 */

const never = (): (() => void) => () => undefined

export function useMountedAfterHydration(): boolean {
  const hydrating = useSyncExternalStore(
    never,
    () => false,
    () => true,
  )
  // The answer at the first render, kept: React renders once more with the
  // client snapshot after hydrating, and the answer must not flip then.
  const [after] = useState(!hydrating)
  return after
}
