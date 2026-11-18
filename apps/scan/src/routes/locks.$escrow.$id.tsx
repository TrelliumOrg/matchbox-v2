import { createFileRoute, notFound, redirect } from "@tanstack/react-router"
import type { ReactNode } from "react"
import { canonicalEscrow, canonicalNumber } from "../data/canonical"
import { getLockPage } from "../data/locks"
import { LockView } from "../explorer/voting/lock-page"

const escrowNames = { vebtc: "veBTC", vemezo: "veMEZO" } as const

/**
 * A lock (`bG-Fb-_hxD`) is named by its escrow and id: veBTC and veMEZO
 * are separate escrows whose ids overlap, so an id alone names no lock.
 */
export const Route = createFileRoute("/locks/$escrow/$id")({
  loader: async ({ params }) => {
    const escrow = canonicalEscrow(params.escrow)
    const id = canonicalNumber(params.id)
    if (escrow === null || id === null || id === "0") throw notFound()
    if (escrow !== params.escrow || id !== params.id) {
      throw redirect({
        to: "/locks/$escrow/$id",
        params: { escrow, id },
        statusCode: 301,
      })
    }
    const page = await getLockPage({ data: { escrow, id } })
    if (page.lock.status === "missing") throw notFound()
    return page
  },
  head: ({ loaderData }) => ({
    meta: [
      {
        title:
          loaderData === undefined
            ? "Lock, Matchscan"
            : `${escrowNames[loaderData.escrow]} #${loaderData.id}, Matchscan`,
      },
    ],
  }),
  component: function LockRoute(): ReactNode {
    return <LockView page={Route.useLoaderData()} />
  },
})
