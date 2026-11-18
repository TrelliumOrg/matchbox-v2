import {
  createContext,
  type MouseEvent,
  type ReactNode,
  useContext,
} from "react"
import type { ClarificationCardId, WalletMode } from "./contract"
import type { StuartSigner } from "./store"

/**
 * What the host page lends the panel: navigation, the signer, the endpoint
 * and the wallet. Internal to the panel tree, which provides it itself.
 */

export type PanelWallet = {
  address: string
  mode: WalletMode
  label?: string
}

export type AskOptions = {
  clarification?: { cardId: ClarificationCardId; optionId: string }
  // Sent in place of the shown question: the earlier request a card's pick
  // answers (a pasted vote script), so the server can re-run it whole.
  query?: string
}

/** Pro's Signing setting: Multisig makes "Export for Safe" the primary. */
export type PanelSigning =
  | { mode: "wallet" }
  | { mode: "multisig"; safe: string | null }

export type PanelHost = {
  endpoint: string | null
  wallet: PanelWallet | null
  signer: StuartSigner | null
  navigate: (to: string) => void
  hrefFor: (to: string) => string
  scanUrl: string
  ask: (question: string, options?: AskOptions) => void
  busy: boolean
  signing: PanelSigning
}

const HostContext = createContext<PanelHost | null>(null)

export const HostProvider = HostContext.Provider

export function useHost(): PanelHost {
  const host = useContext(HostContext)
  if (host === null) throw new Error("Stuart blocks render inside the panel")
  return host
}

function isPlainClick(event: MouseEvent<HTMLAnchorElement>): boolean {
  return (
    event.button === 0 &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey
  )
}

/** An in-app link: a real href, client navigation on a plain click. */
export function EntityLink({
  to,
  className,
  children,
}: {
  to: string
  className?: string
  children: ReactNode
}): ReactNode {
  const host = useHost()
  return (
    <a
      href={host.hrefFor(to)}
      className={className}
      onClick={(event) => {
        if (!isPlainClick(event)) return
        event.preventDefault()
        host.navigate(to)
      }}
    >
      {children}
    </a>
  )
}

EntityLink.displayName = "Stuart.EntityLink"

/** Only same-app paths are navigable from an answer. */
export function isAppPath(to: string): boolean {
  return /^\/(?!\/)[\w\-/.~%]*$/.test(to)
}
