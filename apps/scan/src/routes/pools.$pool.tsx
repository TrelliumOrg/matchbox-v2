import { createFileRoute, notFound, redirect } from "@tanstack/react-router"
import type { ReactNode } from "react"
import { canonicalAddress } from "../data/canonical"
import { getPoolPage } from "../data/pools"
import { PoolView } from "../explorer/pools/pool-page"

/**
 * A pool on Mezo, by its address (`OwLr8LSozA`'s layout). Pools on
 * Ethereum and Base carry their chain: `/pools/{chain}/{address}`.
 */
export const Route = createFileRoute("/pools/$pool")({
  codeSplitGroupings: [["loader", "component"]],
  loader: async ({ params }) => {
    const pool = canonicalAddress(params.pool)
    if (pool === null) throw notFound()
    if (pool !== params.pool) {
      throw redirect({
        to: "/pools/$pool",
        params: { pool },
        statusCode: 301,
      })
    }
    const page = await getPoolPage({ data: { chain: "mezo", pool } })
    if (page.pool.status === "missing") throw notFound()
    return page
  },
  head: ({ loaderData }) => ({
    meta: [
      {
        title:
          loaderData?.pool.status === "ok"
            ? `${loaderData.pool.data.row.title} on Mezo, Matchscan`
            : "Pool, Matchscan",
      },
    ],
  }),
  component: function PoolRoute(): ReactNode {
    return <PoolView page={Route.useLoaderData()} />
  },
})
