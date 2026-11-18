import { createFileRoute, getRouteApi } from "@tanstack/react-router"
import type { ReactNode } from "react"
import { canonicalAddress } from "../data/canonical"
import { pickCursor } from "../data/cursors"
import { getAddressTransfers } from "../data/explorer"
import { Pager, SectionState } from "../explorer/parts"
import { TransfersTable } from "../explorer/tables"

const parent = getRouteApi("/address/$address")

/** Transfers, from Blockscout through the proxy (keyset pager). */
export const Route = createFileRoute("/address/$address/transfers")({
  validateSearch: (search: Record<string, unknown>) =>
    pickCursor("addressTransfers", search) ?? {},
  loaderDeps: ({ search }) => ({ cursor: search }),
  loader: async ({ params, deps }) => ({
    list: await getAddressTransfers({
      data: {
        address: canonicalAddress(params.address) ?? "",
        cursor: deps.cursor,
      },
    }),
    paged: pickCursor("addressTransfers", deps.cursor) !== null,
  }),
  head: () => ({ meta: [{ title: "Transfers, Matchscan" }] }),
  component: function ListTab(): ReactNode {
    const { address, now } = parent.useLoaderData()
    const { list, paged } = Route.useLoaderData()
    if (list.status !== "ok") return <SectionState section={list} />
    return (
      <>
        <TransfersTable
          caption="Token transfers"
          rows={list.data.items}
          now={now}
        />
        <Pager
          label="Transfer pages"
          paged={paged}
          next={list.data.next}
          to="/address/$address/transfers"
          params={{ address }}
        />
      </>
    )
  },
})
