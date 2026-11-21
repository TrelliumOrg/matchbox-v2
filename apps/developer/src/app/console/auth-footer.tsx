import type { ReactNode } from "react"
import { privacyPolicyUrl } from "../../worker/privacy"
import { developerDocsUrl } from "../lib/docs-links"

/**
 * The Matchbox footer links, in the homepage's set and order
 * (apps/home/src/page/sections.tsx): the products, then Privacy. Docs
 * opens Developer's own pages there, and Privacy its section of the
 * policy. The frames (`BF74sUHnMt`, `MDJphzcBIH`) also link "Status";
 * there is no status page yet, so it is left out.
 */
export const footerLinks = [
  { label: "Pro", href: "https://pro.matchbox.markets" },
  { label: "Matchscan", href: "https://scan.matchbox.markets" },
  { label: "ID", href: "https://id.matchbox.markets" },
  { label: "Developer", href: "https://developer.matchbox.markets" },
  { label: "Docs", href: developerDocsUrl },
  { label: "Classic", href: "https://app.matchbox.markets" },
  { label: "Privacy", href: privacyPolicyUrl },
] as const

const link =
  "inline-flex min-h-10 min-w-10 items-center justify-center rounded-md px-2 outline-none hover:text-ink focus-visible:outline-2 focus-visible:outline-ink"

/**
 * The signed-out pages' footer. Each link is at least 40 by 40 to tap or
 * click, at the text's size.
 */
export function AuthFooter(): ReactNode {
  return (
    <footer className="flex justify-center px-3 pb-8">
      <nav
        aria-label="Matchbox"
        className="flex flex-wrap justify-center gap-x-1 text-[15px] text-sec"
      >
        {footerLinks.map((item) => (
          <a key={item.label} href={item.href} data-tap="" className={link}>
            {item.label}
          </a>
        ))}
      </nav>
    </footer>
  )
}
