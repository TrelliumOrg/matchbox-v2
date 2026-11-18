import type { ReactNode } from "react"
import { privacyPolicyUrl } from "../../worker/privacy"
import { developerDocsUrl } from "../lib/docs-links"

/**
 * The signed-out pages' footer (`BF74sUHnMt`, `MDJphzcBIH`). The frames
 * also link "Status"; there is no status page yet, so it is left out.
 */
export function AuthFooter(): ReactNode {
  return (
    <footer className="flex justify-center pb-11">
      <nav
        aria-label="Matchbox"
        className="flex flex-wrap justify-center gap-7 text-[15px] text-sec"
      >
        <a href={developerDocsUrl} data-tap="" className="hover:text-ink">
          Docs
        </a>
        <a
          href="https://pro.matchbox.markets"
          data-tap=""
          className="hover:text-ink"
        >
          Matchbox Pro
        </a>
        <a href={privacyPolicyUrl} data-tap="" className="hover:text-ink">
          Privacy
        </a>
      </nav>
    </footer>
  )
}
