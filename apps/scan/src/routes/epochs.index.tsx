import { createFileRoute } from "@tanstack/react-router"
import type { ReactNode } from "react"
import { getEpochsPage } from "../data/epochs"
import { EpochsView } from "../explorer/voting/epochs-page"
import { cursorOf } from "../explorer/voting/range"

/** Epochs (`T4lYGIj9dz`); `cursor` pages the epochs table. */
export const Route = createFileRoute("/epochs/")({
  validateSearch: (search: Record<string, unknown>): { cursor?: string } => {
    const cursor = cursorOf(search.cursor)
    return cursor === undefined ? {} : { cursor }
  },
  loaderDeps: ({ search }) => ({ cursor: search.cursor ?? null }),
  loader: ({ deps }) => getEpochsPage({ data: { cursor: deps.cursor } }),
  head: () => ({ meta: [{ title: "Epochs, Matchscan" }] }),
  component: function EpochsRoute(): ReactNode {
    return <EpochsView page={Route.useLoaderData()} />
  },
})
