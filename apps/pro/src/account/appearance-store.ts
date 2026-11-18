import { useSyncExternalStore } from "react"

/**
 * Whether the Appearance sheet is open. The sheet lives in the idle
 * ThemeSync (inside the page's ThemeProvider); the Account panel opens it.
 * Its own module so the panel does not carry the theme picker.
 */

let open = false
const listeners = new Set<() => void>()

export function setAppearanceOpen(next: boolean): void {
  open = next
  for (const listener of listeners) listener()
}

/** Opens the Appearance sheet. */
export function openAppearance(): void {
  setAppearanceOpen(true)
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useAppearanceOpen(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => open,
    () => false,
  )
}
