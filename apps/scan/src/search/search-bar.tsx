import { whenIdle } from "@matchbox/motion"
import { Glyph, shapes } from "@matchbox/ui/icons"
import { lazy, type ReactNode, Suspense, useEffect } from "react"
import {
  loadPalette,
  openSearch,
  searchIntent,
  typeAhead,
  useSearchState,
} from "./search-store"

/**
 * The ways into search: the large field on Home, the floating Ctrl K bar on
 * every other page (desktop), the search icon in the phone top bar, and the
 * Ctrl K, Cmd K and "/" shortcuts. Each is a button that opens the palette,
 * so first paint carries no search code beyond this file and the store.
 */

const homePlaceholder = "Address, Mezo ID, transaction, block, epoch or lock"

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return (
    target.isContentEditable ||
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT"
  )
}

/**
 * Ctrl K and Cmd K anywhere, "/" outside fields. The palette's code loads
 * once the page is idle (it is not in first paint), and keys typed before
 * it arrives are kept for it.
 */
export function SearchShortcuts(): null {
  useEffect(() => whenIdle(() => void loadPalette()), [])
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (!event.ctrlKey && !event.metaKey && !event.altKey) {
        if (typeAhead(event.key)) {
          event.preventDefault()
          return
        }
      }
      const mod =
        event.key.toLowerCase() === "k" &&
        (event.ctrlKey || event.metaKey) &&
        !event.altKey
      const slash =
        event.key === "/" &&
        !event.ctrlKey &&
        !event.metaKey &&
        !isTyping(event.target)
      if (!mod && !slash) return
      event.preventDefault()
      openSearch()
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [])
  return null
}

/** Home's centred field (`cP_-xnZA8I`): 64 tall, soft, "/" key cap. */
export function HomeSearch(): ReactNode {
  return (
    <button
      type="button"
      {...searchIntent}
      onClick={() => openSearch()}
      aria-haspopup="dialog"
      className="group flex h-16 w-full max-w-[760px] cursor-text items-center gap-3 rounded-[32px] bg-soft pr-3 pl-6 text-left text-[17px] text-sec outline-none transition-colors hover:bg-soft2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink max-md:h-14 max-md:pl-5 max-md:text-[16px]"
    >
      <Glyph shape={shapes.search} size={20} strokeWidth={1.9} />
      <span className="min-w-0 flex-1 truncate">
        <span className="sr-only">Search, </span>
        {homePlaceholder}
      </span>
      <span className="grid size-10 place-items-center rounded-full bg-raised font-mono text-[15px] text-ink max-md:hidden">
        <span aria-hidden="true">/</span>
      </span>
    </button>
  )
}

/** The phone top bar's way in. */
export function SearchIconButton(): ReactNode {
  return (
    <button
      type="button"
      {...searchIntent}
      onClick={() => openSearch()}
      aria-label="Search"
      aria-haspopup="dialog"
      className="grid size-10 flex-none place-items-center rounded-full bg-soft text-ink outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
    >
      <Glyph shape={shapes.search} size={19} strokeWidth={1.9} />
    </button>
  )
}

const SearchPalette = lazy(loadPalette)

/** Renders the palette once it has been opened. */
export function SearchMount(): ReactNode {
  const { open, query } = useSearchState()
  if (!open) return null
  return (
    <Suspense fallback={null}>
      <SearchPalette initialQuery={query} />
    </Suspense>
  )
}
