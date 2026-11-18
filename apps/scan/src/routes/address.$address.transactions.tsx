import { createFileRoute, getRouteApi } from "@tanstack/react-router"
import type { ReactNode } from "react"
import { canonicalAddress } from "../data/canonical"
import { pickCursor } from "../data/cursors"
import { getAddressTransactions } from "../data/explorer"
import { Pager, SectionState } from "../explorer/parts"
import { TransactionsTable } from "../explorer/tables"

const parent = getRouteApi("/address/$address")

/** All transactions, from Blockscout through the proxy (keyset pager). */
export const Route = createFileRoute("/address/$address/transactions")({
  validateSearch: (search: Record<string, unknown>) =>
    pickCursor("addressTransactions", search) ?? {},
  loaderDeps: ({ search }) => ({ cursor: search }),
  loader: async ({ params, deps }) => ({
    list: await getAddressTransactions({
      data: {
        address: canonicalAddress(params.address) ?? "",
        cursor: deps.cursor,
      },
    }),
    paged: pickCursor("addressTransactions", deps.cursor) !== null,
  }),
  head: () => ({ meta: [{ title: "All transactions, Matchscan" }] }),
  component: function ListTab(): ReactNode {
    const { address, now } = parent.useLoaderData()
    const { list, paged } = Route.useLoaderData()
    if (list.status !== "ok") return <SectionState section={list} />
    return (
      <>
        <TransactionsTable
          caption="Transactions"
          rows={list.data.items}
          now={now}
        />
        <Pager
          label="Transaction pages"
          paged={paged}
          next={list.data.next}
          to="/address/$address/transactions"
          params={{ address }}
        />
      </>
    )
  },
})
