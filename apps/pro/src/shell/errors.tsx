import * as PillButton from "@matchbox/ui/pill-button"
import {
  type ErrorComponentProps,
  Link,
  useRouter,
  useRouterState,
} from "@tanstack/react-router"
import { createIsomorphicFn } from "@tanstack/react-start"
import { getRequestHeader } from "@tanstack/react-start/server"
import type { ReactNode } from "react"
import {
  browserWalletLookupFailed,
  walletLookupHeader,
} from "../lib/wallet-context"

/** Route errors and unknown pages: a title and one action. */

export function ErrorState({ error }: ErrorComponentProps): ReactNode {
  const router = useRouter()
  const missing =
    error instanceof Error && "status" in error && error.status === 404
  return (
    <section className="mt-10">
      <h1 className="text-[32px] font-[650] tracking-[-0.02em]">
        {missing ? "Not found" : "Data unavailable"}
      </h1>
      <PillButton.Root
        intent="secondary"
        className="mt-6"
        onClick={() => void router.invalidate()}
      >
        Try again
      </PillButton.Root>
    </section>
  )
}

/**
 * Whether the Worker could not look up the Mezo ID of the page at
 * `pathname` (a request header it sets on the server, a meta tag it writes
 * for the browser, which counts for that page only).
 */
const walletLookupFailed = createIsomorphicFn()
  .server(
    (_pathname: string) =>
      getRequestHeader(walletLookupHeader) === "unavailable",
  )
  .client((pathname: string) => browserWalletLookupFailed(pathname))

export function NotFound(): ReactNode {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })
  // A Mezo ID link whose lookup failed: not missing, so try again (a full
  // load, which asks again). The Worker answers it 503.
  if (walletLookupFailed(pathname)) {
    return (
      <section className="mt-10">
        <h1 className="text-[32px] font-[650] tracking-[-0.02em]">
          Wallet lookup unavailable
        </h1>
        <PillButton.Root
          intent="secondary"
          className="mt-6"
          onClick={() => window.location.reload()}
        >
          Try again
        </PillButton.Root>
      </section>
    )
  }
  return (
    <section className="mt-10">
      <h1 className="text-[32px] font-[650] tracking-[-0.02em]">
        Page not found
      </h1>
      <PillButton.Root asChild intent="secondary" className="mt-6">
        <Link to="/">Overview</Link>
      </PillButton.Root>
    </section>
  )
}
