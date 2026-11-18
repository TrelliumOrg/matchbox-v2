import * as SubTabs from "@matchbox/ui/sub-tabs"
import { Link } from "@tanstack/react-router"
import type { ReactNode } from "react"
import type { TokenSlug, TokenTab } from "../../data/scan/token-list"

/**
 * The MUSD and MEZO pages' tabs (`iuXYHNtoLX`, `ZaITnY1T_X`): Overview
 * (the panels), Holders, Transfers and Contract from the Blockscout proxy.
 */

export const tabNames: Record<TokenTab, string> = {
  overview: "Overview",
  holders: "Holders",
  transfers: "Transfers",
  contract: "Contract",
}

export function TokenTabBar({
  slug,
  current,
  holders,
}: {
  slug: TokenSlug
  current: TokenTab
  /** "29,242" once the Holders tab has read it. */
  holders: string | null
}): ReactNode {
  return (
    <SubTabs.Root label="Token" className="mt-5">
      {(Object.keys(tabNames) as TokenTab[]).map((tab) => (
        <SubTabs.Item key={tab}>
          <Link
            to="/tokens/$token"
            params={{ token: slug }}
            search={tab === "overview" ? {} : { tab }}
            aria-current={tab === current ? "page" : undefined}
            activeOptions={{ exact: true, includeSearch: true }}
            activeProps={{}}
          >
            {tabNames[tab]}
            {tab === "holders" && holders !== null ? (
              <span className="text-[14px] font-normal text-sec tabular-nums">
                {holders}
              </span>
            ) : null}
          </Link>
        </SubTabs.Item>
      ))}
    </SubTabs.Root>
  )
}
