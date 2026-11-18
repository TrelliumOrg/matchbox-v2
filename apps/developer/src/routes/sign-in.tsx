import * as Lockup from "@matchbox/ui/lockup"
import * as PillButton from "@matchbox/ui/pill-button"
import { createFileRoute, redirect, useRouter } from "@tanstack/react-router"
import { type ReactNode, useState } from "react"
import { AuthFooter } from "../app/console/auth-footer"
import GoogleButton from "../app/console/google-button"
import { getMe } from "../app/data/console-api"
import { errorMessage } from "../app/lib/api-error"
import { safeReturnPath } from "../app/lib/return-path"

type SignInSearch = { return?: string; redirect?: string; invitation?: string }

/** A same-origin path to return to after signing in; "/" otherwise. */
export function safeReturn(value: unknown): string {
  return safeReturnPath(value) ?? "/"
}

/**
 * Where to go after signing in: the return path, Classic's ?redirect=, or,
 * as in Classic, the organization joined after an invitation sign-in.
 */
export function signInDestination(search: SignInSearch): string {
  if (
    search.return === undefined &&
    search.redirect === undefined &&
    search.invitation !== undefined
  ) {
    return "/organization"
  }
  return safeReturn(search.return ?? search.redirect)
}

/**
 * Sign in (`BF74sUHnMt`): Google, verified by the Worker against a nonce
 * bound to this browser. Dev sign-in shows under `vite dev` only; the
 * server also refuses it outside memory mode.
 */
export const Route = createFileRoute("/sign-in")({
  // `redirect` and `invitation` are Classic's parameters: old links and
  // invitation emails keep working.
  validateSearch: (input: Record<string, unknown>): SignInSearch => {
    const search: SignInSearch = {}
    if (typeof input.return === "string") search.return = input.return
    if (typeof input.redirect === "string") search.redirect = input.redirect
    if (
      typeof input.invitation === "string" &&
      input.invitation.length <= 256
    ) {
      search.invitation = input.invitation
    }
    return search
  },
  loaderDeps: ({ search }) => ({
    back: signInDestination(search),
    invitation: search.invitation ?? null,
  }),
  loader: async ({ deps }) => {
    const me = await getMe()
    if (me !== null) throw redirect({ href: deps.back, replace: true })
    return deps
  },
  staleTime: 0,
  component: SignInPage,
})

function SignInPage(): ReactNode {
  const { back, invitation } = Route.useLoaderData()
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [devPending, setDevPending] = useState(false)

  async function finish(): Promise<void> {
    await router.invalidate()
    router.history.replace(back)
  }

  async function signIn(credential: string): Promise<void> {
    const { auth } = await import("../app/lib/api")
    await auth.googleSignIn({
      credential,
      ...(invitation === null ? {} : { invitationToken: invitation }),
    })
    await finish()
  }

  async function devSignIn(): Promise<void> {
    setDevPending(true)
    setError(null)
    try {
      const { auth } = await import("../app/lib/api")
      await auth.devSignIn()
      await finish()
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setDevPending(false)
    }
  }

  return (
    <div className="flex min-h-dvh flex-col items-center px-5">
      <main className="mt-[22vh] flex w-full max-w-[380px] flex-col items-center text-center max-sm:mt-[16vh]">
        <Lockup.Root product="developer" form="full" height={22} />
        <h1 className="mt-16 text-[32px] font-[650] tracking-[-0.02em] text-ink">
          {invitation === null ? "Sign in" : "Invitation"}
        </h1>
        <div className="mt-8 flex w-full flex-col gap-3">
          <GoogleButton
            purpose="sign-in"
            onCredential={signIn}
            onError={setError}
          />
          {import.meta.env.DEV ? (
            <PillButton.Root
              intent="secondary"
              pending={devPending}
              onClick={() => void devSignIn()}
            >
              Dev sign-in
            </PillButton.Root>
          ) : null}
          {error === null ? null : (
            <p role="alert" className="text-[15px] font-medium text-neg">
              {error}
            </p>
          )}
        </div>
      </main>
      <div className="mt-auto pt-16">
        <AuthFooter />
      </div>
    </div>
  )
}
