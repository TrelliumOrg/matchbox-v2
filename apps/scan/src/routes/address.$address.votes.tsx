import { createFileRoute } from "@tanstack/react-router"
import type { ReactNode } from "react"
import { getAddressVotes } from "../data/address"
import { canonicalAddress } from "../data/canonical"
import { Votes } from "../explorer/address/votes"
import { SectionState } from "../explorer/parts"

/** Votes: the address's locks' votes, by epoch. */
export const Route = createFileRoute("/address/$address/votes")({
  loader: async ({ params }) => ({
    votes: await getAddressVotes({
      data: { address: canonicalAddress(params.address) ?? "" },
    }),
  }),
  head: () => ({ meta: [{ title: "Votes, Matchscan" }] }),
  component: function VotesTab(): ReactNode {
    const { votes } = Route.useLoaderData()
    return votes.status === "ok" ? (
      <Votes votes={votes.data} />
    ) : (
      <SectionState section={votes} />
    )
  },
})
