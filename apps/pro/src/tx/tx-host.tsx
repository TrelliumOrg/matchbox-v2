import { LeavingProvider, useLeaving } from "@matchbox/motion"
import type { Config } from "@wagmi/core"
import { type ReactNode, useEffect, useMemo } from "react"
import { getAddress } from "viem"
import { reconnectLimitMs } from "../wallet/reconnect-limit"
import { loadedConfig } from "../wallet/wallet-runtime"
import {
  getWallet,
  openWallet,
  setWallet,
  subscribeWallet,
  useWallet,
  viewingOwnSafe,
} from "../wallet/wallet-store"
import { ClaimSheet } from "./flows/claim-sheet"
import { IncentivesSheet } from "./flows/incentives-sheet"
import {
  AddSheet,
  ExtendSheet,
  MergeSheet,
  NewLockSheet,
  WithdrawSheet,
} from "./flows/lock-sheets"
import { TransferSheet } from "./flows/transfer-sheet"
import { VoteSheet } from "./flows/vote-sheet"
import { Toasts } from "./toasts"

export { claimRequest } from "./claim-request"

/**
 * Opens a sheet once a remembered wallet has reconnected, if it is the
 * wallet the screens show; otherwise the drawer opens, keeping the request.
 * A reconnect that never settles (a wallet that does not answer, wallet
 * code that did not load) opens the drawer after `reconnectLimitMs`: the
 * click is never dropped.
 */
export function openAfterReconnect(owner: string, request: TxRequest): void {
  let timer: ReturnType<typeof setTimeout> | undefined
  let done = false
  const settle = (waited: boolean): void => {
    if (done) return
    const wallet = getWallet()
    if (wallet.phase !== "ready" && !waited) return
    done = true
    stop()
    clearTimeout(timer)
    if (signsFor(owner)) setWallet({ tx: { request, owner } })
    else openAfterConnect(owner, request)
  }
  const stop = subscribeWallet(() => settle(false))
  timer = setTimeout(() => settle(true), reconnectLimitMs)
  settle(false)
}

/**
 * Opens the drawer and, once a wallet connects from it, the sheet the
 * click asked for: the owner's own wallet, or an owner of the Safe saved
 * in Signing, whose sheet signs as the Safe. Another wallet, or closing
 * the drawer without connecting, drops it.
 */
export function openAfterConnect(owner: string, request: TxRequest): void {
  openWallet()
  const start = getWallet().account?.address ?? null
  let done = false
  const settle = (): void => {
    if (done) return
    const wallet = getWallet()
    const address = wallet.account?.address ?? null
    const connected = address !== null && address !== start
    if (!connected && wallet.drawerOpen) return
    done = true
    stop()
    if (connected && signsFor(owner)) setWallet({ tx: { request, owner } })
  }
  const stop = subscribeWallet(settle)
  settle()
}

/** The connected wallet signs for `owner`: it is the owner, or its Safe. */
function signsFor(owner: string): boolean {
  const account = getWallet().account
  return (
    account?.address.toLowerCase() === owner.toLowerCase() ||
    viewingOwnSafe(owner)
  )
}

import { closeTx, type TxRequest, useTx } from "./tx-store"

/**
 * The open transaction sheet and the toasts. Loaded on first intent with
 * the wallet; a sheet waits until wagmi is ready and closes if the wallet
 * changes under it.
 */

function FlowSheet({
  request,
  config,
  account,
}: {
  request: TxRequest
  config: Config
  account: `0x${string}`
}): ReactNode {
  const shared = { config, account }
  switch (request.flow) {
    case "vote":
      return <VoteSheet {...shared} request={request} />
    case "claim":
      return <ClaimSheet {...shared} request={request} />
    case "new-lock":
      return <NewLockSheet {...shared} request={request} />
    case "add":
      return <AddSheet {...shared} request={request} />
    case "extend":
      return <ExtendSheet {...shared} request={request} />
    case "merge":
      return <MergeSheet {...shared} request={request} />
    case "withdraw":
      return <WithdrawSheet {...shared} request={request} />
    case "transfer":
      return <TransferSheet {...shared} request={request} />
    case "incentives":
      return <IncentivesSheet {...shared} request={request} />
  }
}

export default function TxHost(): ReactNode {
  const tx = useTx()
  const request = tx?.request ?? null
  const owner = tx?.owner ?? null
  const wallet = useWallet()
  // Null until wagmi is ready, and after its code failed to load.
  const config = wallet.phase === "ready" ? loadedConfig() : null
  const address = wallet.account?.address ?? null

  // In Multisig mode an owner viewing the saved Safe signs as the Safe.
  const asSafe = owner !== null && address !== null && viewingOwnSafe(owner)
  // A closed sheet stays mounted while it slides out.
  const open = useMemo(
    () =>
      request !== null && config !== null && address !== null
        ? {
            request,
            config,
            account: getAddress(asSafe && owner !== null ? owner : address),
          }
        : null,
    [request, config, address, asSafe, owner],
  )
  const [shown, leaving] = useLeaving(open)

  useEffect(() => {
    if (request === null || owner === null) return
    if (address === null) closeTx()
    else if (!asSafe && address.toLowerCase() !== owner.toLowerCase()) {
      closeTx()
    }
  }, [request, owner, address, asSafe])

  return (
    <>
      {shown === null ? null : (
        <LeavingProvider value={leaving}>
          <FlowSheet
            key={JSON.stringify(shown.request, (_key, value: unknown) =>
              typeof value === "bigint" ? value.toString() : value,
            )}
            request={shown.request}
            config={shown.config}
            account={shown.account}
          />
        </LeavingProvider>
      )}
      <Toasts />
    </>
  )
}
