import { Link } from "@tanstack/react-router"
import type { ReactNode } from "react"
import type { NetworkOverview } from "../../data/network"
import { SectionHeading, SectionState } from "../parts"
import { ActivityList } from "../sentence"

/**
 * The Network overview's latest activity, in plain words. Server rendered
 * like the rest of the page, but loaded as its own chunk so the sentence
 * code stays off the first paint's script budget.
 */

const linkClass =
  "rounded-sm font-semibold text-ink underline underline-offset-4 outline-none focus-visible:outline-2 focus-visible:outline-ink"

export function LatestActivity({
  activity,
  now,
}: {
  activity: NetworkOverview["activity"]
  now: NetworkOverview["now"]
}): ReactNode {
  return (
    <section aria-labelledby="latest-activity" className="mt-12">
      <SectionHeading
        id="latest-activity"
        aside={
          <Link to="/network/transactions" className={linkClass}>
            All transactions
          </Link>
        }
      >
        Latest activity
      </SectionHeading>
      {activity.status !== "ok" ? (
        <SectionState section={activity} />
      ) : activity.data.rows.length === 0 ? (
        <p className="py-10 text-center text-[15px] text-sec">No activity</p>
      ) : (
        <ActivityList rows={activity.data.rows} now={now} />
      )}
    </section>
  )
}
