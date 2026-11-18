import { createFileRoute } from "@tanstack/react-router"
import type { ReactNode } from "react"
import { getLocksPage, type LockOrder } from "../data/locks"
import { LocksView } from "../explorer/voting/locks-page"
import {
  cursorOf,
  periodInput,
  periodSearch,
  type Range,
} from "../explorer/voting/range"

type Search = {
  escrow?: "vemezo"
  order?: Exclude<LockOrder, "amount">
  range?: Exclude<Range, "30d">
  from?: string
  to?: string
  cursor?: string
}

function orderOf(value: unknown): Search["order"] {
  return value === "unlock" || value === "created" ? value : undefined
}

/**
 * Locks (`uNyejMCnPb`). The escrow tab, the order, the panels' period
 * (`range`, or a custom span's `from` and `to`) and
 * the list's cursor are search params; defaults (veBTC, largest, 30d) stay
 * out of the URL.
 */
export const Route = createFileRoute("/locks/")({
  validateSearch: (search: Record<string, unknown>): Search => {
    const order = orderOf(search.order)
    const cursor = cursorOf(search.cursor)
    return {
      ...(search.escrow === "vemezo" ? { escrow: "vemezo" as const } : {}),
      ...(order === undefined ? {} : { order }),
      ...periodSearch(search),
      ...(cursor === undefined ? {} : { cursor }),
    }
  },
  loaderDeps: ({ search }) => ({
    escrow: search.escrow ?? ("vebtc" as const),
    order: search.order ?? ("amount" as const),
    ...periodInput(search),
    cursor: search.cursor ?? null,
  }),
  loader: ({ deps }) => getLocksPage({ data: deps }),
  head: () => ({ meta: [{ title: "Locks, Matchscan" }] }),
  component: function LocksRoute(): ReactNode {
    return <LocksView page={Route.useLoaderData()} />
  },
})
