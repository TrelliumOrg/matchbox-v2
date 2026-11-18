import type { NumberFlowProps } from "@number-flow/react"
import {
  type ComponentType,
  type ReactNode,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react"
import { duration, easing } from "./easing"
import { whenIdle } from "./idle"

export type AnimatedNumberProps = NumberFlowProps & {
  /**
   * Makes it a headline, keyed for the session: the first time it is in
   * view it counts up from zero (count-up.ts, started on idle by
   * `startPageMotion`). The server renders the final value.
   */
  countUp?: string | undefined
}

type NumberFlowComponent = ComponentType<NumberFlowProps>

let loaded: NumberFlowComponent | null = null
let loading: Promise<NumberFlowComponent> | null = null
const listeners = new Set<() => void>()

/** Loads NumberFlow. AnimatedNumber calls this when the page is idle. */
export function preloadAnimatedNumber(): Promise<NumberFlowComponent> {
  loading ??= import("@number-flow/react").then((module) => {
    loaded = module.default
    for (const listener of listeners) listener()
    return module.default
  })
  return loading
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

const timing = { duration: duration.roll, easing: easing.roll }

/** The same text NumberFlow shows, from Intl, for the first paint. */
export function formatStatic(
  value: NumberFlowProps["value"],
  { format, locales, prefix, suffix }: Omit<NumberFlowProps, "value">,
): string {
  const text = new Intl.NumberFormat(locales, format).format(value)
  return `${prefix ?? ""}${text}${suffix ?? ""}`
}

/**
 * Every live number: only the changed digits roll, 380ms on the roll curve.
 * Nothing animates on first load, so the first paint is plain Intl text and
 * NumberFlow (loaded when idle) takes over the first time the value changes:
 * it mounts on the old value and rolls to the new one. The headline figure
 * therefore never re-renders during load. NumberFlow honours
 * prefers-reduced-motion. Use tabular figures via the parent.
 */
export function AnimatedNumber({
  value,
  countUp,
  ...props
}: AnimatedNumberProps): ReactNode {
  const Flow = useSyncExternalStore(
    subscribe,
    () => loaded,
    () => null,
  )
  const [state, setState] = useState({ live: false, shown: value })

  useEffect(() => whenIdle(() => void preloadAnimatedNumber()), [])

  useEffect(() => {
    if (state.shown === value) return
    if (state.live) {
      setState({ live: true, shown: value })
      return
    }
    let frame = 0
    let cancelled = false
    void preloadAnimatedNumber().then(() => {
      if (cancelled) return
      setState((current) => ({ ...current, live: true }))
      frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(() =>
          setState({ live: true, shown: value }),
        )
      })
    })
    return () => {
      cancelled = true
      cancelAnimationFrame(frame)
    }
  }, [value, state.live, state.shown])

  if (!state.live || Flow === null) {
    const text = formatStatic(state.live ? state.shown : value, props)
    return (
      <span
        data-count-up={countUp}
        className={props.className}
        style={props.style}
      >
        {text}
      </span>
    )
  }

  return (
    <Flow
      transformTiming={timing}
      spinTiming={timing}
      opacityTiming={{ duration: 240, easing: "ease-out" }}
      {...props}
      value={state.shown}
    />
  )
}

AnimatedNumber.displayName = "AnimatedNumber"
