import { createFileRoute, redirect } from "@tanstack/react-router"
import { fetchLive } from "../data/live-query"
import { protocolQuery } from "../data/queries"
import { ProtocolPage } from "../features/protocol/protocol-page"

/** Protocol for the current epoch. Old `?epoch=40` links move to `/protocol/40`. */
export const Route = createFileRoute("/protocol/")({
  beforeLoad: ({ search }) => {
    const epoch: unknown = (search as Record<string, unknown>).epoch
    if (typeof epoch === "number" && Number.isInteger(epoch) && epoch >= 0) {
      throw redirect({
        to: "/protocol/$epoch",
        params: { epoch },
        statusCode: 301,
      })
    }
  },
  loader: () => fetchLive(protocolQuery(null)),
  head: () => ({ meta: [{ title: "Protocol, Matchbox Pro" }] }),
  component: function ProtocolCurrent() {
    return <ProtocolPage seed={Route.useLoaderData()} epoch={null} />
  },
})
