import * as Avatar from "@matchbox/ui/avatar"
import * as Lockup from "@matchbox/ui/lockup"
import * as PillButton from "@matchbox/ui/pill-button"
import { createFileRoute, Link, useRouter } from "@tanstack/react-router"
import { type ReactNode, useState } from "react"
import { AuthFooter } from "../app/console/auth-footer"
import { getMe } from "../app/data/console-api"
import { errorMessage } from "../app/lib/api-error"
import { initials, nameHue } from "../app/lib/marks"

/**
 * Invitation (`MDJphzcBIH`), the link in Classic's invitation emails
 * (`/invite/{token}`). Signed out: sign in with Google carrying the token;
 * signed in: accept (POST /api/invitations/accept), as in Classic. The
 * frame's organization card (name, role, inviter, expiry) needs a token
 * preview the API does not have, so the page names no organization.
 */
export const Route = createFileRoute("/invite/$token")({
  loader: async () => ({ me: await getMe() }),
  staleTime: 0,
  component: InvitePage,
})

function InvitePage(): ReactNode {
  const { token } = Route.useParams()
  const { me } = Route.useLoaderData()
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function accept(): Promise<void> {
    setPending(true)
    setError(null)
    try {
      const { orgs } = await import("../app/lib/api")
      const organization = await orgs.acceptInvitation(token)
      await router.invalidate()
      await router.navigate({
        to: "/organization",
        search: { org: organization.id },
      })
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setPending(false)
    }
  }

  async function switchAccount(): Promise<void> {
    const { auth } = await import("../app/lib/api")
    await auth.signOut().catch(() => undefined)
    await router.invalidate()
    await router.navigate({ to: "/sign-in", search: { invitation: token } })
  }

  return (
    <div className="flex min-h-dvh flex-col items-center px-5">
      <main className="mt-[12vh] flex w-full max-w-[440px] flex-col items-center text-center">
        <Lockup.Root product="developer" form="full" height={22} />
        <p className="mt-14 text-[15px] text-sec">Invitation</p>
        <h1 className="mt-1.5 text-[32px] font-[650] tracking-[-0.02em] text-ink">
          Join an organization
        </h1>
        <div className="mt-8 flex w-full flex-col items-center gap-3">
          {me === null ? (
            <PillButton.Root asChild size="lg" className="w-full">
              <Link to="/sign-in" search={{ invitation: token }}>
                Continue with Google
              </Link>
            </PillButton.Root>
          ) : (
            <>
              <PillButton.Root
                size="lg"
                className="w-full"
                pending={pending}
                onClick={() => void accept()}
              >
                Accept invitation
              </PillButton.Root>
              <Link
                to="/"
                className="text-[15px] font-semibold text-ink underline underline-offset-[3px]"
              >
                Not now
              </Link>
            </>
          )}
          {error === null ? null : (
            <p role="alert" className="text-[15px] font-medium text-neg">
              {error}
            </p>
          )}
        </div>
        {me === null ? null : (
          <div className="mt-9 flex w-full items-center gap-3 border-t border-line pt-5 text-left">
            <Avatar.Root
              initials={initials(me.account.displayName ?? me.account.email)}
              hue={nameHue(me.account.email)}
              size={40}
            />
            <span className="min-w-0 flex-1">
              <span className="block text-[14px] text-sec">Signed in as</span>
              <span className="flex items-center gap-2">
                <span className="truncate text-[15.5px] font-semibold text-ink">
                  {me.account.email}
                </span>
                <span className="flex-none text-[14px] text-sec">Google</span>
              </span>
            </span>
            <button
              type="button"
              onClick={() => void switchAccount()}
              className="flex-none cursor-pointer text-[15px] font-semibold text-ink underline underline-offset-[3px]"
            >
              Switch account
            </button>
          </div>
        )}
      </main>
      <div className="mt-auto pt-16">
        <AuthFooter />
      </div>
    </div>
  )
}
