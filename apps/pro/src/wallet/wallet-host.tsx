import * as PillButton from "@matchbox/ui/pill-button"
import * as WalletDrawer from "@matchbox/ui/wallet-drawer"
import { useNavigate, useSearch } from "@tanstack/react-router"
import type { Config } from "@wagmi/core"
import { type ReactNode, useEffect, useRef, useState } from "react"
import { browserWalletContext, setOwnWallet } from "../lib/wallet-context"
import { useLive } from "../live/live-context"
import { getSettings, isSavedSafe } from "../settings/settings-store"
import { ConnectDrawer } from "./connect-drawer"
import followsAccount from "./follow-account"
import { walletConfig } from "./wallet-runtime"
import { getWallet, setWallet, useWallet } from "./wallet-store"

/**
 * The wallet code's load: a chunk that failed (a tab left open across a
 * deploy) is tried again when Connect wallet opens the drawer.
 */
type Load = "loading" | "failed" | "retrying" | "retry-failed"

/**
 * Mounted at the root once wallet code is asked for (`loadWallet`). Creates
 * the wagmi config, keeps the connected wallet in the URL (plain paths for
 * your own wallet, see lib/wallet-path) and renders
 * the drawer. Connecting from the drawer switches the screens to the
 * wallet, except on the Safe saved in Signing (its owner signs as the
 * Safe there); a reconnect on load keeps an address someone chose to view.
 */
export default function WalletHost(): ReactNode {
  const { rpc } = useLive()
  const [config, setConfig] = useState<Config | null>(null)
  const [load, setLoad] = useState<Load>("loading")
  const [tries, setTries] = useState(0)
  const wallet = useWallet()
  const search = useSearch({ from: "__root__" })
  const navigate = useNavigate()
  const previous = useRef<string | null>(null)
  const chose = useRef(false)

  useEffect(() => {
    let live = true
    walletConfig(rpc).then(
      (created) => {
        if (live) setConfig(created)
      },
      () => {
        if (!live) return
        setLoad(tries === 0 ? "failed" : "retry-failed")
        // The screens stop waiting for a wallet: the header offers Connect
        // wallet, and a click waiting for the reconnect opens the drawer.
        if (getWallet().phase !== "ready") setWallet({ phase: "ready" })
      },
    )
    return () => {
      live = false
    }
  }, [rpc, tries])

  function retry(): void {
    setLoad("retrying")
    setTries((count) => count + 1)
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: tries again when the drawer opens
  useEffect(() => {
    if (wallet.drawerOpen && (load === "failed" || load === "retry-failed")) {
      retry()
    }
  }, [wallet.drawerOpen])

  const address = wallet.account?.address ?? null
  // biome-ignore lint/correctness/useExhaustiveDependencies: follows the account only
  useEffect(() => {
    const before = previous.current
    previous.current = address
    if (address === before) return
    const showing = search.address?.toLowerCase() ?? null
    const userChose = chose.current
    chose.current = false
    const remembered = browserWalletContext().own
    // Your wallet uses plain paths: set it before the URL is written.
    setOwnWallet(address)
    if (address !== null) {
      if (
        followsAccount({
          address,
          showing,
          before,
          remembered,
          chose: userChose,
          savedSafe:
            showing !== null && isSavedSafe(getSettings().signing, showing),
        })
      ) {
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

  const onOpenChange = (open: boolean): void => setWallet({ drawerOpen: open })
  if (config === null) {
    if (load === "loading") return null
    return (
      <WalletDrawer.Root open={wallet.drawerOpen} onOpenChange={onOpenChange}>
        <WalletDrawer.Content>
          <WalletDrawer.Header>Connect wallet</WalletDrawer.Header>
          <WalletDrawer.Body className="pb-6">
            <p
              aria-live="polite"
              className="py-10 text-center text-[15px] text-sec"
            >
              {load === "retry-failed"
                ? "Wallets did not load. Check your connection and try again."
                : "Loading wallets"}
            </p>
            <PillButton.Root
              size="lg"
              pending={load !== "retry-failed"}
              onClick={retry}
              className="w-full"
            >
              Try again
            </PillButton.Root>
          </WalletDrawer.Body>
        </WalletDrawer.Content>
      </WalletDrawer.Root>
    )
  }
  return (
    <ConnectDrawer
      config={config}
      open={wallet.drawerOpen}
      onOpenChange={onOpenChange}
      onConnecting={() => {
        chose.current = true
      }}
    />
  )
}
