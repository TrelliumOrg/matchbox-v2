import { useNavigate, useSearch } from "@tanstack/react-router"
import type { Config } from "@wagmi/core"
import { type ReactNode, useEffect, useRef, useState } from "react"
import { setOwnWallet } from "../lib/wallet-context"
import { useLive } from "../live/live-context"
import { ConnectDrawer } from "./connect-drawer"
import { walletConfig } from "./wallet-runtime"
import { setWallet, useWallet } from "./wallet-store"

/**
 * Mounted at the root once wallet code is asked for (`loadWallet`). Creates
 * the wagmi config, keeps the connected wallet in the URL (plain paths for
 * your own wallet, see lib/wallet-path) and renders
 * the drawer. Connecting from the drawer always switches the screens to the
 * wallet; a reconnect on load keeps an address someone chose to view.
 */
export default function WalletHost(): ReactNode {
  const { rpc } = useLive()
  const [config, setConfig] = useState<Config | null>(null)
  const wallet = useWallet()
  const search = useSearch({ from: "__root__" })
  const navigate = useNavigate()
  const previous = useRef<string | null>(null)
  const chose = useRef(false)

  useEffect(() => {
    let live = true
    void walletConfig(rpc).then((created) => {
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
    const showing = search.address?.toLowerCase() ?? null
    const userChose = chose.current
    chose.current = false
    // Your wallet uses plain paths: set it before the URL is written.
    setOwnWallet(address)
    if (address !== null) {
      const follow =
        userChose ||
        showing === null ||
        (before !== null && showing === before.toLowerCase())
      if (follow && showing !== address.toLowerCase()) {
        void navigate({
          to: ".",
          search: (current) => ({ ...current, address }),
          replace: true,
        })
      }
      return
    }
    if (before !== null && showing === before.toLowerCase()) {
      void navigate({
        to: ".",
        search: (current) => ({ ...current, address: undefined }),
        replace: true,
      })
    }
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
    />
  )
}
