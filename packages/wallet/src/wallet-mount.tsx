import { whenIdle } from "@matchbox/motion"
import { lazy, type ReactNode, Suspense, useEffect } from "react"
import type { AccountChange } from "./wallet-host"
import type { WalletOptions } from "./wallet-runtime"
import { loadWallet, reconnectIfRemembered, useWallet } from "./wallet-store"

const WalletHost = lazy(() => loadWallet())

export type WalletMountProps = {
  /** The RPC the wallet reads through. */
  rpc: string
  options: WalletOptions
  onAccount?: (change: AccountChange) => void
  /** Load at once instead of on idle (Pro inside Safe{Wallet}). */
  eager?: boolean
}

/**
 * Renders the wallet host once wallet code is asked for. Until then this,
 * the store and nothing else from the package is in the page: wagmi, viem,
 * the connectors and the drawer load with the host, and WalletConnect loads
 * after them.
 */
export function WalletMount({
  rpc,
  options,
  onAccount,
  eager = false,
}: WalletMountProps): ReactNode {
  const wallet = useWallet()
  useEffect(() => {
    if (eager) {
      void loadWallet()
      return
    }
    return whenIdle(reconnectIfRemembered)
  }, [eager])
  if (wallet.phase === "idle") return null
  return (
    <Suspense fallback={null}>
      <WalletHost
        rpc={rpc}
        options={options}
        {...(onAccount === undefined ? {} : { onAccount })}
      />
    </Suspense>
  )
}
