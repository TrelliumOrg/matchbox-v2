import { createFileRoute, getRouteApi } from "@tanstack/react-router"
import { type ReactNode, Suspense } from "react"
import { rewardsSearch } from "../explorer/address/rewards-range"
import type { Span } from "../explorer/voting/range"
import { deferred } from "../shell/deferred"

/** The tab's body: its own chunk, off the first paint's budget. */
const RewardsTab = deferred(() =>
  import("../explorer/address/rewards-tab").then((module) => module.RewardsTab),
)

const parent = getRouteApi("/address/$address")

/**
 * Rewards (`eSwId--0MF`): a lock owner's rewards by epoch, claimable by
 * lock and claims, from the read models Matchbox Pro reads. An address
 * that never held a lock shows no Rewards tab (a typed URL says so).
 */
export const Route = createFileRoute("/address/$address/rewards")({
  validateSearch: (
    search: Record<string, unknown>,
  ): { range?: "90d" | "30d" } & Partial<Span> => rewardsSearch(search),
  head: () => ({ meta: [{ title: "Rewards, Matchscan" }] }),
  component: function RewardsRoute(): ReactNode {
    const { owner } = parent.useLoaderData()
    const { range } = Route.useSearch()
    if (!owner) {
      return (
        <p className="py-10 text-center text-[15px] text-sec">No rewards</p>
      )
    }
    return (
      <Suspense fallback={null}>
        <RewardsTab range={range ?? "All"} />
      </Suspense>
    )
  },
})
