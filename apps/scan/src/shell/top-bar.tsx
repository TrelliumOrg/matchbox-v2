import * as ScanLockup from "@matchbox/ui/scan-lockup"
import { Link, useRouterState } from "@tanstack/react-router"
import { type ReactNode, Suspense } from "react"
import { isActive, sections } from "../data/sections"
import { SearchIconButton } from "../search/search-bar"
import { AccountControl } from "./account"
import { deferred } from "./deferred"

/**
 * The top bar. Desktop from 1280 (`cP_-xnZA8I`): 76px, the MATCHSCAN
 * lockup, the nine sections, then the price slot, the block ticker (from
 * 1440, where it fits beside Connect) and Connect. Tablets are not drawn,
 * so below 1280 they get the phone layout. Phones (`Li0cKH1lMV`):
 * the short lockup (the icon alone under 480px, since search and Connect
 * are not in the drawn bar), the price slot, search and Connect; sections
 * move to the bottom tabs.
 */

/**
 * The price slot and block ticker: server rendered with every page, but
 * their code (popovers, moving numbers, coin icons) loads as its own chunk
 * and hydrates when it arrives, off the first paint's script budget.
 */
const LiveWidgets = deferred(() =>
  import("./live").then((live) => live.LiveWidgets),
)

export function usePathname(): string {
  return useRouterState({ select: (state) => state.location.pathname })
}

function Nav(): ReactNode {
  const pathname = usePathname()
  return (
    <nav aria-label="Matchscan" className="max-xl:hidden">
      <ul className="flex items-center gap-0.5">
        {sections.map((section) => {
          const active = isActive(section, pathname)
          return (
            <li key={section.id}>
              <Link
                to={section.to}
                aria-current={active ? "page" : undefined}
                className={`flex h-10 items-center rounded-[20px] px-2 text-[16px] whitespace-nowrap outline-none transition-colors focus-visible:outline-2 focus-visible:outline-ink ${active ? "bg-soft font-semibold text-ink" : "font-medium text-ink2 hover:text-ink"}`}
              >
                {section.label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

export function TopBar(): ReactNode {
  return (
    <header className="border-b border-line">
      <div className="mx-auto flex h-[76px] max-w-[1240px] items-center gap-2 px-5 max-xl:h-[60px] min-[30rem]:gap-3 xl:gap-5">
        <Link
          to="/"
          aria-label="Matchscan home"
          className="mr-auto flex flex-none items-center rounded-md outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink xl:mr-0"
        >
          <ScanLockup.Root height={22} className="max-xl:hidden" />
          <ScanLockup.Root
            form="short"
            height={22}
            className="max-[30rem]:hidden xl:hidden"
          />
          <ScanLockup.Root
            form="icon"
            height={22}
            className="min-[30rem]:hidden"
          />
        </Link>
        <Nav />
        <span className="flex-1 max-xl:hidden" />
        <Suspense fallback={null}>
          <LiveWidgets />
        </Suspense>
        <span className="xl:hidden">
          <SearchIconButton />
        </span>
        <AccountControl />
      </div>
    </header>
  )
}
