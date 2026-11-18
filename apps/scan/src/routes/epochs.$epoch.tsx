import { createFileRoute, notFound, redirect } from "@tanstack/react-router"
import type { ReactNode } from "react"
import { canonicalNumber } from "../data/canonical"
import { getEpochPage } from "../data/epochs"
import { EpochView } from "../explorer/voting/epoch-page"

/**
 * One epoch (`2Uik1bZ5w5`), by its number. A start before Epoch 0 or in
 * the future is the API's 404; an epoch not computed yet says so.
 */
export const Route = createFileRoute("/epochs/$epoch")({
  loader: async ({ params }) => {
    const epoch = canonicalNumber(params.epoch)
    if (epoch === null || epoch.length > 5) throw notFound()
    if (epoch !== params.epoch) {
      throw redirect({
        to: "/epochs/$epoch",
        params: { epoch },
        statusCode: 301,
      })
    }
    const page = await getEpochPage({ data: { epoch: Number(epoch) } })
    if (page.doc.status === "missing") throw notFound()
    return page
  },
  head: ({ loaderData }) => ({
    meta: [
      {
        title:
          loaderData === undefined
            ? "Epoch, Matchscan"
            : `Epoch ${loaderData.number}, Matchscan`,
      },
    ],
  }),
  component: function EpochRoute(): ReactNode {
    return <EpochView page={Route.useLoaderData()} />
  },
})
