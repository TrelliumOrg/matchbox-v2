import { ShellEnd } from "@matchbox/app-kit/root-document"
import { useMatch } from "@tanstack/react-router"
import { type ReactNode, Suspense } from "react"
import { borrowDelayNote } from "../data/shell"
import { useShell } from "../data/shell-context"
import { SearchMount, SearchShortcuts } from "../search/search-bar"
import { deferred } from "./deferred"
import { TopBar, usePathname } from "./top-bar"

/**
 * The footer and the phone tab bar: server rendered with every page, their
 * code loaded as its own chunks and hydrated when it arrives, off the
 * first paint's script budget.
 */
const Footer = deferred(() =>
  import("./footer").then((module) => module.Footer),
)
const FloatingSearch = deferred(() =>
  import("../search/floating-search").then((module) => module.FloatingSearch),
)
const TabBar = deferred(() =>
  import("./tab-bar").then((module) => module.TabBar),
)

const delayedText =
  "Some data is delayed: a few lists and figures are behind the chain while Matchscan's updates catch up."
const borrowDelayedText =
  "Borrow data is delayed: loans and markets show an earlier block than the chain's latest."

/**
 * Quiet notes under the top bar: Scan's copy step has halted tables (every
 * page), or the live Borrow snapshot is stale (address pages only). Borrow
 * pages say so themselves from each live answer's own snapshot. An
 * address page reads the snapshot on its document's borrow part, and
 * /status only when the document carries none.
 */
function DelayNotes({ path }: { path: string }): ReactNode {
  const shell = useShell()
  const address = useMatch({ from: "/address/$address", shouldThrow: false })
  const borrow = borrowDelayNote(
    path,
    shell.borrowDelayed,
    address?.loaderData?.doc.borrowDelayed,
  )
  if (!shell.delayed && !borrow) return null
  return (
    <div className="mx-auto w-full max-w-[1240px] px-5 pt-4 text-[14.5px] text-sec">
      {shell.delayed ? <p role="status">{delayedText}</p> : null}
      {borrow ? <p role="status">{borrowDelayedText}</p> : null}
    </div>
  )
}

/**
 * The page frame: top bar, content (1200 wide, centred), footer, the
 * floating search bar on every page but Home (with room under the footer
 * so it never covers the links), and the phone tabs. The
 * render-blocking gate (`ShellEnd`) comes last, so no device paints half a
 * shell.
 */
export function AppShell({ children }: { children: ReactNode }): ReactNode {
  const path = usePathname()
  const home = path === "/"
  return (
    <div className={`flex min-h-dvh flex-col ${home ? "" : "xl:pb-[88px]"}`}>
      <a
        href="#main"
        className="sr-only z-50 rounded-[22px] bg-acc px-5 py-3 font-semibold text-on-acc focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to content
      </a>
      <TopBar />
      <DelayNotes path={path} />
      <main
        id="main"
        className="mx-auto w-full max-w-[1240px] flex-1 px-5 pb-[calc(7rem+env(safe-area-inset-bottom))] xl:pb-36"
      >
        {children}
      </main>
      <Suspense fallback={null}>
        <Footer />
      </Suspense>
      {home ? null : (
        <Suspense fallback={null}>
          <FloatingSearch />
        </Suspense>
      )}
      <Suspense fallback={null}>
        <TabBar />
      </Suspense>
      <SearchShortcuts />
      <SearchMount />
      <ShellEnd />
    </div>
  )
}
