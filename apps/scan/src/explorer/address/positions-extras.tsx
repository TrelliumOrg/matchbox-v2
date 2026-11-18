import { Link } from "@tanstack/react-router"
import type { ReactNode } from "react"
import type { ActivityView } from "../../data/scan/activity-view"
import { ActivityList } from "../sentence"
import type { RewardsRange } from "./rewards-range"
import { WalletRewardsPanel } from "./rewards-tab"
import { useAddressWallet } from "./wallet-panels"

/**
 * Under Positions (`eSwId--0MF`, `ap-rewards` and `ap-activity`): a lock
 * owner's rewards by epoch beside the address's recent activity.
 */
export function PositionsExtras({
  address,
  range,
  recent,
  now,
}: {
  address: string
  range: RewardsRange
  recent: readonly ActivityView[]
  now: number
}): ReactNode {
  const panels = useAddressWallet()
  if (panels.status === "none" && recent.length === 0) return null
  return (
    <div className="grid items-start gap-x-10 lg:grid-cols-[1.15fr_1fr]">
      {panels.status === "none" ? (
        <span className="max-lg:hidden" />
      ) : (
        <WalletRewardsPanel panels={panels} range={range} />
      )}
      {recent.length === 0 ? null : (
        <section aria-label="Recent activity" className="mt-12">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="text-[15px] text-ink2">Recent activity</h2>
            <Link
              to="/address/$address/activity"
              params={{ address }}
              className="rounded-sm text-[15px] font-semibold underline underline-offset-[3px] outline-none focus-visible:outline-2 focus-visible:outline-ink"
            >
              All activity
            </Link>
          </div>
          <ActivityList rows={recent} now={now} />
        </section>
      )}
    </div>
  )
}
