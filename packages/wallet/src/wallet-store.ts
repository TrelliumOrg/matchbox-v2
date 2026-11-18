import { useSyncExternalStore } from "react"

/**
 * The wallet as the screens see it, without wagmi. This module is in the
 * first paint, so it stays tiny: wagmi, viem and the connectors load with
 * `./wallet-host` on first intent (hover, focus or tap of Connect), or when
 * the page is idle for a wallet that connected before.
 *
 * Copied from Pro without its transaction sheets: an app that signs keeps
 * its own sheet state beside this store.
 */

export type WalletAccount = { address: string; chainId: number }

export type WalletSnapshot = {
  /** "idle" until wallet code is asked for. */
  phase: "idle" | "loading" | "ready"
  account: WalletAccount | null
  drawerOpen: boolean
}

const initial: WalletSnapshot = {
  phase: "idle",
  account: null,
  drawerOpen: false,
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

let host: Promise<typeof import("./wallet-host")> | null = null

/** Starts loading the wallet code. Safe to call on every hover. */
export function loadWallet(): Promise<typeof import("./wallet-host")> {
  host ??= import("./wallet-host")
  if (snapshot.phase === "idle") setWallet({ phase: "loading" })
  return host
}

export function openWallet(): void {
  setWallet({ drawerOpen: true })
  void loadWallet()
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

function warmWallet(): void {
  void loadWallet()
}

/** Pointer, focus and touch handlers that start loading on intent. */
export const walletIntent = {
  onPointerEnter: warmWallet,
  onFocus: warmWallet,
  onTouchStart: warmWallet,
} as const

/** Test helper. */
export function resetWallet(): void {
  snapshot = initial
  host = null
}
