import { canonicalBtcAddress } from "@matchbox/domain/btc-address"
import { shortAddress, shortHash } from "@matchbox/domain/format"
import { shapes } from "@matchbox/ui/icons"
import { getRouteApi, useRouter } from "@tanstack/react-router"
import { type ReactNode, useEffect, useState } from "react"
import { canonicalAddress, canonicalHash } from "../data/canonical"
import { EntityPage } from "./entity"

/**
 * Not found (`vF29nhdD8n`) for a transaction or an address. Loaded only
 * when shown (`lazyRouteComponent`), so address pages do not preload it;
 * the transaction page does, for the re-read hook below.
 */

/**
 * How long a valid hash nobody has seen waits for the network: a
 * transaction a wallet has just sent reaches the RPC within seconds, and
 * the page re-reads meanwhile (it opens on the transaction once it is
 * seen). Past this, it is not found.
 */
const waitForNetworkMs = 60_000

/**
 * Not found (`vF29nhdD8n`): a valid hash neither the explorer nor the
 * chain has. Waiting for the network first, re-reading, since a hash
 * from a moment ago may not have reached them yet.
 */
export function TransactionNotFound(): ReactNode {
  const { hash } = getRouteApi("/tx/$hash").useParams()
  const valid = canonicalHash(hash)
  const gaveUp = useRefreshWhile(
    `wait:${valid}`,
    valid !== null,
    waitForNetworkMs,
  )
  const waiting = valid !== null && !gaveUp
  const checks = [
    {
      label: "Format",
      value:
        valid === null ? "Not a transaction hash" : "Valid transaction hash",
      detail: "0x + 64 hex",
      passed: valid !== null,
    },
    {
      label: "Network",
      value: waiting ? "Not seen yet" : "Not seen",
      detail: "Mezo RPC",
      passed: false,
    },
    {
      label: "Explorer",
      value: waiting ? "Not found yet" : "Not found",
      detail: "Blockscout",
      passed: false,
    },
  ]
  if (valid === null) {
    return (
      <EntityPage
        icon={shapes.arrowRight}
        title="Transaction"
        kind="Transaction hash"
        crumbs={[{ label: "Transactions", to: "/network/transactions" }]}
        current={hash.slice(0, 20)}
        checks={checks.filter((check) => check.label !== "Network")}
      />
    )
  }
  return (
    <EntityPage
      icon={shapes.arrowRight}
      title="Transaction"
      kind="Transaction hash"
      heading={waiting ? "Waiting for the network" : "Not found"}
      crumbs={[{ label: "Transactions", to: "/network/transactions" }]}
      current={shortHash(valid)}
      value={{ text: valid, kind: "hash" }}
      checks={checks}
    />
  )
}

/**
 * Not found: an address Blockscout has never seen, or a Bitcoin address
 * with no EVM address to go to. The loader says why (`data`): `none` is no
 * Mezo account for it; anything else is Mezo's API out.
 */
export function AddressNotFound({ data }: { data?: unknown }): ReactNode {
  const { address } = getRouteApi("/address/$address").useParams()
  const btc = canonicalBtcAddress(address)
  if (btc !== null) {
    const none = data === "none"
    return (
      <EntityPage
        icon={shapes.wallet}
        title="Address"
        kind="Bitcoin address"
        heading={none ? "No Mezo account" : "Mezo unavailable"}
        crumbs={[{ label: "Transactions", to: "/network/transactions" }]}
        current={`${btc.slice(0, 8)}…${btc.slice(-6)}`}
        value={{ text: btc, kind: "address" }}
        checks={[
          {
            label: "Format",
            value: "Bitcoin address",
            detail: "Mainnet",
            passed: true,
          },
          {
            label: "Mezo account",
            value: none ? "None" : "Unavailable",
            detail: "Mezo",
            passed: false,
          },
        ]}
      />
    )
  }
  const valid = canonicalAddress(address)
  return (
    <EntityPage
      icon={shapes.wallet}
      title="Address"
      kind="Address"
      crumbs={[{ label: "Transactions", to: "/network/transactions" }]}
      current={valid === null ? address.slice(0, 20) : shortAddress(valid)}
      checks={[
        {
          label: "Format",
          value: valid === null ? "Not an address" : "Valid address",
          detail: "0x + 40 hex",
          passed: valid !== null,
        },
        {
          label: "Explorer",
          value: "Not found",
          detail: "Blockscout",
          passed: false,
        },
      ]}
    />
  )
}

// -- re-reading a page on its way in ---------------------------------------
//
// Here rather than in a module of its own: only the transaction page and
// its not-found view use it, and a chunk of its own would put its name in
// every route's preload map (the framework chunk), which every route pays.

/** Waits between re-reads: sooner at first, then less often. */
const delays = [
  2_000, 3_000, 4_000, 5_000, 8_000, 10_000, 15_000, 20_000, 30_000,
]

/**
 * How long each wait has waited (visible time only) and how many re-reads
 * it has made, by key. Kept outside the component: a re-read can mount the
 * page (or its not-found view) afresh, and the wait must carry on, not
 * start over. One that ran out starts again when its page is shown anew.
 */
const sessions = new Map<string, { waited: number; attempt: number }>()

/**
 * Re-reads the transaction route's data while `active`, sooner at first
 * and then less often (a block is about 3.8 s): a transaction on its way
 * into our data upgrades in place, without a reload, and the shell's data
 * is not read again. Paused while the tab is hidden, and the wait does not
 * run down meanwhile. True once the wait under `key` has lasted `forMs`,
 * and it stops.
 */
export function useRefreshWhile(
  key: string,
  active: boolean,
  forMs: number,
): boolean {
  const router = useRouter()
  const [expired, setExpired] = useState<string | null>(null)
  useEffect(() => {
    if (!active) return
    let session = sessions.get(key)
    if (session === undefined || session.waited >= forMs) {
      session = { waited: 0, attempt: 0 }
      sessions.set(key, session)
    }
    const wait = session
    let timer: ReturnType<typeof setTimeout> | undefined
    let stopped = false
    const next = (): void => {
      if (stopped) return
      if (wait.waited >= forMs) {
        setExpired(key)
        return
      }
      const delay = delays[Math.min(wait.attempt, delays.length - 1)] ?? 0
      timer = setTimeout(() => {
        if (document.visibilityState === "hidden") return next()
        wait.attempt += 1
        wait.waited += delay
        router
          .invalidate({ filter: (match) => match.routeId === "/tx/$hash" })
          .finally(next)
      }, delay)
    }
    next()
    return () => {
      stopped = true
      clearTimeout(timer)
    }
  }, [active, key, forMs, router])
  return expired === key
}
