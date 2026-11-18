import { useSyncExternalStore } from "react"

const query = "(prefers-reduced-motion: reduce)"

function subscribe(onChange: () => void): () => void {
  if (typeof window === "undefined" || window.matchMedia === undefined) {
    return () => {}
  }
  const media = window.matchMedia(query)
  media.addEventListener("change", onChange)
  return () => media.removeEventListener("change", onChange)
}

function getSnapshot(): boolean {
  if (typeof window === "undefined" || window.matchMedia === undefined) {
    return false
  }
  return window.matchMedia(query).matches
}

function getServerSnapshot(): boolean {
  return false
}

/** Whether the user asked for reduced visual motion. False on the server. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}

/** Non-hook check, for event handlers and imperative animations. */
export function prefersReducedMotion(): boolean {
  return getSnapshot()
}
