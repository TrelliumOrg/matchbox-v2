import { Glyph, shapes } from "@matchbox/ui/icons"
import type { ReactNode } from "react"

/**
 * The site footer on every page (layout v2, Doop `WC_9ztyeY-`): Open Pro
 * and Open Matchscan, which moved here from the retired product rail, the
 * privacy policy, and the machine-readable files. The guideline's Status
 * and Terms links have no page behind them, so they are left out. Every
 * address here must be on src/shell/reviewed-links.ts (e2e/smoke.spec.ts).
 */

export const outboundLinks = [
  { href: "https://pro.matchbox.markets", label: "Open Pro" },
  { href: "https://scan.matchbox.markets", label: "Open Matchscan" },
] as const

const policies = [
  { href: "https://matchbox.markets/privacy", label: "Privacy" },
] as const

const files = [
  { href: "/llms.txt", label: "llms.txt" },
  { href: "/developer/openapi.json", label: "openapi.json" },
  { href: "/sitemap.xml", label: "sitemap.xml" },
] as const

// Phones: each link is at least 40 tall itself, not only under a finger
// (data-tap), and the rows close up to keep the footer's rhythm (D3).
const link =
  "flex items-center rounded-md outline-none hover:text-ink focus-visible:outline-2 focus-visible:outline-ink max-md:min-h-10"

export function SiteFooter({ home }: { home: boolean }): ReactNode {
  return (
    <footer
      className={`mx-auto max-w-[1440px] px-5 md:px-8 lg:px-10 ${home ? "pb-12" : "pb-[150px]"}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-t border-line pt-6 max-md:gap-y-2 text-[15px] text-sec">
        <ul className="flex flex-wrap items-center gap-x-[22px] gap-y-2 max-md:gap-y-0">
          {outboundLinks.map((item) => (
            <li key={item.href}>
              <a
                href={item.href}
                data-tap=""
                className={`gap-1.5 text-ink2 ${link}`}
              >
                <Glyph shape={shapes.arrowUpRight} size={15} strokeWidth={2} />
                {item.label}
              </a>
            </li>
          ))}
          {policies.map((item) => (
            <li key={item.href}>
              <a href={item.href} data-tap="" className={link}>
                {item.label}
              </a>
            </li>
          ))}
        </ul>
        <ul className="flex flex-wrap gap-x-[22px] gap-y-2 max-md:gap-y-0 font-mono text-[14px]">
          {files.map((item) => (
            <li key={item.href}>
              <a href={item.href} data-tap="" className={link}>
                {item.label}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </footer>
  )
}
