import { createFileRoute, redirect } from "@tanstack/react-router"
import { type ReactNode, useEffect, useRef, useState } from "react"
import { type ConsentDecision, ConsentView } from "../app/account/consent-view"
import { ErrorState } from "../app/components/states"
import { getAuthorization } from "../app/data/id-api"
import { isApiError } from "../app/lib/api-error"
import { chainIdByNetwork } from "../app/lib/network"
import { validateAuthorizeSearch } from "../app/lib/search"

/**
 * Consent (`w4y8fanNCK`, phone `e70vgJhOmB`). The loader sends signed-out
 * visitors, `prompt=login` and contract accounts verified on another
 * network to sign in first, exactly as the old SPA did in an effect.
 */
export const Route = createFileRoute("/authorize")({
  validateSearch: validateAuthorizeSearch,
  loaderDeps: ({ search }) => ({ request: search.request }),
  loader: async ({ deps }) => {
    if (deps.request === "") {
      return { kind: "error", code: "invalid_request" } as const
    }
    const data = await getAuthorization({ data: { request: deps.request } })
    const back = `/authorize?request=${encodeURIComponent(deps.request)}`
    if (data.kind === "signed-out") {
      throw redirect({
        to: "/sign-in",
        search: { return: back },
        replace: true,
      })
    }
    if (
      data.kind === "ready" &&
      (data.request.reauthenticationRequired ||
        data.request.networkSignInRequired)
    ) {
      throw redirect({
        to: "/sign-in",
        search: {
          return: back,
          force: true,
          ...(data.request.networkSignInRequired
            ? { chain: chainIdByNetwork[data.request.network] }
            : {}),
        },
        replace: true,
      })
    }
    return data
  },
  // A request is single use: never serve it from the cache.
  staleTime: 0,
  gcTime: 0,
  head: () => ({ meta: [{ title: "Authorize" }] }),
  component: AuthorizePage,
})

function Redirecting(): ReactNode {
  return (
    <output className="mx-auto pt-40 text-[16px] font-medium text-sec">
      Redirecting
    </output>
  )
}

function AuthorizePage(): ReactNode {
  const data = Route.useLoaderData()
  const { request: requestId } = Route.useSearch()
  const navigate = Route.useNavigate()
  const [pending, setPending] = useState<ConsentDecision | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const autoApproved = useRef(false)

  async function decide(
    choice: ConsentDecision,
    declinedScopes: string[],
  ): Promise<void> {
    setPending(choice)
    setError(null)
    try {
      const { redirectTo } = await (await import("../app/lib/api")).api.decide(
        requestId,
        choice === "approve"
          ? { decision: "approve", declinedScopes }
          : { decision: "deny" },
      )
      setDone(true)
      window.location.replace(redirectTo)
    } catch (caught) {
      setError(
        isApiError(caught, "not_found") ? "Request expired" : "Decision failed",
      )
      setPending(null)
    }
  }

  const skipConsent = data.kind === "ready" && !data.request.consentRequired

  // Covered by the existing grant: approve with its earlier choices.
  useEffect(() => {
    if (!skipConsent || autoApproved.current) return
    autoApproved.current = true
    setPending("approve")
    import("../app/lib/api")
      .then(({ api }) => api.decide(requestId, { decision: "approve" }))
      .then(({ redirectTo }) => {
        setDone(true)
        window.location.replace(redirectTo)
      })
      .catch((caught: unknown) => {
        setPending(null)
        setError(
          isApiError(caught, "not_found")
            ? "Request expired"
            : "Decision failed",
        )
      })
  }, [requestId, skipConsent])

  if (data.kind === "error") return <ErrorState code={data.code} />
  if (done || (skipConsent && error === null)) return <Redirecting />
  if (skipConsent) {
    return (
      <ErrorState
        code={error === "Request expired" ? "request_expired" : "server_error"}
      />
    )
  }

  return (
    <ConsentView
      request={data.request}
      account={data.account}
      pending={pending}
      error={error}
      onDecision={(choice, declined) => void decide(choice, declined)}
      onSwitchAccount={() =>
        void navigate({
          to: "/sign-in",
          search: {
            return: `/authorize?request=${encodeURIComponent(requestId)}`,
            force: true,
          },
        })
      }
    />
  )
}
