import { useSyncExternalStore } from "react"

/**
 * The wallet as the sign-in page sees it, without wagmi. This module is in
 * the first paint, so it stays tiny: wagmi, viem and the connectors load
 * with `./wallet-host` on first intent (hover, focus or tap of Connect), or
 * when the page is idle for a wallet that connected before. Same pattern as
 * Pro's `wallet/wallet-store.ts`.
 */

export type WalletAccount = {
  address: `0x${string}`
  chainId: number
  /** "MetaMask"; null when the connector does not say. */
  walletName: string | null
}

export type WalletSnapshot = {
  phase: "idle" | "loading" | "ready"
  account: WalletAccount | null
  drawerOpen: boolean
  /** The chain the sign-in message must name (Mezo unless `?chain=`). */
  targetChainId: number
}

const initial: WalletSnapshot = {
  phase: "idle",
  account: null,
  drawerOpen: false,
  targetChainId: 31612,
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

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useWallet(): WalletSnapshot {
  return useSyncExternalStore(subscribe, getWallet, () => initial)
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
export const connectedFlag = "mbx-id-wallet"

export function rememberedWallet(): boolean {
  try {
    return window.localStorage.getItem(connectedFlag) !== null
  } catch {
    return false
  }
}

/** Pointer, focus and touch handlers that start loading on intent. */
export const walletIntent = {
  onPointerEnter: loadWallet,
  onFocus: loadWallet,
  onTouchStart: loadWallet,
} as const
