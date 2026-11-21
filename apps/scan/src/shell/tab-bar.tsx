import { FeedbackEntry, FeedbackIcon } from "@matchbox/feedback-ui/entry"
import { Glyph, shapes } from "@matchbox/ui/icons"
import { getWallet } from "@matchbox/wallet"
import { Link } from "@tanstack/react-router"
import type { ReactNode } from "react"
import { isActive, outbound, sections } from "../data/sections"
import { privacyLink } from "../site"
import { openAppearance } from "./appearance"
import { usePathname } from "./top-bar"

/**
 * Phone bottom tabs (`Li0cKH1lMV`, `HznXg9AzIL`): Home, Borrow, Pools,
 * Gauges, More (Network moved under More to make room for Pools).
 * More opens a native popover with the other sections, Appearance and the
 * outbound links, so it costs no script to open.
 */

const moreId = "scan-more"

const tab =
  "flex flex-col items-center justify-center gap-1 text-[12.5px] font-medium outline-none focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-ink"

const row =
  "flex h-12 items-center gap-3 rounded-[14px] px-3 text-[16px] text-ink outline-none hover:bg-soft focus-visible:outline-2 focus-visible:outline-ink"

function hideMore(): void {
  document.getElementById(moreId)?.hidePopover()
}

export function TabBar(): ReactNode {
  const pathname = usePathname()
  const more = sections.filter((section) => !section.phoneTab)
  const moreActive = more.some((section) => isActive(section, pathname))
  return (
    <>
      <nav
        aria-label="Matchscan tabs"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-bg pb-[env(safe-area-inset-bottom)] xl:hidden"
      >
        <ul className="grid h-16 grid-cols-5">
          {sections
            .filter((section) => section.phoneTab)
            .map((section) => {
              const active = isActive(section, pathname)
              return (
                <li key={section.id} className="grid">
                  <Link
                    to={section.to}
                    aria-current={active ? "page" : undefined}
                    className={`${tab} ${active ? "text-ink" : "text-sec"}`}
                  >
                    <Glyph shape={section.icon} size={24} strokeWidth={1.7} />
                    {section.label}
                  </Link>
                </li>
              )
            })}
          <li className="grid">
            <button
              type="button"
              popoverTarget={moreId}
              className={`${tab} cursor-pointer ${moreActive ? "text-ink" : "text-sec"}`}
            >
              <Glyph shape={shapes.ellipsis} size={24} strokeWidth={1.7} />
              More
            </button>
          </li>
        </ul>
      </nav>
      <nav
        id={moreId}
        popover="auto"
        aria-label="More"
        className="inset-x-3 top-auto bottom-[calc(76px+env(safe-area-inset-bottom))] m-0 w-auto rounded-[24px] bg-raised p-2 text-ink shadow-pop"
      >
        <ul className="flex flex-col">
          {more.map((section) => (
            <li key={section.id}>
              <Link
                to={section.to}
                onClick={hideMore}
                aria-current={isActive(section, pathname) ? "page" : undefined}
                className={row}
              >
                <Glyph shape={section.icon} size={20} strokeWidth={1.8} />
                {section.label}
              </Link>
            </li>
          ))}
          <li>
            <button
              type="button"
              onClick={() => {
                hideMore()
                openAppearance()
              }}
              className={`${row} w-full cursor-pointer`}
            >
              <Glyph shape={shapes.sun} size={20} strokeWidth={1.8} />
              Appearance
            </button>
          </li>
          {import.meta.env.VITE_FEEDBACK_URL ? (
            <li>
              <FeedbackEntry
                endpoint={import.meta.env.VITE_FEEDBACK_URL}
                surface="scan"
                wallet={() => getWallet().account}
                onOpen={hideMore}
                className={`${row} w-full cursor-pointer`}
              >
                <FeedbackIcon strokeWidth={1.8} />
                Feedback
              </FeedbackEntry>
            </li>
          ) : null}
        </ul>
        <ul className="mt-1 flex flex-wrap gap-x-5 border-t border-line px-3 pt-3 pb-2 text-[14.5px] text-sec">
          {[...outbound, privacyLink].map((link) => (
            <li key={link.href}>
              <a
                href={link.href}
                className="outline-none hover:text-ink focus-visible:outline-2 focus-visible:outline-ink"
              >
                {link.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </>
  )
}
