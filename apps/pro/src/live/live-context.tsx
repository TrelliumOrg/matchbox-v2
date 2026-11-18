import { whenIdle } from "@matchbox/motion"
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useState,
} from "react"
import type { LiveConfig } from "../data/inputs.server"
import { useLiveQuery, whenRuntime } from "../data/live-query"
import { loadProApi, marketQuery } from "../data/queries"
import type { Market } from "../data/view-models"
import { blockTimeMs, createHeadStore, type HeadStore } from "./heads"

/**
 * Live chain state for the shell: the head store (block ticker), the market
 * read model (prices, epoch) and the block-tied refresh. Queries marked
 * `meta.block` refetch every `refreshBlocks` new blocks, so the screens
 * follow the chain without reloads and without a request per block.
 */

export const refreshBlocks = 16

type LiveValue = {
  store: HeadStore
  market: Market
  config: LiveConfig
  /** The RPC the wallet reads and simulates through. */
  rpc: string
}

const LiveContext = createContext<LiveValue | null>(null)

export type MarketSeed = { market: Market; live: LiveConfig; rpc: string }

export function LiveProvider({
  seed,
  children,
}: {
  seed: MarketSeed
  children: ReactNode
}): ReactNode {
  const data = useLiveQuery(marketQuery, seed)
  const [store] = useState(() =>
    createHeadStore({
      number: seed.market.block.number,
      receivedAt: Date.now(),
    }),
  )

  useEffect(() => {
    store.set(data.market.block.number)
  }, [store, data.market.block.number])

  useEffect(() => {
    let stop: (() => void) | null = null
    let cancelled = false
    const cancelIdle = whenIdle(() => {
      void import("./head-source").then(({ startHeads }) => {
        if (cancelled) return
        stop = startHeads({
          config: seed.live,
          store,
          pollLatest: async () =>
            (await (await loadProApi()).getMarket()).market.block.number,
        })
      })
    })
    return () => {
      cancelled = true
      cancelIdle()
      stop?.()
    }
  }, [seed.live, store])

  useEffect(() => {
    let last = store.get().number
    return store.subscribe(() => {
      const head = store.get().number
      if (head - last < refreshBlocks) return
      last = head
      whenRuntime((runtime) => void runtime.refreshBlockQueries())
    })
  }, [store])

  return (
    <LiveContext.Provider
      value={{ store, market: data.market, config: seed.live, rpc: seed.rpc }}
    >
      {children}
    </LiveContext.Provider>
  )
}

export function useLive(): LiveValue {
  const value = useContext(LiveContext)
  if (value === null) throw new Error("useLive must be inside <LiveProvider>")
  return value
}

/** Chain time in unix seconds, moved forward by blocks since the market read. */
export function chainNow(market: Market, head: number): number {
  return (
    market.block.timestamp +
    Math.round(((head - market.block.number) * blockTimeMs) / 1000)
  )
}
