import { useEffect, useState } from "react"
import { type SearchHit, searchRemote } from "../data/search"
import { scanSearchKind } from "./scan-kind"

/**
 * The palette's remote step, debounced so a burst of typing is one
 * request: our labels, gauge names, epochs and locks
 * (`/internal/scan/search`), and Blockscout's quick search only when ours
 * has nothing. Numbers and hashes are named by their shape alone. A failed
 * or rate-limited search says so; it never blocks the shape results.
 */

export const searchDebounceMs = 250

export type RemoteSearch = {
  status: "idle" | "loading" | "ok" | "failed" | "limited"
  hits: SearchHit[]
}

const idle: RemoteSearch = { status: "idle", hits: [] }

export function useRemoteSearch(query: string): RemoteSearch {
  const [state, setState] = useState<RemoteSearch>(idle)
  const q = query.trim()
  const kind = scanSearchKind(q)
  useEffect(() => {
    if (kind === null) {
      setState(idle)
      return
    }
    let cancelled = false
    setState({ status: "loading", hits: [] })
    const timer = setTimeout(() => {
      void searchRemote({ data: { q, kind } })
        .then((result) => {
          if (!cancelled) setState({ status: result.status, hits: result.hits })
        })
        .catch(() => {
          if (!cancelled) setState({ status: "failed", hits: [] })
        })
    }, searchDebounceMs)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [q, kind])
  return state
}
