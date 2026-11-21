import {
  decodeNames,
  ownFromCookie,
  ownWalletCookie,
  type WalletContext,
} from "./wallet-path"

/**
 * The browser's side of clean wallet URLs: the connected wallet (also kept
 * in a first-party cookie, so the server renders your plain paths as your
 * wallet) and the Mezo IDs the server resolved for this page (a meta tag
 * the Worker writes). The router's rewrite reads `walletContext()`.
 */

export const walletNamesMeta = "mbx-wallet-names"
export const walletNamesHeader = "x-mbx-wallet-names"

/**
 * Set by the Worker when a Mezo ID link's lookup failed (Mezo's API or
 * ours down): the not found page then says to try again.
 */
export const walletLookupMeta = "mbx-wallet-lookup"
export const walletLookupHeader = "x-mbx-wallet-lookup"

/** The path whose lookup the Worker said failed; undefined until read. */
let lookupFailedAt: string | null | undefined

/**
 * Whether the Worker said the wallet lookup for `pathname` failed. The
 * meta tag sits outside the router's head management, so it would outlive
 * the page: it is read once, for the page the document loaded (the first
 * not found page rendered), then removed. Any other path is not it.
 */
export function browserWalletLookupFailed(pathname: string): boolean {
  if (lookupFailedAt === undefined) {
    const meta = document.querySelector<HTMLMetaElement>(
      `meta[name="${walletLookupMeta}"]`,
    )
    lookupFailedAt =
      meta?.getAttribute("content") === "unavailable" ? pathname : null
    meta?.remove()
  }
  return lookupFailedAt !== null && lookupFailedAt === pathname
}

/** Test helper. */
export function resetWalletLookup(): void {
  lookupFailedAt = undefined
}

let own: string | null | undefined
let names: Map<string, string> | undefined
const ownListeners = new Set<() => void>()

/** Told when the own wallet changes (see `useOwnWallet`). */
export function subscribeOwnWallet(listener: () => void): () => void {
  ownListeners.add(listener)
  return () => ownListeners.delete(listener)
}

function readMeta(): string | null {
  return (
    document
      .querySelector<HTMLMetaElement>(`meta[name="${walletNamesMeta}"]`)
      ?.getAttribute("content") ?? null
  )
}

export function browserWalletContext(): WalletContext {
  if (own === undefined) {
    try {
      own = ownFromCookie(document.cookie)
    } catch {
      own = null
    }
  }
  names ??= decodeNames(readMeta())
  return { own, names }
}

/** Called when a wallet connects or disconnects, before the URL changes. */
export function setOwnWallet(address: string | null): void {
  own = address?.toLowerCase() ?? null
  try {
    document.cookie =
      own === null
        ? `${ownWalletCookie}=; Path=/; Max-Age=0; SameSite=Lax`
        : `${ownWalletCookie}=${own}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`
  } catch {
    // Plain paths still work for this tab.
  }
  for (const listener of ownListeners) listener()
}

/** Remembers a Mezo ID learned later (a lookup), for clean links to it. */
export function learnWalletName(name: string, address: string): void {
  const context = browserWalletContext()
  const map = context.names as Map<string, string>
  map.set(name.toLowerCase(), address.toLowerCase())
  map.set(address.toLowerCase(), name.toLowerCase())
}
