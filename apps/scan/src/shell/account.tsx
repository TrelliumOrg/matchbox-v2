import { addressAvatar, shortAddress } from "@matchbox/domain/format"
import * as Avatar from "@matchbox/ui/avatar"
import * as PillButton from "@matchbox/ui/pill-button"
import { openWallet, useWallet, walletIntent } from "@matchbox/wallet"
import { lazy, type ReactNode, Suspense, useRef, useState } from "react"

/**
 * Connect, or the connected account. No connect control is drawn for
 * Matchscan yet, so this follows Pro's top bar: an orange "Connect wallet"
 * pill that loads the wallet on intent ("Connect" under 1536px, where the
 * drawn bar has no room for it), then the avatar and short address.
 * The account menu loads on intent too.
 */

function loadMenu() {
  return import("./account-menu")
}

const AccountMenu = lazy(loadMenu)

function Account({ address }: { address: string }): ReactNode {
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const avatar = addressAvatar(address)
  return (
    <div className="relative">
      <button
        ref={trigger}
        type="button"
        aria-label={`Account ${shortAddress(address)}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onPointerEnter={loadMenu}
        onFocus={loadMenu}
        onTouchStart={loadMenu}
        onClick={() => setOpen((current) => !current)}
        className="flex h-10 cursor-pointer items-center gap-2.5 rounded-[20px] text-ink outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
      >
        <Avatar.Root initials={avatar.initials} hue={avatar.hue} size={40} />
        <span className="font-mono text-[14px] text-ink2 max-2xl:hidden">
          {shortAddress(address)}
        </span>
      </button>
      {open ? (
        <Suspense fallback={null}>
          <AccountMenu
            address={address}
            onClose={(reason) => {
              setOpen(false)
              if (reason === "escape") trigger.current?.focus()
            }}
          />
        </Suspense>
      ) : null}
    </div>
  )
}

export function AccountControl(): ReactNode {
  const wallet = useWallet()
  if (wallet.account !== null) {
    return <Account address={wallet.account.address} />
  }
  return (
    <PillButton.Root
      {...walletIntent}
      // Tapped before the wallet code arrived: the button shows it is on
      // its way instead of looking dead until the drawer opens (as Pro's).
      // On a 360px phone the price slot gives way to the spinner.
      pending={wallet.drawerOpen && wallet.phase === "loading"}
      onClick={openWallet}
      data-tap=""
      className="max-xl:h-9 max-xl:px-4 max-xl:text-[15px]"
    >
      <span className="2xl:hidden">Connect</span>
      <span className="max-2xl:hidden">Connect wallet</span>
    </PillButton.Root>
  )
}
