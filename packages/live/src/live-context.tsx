import { whenRuntime } from "@matchbox/app-kit/live-query"
import { whenIdle } from "@matchbox/motion"
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useState,
} from "react"
import type { LiveConfig } from "./config"
import { blockTimeMs, createHeadStore, type HeadStore } from "./heads"

/**
 * Live chain state for the shell: the head store (block ticker) and the
 * block-tied refresh. Queries marked `meta.block` refetch every
 * `refreshBlocks` new blocks, so the screens follow the chain without
 * reloads and without a request per block. An app's own live data (Pro's
 * market read model) stays in the app and passes its block as `head`.
 */

export const refreshBlocks = 16

export type LiveValue = {
  store: HeadStore
  config: LiveConfig
  /** The RPC the wallet reads and simulates through. */
  rpc: string
}

const LiveContext = createContext<LiveValue | null>(null)

export type LiveProviderProps = {
  /** The latest block the app's data knows; the store follows it. */
  head: number
  config: LiveConfig
  rpc: string
  /** Fallback poll when there is no RPC URL: returns the latest block. */
  pollLatest: () => Promise<number>
  children: ReactNode
}

export function LiveProvider({
  head,
  config,
  rpc,
  pollLatest,
  children,
}: LiveProviderProps): ReactNode {
  const [store] = useState(() =>
    createHeadStore({ number: head, receivedAt: Date.now() }),
  )

  useEffect(() => {
    store.set(head)
  }, [store, head])

  // biome-ignore lint/correctness/useExhaustiveDependencies: pollLatest is read once, when the source starts
  useEffect(() => {
    let stop: (() => void) | null = null
    let cancelled = false
    const cancelIdle = whenIdle(() => {
      void import("./head-source").then(({ startHeads }) => {
        if (cancelled) return
        stop = startHeads({ config, store, pollLatest })
      })
    })
    return () => {
      cancelled = true
      cancelIdle()
      stop?.()
    }
  }, [config, store])

  useEffect(() => {
    let last = store.get().number
    return store.subscribe(() => {
      const next = store.get().number
      if (next - last < refreshBlocks) return
      last = next
      whenRuntime((runtime) => void runtime.refreshBlockQueries())
    })
  }, [store])

  return (
    <LiveContext.Provider value={{ store, config, rpc }}>
      {children}
    </LiveContext.Provider>
  )
}

export function useLive(): LiveValue {
  const value = useContext(LiveContext)
  if (value === null) throw new Error("useLive must be inside <LiveProvider>")
  return value
}

/** Chain time in unix seconds, moved forward by blocks since `anchor`. */
export function chainNow(
  anchor: { block: { number: number; timestamp: number } },
  head: number,
): number {
  return (
    anchor.block.timestamp +
    Math.round(((head - anchor.block.number) * blockTimeMs) / 1000)
  )
}
