import { Icon } from "@matchbox/ui/icons"
import type { ReactNode } from "react"
import { Glyph } from "../components/glyphs"

/** The icon for a scope row: key, wallet, Discord, person, people. */
export function ScopeIcon({
  scope,
  size = 18,
}: {
  scope: string
  size?: number
}): ReactNode {
  if (scope === "openid") {
    return <Icon name="key-round" size={size} strokeWidth={1.8} />
  }
  if (scope === "wallet") {
    return <Icon name="wallet" size={size} strokeWidth={1.8} />
  }
  if (scope === "discord:id") return <Icon name="discord" size={size} />
  if (scope === "discord:profile") return <Glyph name="user" size={size} />
  if (scope === "discord:membership") return <Glyph name="users" size={size} />
  return <Icon name="key-round" size={size} strokeWidth={1.8} />
}

/** "Not linked" plus the Discord bot command that links a wallet. */
export function DiscordLinkHint(): ReactNode {
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      Not linked
      <span
        title="Link with the /matchbox command in the Mezo Discord server"
        className="rounded-md bg-soft px-1.5 font-mono text-[13px] text-ink"
      >
        /matchbox
      </span>
    </span>
  )
}
