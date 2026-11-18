import * as DocsLockup from "@matchbox/ui/docs-lockup"
import { Glyph, shapes } from "@matchbox/ui/icons"
import { Kbd, syncPlatform } from "@matchbox/ui/kbd"
import { Link, useLocation } from "@tanstack/react-router"
import { lazy, type ReactNode, Suspense, useEffect } from "react"
import { AskHost } from "./ask"
import { navSheetId } from "./bottom-sheet"
import { DogDisc } from "./dog"
import { DocsHeader } from "./header"
import { NavSheet } from "./nav-sheet"
import { SiteFooter } from "./site-footer"
import { search } from "./store"

/**
 * The docs shell (layout v2, Doop `WC_9ztyeY-`; phone `U_C71yzQ9E`): the
 * two-row header from 768 up, the phone top bar with the short lockup,
 * search and menu below it, the page, and the site footer. The floating
 * Ctrl K bar sits at the bottom of the article column. Search, the sheets,
 * Appearance and "Ask about this page" load on intent.
 */

const SearchPalette = lazy(() => import("../search/palette"))

function SearchHost(): ReactNode {
  const state = search.use()
  if (!state.requested) return null
  return (
    <Suspense fallback={null}>
      <SearchPalette
        open={state.open}
        initial={state.value}
        onClose={search.close}
      />
    </Suspense>
  )
}

function useShortcut(): void {
  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        search.open()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])
}

function PhoneTopBar(): ReactNode {
  return (
    <header className="sticky top-0 z-20 flex h-[62px] items-center gap-1 bg-bg px-5 md:hidden">
      <Link
        to="/"
        className="mr-auto flex h-11 items-center rounded-md outline-none focus-visible:outline-2 focus-visible:outline-ink"
      >
        <DocsLockup.Root form="short" height={20} />
      </Link>
      <button
        type="button"
        aria-label="Ask Stuart or search docs"
        onClick={() => search.open()}
        onTouchStart={search.warm}
        className="grid size-11 cursor-pointer place-items-center rounded-full text-ink outline-none focus-visible:outline-2 focus-visible:outline-ink [@media(scripting:none)]:hidden"
      >
        <Glyph shape={shapes.search} size={21} strokeWidth={1.8} />
      </button>
      <button
        type="button"
        aria-label="Menu"
        aria-haspopup="dialog"
        popoverTarget={navSheetId}
        className="-mr-2 grid size-11 cursor-pointer place-items-center rounded-full text-ink outline-none focus-visible:outline-2 focus-visible:outline-ink"
      >
        <Glyph shape={shapes.menu} size={22} strokeWidth={1.8} />
      </button>
    </header>
  )
}

/**
 * The floating Ctrl K bar, fixed at bottom 28 and centred on the article
 * column, or on the article and samples on API pages. The left padding is
 * twice the column's offset from the viewport's centre: from 1024 the
 * section navigation (220 or 240) and its gap sit to the left, from 1280
 * On this page (200) sits to the right.
 */
export function Kbar({ samples }: { samples: boolean }): ReactNode {
  return (
    <div
      className={`pointer-events-none fixed inset-x-0 bottom-7 z-20 hidden justify-center md:flex lg:pl-[268px] ${samples ? "xl:pl-[288px] min-[90rem]:pl-[304px]" : "xl:pl-10"}`}
    >
      <button
        type="button"
        onClick={() => search.open()}
        onPointerEnter={search.warm}
        onFocus={search.warm}
        aria-keyshortcuts="Control+K Meta+K"
        className="pointer-events-auto flex [@media(scripting:none)]:hidden h-[54px] w-[600px] max-w-[calc(100%-80px)] cursor-pointer items-center gap-3 rounded-[27px] bg-bg pr-3 pl-[9px] text-left text-[15.5px] text-sec shadow-[0_0_0_1px_var(--line),var(--lift)] outline-none focus-visible:outline-2 focus-visible:outline-ink dark:bg-soft2"
      >
        <DogDisc size={36} />
        <span className="flex-1">Ask Stuart or search docs</span>
        <Kbd keys={["mod", "k"]} />
      </button>
    </div>
  )
}

export function DocsShell({ children }: { children: ReactNode }): ReactNode {
  const pathname = useLocation({ select: (location) => location.pathname })
  useShortcut()
  // The page guessed the platform before paint; confirm it once.
  useEffect(() => void syncPlatform(), [])
  return (
    <>
      <a
        href="#content"
        className="fixed top-3 left-3 z-50 -translate-y-20 rounded-full bg-ink px-4 py-2.5 text-[15px] font-semibold text-bg outline-none focus:translate-y-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acc motion-safe:transition-transform"
      >
        Skip to content
      </a>
      <DocsHeader />
      <PhoneTopBar />
      <div className="min-h-[calc(100dvh-104px)]">{children}</div>
      <SiteFooter home={pathname === "/"} />
      <NavSheet />
      <SearchHost />
      <AskHost />
    </>
  )
}
