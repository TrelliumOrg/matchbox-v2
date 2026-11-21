import { createFileRoute } from "@tanstack/react-router"
import { defaultKind } from "../features/vote/default-kind"
import { VotePage } from "../features/vote/vote-page"
import { loadVote, validateVoteSearch } from "../features/vote/vote-route"

/**
 * `/vote`: a picked gauge's type, else the type the wallet's locks vote
 * first while it has funded gauges, else the most funded (`defaultKind`).
 * `/vote/<type>` always opens its own type.
 */
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
        kind={picked?.kind ?? defaultKind(voter?.locks ?? [], list.fundedKinds)}
        search={search}
      />
    )
  },
})
