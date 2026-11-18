import { createFileRoute } from "@tanstack/react-router"
import type { ReactNode } from "react"
import { ErrorState, errorTitle } from "../app/components/states"
import { validateErrorSearch } from "../app/lib/search"

/** Where the OIDC server sends errors it must not redirect to the client. */
export const Route = createFileRoute("/error")({
  validateSearch: validateErrorSearch,
  head: ({ match }) => ({
    meta: [
      {
        title: `${errorTitle(match.search.code ?? "invalid_request")} | Matchbox ID`,
      },
    ],
  }),
  component: ErrorPage,
})

function ErrorPage(): ReactNode {
  const { code } = Route.useSearch()
  return <ErrorState code={code ?? "invalid_request"} />
}
