import { whenIdle } from "@matchbox/motion"
import * as Avatar from "@matchbox/ui/avatar"
import { Glyph, shapes } from "@matchbox/ui/icons"
import { ProShort } from "@matchbox/ui/lockup-short"
import * as PillButton from "@matchbox/ui/pill-button"
import * as PriceSlot from "@matchbox/ui/price-slot"
import { Link } from "@tanstack/react-router"
import { lazy, type ReactNode, Suspense, useEffect, useState } from "react"
import { useMezoId } from "../account/identity"
import type { Price } from "../data/view-models"
import {
  addressAvatar,
  formatChange,
  formatDuration,
  formatPrice,
  shortAddress,
} from "../lib/format"
import { useIsPhone } from "../lib/phone"
import {
  useOwnAddress,
  useViewer,
  useViewingOther,
  type Viewer,
} from "../lib/viewer"
import { useHead } from "../live/heads"
import { chainNow, useLive } from "../live/live-context"
import { StuartSearchButton } from "../stuart/search-button"
import {
  openWallet,
  useWallet,
  useWalletSettled,
  walletIntent,
} from "../wallet/wallet-store"

function slotPrice(price: Price | null): PriceSlot.Price | null {
  if (price === null) return null
  return {
    price: formatPrice(price.usd),
    change:
      price.change24hBps === null ? null : formatChange(price.change24hBps),
    trend: (price.change24hBps ?? 0) < 0 ? "down" : "up",
  }
}

const LazyTicker = lazy(() =>
  import("./live-ticker").then((module) => ({
    default: module.LiveBlockTicker,
  })),
)

/**
 * Phones show the block row inside the price popover (no corner ticker).
 * `phoneHidden`: a phone gives the room to someone else's wallet.
 */
function LivePriceSlot({
  phoneHidden = false,
}: {
  phoneHidden?: boolean
}): ReactNode {
  const { store, market } = useLive()
  const phone = useIsPhone()
  const head = useHead(store)
  const remaining = market.epoch.endsAt - chainNow(market, head.number)
  return (
    <PriceSlot.Root
      mezo={slotPrice(market.prices.mezo)}
      btc={slotPrice(market.prices.btc)}
      epoch={{
        label: `Epoch ${market.epoch.number}`,
        remaining: formatDuration(remaining),
      }}
      compact={phone}
      // Phones never size the slot by the epoch, from the first paint.
      epochClassName="max-md:hidden"
      // Phones: the slot gives way (clips) before the header overflows.
      className="max-md:min-w-0 max-md:flex-initial max-md:px-1.5"
      // The popover's wrapper is the header's flex item.
      {...(phoneHidden ? { rootClassName: "max-md:hidden" } : {})}
      {...(phone
        ? {
            block: (
              <Suspense fallback={null}>
                <LazyTicker />
              </Suspense>
            ),
          }
        : {})}
    />
  )
}

function loadAccountPanel() {
  return import("../account/account-panel")
}

const AccountPanel = lazy(loadAccountPanel)

/**
 * The account button: avatar, then the Mezo ID over the short address. Both
 * lines are always laid out at a fixed width (the address in the second),
 * so the Mezo ID arriving after hydration moves nothing: without one the
 * address is centred by a transform. The panel loads on intent.
 */
