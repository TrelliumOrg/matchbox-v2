import { useSyncExternalStore } from "react"

/**
 * Tiny open/closed stores for the shell's overlays (search, Appearance),
 * so a button anywhere can open one and the overlay's own code loads only
 * when it first opens. The menu and On this page sheets are native
 * popovers (./bottom-sheet) and need no store.
 */

export type Toggle = {
  open: (value?: string) => void
  close: () => void
  use: () => { open: boolean; requested: boolean; value: string }
  /** Code to load ahead, on hover or focus of what opens it. */
  warm: () => void
}

export function createToggle(
  load: () => Promise<unknown> = async () => {},
): Toggle {
  let state = { open: false, requested: false, value: "" }
  const listeners = new Set<() => void>()
  const set = (next: typeof state) => {
    state = next
    for (const listener of listeners) listener()
  }
  const subscribe = (listener: () => void) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }
  const server = { open: false, requested: false, value: "" }
  return {
    open: (value = "") => {
      void load()
      set({ open: true, requested: true, value })
    },
    close: () => set({ ...state, open: false }),
    use: () =>
      useSyncExternalStore(
        subscribe,
        () => state,
        () => server,
      ),
    warm: () => void load(),
  }
}

function loadSearch(): Promise<unknown> {
  return import("../search/palette")
}

export const search = createToggle(loadSearch)
