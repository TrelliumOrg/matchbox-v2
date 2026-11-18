import { createFileRoute } from "@tanstack/react-router"
import type { ReactNode } from "react"
import { getPoolsPage } from "../data/pools"
import { PoolsList } from "../explorer/pools/pools-page"
import { searchOf } from "../explorer/pools/search"

/**
 * Pools (`dMc3N9KRX2`): every tracked MUSD and MEZO pool on Mezo, Ethereum
 * and Base. `chain` and `token` filter the table, `small` shows the pools
 * under $25,000.
 */

type PoolsSearch = {
  chain?: "mezo" | "ethereum" | "base"
  token?: "musd" | "mezo"
  small?: true
}

export const Route = createFileRoute("/pools/")({
  // One chunk per route: every new chunk adds a stub and a file name to
  // the entry, which every Scan page loads.
  codeSplitGroupings: [["loader", "component"]],
  validateSearch: (search: Record<string, unknown>): PoolsSearch =>
    searchOf({
      chain:
        search.chain === "mezo" ||
        search.chain === "ethereum" ||
        search.chain === "base"
          ? search.chain
          : "all",
      asset:
        search.token === "musd" || search.token === "mezo"
          ? search.token
          : "all",
      small: search.small === true || search.small === "true",
    }),
  loaderDeps: ({ search }) => ({
    chain: search.chain ?? ("all" as const),
    asset: search.token ?? ("all" as const),
    small: search.small === true,
  }),
  loader: ({ deps }) => getPoolsPage({ data: deps }),
  head: () => ({ meta: [{ title: "Pools, Matchscan" }] }),
  component: function PoolsRoute(): ReactNode {
    return <PoolsList page={Route.useLoaderData()} />
  },
})
