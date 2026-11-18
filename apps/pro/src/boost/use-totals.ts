import { useEffect, useState } from "react"
import {
  type BoostTotalsRead,
  lastBoostTotals,
  readBoostTotals,
  refreshSeconds,
  rememberBoostTotals,
} from "./totals"

export type TotalsState = {
  /** The latest good read of this visit; null before the first. */
  read: BoostTotalsRead | null
  /** The last attempt failed: `read`, if any, is older than it looks. */
  failed: boolean
  retry: () => void
}

/**
 * The chain's totals while something showing them is open: read at once,
 * then every minute. A failure keeps the last good totals of this visit,
 * to be named by their block; it never invents any.
 */
export function useBoostTotals(open: boolean, rpcUrl: string): TotalsState {
  const [state, setState] = useState<{
    read: BoostTotalsRead | null
    failed: boolean
  }>(() => ({ read: lastBoostTotals(), failed: false }))
  const [attempt, setAttempt] = useState(0)
  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` reruns the read on Try again
  useEffect(() => {
    if (!open) return
    let live = true
    const read = () =>
      readBoostTotals(rpcUrl).then(
        (totals) => {
          rememberBoostTotals(totals)
          if (live) setState({ read: totals, failed: false })
        },
        () => {
          if (live) setState({ read: lastBoostTotals(), failed: true })
        },
      )
    void read()
    const timer = window.setInterval(() => void read(), refreshSeconds * 1000)
    return () => {
      live = false
      window.clearInterval(timer)
    }
  }, [open, rpcUrl, attempt])
  return { ...state, retry: () => setAttempt((count) => count + 1) }
}
