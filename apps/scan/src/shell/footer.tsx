import { FeedbackEntry, FeedbackIcon } from "@matchbox/feedback-ui/entry"
import { Glyph, shapes } from "@matchbox/ui/icons"
import * as ScanLockup from "@matchbox/ui/scan-lockup"
import { getWallet } from "@matchbox/wallet"
import type { ReactNode } from "react"
import { outbound } from "../data/sections"
import { privacyLink } from "../site"
import { openAppearance } from "./appearance"

/**
 * Footer (`cP_-xnZA8I`): the lockup, then Matchbox Pro, API and
 * Documentation. Appearance sits here too, for anyone without a wallet
 * (the account menu has it once connected).
 */
export function Footer(): ReactNode {
  return (
    <footer className="border-t border-line max-xl:hidden">
      <div className="mx-auto flex h-[88px] max-w-[1240px] items-center gap-6 px-5">
        <ScanLockup.Root height={18} aria-hidden="true" />
        <span className="flex-1" />
        <button
          type="button"
          data-tap=""
          onClick={openAppearance}
          className="flex cursor-pointer items-center gap-2 rounded-md text-[15px] text-sec outline-none hover:text-ink focus-visible:outline-2 focus-visible:outline-ink"
        >
          <Glyph shape={shapes.sun} size={16} strokeWidth={1.9} />
          Appearance
        </button>
        <ul className="flex items-center gap-6 text-[15px] text-sec">
          {[...outbound, privacyLink].map((link) => (
            <li key={link.href}>
              <a
                href={link.href}
                data-tap=""
                className="rounded-md outline-none hover:text-ink focus-visible:outline-2 focus-visible:outline-ink"
              >
                {link.label}
              </a>
            </li>
          ))}
        </ul>
        {import.meta.env.VITE_FEEDBACK_URL ? (
          <FeedbackEntry
            endpoint={import.meta.env.VITE_FEEDBACK_URL}
            surface="scan"
            wallet={() => getWallet().account}
            className="flex cursor-pointer items-center gap-2 rounded-md text-[15px] text-sec outline-none hover:text-ink focus-visible:outline-2 focus-visible:outline-ink"
          >
            <FeedbackIcon size={16} strokeWidth={1.9} />
            Feedback
          </FeedbackEntry>
        ) : null}
      </div>
    </footer>
  )
}
