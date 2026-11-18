import * as Avatar from "@matchbox/ui/avatar"
import type { ReactNode } from "react"
import { initials, nameHue, walletMark } from "../lib/marks"

/**
 * An app's logo on a soft tile, or its initials. Logos come from the
 * server's pinned copy (`/api/app-logos/…` for verified apps) or the app's
 * own URL; never a referrer.
 */
export function AppMark({
  name,
  logoUrl,
  size = 48,
}: {
  name: string
  logoUrl: string | null
  size?: number
}): ReactNode {
  if (logoUrl === null) {
    return (
      <Avatar.Root
        initials={initials(name)}
        hue={nameHue(name)}
        size={size}
        className="rounded-[14px]"
      />
    )
  }
  return (
    <img
      src={logoUrl}
      alt=""
      width={size}
      height={size}
      referrerPolicy="no-referrer"
      className="flex-none rounded-[14px] bg-soft object-cover"
      style={{ width: size, height: size }}
    />
  )
}

/** The wallet's mark: two hex characters on its hue. */
export function WalletMark({
  address,
  size = 40,
}: {
  address: string
  size?: number
}): ReactNode {
  const mark = walletMark(address)
  return <Avatar.Root initials={mark.initials} hue={mark.hue} size={size} />
}
