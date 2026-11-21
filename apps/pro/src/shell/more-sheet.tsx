import { Glyph, type GlyphShape, shapes } from "@matchbox/ui/icons"
import * as Sheet from "@matchbox/ui/sheet"
import { Link } from "@tanstack/react-router"
import type { ReactNode, RefObject } from "react"
import { calcSearch } from "../boost/calc-link"
import { loadCalculator } from "../boost/calc-mount"
import { classicUrl } from "../classic-note/note-store"
import { proDocs } from "./docs-link"
import { isActive, navItems, usePathname } from "./nav-items"

/**
 * The phone tab bar's More: what the sidebar holds past the four tabs
 * (P2, 19 Nov 2026: a phone had no way to Protocol, the Boost calculator,
 * the docs or Classic). Loaded on the first tap of More.
 */

const rowClass =
  "flex min-h-12 w-full items-center gap-3.5 rounded-[14px] px-3 text-base font-semibold text-ink outline-none hover:bg-soft focus-visible:outline-2 focus-visible:outline-ink"

function RowIcon({ shape }: { shape: GlyphShape }): ReactNode {
  return (
    <Glyph
      shape={shape}
      size={20}
      strokeWidth={1.75}
      className="flex-none text-ink2"
    />
  )
}

export default function MoreSheet({
  open,
  onOpenChange,
  returnFocus,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The More tab, which opens the sheet without being its trigger. */
  returnFocus: RefObject<HTMLButtonElement | null>
}): ReactNode {
  const pathname = usePathname()
  const close = (): void => onOpenChange(false)
  const pages = navItems.filter((item) => !item.phone)
  return (
    <Sheet.Root open={open} onOpenChange={onOpenChange}>
      <Sheet.Content
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          // Unless what the sheet opened, the calculator, took focus.
          const active = document.activeElement
          if (active === null || active === document.body) {
            returnFocus.current?.focus()
          }
        }}
      >
        <Sheet.Header>More</Sheet.Header>
        <Sheet.Body>
          <nav aria-label="More">
            <ul className="-mx-3 flex flex-col gap-1">
              {pages.map((item) => (
                <li key={item.to}>
                  <Link
                    to={item.to}
                    onClick={close}
                    aria-current={isActive(item, pathname) ? "page" : undefined}
                    className={rowClass}
                  >
                    <RowIcon shape={item.icon} />
                    {item.label}
                  </Link>
                </li>
              ))}
              <li>
                <Link
                  to="."
                  search={(now) => ({ ...now, ...calcSearch({}) })}
                  resetScroll={false}
                  onFocus={loadCalculator}
                  onPointerDown={loadCalculator}
                  onClick={close}
                  className={rowClass}
                >
                  <RowIcon shape={shapes.calculator} />
                  Boost calculator
                </Link>
              </li>
              <li>
                <a
                  href={proDocs}
                  target="_blank"
                  rel="noreferrer noopener"
                  className={rowClass}
                >
                  <RowIcon shape={shapes.bookOpen} />
                  Documentation
                </a>
              </li>
              <li>
                {/* Same tab: Classic is the switch to the other app. */}
                <a href={classicUrl} className={rowClass}>
                  <RowIcon shape={shapes.arrowUpRight} />
                  Go to Matchbox Classic
                </a>
              </li>
            </ul>
          </nav>
        </Sheet.Body>
      </Sheet.Content>
    </Sheet.Root>
  )
}
