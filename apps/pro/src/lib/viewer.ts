import { useSearch } from "@tanstack/react-router"
import type { CalcSearch } from "../boost/calc-link"
import { isSavedSafe, useSettings } from "../settings/settings-store"
import { useWallet } from "../wallet/wallet-store"
import { isAddress } from "./format"
import { useOwnWallet } from "./own-wallet"

/**
 * Whose data the screens show. `?address=0x…` names the wallet; the root
 * route keeps it across navigation and the loaders read it. Connecting a
 * wallet sets it to the wallet (see `wallet-host`), so the screens show the
 * connected wallet with write actions. Any other address is read-only.
 */
export type Viewer =
  | { kind: "signed-out" }
  | { kind: "viewing"; address: string }
  | { kind: "connected"; address: string }

export type RootSearch = { address?: string | undefined } & CalcSearch

/**
 * The calculator's keys, passed through for the calculator to check when
 * it opens (`boost/calc-link` `calcFill`). Only this stays in the first
 * paint: a page that never opens the calculator does not load its rules.
 */
function calcKeys(search: Record<string, unknown>): CalcSearch {
  if (!("calc" in search) || search.calc === "0" || search.calc === false) {
    return {}
  }
  // As they came: a number stays a number, so the URL is not rewritten.
  const kept = (value: unknown): string | number | undefined =>
    typeof value === "string" || typeof value === "number" ? value : undefined
  const vebtc = kept(search.vebtc)
  const vemezo = kept(search.vemezo)
  const aim = kept(search.for)
  const solve = search.solve
  return {
    calc: 1,
    ...(vebtc === undefined ? {} : { vebtc }),
    ...(vemezo === undefined ? {} : { vemezo }),
    ...(aim === undefined ? {} : { for: aim }),
    ...(typeof solve === "string" ? { solve } : {}),
  }
}

export function validateRootSearch(
  search: Record<string, unknown>,
): RootSearch {
  return {
    ...(isAddress(search.address) ? { address: search.address } : {}),
    // The boost calculator opens over any page (see `boost/calc-link`).
    ...calcKeys(search),
  }
}

export function viewerFrom(
  search: RootSearch,
  wallet: string | null = null,
): Viewer {
  if (search.address === undefined) return { kind: "signed-out" }
  if (wallet !== null && wallet.toLowerCase() === search.address.toLowerCase())
    return { kind: "connected", address: search.address }
  return { kind: "viewing", address: search.address }
}

export function useViewer(): Viewer {
  const search = useSearch({ from: "__root__" })
  const wallet = useWallet()
  return viewerFrom(search, wallet.account?.address ?? null)
}

/**
 * Whether the wallet on screen is someone else's: a viewed address that
 * is not the connected wallet, not the wallet this browser connected last
 * (`own`, before it reconnects after a load) and not a Safe this browser
 * signs for. Such a page only reads: it offers no claim, vote or lock.
 */
export function viewsOther(
  viewer: Viewer,
  own: string | null,
  signsFor: (address: string) => boolean,
): boolean {
  if (viewer.kind !== "viewing") return false
  if (own !== null && own.toLowerCase() === viewer.address.toLowerCase()) {
    return false
  }
  return !signsFor(viewer.address)
}

/** The wallet this browser signs with, connected or about to reconnect. */
export function useOwnAddress(): string | null {
  const wallet = useWallet()
  const remembered = useOwnWallet()
  return wallet.account?.address ?? remembered
}

/**
 * True on someone else's wallet (see `viewsOther`). The server and the
 * hydrating page answer alike: the wallet has not reconnected yet, so both
 * go by the own-wallet cookie. The Safe saved in Signing is yours whether
 * or not its owner's wallet has connected: its actions go through `openTx`,
 * which waits for the reconnect or opens Connect wallet. The settings are
 * this browser's (the server renders the defaults, so the Safe's actions
 * appear right after hydration), and saving the Safe on its own page
 * brings them back at once.
 */
export function useViewingOther(): boolean {
  const viewer = useViewer()
  const own = useOwnAddress()
  const { signing } = useSettings()
  return viewsOther(viewer, own, (address) => isSavedSafe(signing, address))
}
