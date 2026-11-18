import {
  LeavingProvider,
  prefersReducedMotion,
  useLeaving,
} from "@matchbox/motion"
import { useHapticsSetting } from "@matchbox/motion/haptics"
import { TokenIcon } from "@matchbox/token-icons"
import * as Avatar from "@matchbox/ui/avatar"
import { Glyph, type GlyphShape, shapes } from "@matchbox/ui/icons"
import * as ListRow from "@matchbox/ui/list-row"
import * as SegmentedControl from "@matchbox/ui/segmented-control"
import * as Switch from "@matchbox/ui/switch"
import * as WalletDrawer from "@matchbox/ui/wallet-drawer"
import { Link } from "@tanstack/react-router"
import { Dialog } from "radix-ui"
import {
  lazy,
  type ReactNode,
  Suspense,
  useEffect,
  useRef,
  useState,
} from "react"
import { classicUrl } from "../classic-note/note-store"
import { ActivityRow } from "../components/activity-row"
import { Loading } from "../components/loading"
import { Usd } from "../components/money"
import { fetchLive } from "../data/live-query"
import type { OtherToken } from "../data/pro-api"
import { loadProApi, overviewQuery } from "../data/queries"
import type { Lock, Overview } from "../data/view-models"
import {
  addressAvatar,
  formatChange,
  formatDate,
  formatTokenWithSymbol,
  formatUsd,
  shortAddress,
} from "../lib/format"
import { useLive } from "../live/live-context"
import { readRpc, useSettings } from "../settings/settings-store"
import { toDecimal } from "../tx/amounts"
import { openTx } from "../tx/tx-store"
import { useWallet } from "../wallet/wallet-store"
import { openAppearance } from "./appearance-store"
import { readWalletTokens, type WalletToken } from "./balances"
import { arrowDownLeft, logOut, palette, shield } from "./glyphs"
import { useMezoId } from "./identity"
import { netWorth } from "./net-worth"
import { roundClass, useCopy, useLoad } from "./panel-parts"
import { networkLabel, signingLabel } from "./settings-drafts"
import { NetworkView, SigningView } from "./settings-views"

/**
 * The Account panel (frame `_fqER2WJvw`): a floating right drawer 440 wide
 * (a bottom sheet on phones) with identity, net worth, Send, Receive and New
 * lock, Tokens, Locks and Activity, Settings and Disconnect. Loaded on first
 * intent on the header's account button; Send and Receive load on intent
 * on their own buttons. Receive, Network and Signing are views inside the
 * drawer; Send is a transaction sheet over the page.
 */

export type AccountPanelProps = {
  address: string
  connected: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
}

type View = "main" | "receive" | "network" | "signing"

/**
 * Sub-views push in from the right and pop back from the left: the view
 * that goes slides and fades out (120ms, inert), then the next slides in.
 */
const viewMotion = {
  forward: {
    out: "pointer-events-none animate-[mbx-push-out_120ms_var(--ease-roll)_forwards]",
    in: "animate-[mbx-push-in_220ms_var(--ease-roll)]",
  },
  back: {
    out: "pointer-events-none animate-[mbx-back-out_120ms_var(--ease-roll)_forwards]",
    in: "animate-[mbx-back-in_220ms_var(--ease-roll)]",
  },
} as const

type Direction = keyof typeof viewMotion

function loadSend() {
  return import("./send-sheet")
}

function loadReceive() {
  return import("./receive-view")
}

const SendSheet = lazy(loadSend)
const ReceiveView = lazy(loadReceive)

const sendIntent = {
  onPointerEnter: loadSend,
  onFocus: loadSend,
  onTouchStart: loadSend,
} as const

const receiveIntent = {
  onPointerEnter: loadReceive,
  onFocus: loadReceive,
  onTouchStart: loadReceive,
} as const

