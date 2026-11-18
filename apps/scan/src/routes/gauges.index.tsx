import { createFileRoute } from "@tanstack/react-router"
import type { ReactNode } from "react"
import { type GaugeSort, type GaugeType, getGaugesPage } from "../data/gauges"
import { GaugesView } from "../explorer/voting/gauges-page"

type Search = {
  type?: Exclude<GaugeType, "all">
  sort?: GaugeSort
  /** The previous page's last gauge: this page starts after it. */
  after?: string
}

function afterOf(value: unknown): string | undefined {
  return typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value)
    ? value.toLowerCase()
    : undefined
}

function typeOf(value: unknown): Search["type"] {
  return value === "vebtc" ||
    value === "mezo" ||
    value === "validator" ||
    value === "pool"
    ? value
    : undefined
}

function sortOf(value: unknown): Search["sort"] {
  return value === "rewards" || value === "apy" || value === "voters"
    ? value
    : undefined
}

/**
 * Gauges (`ELrUTI5YDe`). The type tab, the order and the page are search
 * params: one table, filtered, ordered and paged over every gauge on the
 * server, so a tab loads no code of its own and paging needs no script.
 * The defaults (all types, by votes, the first page) stay out of the URL.
 */
export const Route = createFileRoute("/gauges/")({
  validateSearch: (search: Record<string, unknown>): Search => {
    const type = typeOf(search.type)
    const sort = sortOf(search.sort)
    const after = afterOf(search.after)
    return {
      ...(type === undefined ? {} : { type }),
      ...(sort === undefined ? {} : { sort }),
      ...(after === undefined ? {} : { after }),
    }
  },
  loaderDeps: ({
    search,
  }): { type: GaugeType; sort: GaugeSort; after: string | null } => ({
    type: search.type ?? "all",
    sort: search.sort ?? "votes",
    after: search.after ?? null,
  }),
  loader: ({ deps }) => getGaugesPage({ data: deps }),
  head: () => ({ meta: [{ title: "Gauges, Matchscan" }] }),
  component: function GaugesRoute(): ReactNode {
    return <GaugesView page={Route.useLoaderData()} />
  },
})
