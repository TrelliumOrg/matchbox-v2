import { whenIdle } from "@matchbox/motion"
import { lazy, type ReactNode, Suspense, useEffect } from "react"
import { insideFrame } from "../safe/frame"
import {
  loadTx,
  loadWallet,
  reconnectIfRemembered,
  useWallet,
} from "./wallet-store"

const WalletHost = lazy(() => loadWallet())
const TxHost = lazy(() => loadTx())

/** Renders the wallet and transaction hosts once wallet code is asked for. */
export function WalletMount(): ReactNode {
  const wallet = useWallet()
  useEffect(() => {
    // Inside Safe{Wallet} the Safe is the wallet: connect at once.
    if (insideFrame()) {
      void loadWallet()
      return
    }
    return whenIdle(reconnectIfRemembered)
  }, [])
  if (wallet.phase === "idle") return null
  return (
    <Suspense fallback={null}>
      <WalletHost />
      <TxHost />
    </Suspense>
  )
}
