import { Icon } from "@matchbox/ui/icons"
import {
  type ComponentProps,
  lazy,
  type ReactNode,
  Suspense,
  useState,
} from "react"
import type { IdentityAccountView } from "../../shared/contracts"
import { shortAddress } from "../lib/format"
import { WalletMark } from "./marks"

function loadMenu(): Promise<typeof import("./account-menu")> {
  return import("./account-menu")
}

const AccountMenu = lazy(loadMenu)

/** The pill itself: the same button before and after the menu loads. */
export function PillFace({
  account,
  ...props
}: { account: IdentityAccountView } & ComponentProps<"button">): ReactNode {
  return (
    <button
      type="button"
      aria-label="Account menu"
      className="group flex h-12 cursor-pointer items-center gap-2.5 rounded-3xl bg-soft pr-4 pl-1.5 outline-none focus-visible:outline-2 focus-visible:outline-ink"
      {...props}
    >
      <WalletMark address={account.walletAddress} size={36} />
      <span className="font-mono text-[15px] font-medium text-ink max-sm:hidden">
        {shortAddress(account.walletAddress)}
      </span>
      <Icon
        name="chevron-down"
        size={16}
        className="text-sec transition-transform group-data-[state=open]:rotate-180"
      />
    </button>
  )
}

/**
 * The account pill. Its menu (Radix, the theme switch) loads on the first
 * hover, focus or tap, so none of it is in the first paint.
 */
export function AccountPill({
  account,
}: {
  account: IdentityAccountView
}): ReactNode {
  const [opened, setOpened] = useState(false)
  const face = (
    <PillFace
      account={account}
      aria-haspopup="menu"
      aria-expanded={false}
      onPointerEnter={() => void loadMenu()}
      onFocus={() => void loadMenu()}
      onClick={() => setOpened(true)}
    />
  )
  if (!opened) return face
  return (
    <Suspense fallback={face}>
      <AccountMenu account={account} />
    </Suspense>
  )
}
