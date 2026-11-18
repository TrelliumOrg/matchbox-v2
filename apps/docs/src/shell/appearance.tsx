import { lazy, type ReactNode, Suspense, useSyncExternalStore } from "react"

/**
 * The Appearance sheet's open state, and its host inside the idle theme
 * provider (app-kit IdleThemeSync). Pro's sheet: mode, presets, Haptics.
 * Its code loads on the first hover or open.
 */

let open = false
let requested = false
const listeners = new Set<() => void>()

function set(next: boolean): void {
  open = next
  if (next) requested = true
  for (const listener of listeners) listener()
}

function load(): Promise<unknown> {
  return import("./appearance-sheet")
}

export function warmAppearance(): void {
  void load()
}

export function openAppearance(): void {
  set(true)
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

const AppearanceSheet = lazy(() => import("./appearance-sheet"))

export function AppearanceHost(): ReactNode {
  const isOpen = useSyncExternalStore(
    subscribe,
    () => open,
    () => false,
  )
  if (!isOpen && !requested) return null
  return (
    <Suspense fallback={null}>
      <AppearanceSheet open={isOpen} onOpenChange={set} />
    </Suspense>
  )
}
