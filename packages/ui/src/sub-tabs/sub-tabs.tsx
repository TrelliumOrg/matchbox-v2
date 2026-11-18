import { type ReactNode, useRef } from "react"
import { useScrollRow } from "../scroll-row"
import * as Slot from "../slot"

/**
 * Underline tabs that are links (Matchscan's topic pages and address
 * tabs, Developer's console): plain labels, the current one in ink with a
 * 2px underline on a 1px rule. The current link carries
 * `aria-current="page"` (TanStack Router's Link sets it when active).
 *
 * The row scrolls sideways on a narrow screen with no scrollbar and never
 * scrolls vertically: the rule is an inset shadow on the list rather than
 * a border the underline is pulled over, so nothing overflows it. It opens
 * on the current tab and fades the side with more tabs (`useScrollRow`).
 */

export type RootProps = {
  /** Accessible name of the navigation, for example "Gauge types". */
  label: string
  children: ReactNode
  className?: string
}

export function Root({ label, children, className }: RootProps): ReactNode {
  const list = useRef<HTMLUListElement | null>(null)
  useScrollRow(list)
  return (
    <nav aria-label={label} className={`min-w-0 ${className ?? ""}`}>
      <ul
        ref={list}
        className="scroll-row flex gap-7 shadow-[inset_0_-1px_0_var(--line)]"
      >
        {children}
      </ul>
    </nav>
  )
}

Root.displayName = "SubTabs"

export const itemClass =
  "flex h-12 items-center gap-1.5 border-b-2 border-transparent text-[16px] whitespace-nowrap text-ink2 outline-none hover:text-ink focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ink aria-[current=page]:border-ink aria-[current=page]:font-semibold aria-[current=page]:text-ink"

export type ItemProps = {
  /** The tab's link, given the tab's classes. */
  children: ReactNode
}

export function Item({ children }: ItemProps): ReactNode {
  return (
    <li className="flex-none">
      <Slot.Root className={itemClass}>{children}</Slot.Root>
    </li>
  )
}

Item.displayName = "SubTabs.Item"
