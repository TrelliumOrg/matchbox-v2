import { createFileRoute } from "@tanstack/react-router"
import type { ReactNode } from "react"
import { getNetworkOverview } from "../data/network"
import { NetworkOverviewView } from "../explorer/network/overview-page"
import {
  type PeriodInput,
  periodInput,
  periodSearch,
  type Range,
  type Span,
} from "../explorer/voting/range"

/**
 * The Network overview (`-5H-NByPdL`), beside the Transactions and Blocks
 * tabs. The panels' period is a search param (`range`, or a custom span's
 * `from` and `to`); the default (30d) stays out of the URL.
 */
export const Route = createFileRoute("/network/")({
  // One chunk per route: every new chunk adds a stub and a file name to
  // the entry, which every Scan page loads.
  codeSplitGroupings: [["loader", "component"]],
  validateSearch: (
    search: Record<string, unknown>,
  ): { range?: Range } & Partial<Span> => periodSearch(search),
  loaderDeps: ({ search }): PeriodInput => periodInput(search),
  loader: ({ deps }) => getNetworkOverview({ data: deps }),
  head: () => ({ meta: [{ title: "Network, Matchscan" }] }),
  component: function NetworkRoute(): ReactNode {
    return <NetworkOverviewView page={Route.useLoaderData()} />
  },
})
