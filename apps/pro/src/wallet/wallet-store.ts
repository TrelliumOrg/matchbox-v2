import { useSyncExternalStore } from "react"
import { browserWalletContext } from "../lib/wallet-context"
import { insideFrame } from "../safe/frame"
import { getSettings, isSavedSafe } from "../settings/settings-store"
import type { TxRequest } from "../tx/tx-store"

/**
 * The wallet as the screens see it, without wagmi. This module is in the
 * first paint, so it stays tiny: wagmi, viem and the connectors load with
 * `./wallet-host` on first intent (hover, focus or tap of Connect), or when
 * the page is idle for a wallet that connected before.
 */

export type WalletAccount = { address: string; chainId: number }

export type WalletSnapshot = {
  /** "idle" until wallet code is asked for. */
  phase: "idle" | "loading" | "ready"
  account: WalletAccount | null
  drawerOpen: boolean
  /** The open transaction sheet, for the wallet that asked. */
  tx: { request: TxRequest; owner: string } | null
}

const initial: WalletSnapshot = {
  phase: "idle",
  account: null,
  drawerOpen: false,
  tx: null,
}

let snapshot = initial
const listeners = new Set<() => void>()

export function getWallet(): WalletSnapshot {
  return snapshot
}

export function setWallet(next: Partial<WalletSnapshot>): void {
  snapshot = { ...snapshot, ...next }
  for (const listener of listeners) listener()
}

export function subscribeWallet(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useWallet(): WalletSnapshot {
  return useSyncExternalStore(subscribeWallet, getWallet, () => initial)
}

/**
 * Whether the wallet has had its chance to reconnect: wagmi is ready, or
 * this browser never connected one (no reconnect flag, no own-wallet
 * cookie), so wallet code is never asked for on load and the phase stays
 * "idle". The server and the hydrating page cannot see the flag and say
 * no, so the header hydrates as the server rendered it and settles right
 * after.
 */
export function useWalletSettled(): boolean {
  return useSyncExternalStore(subscribeWallet, walletSettled, () => false)
}

function walletSettled(): boolean {
  if (snapshot.phase === "ready") return true
  // Inside Safe{Wallet} the Safe connects on load (see WalletMount).
  return (
    snapshot.phase === "idle" &&
    !remembered() &&
    browserWalletContext().own === null &&
    !insideFrame()
  )
}

export function useTx(): WalletSnapshot["tx"] {
  return useWallet().tx
}

let host: Promise<typeof import("./wallet-host")> | null = null
let txHost: Promise<typeof import("../tx/tx-host")> | null = null

/** Starts loading the wallet code. Safe to call on every hover. */
export function loadWallet(): Promise<typeof import("./wallet-host")> {
  host ??= import("./wallet-host")
  if (snapshot.phase === "idle") setWallet({ phase: "loading" })
  return host
}

/** Loads the sheets and the wallet together. Safe to call on every hover. */
export function loadTx(): Promise<typeof import("../tx/tx-host")> {
  void loadWallet()
  txHost ??= import("../tx/tx-host")
  return txHost
}

export function openWallet(): void {
  setWallet({ drawerOpen: true })
  void loadWallet()
}

/**
 * Opens a sheet for the connected wallet. A wallet this browser connected
 * before may still be reconnecting; the sheets' host waits for it. Without
 * a wallet the drawer opens instead, and the sheet once a wallet that
 * signs for the page connects there. Someone else's address is read-only.
 */
export function openTx(
  viewer: { kind: string; address?: string },
  request: TxRequest,
): void {
  const owner = viewer.address
  if (
    (viewer.kind === "connected" || viewingOwnSafe(owner)) &&
    owner !== undefined
  ) {
    void loadTx()
    setWallet({ tx: { request, owner } })
  } else if (owner === undefined) {
    openWallet()
  } else if (!remembered()) {
    // The drawer opens at once; the sheet follows once a wallet connects.
    openWallet()
    void loadTx().then((host) => {
      if (getWallet().drawerOpen) host.openAfterConnect(owner, request)
    })
  } else {
    void loadTx().then((host) => host.openAfterReconnect(owner, request))
  }
}

/**
 * Multisig mode: the Safe saved in Signing, viewed while one of its owners
 * is connected, signs through the Safe (the sheet proposes to it).
 */
export function viewingOwnSafe(address: string | undefined): boolean {
  return (
    address !== undefined &&
    snapshot.account !== null &&
    isSavedSafe(getSettings().signing, address)
  )
}

export function closeTx(): void {
  setWallet({ tx: null })
}

/** Set by the runtime after a connection, cleared on disconnect. */
export const connectedFlag = "mbx-wallet"

function remembered(): boolean {
  try {
    return window.localStorage.getItem(connectedFlag) !== null
  } catch {
    return false
  }
}

/** Loads the wallet once the page is idle if this browser connected before. */
export function reconnectIfRemembered(): void {
  if (remembered()) void loadWallet()
}

/**
 * Pointer, focus and touch handlers that start loading on intent: the
 * wallet, and the sheets a connected wallet signs with next.
 */
export const walletIntent = {
  onPointerEnter: loadTx,
  onFocus: loadTx,
  onTouchStart: loadTx,
} as const

export const txIntent = walletIntent
