import { Glyph, shapes } from "@matchbox/ui/icons"
import { Link } from "@tanstack/react-router"
import { lazy, type ReactNode, Suspense, useRef, useState } from "react"

import { isActive, navItems, usePathname } from "./nav-items"

const tabClass =
  "flex flex-col items-center justify-center gap-1 text-[12.5px] font-medium outline-none focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-ink"

function loadMore() {
  return import("./more-sheet")
}

const MoreSheet = lazy(loadMore)

/**
 * The phone tab bar: the four pages, and More for the rest of what the
 * sidebar holds (its sheet loads on intent). Its height and the bottom
 * inset are what Vote's ballot bar docks over (e2e/ballot-dock). On a
 * page only More reaches, More is the current tab, by `aria-current` as
 * well as colour, as the page tabs are.
 *
 * The sheet is open only on the page it was opened on, so Back closes it
 * with that page. Closing gives focus back to More: More is not the
 * sheet's Radix trigger, so nothing else would.
 */
export function TabBar(): ReactNode {
  const pathname = usePathname()
  const [openOn, setOpenOn] = useState<string | null>(null)
  // Forgotten once the page changes, so Forward does not open it again.
  if (openOn !== null && openOn !== pathname) setOpenOn(null)
  const open = openOn === pathname
  const [mounted, setMounted] = useState(false)
  const more = useRef<HTMLButtonElement>(null)
  const moreActive = navItems.some(
    (item) => !item.phone && isActive(item, pathname),
  )
  return (
    <nav
      aria-label="Pro"
      className="fixed inset-x-0 bottom-0 z-30 h-(--tabbar) border-t border-line bg-bg pb-(--tabbar-inset) md:hidden"
    >
      <ul className="grid h-full grid-cols-5">
        {navItems
          .filter((item) => item.phone)
          .map((item) => {
            const active = isActive(item, pathname)
            return (
              <li key={item.to} className="grid">
                <Link
                  to={item.to}
                  aria-current={active ? "page" : undefined}
                  className={`${tabClass} ${active ? "text-ink" : "text-sec"}`}
                >
                  <Glyph shape={item.icon} size={24} strokeWidth={1.7} />
                  {item.label}
                </Link>
              </li>
            )
          })}
        <li className="grid">
          <button
            ref={more}
            type="button"
            aria-haspopup="dialog"
            aria-expanded={open}
            aria-current={moreActive ? "page" : undefined}
            onPointerDown={loadMore}
            onFocus={loadMore}
            onClick={() => {
              setMounted(true)
              setOpenOn(pathname)
            }}
            className={`${tabClass} cursor-pointer ${moreActive ? "text-ink" : "text-sec"}`}
          >
            <Glyph shape={shapes.ellipsis} size={24} strokeWidth={1.7} />
            More
          </button>
        </li>
      </ul>
      {mounted ? (
        <Suspense fallback={null}>
          <MoreSheet
            open={open}
            onOpenChange={(next) => setOpenOn(next ? pathname : null)}
            returnFocus={more}
          />
        </Suspense>
      ) : null}
    </nav>
  )
}
