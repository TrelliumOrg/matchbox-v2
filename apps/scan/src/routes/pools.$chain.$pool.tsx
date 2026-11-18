import { createFileRoute, notFound, redirect } from "@tanstack/react-router"
import type { ReactNode } from "react"
import { getPoolPage } from "../data/pools"
import { PoolView } from "../explorer/pools/pool-page"

/**
 * A pool on Ethereum or Base (`OwLr8LSozA`), by its address or, for a
 * Uniswap v4 pool, its pool id. Its addresses link to Etherscan or
 * Basescan, never to a Matchscan address page. A Mezo pool redirects to
 * `/pools/{address}`.
 */

const poolId = /^0x([0-9a-f]{40}|[0-9a-f]{64})$/

export const Route = createFileRoute("/pools/$chain/$pool")({
  codeSplitGroupings: [["loader", "component"]],
  loader: async ({ params }) => {
    const chain = params.chain.toLowerCase()
    const pool = params.pool.toLowerCase()
    if (!poolId.test(pool)) throw notFound()
    if (chain === "mezo") {
      throw redirect({ to: "/pools/$pool", params: { pool }, statusCode: 301 })
    }
    if (chain !== "ethereum" && chain !== "base") throw notFound()
    if (chain !== params.chain || pool !== params.pool) {
      throw redirect({
        to: "/pools/$chain/$pool",
        params: { chain, pool },
        statusCode: 301,
      })
    }
    const page = await getPoolPage({ data: { chain, pool } })
    if (page.pool.status === "missing") throw notFound()
    return page
  },
  head: ({ loaderData }) => ({
    meta: [
      {
        title:
          loaderData?.pool.status === "ok"
            ? `${loaderData.pool.data.row.title} on ${loaderData.pool.data.row.chainName}, Matchscan`
            : "Pool, Matchscan",
      },
    ],
  }),
  component: function PoolRoute(): ReactNode {
    return <PoolView page={Route.useLoaderData()} />
  },
})