export default function AccountPanel({
  address,
  connected,
  open,
  onOpenChange,
}: AccountPanelProps): ReactNode {
  const [view, setView] = useState<View>("main")
  const [going, setGoing] = useState<Direction | null>(null)
  const came = useRef<Direction | null>(null)
  const [sending, setSending] = useState(false)
  const [send, leaving] = useLeaving(sending && connected)
  const mezoId = useMezoId(address) ?? null

  useEffect(() => {
    if (!open) return
    came.current = null
    setView("main")
  }, [open])

  function go(next: View): void {
    const direction = next === "main" ? "back" : "forward"
    if (prefersReducedMotion()) {
      setView(next)
      return
    }
    setGoing(direction)
    setTimeout(() => {
      came.current = direction
      setView(next)
      setGoing(null)
    }, 120)
  }

  const back = (): void => go("main")

  return (
    <>
      <WalletDrawer.Root open={open} onOpenChange={onOpenChange}>
        <WalletDrawer.Content
          onEscapeKeyDown={(event) => {
            if (view === "main") return
            event.preventDefault()
            back()
          }}
        >
          <div
            key={view}
            data-mbx-motion=""
            className={`flex min-h-0 flex-1 flex-col ${going !== null ? viewMotion[going].out : came.current !== null ? viewMotion[came.current].in : ""}`}
          >
            {view === "main" ? (
              <MainView
                address={address}
                mezoId={mezoId}
                connected={connected}
                onView={go}
                onSend={() => {
                  onOpenChange(false)
                  setSending(true)
                }}
                onClose={() => onOpenChange(false)}
              />
            ) : null}
            {view === "receive" ? (
              <Suspense fallback={null}>
                <ReceiveView address={address} mezoId={mezoId} onBack={back} />
              </Suspense>
            ) : null}
            {view === "network" ? <NetworkView onBack={back} /> : null}
            {view === "signing" ? <SigningView onBack={back} /> : null}
          </div>
        </WalletDrawer.Content>
      </WalletDrawer.Root>
      {send === null ? null : (
        <Suspense fallback={null}>
          <LeavingProvider value={leaving}>
            <SendSheet onClose={() => setSending(false)} />
          </LeavingProvider>
        </Suspense>
      )}
    </>
  )
}

type Tab = "tokens" | "locks" | "activity"

/** The painted preset's name ("Graphite"), read when the panel opens. */
function useAppearanceLabel(): string {
  const [label, setLabel] = useState("")
  useEffect(() => {
    const preset = document.documentElement.getAttribute("data-theme") ?? ""
    setLabel(
      preset === "" ? "" : `${preset[0]?.toUpperCase()}${preset.slice(1)}`,
    )
  }, [])
  return label
}

