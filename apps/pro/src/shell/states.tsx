import { Glyph, type GlyphShape } from "@matchbox/ui/icons"
import * as PillButton from "@matchbox/ui/pill-button"
import type { ReactNode } from "react"
import { openWallet, walletIntent } from "../wallet/wallet-store"

/**
 * Empty, error and not-found states: one line and one action, no
 * illustration (matchbox-v3 Empty states, frame `r13Ve8l5Ls`).
 */

export type EmptyStateProps = {
  icon: GlyphShape
  title: string
  action?: ReactNode
  /** "card" sits on a soft card (Activity), "plain" is a single line. */
  variant?: "card" | "plain"
}

export function EmptyState({
  icon,
  title,
  action,
  variant = "card",
}: EmptyStateProps): ReactNode {
  if (variant === "plain") {
    return <p className="mt-4 text-[15px] text-sec">{title}</p>
  }
  return (
    <section className="mt-7 flex min-h-[420px] flex-col items-center justify-center gap-5 rounded-[24px] bg-soft px-6 py-16 text-center shadow-[inset_0_0_0_1px_var(--edge)]">
      <span className="grid size-16 place-items-center rounded-full bg-raised text-ink2">
        <Glyph shape={icon} size={22} strokeWidth={1.7} />
      </span>
      <h2 className="-mt-1 text-[19px] font-semibold">{title}</h2>
      {action}
    </section>
  )
}

/** User screens without a wallet or `?address=`. */
export function SignedOut({
  title,
  icon,
}: {
  title: string
  icon: GlyphShape
}): ReactNode {
  return (
    <>
      <h1 className="mt-5 text-[32px] font-[650] tracking-[-0.02em] md:mt-5">
        {title}
      </h1>
      <EmptyState
        icon={icon}
        title="No wallet connected"
        action={
          <PillButton.Root {...walletIntent} onClick={openWallet}>
            Connect wallet
          </PillButton.Root>
        }
      />
    </>
  )
}
