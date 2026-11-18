import { createFileRoute, getRouteApi } from "@tanstack/react-router"
import type { ReactNode } from "react"
import { getLoanHistory } from "../data/address"
import { canonicalAddress } from "../data/canonical"
import { LoanHistory } from "../explorer/address/loans"
import { SectionState } from "../explorer/parts"

const parent = getRouteApi("/address/$address")

/** Loan history: borrow events by owner (troves, Morpho, Enclaves). */
export const Route = createFileRoute("/address/$address/loans")({
  loader: async ({ params }) => ({
    loans: await getLoanHistory({
      data: { address: canonicalAddress(params.address) ?? "" },
    }),
  }),
  head: () => ({ meta: [{ title: "Loan history, Matchscan" }] }),
  component: function LoansTab(): ReactNode {
    const { now } = parent.useLoaderData()
    const { loans } = Route.useLoaderData()
    return loans.status === "ok" ? (
      <LoanHistory
        events={loans.data.items}
        more={loans.data.more}
        skipped={loans.skipped ?? 0}
        now={now}
      />
    ) : (
      <SectionState section={loans} />
    )
  },
})
