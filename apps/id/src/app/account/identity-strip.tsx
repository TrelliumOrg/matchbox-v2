import * as Avatar from "@matchbox/ui/avatar"
import { Icon } from "@matchbox/ui/icons"
import * as PillButton from "@matchbox/ui/pill-button"
import { type ReactNode, useState } from "react"
import type { IdentityAccountView } from "../../shared/contracts"
import { WalletMark } from "../components/marks"
import { shortAddress } from "../lib/format"
import { initials, nameHue } from "../lib/marks"

// No official Mezo invite is recorded in Matchbox yet: opens Discord itself.
const discordInvite = "https://discord.com/app"
const linkCommand = "/matchbox"

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

/** The signed-in wallet and its linked Discord. */
export function IdentityStrip({
  account,
}: {
  account: IdentityAccountView
}): ReactNode {
  const [copied, setCopied] = useState<"address" | "command" | null>(null)
  const discord = account.discord
  const discordName =
    discord === null
      ? null
      : (discord.username ?? discord.displayName ?? discord.id)

  async function copyValue(
    kind: "address" | "command",
    text: string,
  ): Promise<void> {
    if (await copy(text)) {
      setCopied(kind)
      window.setTimeout(() => setCopied(null), 1600)
    }
  }

  return (
    <dl className="mt-7 grid gap-4 rounded-[28px] bg-soft p-6 md:grid-cols-2 md:gap-0 max-md:p-4">
      <div className="flex min-w-0 items-center gap-4 md:pr-6">
        <WalletMark address={account.walletAddress} size={48} />
        <div className="min-w-0 flex-1">
          <dt className="sr-only">Wallet</dt>
          <dd
            title={account.walletAddress}
            className="font-mono text-[15.5px] font-medium text-ink"
          >
            {shortAddress(account.walletAddress)}
          </dd>
          <dd aria-hidden="true" className="text-[15px] text-sec">
            Wallet
          </dd>
        </div>
        <button
          type="button"
          aria-label={copied === "address" ? "Copied" : "Copy address"}
          onClick={() => void copyValue("address", account.walletAddress)}
          className="grid size-10 flex-none cursor-pointer place-items-center rounded-full bg-raised text-ink outline-none focus-visible:outline-2 focus-visible:outline-ink"
        >
          <Icon
            name={copied === "address" ? "check" : "copy"}
            size={17}
            strokeWidth={1.8}
          />
        </button>
      </div>
      <div className="flex min-w-0 items-center gap-4 md:border-l md:border-line md:pl-6">
        {discord === null ? (
          <span className="grid size-12 flex-none place-items-center rounded-full bg-raised text-sec">
            <Icon name="discord" size={20} />
          </span>
        ) : (
          <span className="relative flex-none">
            {discord.avatarUrl === null ? (
              <Avatar.Root
                initials={initials(discordName ?? "?").slice(0, 1)}
                hue={nameHue(discord.id)}
                size={48}
              />
            ) : (
              <img
                src={discord.avatarUrl}
                alt=""
                referrerPolicy="no-referrer"
                className="size-12 rounded-full bg-raised object-cover"
              />
            )}
            <span className="absolute -right-0.5 -bottom-0.5 grid size-[18px] place-items-center rounded-full bg-ink text-bg ring-2 ring-soft">
              <Icon name="discord" size={10} />
            </span>
          </span>
        )}
        <div className="min-w-0 flex-1">
          <dt className="sr-only">Discord</dt>
          <dd className="truncate text-[15.5px] font-semibold text-ink">
            {discordName ?? "Discord"}
          </dd>
          <dd className="text-[15px] text-sec">
            {discord === null ? "Not linked" : "Discord"}
          </dd>
        </div>
        {discord === null ? (
          <span className="flex flex-wrap justify-end gap-2">
            <PillButton.Root asChild size="sm">
              <a href={discordInvite} target="_blank" rel="noreferrer noopener">
                Open Discord
              </a>
            </PillButton.Root>
            <PillButton.Root
              intent="secondary"
              size="sm"
              onClick={() => void copyValue("command", linkCommand)}
            >
              {copied === "command" ? "Copied" : `Copy ${linkCommand}`}
            </PillButton.Root>
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-raised px-2.5 py-1 text-[13.5px] font-medium text-ink">
            <Icon name="check" size={13} strokeWidth={2.2} />
            Linked
          </span>
        )}
      </div>
    </dl>
  )
}
