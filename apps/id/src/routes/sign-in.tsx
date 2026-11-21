import { createFileRoute, redirect, useRouter } from "@tanstack/react-router"
import type { ReactNode } from "react"
import { SignInView } from "../app/account/sign-in-view"
import { getRequestSummary, getViewer } from "../app/data/id-api"
import {
  authorizationRequestIdOf,
  safeReturnPath,
} from "../app/lib/return-path"
import { validateSignInSearch } from "../app/lib/search"

/**
 * Sign in (`1oV4owEw1g`, wallet drawer `wC8x0OOodQ`, sign message
 * `MLtd4OJScI`, rejected `1xNws3a3ZJ`, phone `pBiIrEGRHa`). Someone already
 * signed in goes straight back, unless the app asked to sign in again
 * (`force`) or for another network (`chain`).
 */
export const Route = createFileRoute("/sign-in")({
  validateSearch: validateSignInSearch,
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) => {
    const returnTo = safeReturnPath(deps.return) ?? "/"
    const force = deps.force === true || deps.chain !== undefined
    const requestId = authorizationRequestIdOf(safeReturnPath(deps.return))
    const [viewer, summary] = await Promise.all([
      getViewer(),
      requestId === null
        ? Promise.resolve(null)
        : getRequestSummary({ data: { request: requestId } }),
    ])
    if (viewer.account !== null && !force) {
      throw redirect({ href: returnTo, replace: true })
    }
    return {
      returnTo,
      force,
      summary,
      sessionWallet: viewer.account?.walletAddress ?? null,
    }
  },
  staleTime: 0,
  head: () => ({ meta: [{ title: "Sign in | Matchbox ID" }] }),
  component: SignInPage,
})

function SignInPage(): ReactNode {
  const data = Route.useLoaderData()
  const { chain } = Route.useSearch()
  const router = useRouter()
  return (
    <SignInView
      summary={data.summary}
      targetChainId={chain ?? 31612}
      named={chain !== undefined}
      sessionWallet={data.force ? data.sessionWallet : null}
      onSignedIn={async () => {
        await router.invalidate()
        router.history.replace(data.returnTo)
      }}
    />
  )
}
