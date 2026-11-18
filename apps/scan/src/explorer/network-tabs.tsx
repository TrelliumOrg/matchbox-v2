import * as SubTabs from "@matchbox/ui/sub-tabs"
import { Link } from "@tanstack/react-router"
import type { ReactNode } from "react"
import { PageTitle } from "../shell/page"

/**
 * The Network page's title and tabs (`-5H-NByPdL`, `ndoSD6xB0U`,
 * `YY3BAmH_lR`). Only the tabs with data show: Activity, Fees, DEX and
 * Bridge need read models that do not exist yet, and so do the per-tab
 * 24h counts. Each tab is current on its own path only.
 */
export function NetworkHeader({
  current,
}: {
  current: "overview" | "transactions" | "blocks"
}): ReactNode {
  return (
    <>
      <PageTitle>Network</PageTitle>
      <SubTabs.Root label="Network" className="mt-4 mb-8">
        <SubTabs.Item>
          <Link
            to="/network"
            activeOptions={{ exact: true }}
            aria-current={current === "overview" ? "page" : undefined}
          >
            Overview
          </Link>
        </SubTabs.Item>
        <SubTabs.Item>
          <Link
            to="/network/transactions"
            activeOptions={{ exact: true }}
            aria-current={current === "transactions" ? "page" : undefined}
          >
            Transactions
          </Link>
        </SubTabs.Item>
        <SubTabs.Item>
          <Link
            to="/network/blocks"
            activeOptions={{ exact: true }}
            aria-current={current === "blocks" ? "page" : undefined}
          >
            Blocks
          </Link>
        </SubTabs.Item>
      </SubTabs.Root>
    </>
  )
}
