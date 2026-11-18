import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react"
import { getWalletPanels } from "../../data/address"
import type { Section } from "../../data/explorer"
import type { StreakView, WalletView } from "../../data/wallet-views"

/**
 * A lock owner's rewards, veMEZO votes and streak, read after the page has
 * rendered: the API may read the wallet's claimable and locks from the
 * chain (seconds, cold), and the page never waits for it. The server
 * renders placeholders in their places (the address is known to own
 * locks from its document), the browser reads the panels once and every
 * part under the address page shares them.
 *
 * The answer is kept with its address, so moving to another owner's page
 * shows placeholders, never the last wallet's figures. A failed read is
 * tried once more after a few seconds, then waits for "Retry".
 */

export type WalletPanels =
  /** An address that never held a lock: no wallet parts at all. */
  | { status: "none" }
  | { status: "loading" }
  | {
      status: "done"
      wallet: Section<WalletView>
      streak: Section<StreakView>
      /** Reads the panels again; null while the read is fine. */
      retry: (() => void) | null
    }

type Read = {
  address: string
  wallet: Section<WalletView>
  streak: Section<StreakView>
}

const unavailable = { status: "unavailable" } as const

/** How long the one automatic retry waits. */
export const retryAfterMs = 3_000

function failed(read: Read): boolean {
  return read.wallet.status !== "ok" || read.streak.status !== "ok"
}

async function readPanels(address: string): Promise<Read> {
  try {
    return { address, ...(await getWalletPanels({ data: { address } })) }
  } catch {
    return { address, wallet: unavailable, streak: unavailable }
  }
}

export function useWalletPanels(address: string, owner: boolean): WalletPanels {
  const [read, setRead] = useState<Read | null>(null)
  // Bumped by Retry: reads again with no automatic retry after it.
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (!owner) return
    let live = true
    let timer: ReturnType<typeof setTimeout> | undefined
    readPanels(address).then((first) => {
      if (!live) return
      setRead(first)
      if (!failed(first) || attempt > 0) return
      timer = setTimeout(() => {
        readPanels(address).then((second) => {
          if (live) setRead(second)
        })
      }, retryAfterMs)
    })
    return () => {
      live = false
      if (timer !== undefined) clearTimeout(timer)
    }
  }, [address, owner, attempt])
  const retry = useCallback(() => {
    setRead(null)
    setAttempt((count) => count + 1)
  }, [])
  if (!owner) return { status: "none" }
  // Another address's answer is never shown: this one is still loading.
  if (read === null || read.address !== address) return { status: "loading" }
  return {
    status: "done",
    wallet: read.wallet,
    streak: read.streak,
    retry: failed(read) ? retry : null,
  }
}

const WalletPanelsContext = createContext<WalletPanels>({ status: "none" })

export const WalletPanelsProvider = WalletPanelsContext.Provider

export function useAddressWallet(): WalletPanels {
  return useContext(WalletPanelsContext)
}
