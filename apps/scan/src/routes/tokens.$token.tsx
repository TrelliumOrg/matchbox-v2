import { createFileRoute, notFound, redirect } from "@tanstack/react-router"
import type { ReactNode } from "react"
import { pickCursor } from "../data/cursors"
import { type TokenTab, tokenSlugOf, tokenTabOf } from "../data/scan/token-list"
import { getTokenPage } from "../data/token-pages"
import { getTokenTab } from "../data/token-tabs"
import { TokenView } from "../explorer/tokens/token-page"
import {
  type PeriodInput,
  periodInput,
  periodSearch,
  type Range,
} from "../explorer/voting/range"

/**
 * A token's page, by its slug: MUSD (`iuXYHNtoLX`) and MEZO
 * (`ZaITnY1T_X`). Its address or symbol in any case redirects to the
 * slug, so the page has one URL; any other token is not found here (the
 * Tokens list links the rest to their address). `range` (or a custom
 * span's `from` and `to`) picks the panels' period, `tab` a tab past Overview (Holders, Transfers, Contract), and
 * Transfers pages by the proxy's keyset cursor.
 */

type TokenSearch = {
  range?: Range
  from?: string
  to?: string
  tab?: Exclude<TokenTab, "overview">
  block_number?: string
  index?: string
}
export const Route = createFileRoute("/tokens/$token")({
  // One chunk per route: every new chunk adds a stub and a file name to
  // the entry, which every Scan page loads.
  codeSplitGroupings: [["loader", "component"]],
  validateSearch: (search: Record<string, unknown>): TokenSearch => {
    const tab = tokenTabOf(search.tab)
    const cursor =
      tab === "transfers" ? pickCursor("tokenTransfers", search) : null
    return {
      ...periodSearch(search),
      ...(tab === null || tab === "overview" ? {} : { tab }),
      ...(cursor ?? {}),
    }
  },
  loaderDeps: ({
    search,
  }): {
    period: PeriodInput
    tab: TokenTab
    cursor: Record<string, string> | null
  } => ({
    period: periodInput(search),
    tab: search.tab ?? "overview",
    cursor:
      search.tab === "transfers" ? pickCursor("tokenTransfers", search) : null,
  }),
  loader: async ({ params, deps }) => {
    const token = tokenSlugOf(params.token)
    if (token === null) throw notFound()
    if (!token.canonical) {
      // The one URL keeps the period asked for (30d is the default).
      throw redirect({
        to: "/tokens/$token",
        params: { token: token.slug },
        search: {
          ...(deps.period.range === "30d" ? {} : { range: deps.period.range }),
          ...(deps.period.from === undefined
            ? {}
            : { from: deps.period.from, to: deps.period.to }),
          ...(deps.tab === "overview" ? {} : { tab: deps.tab }),
        },
        statusCode: 301,
      })
    }
    const now = Math.floor(Date.now() / 1000)
    const tab = deps.tab
    const [page, tabData] = await Promise.all([
      getTokenPage({ data: { slug: token.slug, ...deps.period } }),
      tab === "overview"
        ? Promise.resolve(null)
        : getTokenTab({
            data: { slug: token.slug, tab, cursor: deps.cursor ?? {} },
          }),
    ])
    return { page, tab: tabData, paged: deps.cursor !== null, now }
  },
  head: ({ loaderData }) => ({
    meta: [
      {
        title:
          loaderData === undefined
            ? "Token, Matchscan"
            : `${loaderData.page.token.symbol}, Matchscan`,
      },
    ],
  }),
  component: function TokenRoute(): ReactNode {
    const { page, tab, paged, now } = Route.useLoaderData()
    return <TokenView page={page} tab={tab} paged={paged} now={now} />
  },
})
