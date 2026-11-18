import { useSyncExternalStore } from "react"

/**
 * The latest Mezo block, shared by the block ticker and block-tied queries.
 * `head-source.ts` feeds it (loaded when the page is idle).
 */

/**
 * What BlockHub's head message says about the block beyond its number
 * (`blockHeadMessageSchema` in @matchbox/contracts/scan), so a "Latest
 * blocks" list can grow with no HTTP request. Null fields were missing from
 * the RPC block.
 */
export type HeadBlock = {
  number: number
  /** Unix seconds. */
  timestamp: number
  hash: string | null
  transactionCount: number | null
  /** Base-10 integer string. */
  gasUsed: string | null
  /** The proposer, lower case. */
  miner: string | null
}

export type Head = {
  number: number
  /** When this client learned of the block, ms since the epoch. */
  receivedAt: number
  /** The block's details, when the source sent them (BlockHub does). */
  block?: HeadBlock
}

export const blockTimeMs = 3800

type Listener = () => void

export type HeadStore = {
  get: () => Head
  /** The head the page was rendered with, for hydration. */
  initial: () => Head
  set: (number: number, receivedAt?: number, block?: HeadBlock) => void
  subscribe: (listener: Listener) => () => void
}

export function createHeadStore(initial: Head): HeadStore {
  let head = initial
  const listeners = new Set<Listener>()
  return {
    get: () => head,
    initial: () => initial,
    set(number, receivedAt = Date.now(), block) {
      if (number <= head.number) return
      head =
        block === undefined || block.number !== number
          ? { number, receivedAt }
          : { number, receivedAt, block }
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