function MainView({
  address,
  mezoId,
  connected,
  onView,
  onSend,
  onClose,
}: {
  address: string
  mezoId: string | null
  connected: boolean
  onView: (view: View) => void
  onSend: () => void
  onClose: () => void
}): ReactNode {
  const { market, rpc } = useLive()
  const settings = useSettings()
  const viewer = { kind: connected ? "connected" : "viewing", address }
  const [tab, setTab] = useState<Tab>("tokens")
  const { copied, copy } = useCopy()
  const avatar = addressAvatar(address)
  const appearance = useAppearanceLabel()
  const id = address.toLowerCase()
  const rpcUrl = readRpc(rpc)

  const overview = useLoad(`overview-${id}`, () =>
    fetchLive(overviewQuery(address)),
  )
  const tokens = useLoad(`tokens-${id}-${rpcUrl}`, () =>
    readWalletTokens({ rpcUrl, owner: address, prices: market.prices }),
  )

  // Registered tokens beyond those three, from the API. A failed read
  // leaves the list at the three.
  const others = useLoad(`others-${id}`, async () =>
    (await loadProApi()).getOtherTokens({ data: { address } }),
  )
  const otherTokens = others.data ?? []

  const worth =
    overview.data === null ||
    (tokens.data === null && !tokens.failed) ||
    (others.data === null && !others.failed)
      ? null
      : netWorth({
          walletUsd: [
            ...(tokens.data ?? []).map((token) => token.usd),
            ...otherTokens.map((token) => token.usd),
          ],
          locks: overview.data.locks,
          claimableUsd: overview.data.claimable.usd,
        })

  return (
    <>
      <header className="flex flex-none items-center gap-3.5 px-7 pt-7 max-sm:px-6 max-sm:pt-4">
        <Avatar.Root initials={avatar.initials} hue={avatar.hue} size={56} />
        <div className="min-w-0 flex-1">
          <Dialog.Title className="flex items-center gap-1.5 truncate text-[19px] font-[650] tracking-[-0.01em]">
            {mezoId ?? shortAddress(address)}
            {mezoId === null ? null : (
              <Glyph
                shape={shapes.keyRound}
                size={16}
                strokeWidth={1.75}
                className="flex-none text-sec"
              />
            )}
          </Dialog.Title>
          <button
            type="button"
            onClick={() => copy("address", address)}
            aria-label={`Copy address ${address}`}
            className="mt-0.5 flex cursor-pointer items-center gap-1.5 rounded-sm font-mono text-[13.5px] text-sec outline-none hover:text-ink focus-visible:outline-2 focus-visible:outline-ink"
          >
            {shortAddress(address)}
            <Glyph
              shape={copied === "address" ? shapes.check : shapes.copy}
              size={14}
              strokeWidth={1.9}
              className={copied === "address" ? "mbx-draw" : undefined}
            />
          </button>
        </div>
        <a
          href={`https://scan.matchbox.markets/address/${address}`}
          target="_blank"
          rel="noreferrer noopener"
          aria-label="View on Matchscan"
          className={roundClass}
        >
          <Glyph shape={shapes.arrowUpRight} size={18} strokeWidth={1.9} />
        </a>
        <Dialog.Close aria-label="Close" className={roundClass}>
          <Glyph shape={shapes.x} size={20} strokeWidth={1.8} />
        </Dialog.Close>
      </header>
      <WalletDrawer.Body className="mt-5">
        <section aria-label="Net worth">
          {overview.failed ? (
            <p className="text-[15px] text-sec">Net worth unavailable</p>
          ) : worth === null ? (
            <Loading
              id="account-worth"
              label="Loading net worth"
              sample={worthSample}
            />
          ) : (
            <Worth worth={worth} />
          )}
        </section>
        {connected ? (
          <ul className="mt-5 grid grid-cols-3 gap-2.5">
            <li>
              <Action
                label="Send"
                shape={shapes.arrowUpRight}
                onClick={onSend}
                intent={sendIntent}
              />
            </li>
            <li>
              <Action
                label="Receive"
                shape={arrowDownLeft}
                onClick={() => onView("receive")}
                intent={receiveIntent}
              />
            </li>
            <li>
              <Action
                label="New lock"
                shape={shapes.plus}
                onClick={() => {
                  onClose()
                  openTx(viewer, { flow: "new-lock", kind: "vebtc" })
                }}
              />
            </li>
          </ul>
        ) : null}
        <SegmentedControl.Root
          surface="sheet"
          size="sm"
          value={tab}
          aria-label="Holdings"
          className="mt-6"
          onValueChange={(value) =>
            setTab(
              value === "locks"
                ? "locks"
                : value === "activity"
                  ? "activity"
                  : "tokens",
            )
          }
        >
          <SegmentedControl.Item value="tokens">Tokens</SegmentedControl.Item>
          <SegmentedControl.Item value="locks">Locks</SegmentedControl.Item>
          <SegmentedControl.Item value="activity">
            Activity
          </SegmentedControl.Item>
        </SegmentedControl.Root>
        <div
          key={tab}
          data-mbx-motion=""
          className="mt-2 min-h-[136px] animate-[mbx-fade-in_200ms_ease-out]"
        >
          {tab === "tokens" ? (
            <Tokens
              tokens={tokens.data}
              others={otherTokens}
              failed={tokens.failed}
            />
          ) : null}
          {tab === "locks" ? (
            <Locks overview={overview.data} failed={overview.failed} />
          ) : null}
          {tab === "activity" ? (
            <Activity
              overview={overview.data}
              failed={overview.failed}
              onClose={onClose}
            />
          ) : null}
        </div>
        <Settings
          appearance={appearance}
          network={networkLabel(settings.network)}
          signing={signingLabel(settings.signing)}
          onAppearance={() => {
            onClose()
            openAppearance()
          }}
          onView={onView}
        />
      </WalletDrawer.Body>
      <AccountFooter
        address={address}
        connected={connected}
        onClose={onClose}
      />
    </>
  )
}

