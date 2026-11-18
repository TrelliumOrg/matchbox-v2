import { createFileRoute, notFound, redirect } from "@tanstack/react-router"
import type { ReactNode } from "react"
import { canonicalAddress } from "../data/canonical"
import { getValidatorPage } from "../data/validators"
import { ValidatorView } from "../explorer/validators/validator-page"

/**
 * One validator (`MecoxYurzZ`), by the address that proposes its blocks
 * (its ValidatorPool operator, where the API matched one). A proposer with
 * no validator gauge has a page too, with its blocks alone. A validator
 * that left the set has no operator on its gauge and is reached through
 * its gauge page instead.
 */
export const Route = createFileRoute("/validators/$address")({
  loader: async ({ params }) => {
    const address = canonicalAddress(params.address)
    if (address === null) throw notFound()
    if (address !== params.address) {
      throw redirect({
        to: "/validators/$address",
        params: { address },
        statusCode: 301,
      })
    }
    const page = await getValidatorPage({ data: { address } })
    if (page.header.status === "missing") throw notFound()
    return page
  },
  head: ({ loaderData }) => ({
    meta: [
      {
        title:
          loaderData?.header.status === "ok" &&
          loaderData.header.data.name !== null
            ? `${loaderData.header.data.name}, Matchscan`
            : "Validator, Matchscan",
      },
    ],
  }),
  component: function ValidatorRoute(): ReactNode {
    return <ValidatorView page={Route.useLoaderData()} />
  },
})
