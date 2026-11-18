import { createFileRoute } from "@tanstack/react-router"
import type { ReactNode } from "react"
import { fetchLive, useLiveQuery } from "../data/live-query"
import { homeQuery, overviewQuery } from "../data/queries"
import type { Home, Overview } from "../data/view-models"
import { HomeView } from "../features/overview/home-view"
import { OverviewView } from "../features/overview/overview-view"

export const Route = createFileRoute("/")({
  loaderDeps: ({ search }) => ({ address: search.address ?? null }),
  loader: async ({ deps }) =>
    deps.address === null
      ? { kind: "home" as const, home: await fetchLive(homeQuery) }
      : {
          kind: "overview" as const,
          overview: await fetchLive(overviewQuery(deps.address)),
        },
  head: () => ({ meta: [{ title: "Overview, Matchbox Pro" }] }),
  component: OverviewRoute,
})

function SignedOutHome({ seed }: { seed: Home }): ReactNode {
  const data = useLiveQuery(homeQuery, seed)
  return <HomeView data={data} />
}

function Viewing({
  address,
  seed,
}: {
  address: string
  seed: Overview
}): ReactNode {
  const data = useLiveQuery(overviewQuery(address), seed)
  return <OverviewView data={data} />
}

function OverviewRoute(): ReactNode {
  const loaded = Route.useLoaderData()
  if (loaded.kind === "home") return <SignedOutHome seed={loaded.home} />
  return <Viewing address={loaded.overview.address} seed={loaded.overview} />
}
