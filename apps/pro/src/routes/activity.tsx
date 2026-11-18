import { shapes } from "@matchbox/ui/icons"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import type { ReactNode } from "react"
import { fetchLive, useLiveQuery } from "../data/live-query"
import { activityQuery, loadProApi } from "../data/queries"
import type { ActivityFilter, ActivityPage } from "../data/view-models"
import { ActivityView } from "../features/activity/activity-view"
import { activityFilters } from "../features/activity/filters"
import { useHead } from "../live/heads"
import { chainNow, useLive } from "../live/live-context"
import { SignedOut } from "../shell/states"
import { ownEvents, useOwnTxs } from "../tx/own-txs"

type ActivitySearch = { filter?: ActivityFilter | undefined }

function validateActivitySearch(
  search: Record<string, unknown>,
): ActivitySearch {
  const filter = activityFilters.find((entry) => entry.value === search.filter)
  return filter === undefined || filter.value === "all"
    ? {}
    : { filter: filter.value }
}

export const Route = createFileRoute("/activity")({
  validateSearch: validateActivitySearch,
  loaderDeps: ({ search }) => ({
    address: search.address ?? null,
    filter: search.filter ?? "all",
  }),
  loader: async ({ deps }) =>
    deps.address === null
      ? null
      : fetchLive(activityQuery(deps.address, deps.filter)),
  head: () => ({ meta: [{ title: "Activity, Matchbox Pro" }] }),
  component: ActivityRoute,
})

function LiveActivity({
  seed,
  filter,
}: {
  seed: ActivityPage
  filter: ActivityFilter
}): ReactNode {
  const data = useLiveQuery(activityQuery(seed.address, filter), seed)
  const navigate = useNavigate({ from: Route.fullPath })
  const { store, market } = useLive()
  const head = useHead(store)
  // What this browser sent and the indexer does not list yet.
  const own = ownEvents(
    useOwnTxs(),
    seed.address,
    data.events,
    () => market.epoch.number,
  )
  return (
    <ActivityView
      data={data}
      filter={filter}
      today={chainNow(market, head.number)}
      own={own}
      loadMore={async (cursor) =>
        (await loadProApi()).getActivity({
          data: { address: seed.address, filter, cursor },
        })
      }
      onFilter={(next) =>
        void navigate({
          search: (previous) => ({
            ...previous,
            filter: next === "all" ? undefined : next,
          }),
          replace: true,
          resetScroll: false,
          viewTransition: false,
        })
      }
    />
  )
}

function ActivityRoute(): ReactNode {
  const seed = Route.useLoaderData()
  const search = Route.useSearch()
  if (seed === null) return <SignedOut title="Activity" icon={shapes.list} />
  return <LiveActivity seed={seed} filter={search.filter ?? "all"} />
}
