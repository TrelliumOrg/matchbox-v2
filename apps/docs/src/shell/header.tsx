import { manifest } from "@matchbox/docs/manifest"
import { type SectionId, sectionOfPath, sections } from "@matchbox/docs/site"
import { FeedbackEntry, FeedbackIcon } from "@matchbox/feedback-ui/entry"
import * as DocsLockup from "@matchbox/ui/docs-lockup"
import { Glyph, shapes } from "@matchbox/ui/icons"
import { Link, useLocation } from "@tanstack/react-router"
import type { ReactNode } from "react"
import { DocLink } from "../content/doc-link"
import { openAppearance, warmAppearance } from "./appearance"
import { iconButton, PageActions } from "./page-actions"
import { iconOf } from "./section-icons"

/**
 * The docs header (layout v2, Doop `WC_9ztyeY-`, `rdTgFW46zL`): two rows,
 * 104 in total, sticky at the top and never hidden. Row 1 (64) has the
 * lockup, the page's actions, a hairline and Appearance. Row 2 (40) is the
 * product row, real links with aria-current on the active product. From
 * 1440 it stops at 1360 and centres with the grid below. Phones keep their
 * own top bar.
 */

/** A product's own pages show its icon on a disc in its tab colour. */
const tabDisc: Partial<Record<SectionId, string>> = {
  pro: "bg-mezo text-on-mezo",
  scan: "bg-acc-soft text-acc-ink",
  id: "bg-ink text-bg",
  developer: "bg-ink2 text-bg",
}

function pathOf(pathname: string): string {
  return pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname
}

function ProductRow({ active }: { active: SectionId | null }): ReactNode {
  return (
    <nav aria-label="Products" className="-ml-2.5 h-10 min-w-0">
      <ul className="flex h-full items-center gap-1 overflow-x-auto [scrollbar-width:none]">
        {sections.map((section) => {
          const current = section.id === active
          const disc = current ? tabDisc[section.id] : undefined
          return (
            <li key={section.id} className="flex-none">
              <DocLink
                href={section.href}
                aria-current={current ? "page" : undefined}
                className={`flex h-[34px] items-center gap-2 rounded-[17px] pr-3 text-[15px] whitespace-nowrap outline-none hover:bg-soft focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ink ${current ? "bg-soft font-semibold text-ink" : "font-medium text-ink2"} ${disc === undefined ? "pl-2.5" : "pl-1.5"}`}
              >
                {disc === undefined ? (
                  <Glyph
                    shape={iconOf(section.icon)}
                    size={18}
                    strokeWidth={1.75}
                    className={current ? "text-ink" : "text-sec"}
                  />
                ) : (
                  <span
                    aria-hidden="true"
                    className={`grid size-6 flex-none place-items-center rounded-full ${disc}`}
                  >
                    <Glyph
                      shape={iconOf(section.icon)}
                      size={14}
                      strokeWidth={2}
                    />
                  </span>
                )}
                {section.label}
              </DocLink>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

export function DocsHeader(): ReactNode {
  const pathname = useLocation({ select: (location) => location.pathname })
  const path = pathOf(pathname)
  const page = manifest.pages[path]
  // A missing page belongs to no product.
  const active = path === "/" || page !== undefined ? sectionOfPath(path) : null
  return (
    <header className="sticky top-0 z-30 hidden bg-bg shadow-[inset_0_-1px_0_var(--line)] md:block">
      <div className="mx-auto max-w-[1440px] px-8 lg:px-10">
        <div className="flex h-16 items-center gap-2.5">
          <Link
            to="/"
            className="mr-auto flex h-11 flex-none items-center rounded-md outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink"
          >
            <DocsLockup.Root
              form="full"
              height={22}
              className="hidden min-[73.8125rem]:block"
            />
            <DocsLockup.Root
              form="short"
              height={22}
              className="min-[73.8125rem]:hidden"
            />
          </Link>
          {page === undefined ? null : (
            <>
              <PageActions page={page} />
              <span aria-hidden="true" className="h-6 w-px flex-none bg-line" />
            </>
          )}
          {import.meta.env.VITE_FEEDBACK_URL ? (
            <FeedbackEntry
              endpoint={import.meta.env.VITE_FEEDBACK_URL}
              surface="docs"
              className="flex h-10 flex-none cursor-pointer items-center gap-2 rounded-[20px] bg-soft px-3.5 text-[15px] font-medium text-ink2 outline-none hover:bg-soft2 focus-visible:outline-2 focus-visible:outline-ink"
            >
              <FeedbackIcon size={18} strokeWidth={1.75} />
              Feedback
            </FeedbackEntry>
          ) : null}
          <button
            type="button"
            aria-label="Appearance"
            title="Appearance"
            aria-haspopup="dialog"
            onClick={() => openAppearance()}
            onPointerEnter={warmAppearance}
            onFocus={warmAppearance}
            className={iconButton}
          >
            <Glyph shape={shapes.palette} size={19} strokeWidth={1.75} />
          </button>
        </div>
        <ProductRow active={active} />
      </div>
    </header>
  )
}