const worthSample: ReactNode = (
  <>
    <p className="text-[15px] text-sec">Net worth</p>
    <p className="mt-1 text-[40px] leading-tight font-[650]">$1,284.40</p>
    <p className="mt-1 text-[14.5px] text-sec">
      Wallet $412.10, locks $868.40, claimable $3.90
    </p>
  </>
)

function Worth({ worth }: { worth: ReturnType<typeof netWorth> }): ReactNode {
  return (
    <>
      <p className="text-[15px] text-sec">Net worth</p>
      <p className="mt-1 text-[40px] leading-tight font-[650] tracking-[-0.025em] tabular-nums">
        <Usd value={worth.total} style="cents" countUp="account-net-worth" />
      </p>
      <p className="mt-1 text-[14.5px] text-sec tabular-nums">
        Wallet{" "}
        <b className="font-semibold text-ink">
          {formatUsd(worth.wallet, "cents")}
        </b>
        , locks{" "}
        <b className="font-semibold text-ink">
          {formatUsd(worth.locks, "cents")}
        </b>
        , claimable{" "}
        <b className="font-semibold text-ink">
          {formatUsd(worth.claimable, "cents")}
        </b>
      </p>
    </>
  )
}

function Action({
  label,
  shape,
  onClick,
  intent,
}: {
  label: string
  shape: GlyphShape
  onClick: () => void
  intent?: {
    onPointerEnter: () => unknown
    onFocus: () => unknown
    onTouchStart: () => unknown
  }
}): ReactNode {
  return (
    <button
      type="button"
      onClick={onClick}
      {...intent}
      className="flex h-16 w-full cursor-pointer flex-col items-center justify-center gap-1 rounded-[18px] bg-soft text-[14.5px] font-semibold text-ink outline-none hover:bg-soft2 focus-visible:outline-2 focus-visible:outline-ink dark:bg-soft2"
    >
      <Glyph shape={shape} size={18} strokeWidth={1.9} />
      {label}
    </button>
  )
}

function Empty({ children }: { children: ReactNode }): ReactNode {
  return <p className="py-8 text-center text-[15px] text-sec">{children}</p>
}

const tokensSample: ReactNode = (
  <ListRow.List>
    {["Mezo USD", "Bitcoin"].map((name) => (
      <ListRow.Root key={name}>
        <ListRow.Icon />
        <ListRow.Text>
          <ListRow.Title>{name}</ListRow.Title>
          <ListRow.Subline>210.00 MUSD</ListRow.Subline>
        </ListRow.Text>
        <ListRow.Value>
          <ListRow.Main>$210.00</ListRow.Main>
          <ListRow.Sub>0.0%</ListRow.Sub>
        </ListRow.Value>
      </ListRow.Root>
    ))}
  </ListRow.List>
)

function Tokens({
  tokens,
  others,
  failed,
}: {
  tokens: WalletToken[] | null
  others: readonly OtherToken[]
  failed: boolean
}): ReactNode {
  if (failed) return <Empty>Balances unavailable</Empty>
  if (tokens === null)
    return (
      <Loading
        id="account-tokens"
        label="Loading tokens"
        sample={tokensSample}
      />
    )
  const held = tokens.filter((token) => token.balance > 0n)
  if (held.length === 0 && others.length === 0) return <Empty>No tokens</Empty>
  return (
    <ListRow.List>
      {held.map((token) => (
        <ListRow.Root key={token.symbol}>
          <TokenIcon ticker={token.symbol} size={40} />
          <ListRow.Text>
            <ListRow.Title>{token.name}</ListRow.Title>
            <ListRow.Subline>
              {formatTokenWithSymbol(
                toDecimal(token.balance, token.decimals),
                token.symbol,
              )}
            </ListRow.Subline>
          </ListRow.Text>
          <ListRow.Value>
            <ListRow.Main>
              {token.usd === null ? "" : formatUsd(token.usd, "cents")}
            </ListRow.Main>
            {token.changeBps === null ? null : (
              <ListRow.Sub
                className={
                  token.changeBps > 0
                    ? "text-pos"
                    : token.changeBps < 0
                      ? "text-neg"
                      : ""
                }
              >
                {token.changeBps === 0 ? "0.0%" : formatChange(token.changeBps)}
              </ListRow.Sub>
            )}
          </ListRow.Value>
        </ListRow.Root>
      ))}
      {others.map((token) => (
        <ListRow.Root key={token.address}>
          <TokenIcon ticker={token.symbol} size={40} />
          <ListRow.Text>
            <ListRow.Title>{token.name}</ListRow.Title>
            <ListRow.Subline>
              {formatTokenWithSymbol(token.amount, token.symbol)}
            </ListRow.Subline>
          </ListRow.Text>
          <ListRow.Value>
            <ListRow.Main>
              {token.usd === null ? "" : formatUsd(token.usd, "cents")}
            </ListRow.Main>
          </ListRow.Value>
        </ListRow.Root>
      ))}
    </ListRow.List>
  )
}

