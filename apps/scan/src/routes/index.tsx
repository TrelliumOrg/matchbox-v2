import { createFileRoute } from "@tanstack/react-router"
import { type ReactNode, Suspense } from "react"
import { getLatestBlocks } from "../data/explorer"
import { getHome } from "../data/home"
import { EpochGauges, HomeTiles } from "../explorer/home"
import { LatestBlocks, LatestBlocksHeading } from "../explorer/latest-blocks"
import { SectionState } from "../explorer/parts"
import { HomeSearch } from "../search/search-bar"
import { deferred } from "../shell/deferred"

/** Below the tiles: its own chunk, off the first paint's budget. */
const LatestBorrowing = deferred(() =>
  import("../explorer/home-borrowing").then((module) => module.LatestBorrowing),
)

/**
 * Home (`cP_-xnZA8I`, phone `Li0cKH1lMV`). The title is the LCP element.
 * "Latest blocks" comes from the proxy and then from BlockHub's head
 * messages, proposers named, with the average block time over the blocks
 * shown. The tiles (Borrowed, BTC collateral, open positions, veBTC
 * locked, Validators, the epoch's incentives), "Latest borrowing" (every
 * venue's newest borrow events, `/borrow/events`) and "Epoch gauges" come
 * from Matchscan's read routes, each left out when its read fails. Left
 * out until their data exists: MEZO unclaimed by validators, the lock
 * count, TVL, active addresses and Latest borrowing's health column (no
 * live state in the events).
 */
export const Route = createFileRoute("/")({
  loader: async () => {
    const [latest, home] = await Promise.all([getLatestBlocks(), getHome()])
    return { now: Math.floor(Date.now() / 1000), latest, home }
  },
  component: HomePage,
})

function HomePage(): ReactNode {
  const { now, latest, home } = Route.useLoaderData()
  return (
    <>
      <section className="flex flex-col items-center gap-8 pt-14 pb-4 text-center max-xl:items-stretch max-xl:gap-5 max-xl:pt-6">
        <h1 className="text-[44px] leading-tight font-[650] tracking-[-0.025em] max-xl:text-[32px]">
          Explore Mezo
        </h1>
        <div className="flex w-full justify-center">
          <HomeSearch />
        </div>
      </section>
      <HomeTiles tiles={home.tiles} />
      <Suspense fallback={null}>
        <LatestBorrowing rows={home.borrowing} />
      </Suspense>
      <div className="mt-14 grid gap-10 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <EpochGauges gauges={home.gauges} />
        <section aria-labelledby="latest-blocks">
          {latest.status === "ok" ? (
            <LatestBlocks
              seed={latest.data.blocks}
              proposers={latest.data.proposers}
              now={now}
            />
          ) : (
            <>
              <LatestBlocksHeading average={null} />
              <SectionState section={latest} />
            </>
          )}
        </section>
      </div>
    </>
  )
}
