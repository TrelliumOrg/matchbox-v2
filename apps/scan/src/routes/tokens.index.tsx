import { createFileRoute } from "@tanstack/react-router"
import type { ReactNode } from "react"
import { getTokensPage, type TokenSort } from "../data/token-pages"
import { TokensView } from "../explorer/tokens/tokens-page"

/**
 * Tokens (`PnId7WLIDs`): the listed tokens' supply, holders and prices,
 * in the registry's order or sorted by value on Mezo or holders (`sort`).
 */
export const Route = createFileRoute("/tokens/")({
  // One chunk per route: every new chunk adds a stub and a file name to
  // the entry, which every Scan page loads.
  codeSplitGroupings: [["loader", "component"]],
  validateSearch: (search: Record<string, unknown>): { sort?: TokenSort } =>
    search.sort === "value" || search.sort === "holders"
      ? { sort: search.sort }
      : {},
  loaderDeps: ({ search }): { sort: TokenSort } => ({
    sort: search.sort ?? "listed",
  }),
  loader: ({ deps }) => getTokensPage({ data: { sort: deps.sort } }),
  head: () => ({ meta: [{ title: "Tokens, Matchscan" }] }),
  component: function TokensRoute(): ReactNode {
    return <TokensView page={Route.useLoaderData()} />
  },
})
