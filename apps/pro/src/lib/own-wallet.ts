import { createIsomorphicFn } from "@tanstack/react-start"
import { getRequestHeader } from "@tanstack/react-start/server"
import { useSyncExternalStore } from "react"
import { browserWalletContext, subscribeOwnWallet } from "./wallet-context"
import { ownFromCookie } from "./wallet-path"

/**
 * The wallet this browser connected last, from its first-party cookie: the
 * request's on the server, the document's in the browser. Both read the
 * same cookie, so the server and the hydrating page agree on it before the
 * wallet itself reconnects.
 */
export const ownWallet = createIsomorphicFn()
  .server((): string | null =>
    ownFromCookie(getRequestHeader("cookie") ?? null),
  )
  .client((): string | null => browserWalletContext().own)

/**
 * `ownWallet` as React state: a disconnect (which clears it after the
 * wallet goes) re-renders whatever showed it.
 */
export function useOwnWallet(): string | null {
  return useSyncExternalStore(subscribeOwnWallet, ownWallet, ownWallet)
}
