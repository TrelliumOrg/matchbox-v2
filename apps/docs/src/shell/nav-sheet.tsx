import { manifest } from "@matchbox/docs/manifest"
import { sectionById, sectionOfPath, sections } from "@matchbox/docs/site"
import { Glyph, shapes } from "@matchbox/ui/icons"
import { useLocation } from "@tanstack/react-router"
import type { ReactNode } from "react"
import { DocLink } from "../content/doc-link"
import { openAppearance } from "./appearance"
import { BottomSheet, hideSheet, navSheetId } from "./bottom-sheet"
import { PageTree } from "./page-tree"
import { iconOf } from "./section-icons"
import { outboundLinks } from "./site-footer"

const close = (): void => hideSheet(navSheetId)

/** The phone navigation sheet (Doop `Ex_NDcO1Cv`), and the 834 section pill's. */
export function NavSheet(): ReactNode {
  const pathname = useLocation({ select: (location) => location.pathname })
  const path = pathname.length > 1 ? pathname.replace(/\/$/, "") : pathname
  const section = sectionOfPath(path)
  const page = manifest.pages[path]
  const tree = page?.tree ?? sectionById(section).tree
  const tile =
    "flex h-[66px] flex-col items-center justify-center gap-1.5 rounded-[18px] text-[13.5px] text-ink2 outline-none hover:bg-soft focus-visible:outline-2 focus-visible:outline-ink"
  return (
    <BottomSheet id={navSheetId} label="Navigation">
      <nav aria-label="Sections">
        <ul className="grid grid-cols-4 gap-1">
          {sections.map((item) => (
            <li key={item.id}>
              <DocLink
                href={item.href}
                onClick={close}
                aria-current={item.id === section ? "page" : undefined}
                className={`${tile} ${item.id === section ? "bg-soft font-semibold text-ink" : ""}`}
              >
                <Glyph shape={iconOf(item.icon)} size={21} strokeWidth={1.7} />
                {item.label}
              </DocLink>
            </li>
          ))}
          <li>
            <button
              type="button"
              onClick={() => {
                close()
                openAppearance()
              }}
              className={`${tile} w-full cursor-pointer [@media(scripting:none)]:hidden`}
            >
              <Glyph shape={shapes.palette} size={21} strokeWidth={1.7} />
              Appearance
            </button>
          </li>
        </ul>
      </nav>
      <div className="mx-2 mt-3 border-t border-line pt-1">
        <PageTree tree={tree} current={path} onNavigate={close} open={false} />
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2 border-t border-line pt-4">
        {outboundLinks.map((link) => (
          <a
            key={link.href}
            href={link.href}
            className="flex h-12 items-center justify-center gap-2 rounded-3xl bg-soft text-[15px] font-semibold text-ink outline-none focus-visible:outline-2 focus-visible:outline-ink"
          >
            {link.label}
            <Glyph shape={shapes.arrowUpRight} size={16} strokeWidth={2} />
          </a>
        ))}
      </div>
    </BottomSheet>
  )
}
