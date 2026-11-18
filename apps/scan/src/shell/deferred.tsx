import { type ComponentType, lazy, type ReactNode, useState } from "react"

/**
 * A shell part whose code is not in the first paint's scripts. On the
 * server its import starts when the Worker boots and the part renders
 * directly once that has resolved, so the HTML is complete and the same
 * on every request (a part React.lazy suspends on mid-render would stream
 * in after the rest and be swapped in by script, changing what the first
 * paint holds). In the browser it loads lazily inside the caller's
 * Suspense, which keeps the server HTML on screen until the code arrives.
 */
export function deferred<P extends object>(
  load: () => Promise<ComponentType<P>>,
): ComponentType<P> {
  let ready: ComponentType<P> | null = null
  if (import.meta.env.SSR) {
    void load().then((component) => {
      ready = component
    })
  }
  const Lazy = lazy(() => load().then((component) => ({ default: component })))
  // biome-ignore lint/correctness/noComponentHookFactories: built once per part at module scope, like React.lazy
  function Deferred(props: P): ReactNode {
    // Chosen once per mount, so the part never remounts when its code
    // arrives while it is on screen.
    const [Part] = useState<ComponentType<P>>(() => ready ?? Lazy)
    return <Part {...props} />
  }
  return Deferred
}
