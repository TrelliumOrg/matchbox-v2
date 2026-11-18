import { useSyncExternalStore } from "react"

/**
 * The latest Mezo block, shared by the block ticker and block-tied queries.
 * `head-source.ts` feeds it (loaded when the page is idle).
 */

export type Head = {
  number: number
  /** When this client learned of the block, ms since the epoch. */
  receivedAt: number
}

export const blockTimeMs = 3800

type Listener = () => void

export type HeadStore = {
  get: () => Head
  /** The head the page was rendered with, for hydration. */
  initial: () => Head
  set: (number: number, receivedAt?: number) => void
  subscribe: (listener: Listener) => () => void
}

export function createHeadStore(initial: Head): HeadStore {
  let head = initial
  const listeners = new Set<Listener>()
  return {
    get: () => head,
    initial: () => initial,
    set(number, receivedAt = Date.now()) {
      if (number <= head.number) return
      head = { number, receivedAt }
      for (const listener of listeners) listener()
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

/**
 * The latest head. Hydration reads the head the server rendered with, so an
 * island that hydrates after a new block (the corner ticker) still matches
 * the server HTML, then catches up.
 */
export function useHead(store: HeadStore): Head {
  return useSyncExternalStore(store.subscribe, store.get, store.initial)
}
