import { createFileRoute, getRouteApi } from "@tanstack/react-router"
import { type ReactNode, Suspense } from "react"
import { Positions } from "../explorer/address/positions"
import { rewardsSearch } from "../explorer/address/rewards-range"
import type { Span } from "../explorer/voting/range"
import { deferred } from "../shell/deferred"

const parent = getRouteApi("/address/$address")

/** Recent activity shows this many rows; the Activity tab has the rest. */
const recentRows = 5

/** Below the positions: its own chunk, off the first paint's budget. */
const PositionsExtras = deferred(() =>
  import("../explorer/address/positions-extras").then(
    (module) => module.PositionsExtras,
  ),
)

/**
 * Positions (`eSwId--0MF`): locks and open loans from the document, then a
 * lock owner's rewards by epoch beside the recent activity.
 */
export const Route = createFileRoute("/address/$address/")({
  validateSearch: (
    search: Record<string, unknown>,
  ): { range?: "90d" | "30d" } & Partial<Span> => rewardsSearch(search),
  component: function PositionsTab(): ReactNode {
    const { address, doc, owner, now } = parent.useLoaderData()
    const { range } = Route.useSearch()
    const recent =
      doc.activity.status === "ok"
        ? doc.activity.data.items.slice(0, recentRows)
        : []
    return (
      <>
        <Positions address={address} locks={doc.locks} borrow={doc.borrow} />
        {!owner && recent.length === 0 ? null : (
          <Suspense fallback={null}>
            <PositionsExtras
              address={address}
              range={range ?? "All"}
              recent={recent}
              now={now}
            />
          </Suspense>
        )}
      </>
    )
  },
})
