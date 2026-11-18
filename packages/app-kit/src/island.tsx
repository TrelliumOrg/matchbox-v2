import { whenIdle } from "@matchbox/motion"
import {
  type ComponentType,
  lazy,
  memo,
  type ReactNode,
  Suspense,
  useState,
} from "react"

/**
 * Below-the-fold sections hydrate when they come near the viewport, the
 * plan's "anything below the fold behind code splitting". The server renders
 * the section like any other markup; in the browser its code loads only when
 * the section is within 200px of the screen (never, for a section hidden at
 * this width), and React hydrates it then. Until then the server HTML stays
 * on screen, untouched. On client navigations there is no server HTML, so
 * the code loads at once.
 */

function whenNear(id: string): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve()
  const element = document.querySelector(`[data-island="${id}"]`)
  if (element === null || !("IntersectionObserver" in window)) {
    return Promise.resolve()
  }
  return new Promise((resolve) => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return
        observer.disconnect()
        resolve()
      },
      { rootMargin: "200px" },
    )
    observer.observe(element)
  })
}

/** Plain data compared by value; functions and the rest by identity. */
function sameValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  if (
    typeof left !== "object" ||
    typeof right !== "object" ||
    left === null ||
    right === null
  ) {
    return false
  }
  try {
    return JSON.stringify(left) === JSON.stringify(right)
  } catch {
    return false
  }
}

function sameProps<P extends object>(left: P, right: P): boolean {
  const keys = Object.keys(left) as (keyof P)[]
  return (
    keys.length === Object.keys(right).length &&
    keys.every((key) => sameValue(left[key], right[key]))
  )
}

/**
 * `load` imports the section. The server starts that import when the Worker
 * boots and renders the section directly once it has resolved, so the HTML
 * is complete; in the browser the same import waits for the viewport.
 */
export function island<P extends object>(
  id: string,
  load: () => Promise<ComponentType<P>>,
  /** Classes for the wrapper, which is the layout box (grid cell, sticky). */
  className?: string,
  /**
   * Also load it in the browser once the page is idle, so a client
   * navigation to a page with this section renders it at once instead of
   * popping it in after its code arrives.
   */
  preload = false,
): ComponentType<P> {
  let ready: ComponentType<P> | null = null
  if (import.meta.env.SSR || preload) {
    const take = (): void =>
      void load().then((component) => {
        ready = component
      })
    if (import.meta.env.SSR) take()
    else whenIdle(take)
  }
  const Deferred = lazy(() =>
    whenNear(id)
      .then(load)
      .then((component) => ({ default: component })),
  )
  // biome-ignore lint/correctness/noComponentHookFactories: built once per section at module scope, like React.lazy
  function Island(props: P): ReactNode {
    // Chosen once per mount, so the section never remounts when its code
    // arrives while it is on screen.
    const [Section] = useState<ComponentType<P>>(() => ready ?? Deferred)
    return (
      <div data-island={id} className={className}>
        <Suspense fallback={null}>
          <Section {...props} />
        </Suspense>
      </div>
    )
  }
  Island.displayName = `Island(${id})`
  // A section still waiting to hydrate that receives new props is thrown
  // away and rendered again on the client, from an empty fallback: a layout
  // shift. Parents re-render with equal data after hydration (a live query
  // settling), so an island only re-renders when its data really changes.
  return memo(Island, sameProps)
}
