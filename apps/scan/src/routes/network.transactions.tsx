import { createFileRoute } from "@tanstack/react-router"
import type { ReactNode } from "react"
import { pickCursor } from "../data/cursors"
import {
  activityCursorPattern,
  type TxTab,
  txTabOf,
} from "../data/transaction-tabs"
import { getTransactionsPage } from "../data/transactions"
import {
  TransactionsBody,
  TransactionTabs,
} from "../explorer/network/transactions-view"
import { NetworkHeader } from "../explorer/network-tabs"

/**
 * Transactions (`ndoSD6xB0U`): All in plain words (the decoded action
 * and subject where Matchscan knows them, the amount with its token) with
 * Blockscout's keyset pager, and the Votes, Claims and Swaps tabs from the
 * activity actions with their own merged cursor. Left out until their
 * data exists: the Loans, Transfers, Bridge and Contract calls tabs (no
 * list to filter), every tab's count (needs an aggregate), the hourly
 * chart and CSV.
 */

type TransactionsSearch = {
  tab?: Exclude<TxTab, "all">
  cursor?: string
  block_number?: string
  index?: string
}

function cursorOf(
  tab: TxTab,
  search: Record<string, unknown>,
): Record<string, string> | null {
  if (tab === "all") return pickCursor("transactions", search)
  return typeof search.cursor === "string" &&
    activityCursorPattern.test(search.cursor)
    ? { cursor: search.cursor }
    : null
}

export const Route = createFileRoute("/network/transactions")({
  validateSearch: (search: Record<string, unknown>): TransactionsSearch => {
    const tab = txTabOf(search.tab) ?? "all"
    return {
      ...(tab === "all" ? {} : { tab }),
      ...(cursorOf(tab, search) ?? {}),
    }
  },
  loaderDeps: ({ search }) => ({
    tab: search.tab ?? ("all" as const),
    cursor: cursorOf(search.tab ?? "all", search),
  }),
  loader: async ({ deps }) => ({
    now: Math.floor(Date.now() / 1000),
    paged: deps.cursor !== null,
    page: await getTransactionsPage({
      data: { tab: deps.tab, cursor: deps.cursor ?? {} },
    }),
  }),
  head: () => ({ meta: [{ title: "Transactions, Matchscan" }] }),
  component: TransactionsPage,
})

function TransactionsPage(): ReactNode {
  const { now, paged, page } = Route.useLoaderData()
  return (
    <>
      <NetworkHeader current="transactions" />
      <TransactionTabs current={page.tab} />
      <h2 className="sr-only">Latest transactions</h2>
      <div className="mt-4">
        <TransactionsBody page={page} paged={paged} now={now} />
      </div>
    </>
  )
}