function Account({
  address,
  connected,
  viewing = false,
}: {
  address: string
  connected: boolean
  /** Someone else's wallet: reads as viewing, beside Connect wallet. */
  viewing?: boolean
}): ReactNode {
  const [open, setOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  // Fetched on idle as well as on intent, so the panel opens on the click
  // instead of a chunk load later (a fast click after hover waited ~300ms).
  useEffect(() => whenIdle(() => void loadAccountPanel()), [])
  const mezoId = useMezoId(address) ?? null
  const avatar = addressAvatar(address)
  return (
    <>
      <button
        type="button"
        aria-label={`${viewing ? "Viewing" : "Account"} ${mezoId ?? shortAddress(address)}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onPointerEnter={loadAccountPanel}
        onFocus={loadAccountPanel}
        onTouchStart={loadAccountPanel}
        onClick={() => {
          setMounted(true)
          setOpen(true)
        }}
        data-tap=""
        className={
          viewing
            ? "flex h-10 flex-none cursor-pointer items-center gap-1.5 rounded-[20px] pr-1 pl-2.5 text-ink outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink md:gap-2.5 md:pr-0 md:pl-1"
            : "flex h-10 cursor-pointer items-center gap-2.5 rounded-[20px] text-ink outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
        }
      >
        {viewing ? (
          <Glyph
            shape={shapes.eye}
            size={16}
            strokeWidth={2}
            className="flex-none text-sec md:hidden"
          />
        ) : null}
        <Avatar.Root
          initials={avatar.initials}
          hue={avatar.hue}
          size={viewing ? 32 : 40}
        />
        {viewing ? (
          <span className="hidden w-[7.25rem] flex-col text-left md:flex">
            <span className="text-[13.5px] leading-5 text-sec">Viewing</span>
            <span className="truncate text-[15px] leading-5 font-semibold tabular-nums">
              {mezoId ?? shortAddress(address)}
            </span>
          </span>
        ) : (
          <span className="hidden w-[7.25rem] flex-col text-left md:flex">
            <span
              className={`truncate text-[15px] leading-5 font-semibold transition-opacity duration-200 motion-reduce:transition-none ${mezoId === null ? "opacity-0" : "opacity-100"}`}
            >
              {mezoId ?? " "}
            </span>
            <span
              className={`truncate leading-5 tabular-nums transition-transform duration-200 ease-roll motion-reduce:transition-none ${mezoId === null ? "-translate-y-2.5 text-[15px] font-semibold" : "text-[13.5px] text-sec"}`}
            >
              {shortAddress(address)}
            </span>
          </span>
        )}
        {viewing ? null : (
          <Glyph
            shape={shapes.chevronRight}
            size={16}
            strokeWidth={2}
            className="hidden text-sec md:block"
          />
        )}
      </button>
      {mounted ? (
        <Suspense fallback={null}>
          <AccountPanel
            address={address}
            connected={connected}
            viewing={viewing}
            open={open}
            onOpenChange={setOpen}
          />
        </Suspense>
      ) : null}
    </>
  )
}

/**
 * Someone else's wallet: their avatar and address under "Viewing", which
 * opens their account read-only, and a way to stop viewing.
 */
function ViewingChip({
  address,
  own,
}: {
  address: string
  own: string | null
}): ReactNode {
  return (
    <div className="flex flex-none items-center gap-1 rounded-[20px] bg-soft md:pr-1">
      <Account address={address} connected={false} viewing />
      <Link
        to="."
        search={(previous) => ({ ...previous, address: own ?? undefined })}
        aria-label={`Stop viewing ${shortAddress(address)}`}
        className="hidden size-8 flex-none place-items-center rounded-full text-sec outline-none hover:bg-soft2 hover:text-ink focus-visible:outline-2 focus-visible:outline-ink md:grid"
      >
        <Glyph shape={shapes.x} size={16} strokeWidth={2} />
      </Link>
    </div>
  )
}

function ConnectWallet(): ReactNode {
  const wallet = useWallet()
  return (
    <PillButton.Root
      {...walletIntent}
      // Tapped before the wallet code arrived: the button shows it is on
      // its way instead of looking dead until the sheet opens.
      pending={wallet.drawerOpen && wallet.phase === "loading"}
      onClick={openWallet}
      data-tap=""
      className="max-md:h-9 max-md:px-4 max-md:text-[15px]"
    >
      <span className="md:hidden">Connect</span>
      <span className="hidden md:inline">Connect wallet</span>
    </PillButton.Root>
  )
}

/**
 * The account button the header ends with, or null for Connect wallet.
 * Your wallet on screen, or your own account beside someone else's, shows
 * while it is connected or may still reconnect (`settled` false: the
 * server and the hydrating page go by the own-wallet cookie). Once the
 * reconnect settled without a wallet (a locked extension, an expired
 * session), or right after hydrating in a browser that never connected
 * one, the header offers Connect wallet: a page that is not yours
 * offers nothing else to connect with.
 */
export function headerAccount({
  viewer,
  other,
  own,
  connected,
  settled,
}: {
  viewer: Viewer
  other: boolean
  own: string | null
  connected: boolean
  settled: boolean
}): { address: string; connected: boolean } | null {
  if (viewer.kind === "signed-out") return null
  if (viewer.kind === "connected") {
    return { address: viewer.address, connected: true }
  }
  const address = other ? own : viewer.address
  if (address === null || (settled && !connected)) return null
  return { address, connected: other && connected }
}

export function TopBar(): ReactNode {
  const viewer = useViewer()
  const own = useOwnAddress()
  const other = useViewingOther()
  const wallet = useWallet()
  const settled = useWalletSettled()
  // Someone else's wallet reads as viewing: Connect wallet (or your own
  // account) stays where it always is, and their address never takes its
  // place (it looked like your own connected wallet, 19 Nov 2026).
  const account = headerAccount({
    viewer,
    other,
    own,
    connected: wallet.account !== null,
    settled,
  })
  const iconOnly = viewer.kind === "signed-out" || other
  return (
    <header className="flex h-11 items-center gap-2 md:justify-end md:gap-[18px]">
      {/* Phones: PRO beside the mark while it fits (signed in, 384px and
          up); the mark alone otherwise, so the header never overflows. */}
      <Link
        to="/"
        aria-label="Matchbox Pro"
        className="mr-auto flex flex-none items-center rounded-md outline-none focus-visible:outline-2 focus-visible:outline-ink md:hidden"
      >
        <ProShort
          form="short"
          height={22}
          className={iconOnly ? "hidden" : "max-[24rem]:hidden"}
        />
        <ProShort
          form="icon"
          height={22}
          aria-hidden="true"
          className={iconOnly ? "" : "min-[24rem]:hidden"}
        />
      </Link>
      {/* A phone has no room for the price beside Viewing and Connect: at
          360px the header ran 85px past the screen. */}
      <LivePriceSlot phoneHidden={other} />
      <span aria-hidden="true" className="hidden h-6 w-px bg-line md:block" />
      {/* Phones: Stuart's way in, since the Ctrl K bar is hidden there. */}
      <StuartSearchButton />
      {viewer.kind !== "signed-out" && other ? (
        <ViewingChip address={viewer.address} own={own} />
      ) : null}
      {account === null ? (
        <ConnectWallet />
      ) : (
        <Account address={account.address} connected={account.connected} />
      )}
    </header>
  )
}
