import { shapes } from "@matchbox/ui/icons"
import * as ListRow from "@matchbox/ui/list-row"
import { Link } from "@tanstack/react-router"
import type { ReactNode } from "react"
import { ActivityRow } from "../../components/activity-row"
import type { ActivityEvent } from "../../data/view-models"
import { useLive } from "../../live/live-context"
import { SectionHeading, underlineLink } from "../../shell/page"
import { EmptyState } from "../../shell/states"
import { ownEvents, useOwnTxs } from "../../tx/own-txs"

/** Rows on Overview: the latest three. */
const shown = 3

/**
 * The three latest events on Overview, below the lock cards. What this
 * browser sent and the indexer does not list yet comes first, as on
 * Activity: "Confirming", then confirmed, until the indexed row replaces
 * it. So a lock made a moment ago is on this page before the indexer has
 * it.
 */
export function OverviewActivity({
  events,
  address,
}: {
  events: readonly ActivityEvent[]
  /** Whose Overview this is. */
  address: string
}): ReactNode {
  const { market } = useLive()
  const own = ownEvents(useOwnTxs(), address, events, () => market.epoch.number)
  const data = { activity: [...own, ...events].slice(0, shown) }
  return (
    <section className="mt-11">
      <SectionHeading
        action={
          data.activity.length === 0 ? null : (
            <Link to="/activity" className={underlineLink}>
              See all
            </Link>
          )
        }
      >
        Activity
      </SectionHeading>
      {data.activity.length === 0 ? (
        <EmptyState icon={shapes.list} title="No activity" variant="plain" />
      ) : (
        <ListRow.List className="mt-2.5">
          {data.activity.map((event) => (
            <ActivityRow key={event.id} event={event} context="summary" />
          ))}
        </ListRow.List>
      )}
    </section>
  )
}
