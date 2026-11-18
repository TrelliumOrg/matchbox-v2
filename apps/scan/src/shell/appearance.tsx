import { lazy, type ReactNode, Suspense, useSyncExternalStore } from "react"

/**
 * The Appearance sheet's open state, and its host inside the idle theme
 * provider. The sheet's code loads on the first open.
 */

let open = false
let requested = false
const listeners = new Set<() => void>()

function set(next: boolean): void {
  open = next
  if (next) requested = true
  for (const listener of listeners) listener()
}

export function openAppearance(): void {
  set(true)
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function useAppearanceOpen(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => open,
    () => false,
  )
}

const AppearanceSheet = lazy(() => import("./appearance-sheet"))

export function AppearanceHost(): ReactNode {
  const isOpen = useAppearanceOpen()
  if (!isOpen && !requested) return null
  return (
    <Suspense fallback={null}>
      <AppearanceSheet open={isOpen} onOpenChange={set} />
    </Suspense>
  )
}
