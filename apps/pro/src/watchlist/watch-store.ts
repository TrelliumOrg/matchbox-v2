import { useSyncExternalStore } from "react"

/**
 * The gauges this browser watches: the star on a gauge profile and the
 * Watching tab on Vote. Kept on this device only (localStorage, every
 * access in try/catch). The API has a watchlist per Matchbox ID account,
 * but it needs an ID session and ID v2 is not released, so nothing is
 * synced yet: when it is, this list is what a first sign-in uploads.
 */

export const watchStorageKey = "mbx-watching"

/** The API's own cap on a watchlist. */
export const watchLimit = 100

const address = /^0x[0-9a-f]{40}$/

/** Reads a stored list without trusting it: lower-case addresses, once. */
export function parseWatching(raw: string | null): string[] {
  if (raw === null) return []
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  for (const entry of value) {
    if (typeof entry !== "string") continue
    const id = entry.toLowerCase()
    if (address.test(id)) seen.add(id)
  }
  return [...seen].slice(0, watchLimit)
}

/** The list with `gauge` added (newest first) or removed. */
export function toggled(list: readonly string[], gauge: string): string[] {
  const id = gauge.toLowerCase()
  if (!address.test(id)) return [...list]
  if (list.includes(id)) return list.filter((entry) => entry !== id)
  return [id, ...list].slice(0, watchLimit)
}

const none: readonly string[] = []
let current: readonly string[] | null = null
const listeners = new Set<() => void>()

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage
  } catch {
    return null
  }
}

export function getWatching(): readonly string[] {
  if (current !== null) return current
  try {
    current = parseWatching(storage()?.getItem(watchStorageKey) ?? null)
  } catch {
    current = none
  }
  return current
}

export function toggleWatching(gauge: string): void {
  current = toggled(getWatching(), gauge)
  try {
    storage()?.setItem(watchStorageKey, JSON.stringify(current))
  } catch {
    // Kept for this tab only.
  }
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  // Another tab starred or unstarred a gauge.
  const onStorage = (event: StorageEvent) => {
    if (event.key !== watchStorageKey) return
    current = null
    listener()
  }
  window.addEventListener("storage", onStorage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener("storage", onStorage)
  }
}

/** Empty on the server and during hydration; the device's list after. */
export function useWatching(): readonly string[] {
  return useSyncExternalStore(subscribe, getWatching, () => none)
}

/** For tests: read storage again. */
export function resetWatching(): void {
  current = null
  for (const listener of listeners) listener()
}
