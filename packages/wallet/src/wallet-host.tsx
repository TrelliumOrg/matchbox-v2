import type { Config } from "@wagmi/core"
import { type ReactNode, useEffect, useRef, useState } from "react"
import { ConnectDrawer } from "./connect-drawer"
import { type WalletOptions, walletConfig } from "./wallet-runtime"
import { setWallet, useWallet } from "./wallet-store"

/**
 * Mounted at the root once wallet code is asked for (`loadWallet`). Creates
 * the wagmi config and renders the drawer. `onAccount` hears every account
 * change, with whether the person picked the wallet in the drawer (Pro keeps
 * the connected wallet in the URL from it); a reconnect on load is not a
 * choice.
 */

export type AccountChange = {
  address: string | null
  before: string | null
  /** True when the change came from a connection started in the drawer. */
  chose: boolean
}

export type WalletHostProps = {
  rpc: string
  options: WalletOptions
  onAccount?: (change: AccountChange) => void
  /** Rows after the drawer's wallet list. */
  drawerFoot?: ReactNode
}

export default function WalletHost({
  rpc,
  options,
  onAccount,
  drawerFoot,
}: WalletHostProps): ReactNode {
  const [config, setConfig] = useState<Config | null>(null)
  const wallet = useWallet()
  const previous = useRef<string | null>(null)
  const chose = useRef(false)

  // biome-ignore lint/correctness/useExhaustiveDependencies: the config is created once per tab
  useEffect(() => {
    let live = true
    void walletConfig(rpc, options).then((created) => {
      if (live) setConfig(created)
    })
    return () => {
      live = false
    }
  }, [rpc])

  const address = wallet.account?.address ?? null
  // biome-ignore lint/correctness/useExhaustiveDependencies: follows the account only
  useEffect(() => {
    const before = previous.current
    previous.current = address
    if (address === before) return
    const userChose = chose.current
    chose.current = false
    onAccount?.({ address, before, chose: userChose })
  }, [address])

  if (config === null) return null
  return (
    <ConnectDrawer
      config={config}
      open={wallet.drawerOpen}
      onOpenChange={(open) => setWallet({ drawerOpen: open })}
      onConnecting={() => {
        chose.current = true
      }}
      foot={drawerFoot}
    />
  )
}
