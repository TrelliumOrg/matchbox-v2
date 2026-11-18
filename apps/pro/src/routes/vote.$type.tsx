import { createFileRoute, notFound } from "@tanstack/react-router"
import { gaugeKinds, kindForSegment } from "../features/gauge/kinds"
import { VotePage } from "../features/vote/vote-page"
import { loadVote, validateVoteSearch } from "../features/vote/vote-route"

/** `/vote/vebtc`, `/vote/mezo`, `/vote/validators`, `/vote/pools`. */
export const Route = createFileRoute("/vote/$type")({
  params: {
    parse: ({ type }) => {
      const kind = kindForSegment(type)
      if (kind === null) throw notFound()
      return { type: kind }
    },
    stringify: ({ type }) => ({ type: gaugeKinds[type].segment }),
  },
  validateSearch: validateVoteSearch,
  loaderDeps: ({ search }) => ({ address: search.address ?? null }),
  loader: ({ deps }) => loadVote(deps.address),
  head: ({ params }) => ({
    meta: [{ title: `${gaugeKinds[params.type].label}, Vote, Matchbox Pro` }],
  }),
  component: function VoteType() {
    const { list, voter } = Route.useLoaderData()
    const { type } = Route.useParams()
    return (
      <VotePage
        list={list}
        voter={voter}
        kind={type}
        search={Route.useSearch()}
      />
    )
  },
})
