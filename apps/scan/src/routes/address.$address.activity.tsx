import { createFileRoute, getRouteApi } from "@tanstack/react-router"
import type { ReactNode } from "react"
import { getAddressActivity } from "../data/address"
import { canonicalAddress } from "../data/canonical"
import { Pager, SectionState } from "../explorer/parts"
import { ActivityList } from "../explorer/sentence"

const parent = getRouteApi("/address/$address")
const scanCursor = /^[A-Za-z0-9_-]{4,512}$/

/**
 * Activity in plain words, by address (keyset pager). The first page is
 * the composed document's; later pages read /activity/address.
 */
export const Route = createFileRoute("/address/$address/activity")({
  validateSearch: (search: Record<string, unknown>): { cursor?: string } =>
    typeof search.cursor === "string" && scanCursor.test(search.cursor)
      ? { cursor: search.cursor }
      : {},
  loaderDeps: ({ search }) => ({ cursor: search.cursor ?? null }),
  loader: async ({ params, deps }) => ({
    later:
      deps.cursor === null
        ? null
        : await getAddressActivity({
            data: {
              address: canonicalAddress(params.address) ?? "",
              cursor: deps.cursor,
            },
          }),
  }),
  head: () => ({ meta: [{ title: "Activity, Matchscan" }] }),
  component: function ActivityTab(): ReactNode {
    const { address, doc, now } = parent.useLoaderData()
    const { later } = Route.useLoaderData()
    const activity = later ?? doc.activity
    if (activity.status !== "ok") return <SectionState section={activity} />
    if (activity.data.items.length === 0) {
      return (
        <p className="py-10 text-center text-[15px] text-sec">No activity</p>
      )
    }
    return (
      <>
        <ActivityList rows={activity.data.items} now={now} />
        <Pager
          label="Activity pages"
          paged={later !== null}
          next={activity.data.next}
          skipped={activity.skipped}
          restarted={activity.restarted}
          to="/address/$address/activity"
          params={{ address }}
        />
      </>
    )
  },
})
