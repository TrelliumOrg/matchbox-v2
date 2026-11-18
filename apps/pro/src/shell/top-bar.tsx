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
import { useViewer } from "../lib/viewer"
import { useHead } from "../live/heads"
import { chainNow, useLive } from "../live/live-context"
import { StuartSearchButton } from "../stuart/search-button"
import { openWallet, useWallet, walletIntent } from "../wallet/wallet-store"

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

/** Phones show the block row inside the price popover (no corner ticker). */
function LivePriceSlot(): ReactNode {
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
}: {
  address: string
  connected: boolean
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
        aria-label={`Account ${mezoId ?? shortAddress(address)}`}
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
        className="flex h-10 cursor-pointer items-center gap-2.5 rounded-[20px] text-ink outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
      >
        <Avatar.Root initials={avatar.initials} hue={avatar.hue} size={40} />
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
        <Glyph
          shape={shapes.chevronRight}
          size={16}
          strokeWidth={2}
          className="hidden text-sec md:block"
        />
      </button>
      {mounted ? (
        <Suspense fallback={null}>
          <AccountPanel
            address={address}
            connected={connected}
            open={open}
            onOpenChange={setOpen}
          />
        </Suspense>
      ) : null}
    </>
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

export function TopBar(): ReactNode {
  const viewer = useViewer()
  const signedOut = viewer.kind === "signed-out"
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
          className={signedOut ? "hidden" : "max-[24rem]:hidden"}
        />
        <ProShort
          form="icon"
          height={22}
          aria-hidden="true"
          className={signedOut ? "" : "min-[24rem]:hidden"}
        />
      </Link>
      <LivePriceSlot />
      <span aria-hidden="true" className="hidden h-6 w-px bg-line md:block" />
      {/* Phones: Stuart's way in, since the Ctrl K bar is hidden there. */}
      <StuartSearchButton />
      {!signedOut ? (
        <Account
          address={viewer.address}
          connected={viewer.kind === "connected"}
        />
      ) : (
        <ConnectWallet />
      )}
    </header>
  )
}
