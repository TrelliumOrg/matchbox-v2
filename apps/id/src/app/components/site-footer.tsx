import type { ReactNode } from "react"
import { legalLinks } from "../lib/legal"

/**
 * The Matchbox footer links, in the homepage's set and order
 * (apps/home/src/page/sections.tsx): the products, then Privacy. Docs
 * opens Matchbox ID's own pages there, and Privacy its section of the
 * policy. Each link is at least 40 by 40 to tap or click.
 */
export const footerLinks = [
  { label: "Pro", href: "https://pro.matchbox.markets" },
  { label: "Matchscan", href: "https://scan.matchbox.markets" },
  { label: "ID", href: "https://id.matchbox.markets" },
  { label: "Developer", href: "https://developer.matchbox.markets" },
  { label: "Docs", href: "https://docs.matchbox.markets/id" },
  { label: "Classic", href: "https://app.matchbox.markets" },
  { label: "Privacy", href: legalLinks.privacy },
] as const

export const footerLinkClass =
  "inline-flex min-h-10 min-w-10 items-center justify-center rounded-md px-2 outline-none hover:text-ink focus-visible:outline-2 focus-visible:outline-ink"

export function SiteLinks(): ReactNode {
  return (
    <nav aria-label="Matchbox">
      <ul className="-mx-2 flex flex-wrap items-center gap-x-1 text-[15px] text-sec">
        {footerLinks.map((link) => (
          <li key={link.label}>
            <a href={link.href} className={footerLinkClass}>
              {link.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  )
}
