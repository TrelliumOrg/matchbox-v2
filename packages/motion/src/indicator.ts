import { type RefObject, useLayoutEffect } from "react"
import { easing } from "./easing"
import { prefersReducedMotion } from "./reduced-motion"

/**
 * The active marker of a list (a nav, the Vote type list) slides from the
 * item that was active to the new one instead of jumping. Each item renders
 * its own marker (absolutely placed, hidden unless active), so the server
 * paints it in place; when an item becomes active its marker plays a FLIP
 * from the previous marker's rect (translate and scale, transform only).
 * Items are matched per `group`; under reduced motion it jumps.
 */

type Rect = { left: number; top: number; width: number; height: number }

/**
 * A marker sliding from `from` to `to` in two dimensions (a vertical list's
 * active fill): translate and scale, transform only. Give the marker
 * `transform-origin: 0 0` (Tailwind `origin-top-left`). Null under reduced
 * motion or when either rect is not laid out (a list hidden at this width).
 */
export function indicatorSlide(
  from: Rect,
  to: Rect,
  reduced: boolean = prefersReducedMotion(),
): { keyframes: Keyframe[]; options: KeyframeAnimationOptions } | null {
  if (
    reduced ||
    from.width === 0 ||
    from.height === 0 ||
    to.width === 0 ||
    to.height === 0
  ) {
    return null
  }
  const dx = from.left - to.left
  const dy = from.top - to.top
  const sx = from.width / to.width
  const sy = from.height / to.height
  return {
    keyframes: [
      { transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` },
      { transform: "none" },
    ],
    options: { duration: 300, easing: easing.roll },
  }
}

type Active = {
  element: WeakRef<Element>
  /** Its rect in the list's content (`[data-indicator-root]`) when it won. */
  within: Rect
}

const lastActive = new Map<string, Active>()

function rootOf(element: Element): Element {
  return element.closest("[data-indicator-root]") ?? element
}

/** Where the list's content starts on screen (a scrolled row moves it). */
function origin(root: Element): { left: number; top: number } {
  const box = root.getBoundingClientRect()
  return { left: box.left - root.scrollLeft, top: box.top - root.scrollTop }
}

/**
 * Slides the active marker of `group` from the item that was active. Put
 * `data-indicator-root` on the list: when the page remounts it (a route
 * change), the marker still slides from where the old one sat in it.
 */
export function useSlidingIndicator(
  marker: RefObject<HTMLElement | null>,
  group: string,
  active: boolean,
): void {
  useLayoutEffect(() => {
    const element = marker.current
    if (!active || element === null) return
    const root = origin(rootOf(element))
    const to = element.getBoundingClientRect()
    const before = lastActive.get(group)
    lastActive.set(group, {
      element: new WeakRef(element),
      within: {
        left: to.left - root.left,
        top: to.top - root.top,
        width: to.width,
        height: to.height,
      },
    })
    const old = before?.element.deref()
    if (before === undefined || old === element) return
    const from =
      old?.isConnected === true
        ? old.getBoundingClientRect()
        : {
            ...before.within,
            left: before.within.left + root.left,
            top: before.within.top + root.top,
          }
    const step = indicatorSlide(from, to, prefersReducedMotion())
    if (step !== null) element.animate(step.keyframes, step.options)
  }, [marker, group, active])
}
