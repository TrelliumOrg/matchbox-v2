import {
  type ComponentType,
  createElement,
  type ReactNode,
  useEffect,
  useSyncExternalStore,
} from "react"
import type { TextMorphProps } from "torph/react"
import { duration, easing } from "./easing"
import { whenIdle } from "./idle"

export type MorphTextProps = TextMorphProps

type TextMorphComponent = ComponentType<TextMorphProps>

let loaded: TextMorphComponent | null = null
let loading: Promise<TextMorphComponent> | null = null
const listeners = new Set<() => void>()

/** Loads torph. MorphText calls this when the page is idle. */
export function preloadMorphText(): Promise<TextMorphComponent> {
  loading ??= import("torph/react").then((module) => {
    loaded = module.TextMorph
    for (const listener of listeners) listener()
    return module.TextMorph
  })
  return loading
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/**
 * Words that change in place: signing steps, button states, status words.
 * The first paint is plain text (nothing animates on first load, and torph
 * stays out of the initial JS); torph loads when the page is idle and takes
 * over, so every later change morphs. torph keeps a hidden copy for screen
 * readers and skips the morph under reduced motion.
 */
export function MorphText({
  duration: ms = duration.roll,
  ease = easing.text,
  respectReducedMotion = true,
  as = "span",
  className,
  style,
  children,
  ...props
}: MorphTextProps): ReactNode {
  const TextMorph = useSyncExternalStore(
    subscribe,
    () => loaded,
    () => null,
  )

  useEffect(() => whenIdle(() => void preloadMorphText()), [])

  if (TextMorph === null) {
    return createElement(as, { className, style }, children)
  }
  return (
    <TextMorph
      duration={ms}
      ease={ease}
      respectReducedMotion={respectReducedMotion}
      as={as}
      {...(className === undefined ? {} : { className })}
      {...(style === undefined ? {} : { style })}
      {...props}
    >
      {children}
    </TextMorph>
  )
}

MorphText.displayName = "MorphText"
