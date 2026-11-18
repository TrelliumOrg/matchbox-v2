import {
  registerSearchCommands,
  type SearchCommand,
} from "@matchbox/stuart-ui/commands"
import { useEffect } from "react"
import { fetchLive } from "../data/live-query"
import { overviewQuery } from "../data/queries"
import type { Lock } from "../data/view-models"
import { formatTokenWithSymbol } from "../lib/format"
import { useViewer } from "../lib/viewer"

/**
 * The viewed wallet's locks in the search box: typing "lock", "vemezo" or
 * a lock's number lists them under "Locks". A lock has no page of its own,
 * so a row goes to that wallet's Overview, where its card is. Both search
 * boxes call the hook; the query cache makes it one read.
 */

const escrow = {
  vebtc: { label: "veBTC", symbol: "BTC" },
  vemezo: { label: "veMEZO", symbol: "MEZO" },
} as const

export function lockCommands(
  locks: readonly Lock[],
  address: string,
): SearchCommand[] {
  return locks.map((lock) => ({
    id: `lock-${lock.kind}-${lock.tokenId}`,
    label: `${escrow[lock.kind].label} #${lock.tokenId}`,
    hint: `${formatTokenWithSymbol(lock.amount, escrow[lock.kind].symbol)} locked`,
    keywords: ["lock", "locks", lock.tokenId],
    // The wallet whose lock it is: a bare "/" would open the connected
    // wallet's Overview, where a viewed wallet's lock is not shown.
    to: `/?address=${address.toLowerCase()}`,
    group: "Locks",
  }))
}

/**
 * Keeps the "Locks" group on the wallet being viewed. Called from the
 * search box's own code, which loads after first paint, so this read is
 * never on it. A failed read leaves the group empty.
 */
export function useLockCommands(): void {
  const viewer = useViewer()
  const address = viewer.kind === "signed-out" ? null : viewer.address
  useEffect(() => {
    registerSearchCommands([], "locks")
    if (address === null) return
    let current = true
    fetchLive(overviewQuery(address))
      .then((overview) => {
        if (current) {
          registerSearchCommands(lockCommands(overview.locks, address), "locks")
        }
      })
      .catch(() => undefined)
    return () => {
      current = false
    }
  }, [address])
}
