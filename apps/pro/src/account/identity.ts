import { whenIdle } from "@matchbox/motion"
import { useEffect, useState } from "react"
import { fetchLive, whenRuntime } from "../data/live-query"
import type { Identity, IdentityLookup } from "../data/pro-api"
import { identityQuery, loadProApi } from "../data/queries"

/**
 * Mezo IDs for the header, the Account panel and the transfer sheets while
 * someone types. In the first paint, so it stays tiny: the lookup runs once
 * the page is idle, and found and not found answers are kept for the tab
 * (an ID's answer under the ID and its wallet; an address's answer under
 * the address only, never under the ID Mezo gave it). An unavailable
 * lookup is never kept: the next one asks again.
 *
 * What a transfer sends to is never read from here: `freshMezoIdWallet`
 * asks past every cache at review, and what it learns replaces what this
 * tab and the query client held for that ID.
 */

export type { Identity, IdentityLookup }

const known = new Map<string, Identity | null>()
const unavailable: IdentityLookup = { status: "unavailable" }
const addressKey = /^0x[0-9a-f]{40}$/

function remember(key: string, lookup: IdentityLookup): void {
  if (lookup.status === "unavailable") return
  if (lookup.status === "not-found") {
    known.set(key, null)
    return
  }
  const identity = lookup.identity
  known.set(key, identity)
  // An ID's answer also names its wallet (the API checked it is the ID's
  // own). An address's answer is kept under the address alone.
  if (!addressKey.test(key)) known.set(identity.address.toLowerCase(), identity)
}

/**
 * A fresh answer for `id` replaces what was held for it: here, entries
 * that named the ID for another wallet are dropped, and the query client's
 * entries follow (once its runtime is up; loading it is not forced).
 */
function learnFresh(id: string, lookup: IdentityLookup): void {
  if (lookup.status === "unavailable") return
  const now =
    lookup.status === "found" ? lookup.identity.address.toLowerCase() : null
  const stale: string[] = []
  for (const [key, identity] of known) {
    if (identity?.mezoId === id && identity.address.toLowerCase() !== now) {
      known.delete(key)
      stale.push(key)
    }
  }
  remember(id, lookup)
  whenRuntime((runtime) => {
    runtime.client.setQueryData(["identity", id], lookup)
    for (const key of stale) {
      if (key !== id)
        runtime.client.removeQueries({ queryKey: ["identity", key] })
    }
  })
}

/** Looks up an address or Mezo ID for display: found, not found or unavailable. */
export async function lookupIdentity(key: string): Promise<IdentityLookup> {
  const id = key.trim().toLowerCase()
  if (known.has(id)) {
    const identity = known.get(id) ?? null
    return identity === null
      ? { status: "not-found" }
      : { status: "found", identity }
  }
  try {
    const lookup = await fetchLive(identityQuery(id))
    remember(id, lookup)
    return lookup
  } catch {
    return unavailable
  }
}

/**
 * A Mezo ID's wallet as Mezo answers it now: the API's fresh read, no
 * cache on the way (not the API's, the query client's or this tab's).
 */
export async function freshMezoIdWallet(id: string): Promise<IdentityLookup> {
  let lookup: IdentityLookup
  try {
    lookup = await (await loadProApi()).getFreshIdentity({ data: { id } })
  } catch {
    return unavailable
  }
  learnFresh(id.trim().toLowerCase(), lookup)
  return lookup
}

/**
 * The Mezo ID for `address`: undefined until known (the server and the
 * first client render), then the ID or null.
 */
export function useMezoId(address: string): string | null | undefined {
  const id = address.toLowerCase()
  const [state, setState] = useState<{
    id: string
    mezoId: string | null | undefined
  }>({ id, mezoId: undefined })

  useEffect(() => {
    let live = true
    const settle = (lookup: IdentityLookup): void => {
      if (live) {
        setState({
          id,
          mezoId: lookup.status === "found" ? lookup.identity.mezoId : null,
        })
      }
    }
    if (known.has(id)) {
      const identity = known.get(id) ?? null
      settle(
        identity === null
          ? { status: "not-found" }
          : { status: "found", identity },
      )
      return () => {
        live = false
      }
    }
    const cancel = whenIdle(() => void lookupIdentity(id).then(settle))
    return () => {
      live = false
      cancel()
    }
  }, [id])

  return state.id === id ? state.mezoId : undefined
}

/** Test helper. */
export function resetIdentities(): void {
  known.clear()
}
