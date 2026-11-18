import { Glyph, shapes } from "@matchbox/ui/icons"
import { Kbd } from "@matchbox/ui/kbd"
import type { ReactNode } from "react"
import { openSearch, searchIntent } from "./search-store"

const barPlaceholder = "Search addresses, transactions, blocks, epochs"

/**
 * The floating Ctrl K bar (inner pages, `ndoSD6xB0U`): bottom centre, 600
 * wide, 54 tall. Hidden on phones, where the top bar has a search icon.
 */
export function FloatingSearch(): ReactNode {
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-30 hidden justify-center px-6 xl:flex">
      <button
        type="button"
        {...searchIntent}
        onClick={() => openSearch()}
        aria-haspopup="dialog"
        className="pointer-events-auto flex h-[54px] w-full max-w-[600px] cursor-text items-center gap-3 rounded-[27px] bg-raised pr-2.5 pl-5 text-left text-[15.5px] text-sec shadow-[0_0_0_1px_var(--line),var(--popShadow)] outline-none transition-transform duration-150 ease-roll hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink motion-reduce:transition-none motion-reduce:hover:translate-y-0"
      >
        <Glyph shape={shapes.search} size={18} strokeWidth={1.9} />
        <span className="min-w-0 flex-1 truncate">
          <span className="sr-only">Search, </span>
          {barPlaceholder}
        </span>
        <Kbd keys={["mod", "k"]} />
      </button>
    </div>
  )
}
