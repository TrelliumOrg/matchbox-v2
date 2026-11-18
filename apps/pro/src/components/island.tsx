import { whenIdle } from "@matchbox/motion"
import {
  type ComponentType,
  lazy,
  memo,
  type ReactNode,
  Suspense,
  useEffect,
  useRef,
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

/**
 * Resolves when the section's box comes near the screen. `rewatch` is
 * handed a function that points the wait at another element: if React
 * gives up hydrating the page and renders it again, the box in the
 * document is a new one, and a wait still watching the old, detached box
 * would never end. That left a gauge profile without everything below its
 * header after a hydration error (13 Nov 2026).
 */
function whenNear(
  id: string,
  rewatch: (watch: (element: Element) => void) => void,
): Promise<void> {
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
    rewatch((next) => {
      observer.disconnect()
      observer.observe(next)
    })
  })
}

/**
 * JSON has no form for a Map, a Set or a bigint: the first two come out as
 * "{}" whatever they hold, so two different ballots compared equal and the
 * section showing one never re-rendered; a bigint throws.
 */
function plain(_key: string, value: unknown): unknown {
  if (value instanceof Map) return { map: [...value] }
  if (value instanceof Set) return { set: [...value] }
  return typeof value === "bigint" ? `${value}n` : value
}

/** Plain data compared by value; functions and the rest by identity. */
export function sameValue(left: unknown, right: unknown): boolean {
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
    return JSON.stringify(left, plain) === JSON.stringify(right, plain)
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
  // Points the wait at the section's current box (see `whenNear`).
  let watch: ((element: Element) => void) | null = null
  const Deferred = lazy(() =>
    whenNear(id, (next) => {
      watch = next
    })
      .then(load)
      .then((component) => ({ default: component })),
  )
  // biome-ignore lint/correctness/noComponentHookFactories: built once per section at module scope, like React.lazy
  function Island(props: P): ReactNode {
    // Chosen once per mount, so the section never remounts when its code
    // arrives while it is on screen.
    const [Section] = useState<ComponentType<P>>(() => ready ?? Deferred)
    const box = useRef<HTMLDivElement>(null)
    // On every mount: after a hydration error this is a new box.
    useEffect(() => {
      if (box.current !== null) watch?.(box.current)
    }, [])
    return (
      <div ref={box} data-island={id} className={className}>
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
  // biome-ignore lint/correctness/noComponentHookFactories: built once per section at module scope, like React.lazy
  const Steady = memo(Island, sameProps)

  // A parent that passes `onChange={() => ...}` passes a new function on
  // every render, which the comparison above sees as a change. So handlers
  // (`on...` props) reach the section through wrappers that never change
  // and call whatever the parent passed last (see `steadyProps`). Without this, any parent re-render
  // before the section hydrated emptied it for a frame: the lock picker on
  // Vote collapsed 144px and came back (layout shift 0.098, 13 Nov 2026).
  const warned = new Set<string>()
  // biome-ignore lint/correctness/noComponentHookFactories: built once per section at module scope, like React.lazy
  function Outer(props: P): ReactNode {
    const latest = useRef(props)
    latest.current = props
    const wrappers = useRef(new Map<string, (...args: unknown[]) => unknown>())
    return (
      <Steady
        {...steadyProps(props, latest, wrappers.current, (key) => {
          if (!import.meta.env.DEV || warned.has(key)) return
          warned.add(key)
          console.warn(
            `Island "${id}" got a function prop "${key}" that is not an on... handler. A new function there renders the island again, and before it has hydrated that empties it for a frame. Pass data, or a stable function.`,
          )
        })}
      />
    )
  }
  Outer.displayName = `IslandProps(${id})`
  return Outer
}

/** A prop that is an event handler by name: `onChange`, `onNewLock`. */
const handlerName = /^on[A-Z]/

/**
 * `props` with every handler (`on...`) replaced by a wrapper that stays
 * the same between renders and calls the latest handler of that name.
 *
 * Only handlers: they are called later, on an event, so calling the latest
 * one is always right. Any other function is passed through as it is and
 * still counts as a change. A component passed as a prop must be rendered
 * as that component, and a render prop or formatter draws output that has
 * to follow the parent's closure; a stand-in would break the first and go
 * stale on the second. `other` is told about each of those, so the island
 * can say in development why it renders again.
 */
export function steadyProps<P extends object>(
  props: P,
  latest: { current: P },
  wrappers: Map<string, (...args: unknown[]) => unknown>,
  other: (key: string) => void = () => undefined,
): P {
  const steady: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(props)) {
    if (typeof value !== "function") {
      steady[key] = value
      continue
    }
    if (!handlerName.test(key)) {
      steady[key] = value
      other(key)
      continue
    }
    let wrapper = wrappers.get(key)
    if (wrapper === undefined) {
      wrapper = (...args: unknown[]): unknown => {
        const current: unknown = Reflect.get(latest.current, key)
        return typeof current === "function"
          ? Reflect.apply(current, undefined, args)
          : undefined
      }
      wrappers.set(key, wrapper)
    }
    steady[key] = wrapper
  }
  // Same keys and data as `props`; only the handlers are stand-ins.
  return steady as P
}
