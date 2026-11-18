import * as PillButton from "@matchbox/ui/pill-button"
import * as WalletDrawer from "@matchbox/ui/wallet-drawer"
import type { Config } from "@wagmi/core"
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react"
import { chainName } from "../lib/network"
import {
  connectWallet,
  recentWallets,
  switchTo,
  walletConnectors,
  watchWalletConnectors,
} from "./wallet-runtime"
import { getWallet, useWallet } from "./wallet-store"
import {
  connectError,
  groupWallets,
  type WalletConnector,
  type WalletEntry,
} from "./wallets"

/** wagmi reconnected this wallet while the picker was open. */
function alreadyConnected(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    Reflect.get(error, "name") === "ConnectorAlreadyConnectedError"
  )
}

type View =
  | { kind: "list" }
  | { kind: "connecting"; wallet: WalletEntry; error: string | null }

const legal = {
  terms: "https://mezo.org/legal/terms",
  privacy: "https://matchbox.markets/privacy#matchbox-id",
} as const

export type ConnectDrawerProps = {
  config: Config
  open: boolean
  onOpenChange: (open: boolean) => void
}

/** The wallet picker, connecting ring and network switch (Pro's drawer). */
export function ConnectDrawer({
  config,
  open,
  onOpenChange,
}: ConnectDrawerProps): ReactNode {
  const wallet = useWallet()
  const [connectors, setConnectors] = useState<WalletConnector[]>(() =>
    walletConnectors(config),
  )
  const [view, setView] = useState<View>({ kind: "list" })
  // Which way the body last moved: the connecting view pushes in from the
  // right, going back slides the list in from the left. Null on open.
  const [moved, setMoved] = useState<"forward" | "back" | null>(null)
  const [switching, setSwitching] = useState<string | null>(null)
  // A late answer from an abandoned attempt is ignored.
  const attempt = useRef(0)

  useEffect(() => watchWalletConnectors(config, setConnectors), [config])

  const groups = useMemo(
    () =>
      groupWallets(connectors, open ? recentWallets() : [], {
        injectedProvider: typeof window !== "undefined" && "ethereum" in window,
      }),
    [connectors, open],
  )

  const target = wallet.targetChainId === 31611 ? 31611 : 31612
  const wrongChain =
    wallet.account !== null && wallet.account.chainId !== target

  function back(): void {
    attempt.current += 1
    setMoved("back")
    setView({ kind: "list" })
  }

  // Closing abandons an attempt but keeps the view while the drawer slides
  // out; the list comes back on the next open, however it opens.
  function changeOpen(next: boolean): void {
    onOpenChange(next)
    if (!next) attempt.current += 1
  }

  useEffect(() => {
    if (!open) return
    setMoved(null)
    setView({ kind: "list" })
  }, [open])

  async function pick(entry: WalletEntry): Promise<void> {
    if (!entry.installed || entry.connectorUid === null) {
      if (entry.downloadUrl !== null) {
        window.open(entry.downloadUrl, "_blank", "noopener,noreferrer")
      }
      return
    }
    attempt.current += 1
    const run = attempt.current
    setMoved("forward")
    setView({ kind: "connecting", wallet: entry, error: null })
    try {
      await connectWallet(config, entry.connectorUid, target)
      if (attempt.current === run) changeOpen(false)
    } catch (error) {
      if (attempt.current !== run) return
      if (alreadyConnected(error) && getWallet().account !== null) {
        changeOpen(false)
        return
      }
      setView({ kind: "connecting", wallet: entry, error: connectError(error) })
    }
  }

  async function switchChain(): Promise<void> {
    setSwitching("Confirm in your wallet")
    try {
      await switchTo(config, target)
      setSwitching(null)
      changeOpen(false)
    } catch (error) {
      setSwitching(connectError(error))
    }
  }

  const empty =
    groups.recent.length === 0 &&
    groups.detected.length === 0 &&
    groups.more.length === 0 &&
    groups.walletConnect === null

  function row(entry: WalletEntry, primary: boolean): ReactNode {
    return (
      <WalletDrawer.Row
        key={entry.key}
        name={entry.name}
        icon={entry.icon}
        detail={entry.detail}
        tone={entry.detail === "Installed" ? "positive" : "default"}
        action={entry.installed ? (primary ? "primary" : "secondary") : "get"}
        onSelect={() => void pick(entry)}
      />
    )
  }

  return (
    <WalletDrawer.Root open={open} onOpenChange={changeOpen}>
      <WalletDrawer.Content
        onEscapeKeyDown={(event) => {
          if (view.kind !== "connecting") return
          event.preventDefault()
          back()
        }}
      >
        <WalletDrawer.Header
          onBack={view.kind === "connecting" ? back : undefined}
        >
          {wrongChain && view.kind === "list"
            ? "Switch network"
            : "Connect wallet"}
        </WalletDrawer.Header>
        <WalletDrawer.Body
          key={view.kind}
          data-mbx-motion=""
          className={
            moved === "forward"
              ? "animate-[mbx-push-in_220ms_var(--ease-roll)]"
              : moved === "back"
                ? "animate-[mbx-back-in_220ms_var(--ease-roll)]"
                : undefined
          }
        >
          {wrongChain && view.kind === "list" ? (
            <div className="pt-2">
              <PillButton.Root
                size="lg"
                pending={switching === "Confirm in your wallet"}
                onClick={() => void switchChain()}
              >
                {switching ?? `Switch to ${chainName(target)}`}
              </PillButton.Root>
            </div>
          ) : view.kind === "connecting" ? (
            <WalletDrawer.Connecting
              name={view.wallet.name}
              icon={view.wallet.icon}
              error={view.error}
              onCancel={back}
              onRetry={() => void pick(view.wallet)}
            />
          ) : empty ? (
            <p className="py-10 text-center text-[15px] text-sec">
              No wallets found
            </p>
          ) : (
            <>
              {groups.recent.length > 0 ? (
                <WalletDrawer.Group label="Recent">
                  {groups.recent.map((entry) => row(entry, true))}
                </WalletDrawer.Group>
              ) : null}
              {groups.detected.length > 0 ? (
                <WalletDrawer.Group label="Detected">
                  {groups.detected.map((entry) =>
                    row(entry, groups.recent.length === 0),
                  )}
                </WalletDrawer.Group>
              ) : null}
              {groups.more.length > 0 ? (
                <WalletDrawer.Group label="More wallets">
                  {groups.more.map((entry) => row(entry, false))}
                </WalletDrawer.Group>
              ) : null}
              {groups.walletConnect === null ? null : (
                <WalletDrawer.Group label="WalletConnect">
                  {row(groups.walletConnect, false)}
                </WalletDrawer.Group>
              )}
            </>
          )}
        </WalletDrawer.Body>
        <WalletDrawer.Footer>
          By connecting you agree to the{" "}
          <a
            href={legal.terms}
            target="_blank"
            rel="noreferrer noopener"
            className="font-semibold text-ink underline underline-offset-[3px]"
          >
            Terms
          </a>{" "}
          and{" "}
          <a
            href={legal.privacy}
            target="_blank"
            rel="noreferrer noopener"
            className="font-semibold text-ink underline underline-offset-[3px]"
          >
            Privacy Policy
          </a>
        </WalletDrawer.Footer>
      </WalletDrawer.Content>
    </WalletDrawer.Root>
  )
}
