import { createFileRoute, notFound } from "@tanstack/react-router"
import { fetchLive } from "../data/live-query"
import { protocolQuery } from "../data/queries"
import { parseEpochParam } from "../features/protocol/epoch-param"
import { ProtocolPage } from "../features/protocol/protocol-page"

/** Protocol for one epoch: `/protocol/40`. */
export const Route = createFileRoute("/protocol/$epoch")({
  params: {
    parse: ({ epoch }) => {
      const number = parseEpochParam(epoch)
      if (number === null) throw notFound()
      return { epoch: number }
    },
    stringify: ({ epoch }) => ({ epoch: String(epoch) }),
  },
  loader: ({ params }) => fetchLive(protocolQuery(params.epoch)),
  head: ({ params }) => ({
    meta: [{ title: `Epoch ${params.epoch}, Protocol, Matchbox Pro` }],
  }),
  component: function ProtocolEpochRoute() {
    const { epoch } = Route.useParams()
    return <ProtocolPage seed={Route.useLoaderData()} epoch={epoch} />
  },
})
