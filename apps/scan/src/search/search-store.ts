import { useSyncExternalStore } from "react"
import { maxQueryLength } from "./limits"

/**
 * Whether the search palette is open, and the text it opens with. In the
 * first paint, so it stays tiny: the palette loads on intent (hover, focus,
 * Ctrl K) or on the first open.
 */

type SearchState = { open: boolean; query: string }

const closed: SearchState = { open: false, query: "" }

let state = closed
const listeners = new Set<() => void>()

function set(next: SearchState): void {
  state = next
  for (const listener of listeners) listener()
}

export function openSearch(query = ""): void {
  void loadPalette()
  set({ open: true, query })
}

export function closeSearch(): void {
  set(closed)
}

let mounted = false

/** The palette says when its input is on screen and owns the keys. */
export function setPaletteMounted(next: boolean): void {
  mounted = next
}

/**
 * Keys typed after Ctrl K but before the palette's code arrives join its
 * opening text, so nothing typed is lost. True when the key was taken.
 */
export function typeAhead(key: string): boolean {
  if (!state.open || mounted || key.length !== 1) return false
  if (state.query.length >= maxQueryLength) return true
  set({ open: true, query: state.query + key })
  return true
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useSearchState(): SearchState {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => closed,
  )
}

let palette: Promise<typeof import("./search-palette")> | null = null

/** Starts loading the palette. Safe to call on every hover. */
export function loadPalette(): Promise<typeof import("./search-palette")> {
  palette ??= import("./search-palette")
  return palette
}

export const searchIntent = {
  onPointerEnter: () => void loadPalette(),
  onFocus: () => void loadPalette(),
  onTouchStart: () => void loadPalette(),
} as const
