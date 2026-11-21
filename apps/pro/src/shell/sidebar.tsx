import { FeedbackEntry, FeedbackIcon } from "@matchbox/feedback-ui/entry"
import { useSlidingIndicator } from "@matchbox/motion"
import { Glyph, shapes } from "@matchbox/ui/icons"
import * as Lockup from "@matchbox/ui/lockup"
import { Link } from "@tanstack/react-router"
import { lazy, type ReactNode, Suspense, useRef } from "react"
import { calcSearch } from "../boost/calc-link"
import { loadCalculator } from "../boost/calc-mount"
import type { ClassicRowProps } from "../classic-note/classic-note"
import { classicUrl, useClassicNote } from "../classic-note/note-store"
import { getWallet } from "../wallet/wallet-store"

import { proDocs } from "./docs-link"
import { LiveBlockTicker } from "./live-ticker"
import { isActive, navItems, usePathname } from "./nav-items"

type NavItem = (typeof navItems)[number]

/** A nav link; the soft pill slides from the page left to the page opened. */
function NavLink({
  item,
  active,
}: {
  item: NavItem
  active: boolean
}): ReactNode {
  const pill = useRef<HTMLSpanElement | null>(null)
  useSlidingIndicator(pill, "pro-sidebar", active)
  return (
    <Link
      to={item.to}
      aria-current={active ? "page" : undefined}
      aria-label={item.label}
      className={`relative isolate flex size-11 items-center justify-center rounded-[22px] text-base text-ink2 outline-none hover:bg-soft focus-visible:outline-2 focus-visible:outline-ink lg:h-11 lg:w-full lg:justify-start lg:gap-3.5 lg:px-4 rail:w-11 rail:justify-center rail:px-0 ${active ? "font-semibold text-ink" : ""}`}
    >
      <span
        ref={pill}
        aria-hidden="true"
        data-mbx-motion=""
        className={`absolute inset-0 -z-10 origin-top-left rounded-[22px] bg-soft ${active ? "" : "invisible"}`}
      />
      <Glyph shape={item.icon} size={20} strokeWidth={1.7} />
      <span className="hidden lg:inline rail:hidden">{item.label}</span>
    </Link>
  )
}

const lowerLinkClass =
  "flex size-11 items-center justify-center rounded-[22px] text-[15px] text-sec outline-none hover:text-ink2 focus-visible:outline-2 focus-visible:outline-ink lg:h-10 lg:w-full lg:justify-start lg:gap-3.5 lg:px-4 rail:size-11 rail:justify-center rail:px-0"

function LowerLabel({ children }: { children: string }): ReactNode {
  return <span className="hidden lg:inline rail:hidden">{children}</span>
}

/**
 * The way to the other product. After the Classic note is dismissed the
 * row holds a soft fill for a moment (`held`), then lets it go (`fading`).
 */
function ClassicRow({
  ref,
  held = false,
  fading = false,
  className = "",
}: ClassicRowProps): ReactNode {
  return (
    <a
      ref={ref}
      href={classicUrl}
      aria-label="Matchbox Classic"
      className={`${lowerLinkClass} ${held ? "bg-soft text-ink" : ""} ${fading ? "transition-colors duration-[400ms]" : ""} ${className}`}
    >
      <Glyph shape={shapes.arrowUpRight} size={20} strokeWidth={1.7} />
      <LowerLabel>Matchbox Classic</LowerLabel>
    </a>
  )
}

const SidebarNote = lazy(() =>
  import("../classic-note/classic-note").then((module) => ({
    default: module.SidebarNote,
  })),
)

/**
 * The Classic row, or the note that stands in for it on a visit from the
 * homepage (the note's code loads only for such a visit).
 */
function ClassicSlot(): ReactNode {
  const note = useClassicNote()
  if (note.phase === "off") return <ClassicRow />
  return (
    <Suspense fallback={<ClassicRow />}>
      <SidebarNote Row={ClassicRow} />
    </Suspense>
  )
}

/**
 * Collapses to the icon rail while Stuart is expanded (DAICnrdo-X) and on
 * Vote below 1280px. The block ticker sits at its foot, so it never covers
 * a row of the content column (on the rail, the ring alone).
 */
export function Sidebar(): ReactNode {
  const pathname = usePathname()
  return (
    <aside className="flex h-full w-[72px] flex-none flex-col items-center border-r border-line pt-9 pb-7 lg:w-[240px] lg:items-stretch lg:border-r-0 lg:pt-10 lg:pr-4 lg:pl-7 xl:w-[280px] xl:pr-6 xl:pl-10 rail:w-[72px] rail:items-center rail:border-r-0 rail:px-0 rail:pt-10">
      <Link
        to="/"
        className="flex h-11 items-center rounded-md outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink"
      >
        <Lockup.Pro form="icon" height={22} className="lg:hidden rail:block" />
        <Lockup.Pro
          form="short"
          height={22}
          className="hidden lg:block xl:hidden rail:hidden"
        />
        <Lockup.Pro
          height={22}
          collapse="fold"
          className="hidden xl:block rail:hidden"
        />
      </Link>
      <nav
        aria-label="Pro"
        data-indicator-root=""
        className="mt-6 lg:mt-[30px] rail:mt-[30px]"
      >
        <ul className="flex flex-col gap-1">
          {navItems.map((item) => (
            <li key={item.to}>
              <NavLink item={item} active={isActive(item, pathname)} />
            </li>
          ))}
        </ul>
      </nav>
      <div className="mt-auto mb-2 flex h-10 items-center justify-center lg:justify-start lg:px-4 rail:justify-center rail:px-0">
        <LiveBlockTicker className="max-lg:[&>:last-child]:hidden rail:[&>:last-child]:hidden" />
      </div>
      <ul className="flex flex-col gap-1">
        <li>
          {/* Opens the calculator over this page; Back closes it. */}
          <Link
            to="."
            search={(now) => ({ ...now, ...calcSearch({}) })}
            resetScroll={false}
            aria-label="Boost calculator"
            onPointerEnter={loadCalculator}
            onFocus={loadCalculator}
            className={lowerLinkClass}
          >
            <Glyph shape={shapes.calculator} size={20} strokeWidth={1.7} />
            <LowerLabel>Boost calculator</LowerLabel>
          </Link>
        </li>
        <li>
          <a
            href={proDocs}
            target="_blank"
            rel="noreferrer noopener"
            aria-label="Documentation"
            className={lowerLinkClass}
          >
            <Glyph shape={shapes.bookOpen} size={20} strokeWidth={1.7} />
            <LowerLabel>Documentation</LowerLabel>
          </a>
        </li>
        {import.meta.env.VITE_FEEDBACK_URL ? (
          <li>
            <FeedbackEntry
              endpoint={import.meta.env.VITE_FEEDBACK_URL}
              surface="pro"
              aria-label="Feedback"
              className={`${lowerLinkClass} cursor-pointer`}
              wallet={() => getWallet().account}
              screenshotBlocked={() =>
                getWallet().tx === null ? null : "A signing review is open"
              }
            >
              <FeedbackIcon />
              <LowerLabel>Feedback</LowerLabel>
            </FeedbackEntry>
          </li>
        ) : null}
        <li>
          <ClassicSlot />
        </li>
      </ul>
    </aside>
  )
}
