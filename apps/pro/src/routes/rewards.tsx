import { shapes } from "@matchbox/ui/icons"
import { createFileRoute } from "@tanstack/react-router"
import type { ReactNode } from "react"
import { fetchLive, useLiveQuery } from "../data/live-query"
import { rewardsQuery } from "../data/queries"
import type { Rewards } from "../data/view-models"
import { RewardsView } from "../features/rewards/rewards-view"
import { SignedOut } from "../shell/states"

export const Route = createFileRoute("/rewards")({
  loaderDeps: ({ search }) => ({ address: search.address ?? null }),
  loader: async ({ deps }) =>
    deps.address === null ? null : fetchLive(rewardsQuery(deps.address)),
  head: () => ({ meta: [{ title: "Rewards, Matchbox Pro" }] }),
  component: RewardsRoute,
})

function LiveRewards({ seed }: { seed: Rewards }): ReactNode {
  const data = useLiveQuery(rewardsQuery(seed.address), seed)
  return <RewardsView data={data} />
}

function RewardsRoute(): ReactNode {
  const seed = Route.useLoaderData()
  if (seed === null) return <SignedOut title="Rewards" icon={shapes.gift} />
  return <LiveRewards seed={seed} />
}
