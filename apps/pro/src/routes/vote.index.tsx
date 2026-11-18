import { createFileRoute } from "@tanstack/react-router"
import { VotePage } from "../features/vote/vote-page"
import {
  defaultKind,
  loadVote,
  validateVoteSearch,
} from "../features/vote/vote-route"

/** `/vote`: the type the wallet's locks vote first, or a picked gauge's. */
export const Route = createFileRoute("/vote/")({
  validateSearch: validateVoteSearch,
  loaderDeps: ({ search }) => ({ address: search.address ?? null }),
  loader: ({ deps }) => loadVote(deps.address),
  head: () => ({ meta: [{ title: "Vote, Matchbox Pro" }] }),
  component: function VoteDefault() {
    const { list, voter } = Route.useLoaderData()
    const search = Route.useSearch()
    // A gauge to pick on arrival opens its own type.
    const picked =
      search.pick === undefined
        ? undefined
        : list.gauges.find(
            (gauge) => gauge.address.toLowerCase() === search.pick,
          )
    return (
      <VotePage
        list={list}
        voter={voter}
        kind={picked?.kind ?? defaultKind(voter?.locks ?? [])}
        search={search}
      />
    )
  },
})
