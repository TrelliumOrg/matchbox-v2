import { FeedbackEntry, FeedbackIcon } from "@matchbox/feedback-ui/entry"
import * as Lockup from "@matchbox/ui/lockup"
import { Link } from "@tanstack/react-router"
import type { ReactNode } from "react"
import type { IdentityAccountView } from "../../shared/contracts"
import { AccountPill } from "./account-pill"

/**
 * Header (lockup, account menu when signed in), the page, and its foot:
 * Feedback at the bottom right, outside every consent step.
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
      {import.meta.env.VITE_FEEDBACK_URL ? (
        <footer className="flex justify-end px-5 pb-10 md:px-10">
          <FeedbackEntry
            endpoint={import.meta.env.VITE_FEEDBACK_URL}
            surface="id"
            className="flex cursor-pointer items-center gap-2 rounded-md text-[15px] text-sec outline-none hover:text-ink focus-visible:outline-2 focus-visible:outline-ink"
          >
            <FeedbackIcon size={16} strokeWidth={1.9} />
            Feedback
          </FeedbackEntry>
        </footer>
      ) : null}
    </div>
  )
}
