import { FeedbackEntry, FeedbackIcon } from "@matchbox/feedback-ui/entry"
import * as Lockup from "@matchbox/ui/lockup"
import { Link } from "@tanstack/react-router"
import type { ReactNode } from "react"
import type { IdentityAccountView } from "../../shared/contracts"
import { AccountPill } from "./account-pill"
import { footerLinkClass, SiteLinks } from "./site-footer"

/**
 * Header (lockup, account menu when signed in), the page, and its foot:
 * the Matchbox links, and Feedback at the bottom right, outside every
 * consent step.
 */
export function Shell({
  account,
  children,
}: {
  account: IdentityAccountView | null
  children: ReactNode
}): ReactNode {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex h-[84px] items-center justify-between px-5 md:px-10">
        <Link
          to="/"
          aria-label="Matchbox ID"
          className="rounded-md outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink"
        >
          <Lockup.Root product="id" height={22} />
        </Link>
        {account === null ? null : <AccountPill account={account} />}
      </header>
      <main className="flex flex-1 flex-col px-5 pb-16 md:px-10">
        {children}
      </main>
      <footer className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 px-5 pb-8 md:px-10">
        <SiteLinks />
        {import.meta.env.VITE_FEEDBACK_URL ? (
          <FeedbackEntry
            endpoint={import.meta.env.VITE_FEEDBACK_URL}
            surface="id"
            className={`${footerLinkClass} cursor-pointer gap-2 text-[15px] text-sec`}
          >
            <FeedbackIcon size={16} strokeWidth={1.9} />
            Feedback
          </FeedbackEntry>
        ) : null}
      </footer>
    </div>
  )
}
