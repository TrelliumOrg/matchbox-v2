import { Glyph, shapes } from "@matchbox/ui/icons"
import type { ReactNode } from "react"

/**
 * The site footer on every page (layout v2, Doop `WC_9ztyeY-`): Open Pro
 * and Open Matchscan, which moved here from the retired product rail, the
 * policies, and the machine-readable files. The guideline's Status link
 * has no page behind it, so it is left out.
 */

export const outboundLinks = [
  { href: "https://pro.matchbox.markets", label: "Open Pro" },
  { href: "https://scan.matchbox.markets", label: "Open Matchscan" },
] as const

const policies = [
  { href: "https://matchbox.markets/privacy", label: "Privacy" },
  { href: "https://matchbox.markets/terms", label: "Terms" },
] as const

const files = [
  { href: "/llms.txt", label: "llms.txt" },
  { href: "/developer/openapi.json", label: "openapi.json" },
  { href: "/sitemap.xml", label: "sitemap.xml" },
] as const

const link =
  "rounded-md outline-none hover:text-ink focus-visible:outline-2 focus-visible:outline-ink"

export function SiteFooter({ home }: { home: boolean }): ReactNode {
  return (
    <footer
      className={`mx-auto max-w-[1440px] px-5 md:px-8 lg:px-10 ${home ? "pb-12" : "pb-[150px]"}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-t border-line pt-6 max-md:gap-y-[26px] text-[15px] text-sec">
        <ul className="flex flex-wrap items-center gap-x-[22px] gap-y-2 max-md:gap-y-[26px]">
          {outboundLinks.map((item) => (
            <li key={item.href}>
              <a
                href={item.href}
                data-tap=""
                className={`flex items-center gap-1.5 text-ink2 ${link}`}
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
        <ul className="flex flex-wrap gap-x-[22px] gap-y-2 max-md:gap-y-[26px] font-mono text-[14px]">
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
