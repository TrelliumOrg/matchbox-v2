import type { Config } from "@wagmi/core"
import { type ReactNode, useEffect, useState } from "react"
import { ConnectDrawer } from "./connect-drawer"
import { walletConfig } from "./wallet-runtime"
import { setWallet, useWallet } from "./wallet-store"

export { isFresh, prepareSignIn, signIn } from "./siwe"
export { switchTo, walletConfig } from "./wallet-runtime"

/**
 * Mounted once wallet code is asked for (`loadWallet`): creates the wagmi
 * config and renders the drawer. Everything wagmi, viem and the connectors
 * need is in this lazily loaded chunk.
 */
export default function WalletHost(): ReactNode {
  const [config, setConfig] = useState<Config | null>(null)
  const wallet = useWallet()

  useEffect(() => {
    let live = true
    void walletConfig().then((created) => {
      if (live) setConfig(created)
    })
    return () => {
      live = false
    }
  }, [])

  if (config === null) return null
  return (
    <ConnectDrawer
      config={config}
      open={wallet.drawerOpen}
      onOpenChange={(open) => setWallet({ drawerOpen: open })}
    />
  )
}
