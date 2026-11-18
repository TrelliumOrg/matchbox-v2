import { canonicalBtcAddress } from "@matchbox/domain/btc-address"
import { mezoIdFromQuery } from "@matchbox/domain/mezo-id"
import { useEffect, useState } from "react"
import { findMezoId, type MezoIdMatch } from "../data/mezo-id"
import { scanSearchKind } from "./scan-kind"
import { searchDebounceMs } from "./use-remote-search"

/**
 * The palette's Mezo ID step, beside the name search and on the same
 * debounce: "alice.mezo", or a bare name read as one ("alice"), to the
 * ID's wallets, and a mainnet Bitcoin address to the EVM address Mezo
 * links with it. One exact lookup per settled query, cached by the API.
 * Quiet: a miss and a failure both end as no match, except a Bitcoin
 * address with no Mezo account (a match with no wallets).
 */

export type MezoIdSearch = {
  status: "idle" | "loading" | "done"
  match: MezoIdMatch | null
}

const idle: MezoIdSearch = { status: "idle", match: null }

/**
 * The key a query asks for: a Bitcoin address, or an ID among the queries
 * the name search reads. Null for anything else.
 */
export function mezoIdQuery(query: string): string | null {
  const q = query.trim()
  const btc = canonicalBtcAddress(q)
  if (btc !== null) return btc
  return scanSearchKind(q) === "name" ? mezoIdFromQuery(q) : null
}

export function useMezoIdSearch(query: string): MezoIdSearch {
  const [state, setState] = useState<MezoIdSearch>(idle)
  const id = mezoIdQuery(query)
  useEffect(() => {
    if (id === null) {
      setState(idle)
      return
    }
    let cancelled = false
    setState({ status: "loading", match: null })
    const timer = setTimeout(() => {
      void findMezoId({ data: { q: id } })
        .then((match) => {
          if (!cancelled) setState({ status: "done", match })
        })
        .catch(() => {
          if (!cancelled) setState({ status: "done", match: null })
        })
    }, searchDebounceMs)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [id])
  return state
}