const escrowLabel = { vebtc: "veBTC", vemezo: "veMEZO" } as const

function lockSubline(lock: Lock): string {
  if (lock.expired) return "Lock expired"
  if (lock.unlocksAt === null) return "Auto max"
  return `Unlocks ${formatDate(lock.unlocksAt)}`
}

function Locks({
  overview,
  failed,
}: {
  overview: Overview | null
  failed: boolean
}): ReactNode {
  if (failed) return <Empty>Locks unavailable</Empty>
  if (overview === null)
    return (
      <Loading id="account-locks" label="Loading locks" sample={tokensSample} />
    )
  if (overview.locks.length === 0) return <Empty>No locks</Empty>
  return (
    <ListRow.List>
      {overview.locks.map((lock) => (
        <ListRow.Root key={`${lock.kind}-${lock.tokenId}`}>
          <TokenIcon
            ticker={lock.kind === "vebtc" ? "BTC" : "MEZO"}
            size={40}
          />
          <ListRow.Text>
            <ListRow.Title>
              {escrowLabel[lock.kind]} #{lock.tokenId}
            </ListRow.Title>
            <ListRow.Subline>{lockSubline(lock)}</ListRow.Subline>
          </ListRow.Text>
          <ListRow.Value>
            <ListRow.Main>{formatUsd(lock.usd, "cents")}</ListRow.Main>
            <ListRow.Sub>
              {formatTokenWithSymbol(
                lock.amount,
                lock.kind === "vebtc" ? "BTC" : "MEZO",
              )}
            </ListRow.Sub>
          </ListRow.Value>
        </ListRow.Root>
      ))}
    </ListRow.List>
  )
}

function Activity({
  overview,
  failed,
  onClose,
}: {
  overview: Overview | null
  failed: boolean
  onClose: () => void
}): ReactNode {
  if (failed) return <Empty>Activity unavailable</Empty>
  if (overview === null)
    return (
      <Loading
        id="account-activity"
        label="Loading activity"
        sample={tokensSample}
      />
    )
  if (overview.activity.length === 0) return <Empty>No activity</Empty>
  return (
    <>
      <ListRow.List>
        {overview.activity.slice(0, 5).map((event) => (
          <ActivityRow key={event.id} event={event} context="summary" />
        ))}
      </ListRow.List>
      <Link
        to="/activity"
        onClick={onClose}
        className="mt-1 inline-block text-[15px] font-semibold underline underline-offset-[3px] outline-none focus-visible:outline-2 focus-visible:outline-ink"
      >
        View activity
      </Link>
    </>
  )
}

const settingRowClass =
  "-mx-3 flex min-h-[52px] w-[calc(100%+24px)] cursor-pointer items-center gap-3.5 rounded-[16px] px-3 text-left outline-none hover:bg-soft focus-visible:bg-soft focus-visible:outline-2 focus-visible:outline-ink dark:hover:bg-soft2"

