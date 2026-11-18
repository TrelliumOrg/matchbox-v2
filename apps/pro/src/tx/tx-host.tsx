import { LeavingProvider, useLeaving } from "@matchbox/motion"
import type { Config } from "@wagmi/core"
import { type ReactNode, useEffect, useMemo, useState } from "react"
import { getAddress } from "viem"
import { requireConfig } from "../wallet/wallet-runtime"
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
 * wallet the screens show; otherwise the drawer opens.
 */
export function openAfterReconnect(owner: string, request: TxRequest): void {
  const settle = (): boolean => {
    const wallet = getWallet()
    if (wallet.phase !== "ready") return false
    stop()
    if (
      wallet.account?.address.toLowerCase() === owner.toLowerCase() ||
      viewingOwnSafe(owner)
    ) {
      setWallet({ tx: { request, owner } })
    } else {
      openWallet()
    }
    return true
  }
  const stop = subscribeWallet(() => void settle())
  settle()
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
  const [config, setConfig] = useState<Config | null>(null)
  const address = wallet.account?.address ?? null

  useEffect(() => {
    if (wallet.phase === "ready") setConfig(requireConfig())
  }, [wallet.phase])

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
