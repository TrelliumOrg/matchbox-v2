import { Glyph, type GlyphShape } from "@matchbox/ui/icons"
import * as PillButton from "@matchbox/ui/pill-button"
import {
  type ErrorComponentProps,
  Link,
  useRouter,
} from "@tanstack/react-router"
import type { ReactNode } from "react"

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

/**
 * User screens without a wallet. `action` is the app's connect button
 * (Pro's opens its wallet drawer), so this module needs no wallet code.
 */
export function SignedOut({
  title,
  icon,
  action,
}: {
  title: string
  icon: GlyphShape
  action: ReactNode
}): ReactNode {
  return (
    <>
      <h1 className="mt-5 text-[32px] font-[650] tracking-[-0.02em] md:mt-5">
        {title}
      </h1>
      <EmptyState icon={icon} title="No wallet connected" action={action} />
    </>
  )
}

/** Route errors and unknown pages: a title and one action. */

export function ErrorState({ error }: ErrorComponentProps): ReactNode {
  const router = useRouter()
  const missing =
    error instanceof Error && "status" in error && error.status === 404
  return (
    <section className="mt-10">
      <h1 className="text-[32px] font-[650] tracking-[-0.02em]">
        {missing ? "Not found" : "Data unavailable"}
      </h1>
      <PillButton.Root
        intent="secondary"
        className="mt-6"
        onClick={() => void router.invalidate()}
      >
        Try again
      </PillButton.Root>
    </section>
  )
}

/** `home` names the app's first page: Pro's is "Overview". */
export function NotFound({ home = "Home" }: { home?: string }): ReactNode {
  return (
    <section className="mt-10">
      <h1 className="text-[32px] font-[650] tracking-[-0.02em]">
        Page not found
      </h1>
      <PillButton.Root asChild intent="secondary" className="mt-6">
        <Link to="/">{home}</Link>
      </PillButton.Root>
    </section>
  )
}