function SettingRow({
  shape,
  label,
  value,
  onClick,
}: {
  shape: GlyphShape
  label: string
  value: string
  onClick: () => void
}): ReactNode {
  return (
    <li>
      <button type="button" onClick={onClick} className={settingRowClass}>
        <Glyph
          shape={shape}
          size={20}
          strokeWidth={1.75}
          className="flex-none text-ink2"
        />
        <span className="text-base font-semibold">{label}</span>
        <span className="ml-auto text-[15px] text-sec">{value}</span>
        <Glyph
          shape={shapes.chevronRight}
          size={18}
          strokeWidth={1.9}
          className="flex-none text-sec"
        />
      </button>
    </li>
  )
}

function Settings({
  appearance,
  network,
  signing,
  onAppearance,
  onView,
}: {
  appearance: string
  network: string
  signing: string
  onAppearance: () => void
  onView: (view: View) => void
}): ReactNode {
  const [haptics, setHaptics] = useHapticsSetting()
  return (
    <section aria-labelledby="account-settings" className="mt-7">
      <h3
        id="account-settings"
        className="mb-1.5 text-[15px] font-[550] text-sec"
      >
        Settings
      </h3>
      <ul>
        <SettingRow
          shape={palette}
          label="Appearance"
          value={appearance}
          onClick={onAppearance}
        />
        <li className="-mx-3 flex min-h-[52px] items-center gap-3.5 px-3">
          <Glyph
            shape={shapes.smartphone}
            size={20}
            strokeWidth={1.75}
            className="flex-none text-ink2"
          />
          <label htmlFor="account-haptics" className="text-base font-semibold">
            Haptics
          </label>
          <Switch.Root
            id="account-haptics"
            className="ml-auto"
            checked={haptics}
            onCheckedChange={setHaptics}
          />
        </li>
        <SettingRow
          shape={shapes.globe}
          label="Network"
          value={network}
          onClick={() => onView("network")}
        />
        <SettingRow
          shape={shield}
          label="Signing"
          value={signing}
          onClick={() => onView("signing")}
        />
        <li>
          {/* The way back to Classic for phones and rail widths, which
              have no sidebar row for it. Same tab, like the sidebar's. */}
          <a href={classicUrl} className={settingRowClass}>
            <Glyph
              shape={shapes.arrowUpRight}
              size={20}
              strokeWidth={1.75}
              className="flex-none text-ink2"
            />
            <span className="text-base font-semibold">Matchbox Classic</span>
          </a>
        </li>
      </ul>
    </section>
  )
}

function AccountFooter({
  address,
  connected,
  onClose,
}: {
  address: string
  connected: boolean
  onClose: () => void
}): ReactNode {
  const wallet = useWallet()
  const own = wallet.account?.address
  const [name, setName] = useState<string | null>(null)

  useEffect(() => {
    if (!connected || wallet.phase !== "ready") return
    let live = true
    void import("../wallet/wallet-runtime").then((runtime) => {
      if (live) setName(runtime.connectedWalletName(runtime.requireConfig()))
    })
    return () => {
      live = false
    }
  }, [connected, wallet.phase])

  const footerClass =
    "flex flex-none items-center justify-between border-line border-t px-7 pt-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] max-sm:px-6"
  const actionClass =
    "flex cursor-pointer items-center gap-2 rounded-sm text-[15.5px] font-semibold text-neg outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"

  return (
    <footer className={footerClass}>
      {connected ? (
        <>
          <button
            type="button"
            className={actionClass}
            onClick={() => {
              onClose()
              void import("../wallet/wallet-runtime").then((runtime) =>
                runtime.disconnectWallet(runtime.requireConfig()),
              )
            }}
          >
            <Glyph shape={logOut} size={18} strokeWidth={1.9} />
            Disconnect
          </button>
          {name === null ? null : (
            <span className="text-[14px] text-sec">{name}</span>
          )}
        </>
      ) : (
        <Link
          to="."
          search={(previous) => ({ ...previous, address: own })}
          className={actionClass}
          onClick={onClose}
          aria-label={`Stop viewing ${shortAddress(address)}`}
        >
          <Glyph shape={shapes.x} size={18} strokeWidth={1.9} />
          Stop viewing
        </Link>
      )}
    </footer>
  )
}
