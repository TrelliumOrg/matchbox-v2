import { createFileRoute, Outlet, redirect } from "@tanstack/react-router"
import type { ReactNode } from "react"
import { ConsoleShell } from "../app/console/shell"
import { getMe } from "../app/data/console-api"

/**
 * Every signed-in page. The loader reads the session in-process; signed-out
 * visitors go to sign in. `?org=` picks the organization, else the first.
 */
export const Route = createFileRoute("/_console")({
  validateSearch: (input: Record<string, unknown>): { org?: string } =>
    typeof input.org === "string" && /^[0-9a-f-]{36}$/i.test(input.org)
      ? { org: input.org }
      : {},
  loaderDeps: ({ search }) => ({ org: search.org }),
  loader: async ({ deps, location }) => {
    const me = await getMe()
    if (me === null) {
      throw redirect({
        to: "/sign-in",
        search: { return: location.href },
        replace: true,
      })
    }
    const org =
      me.organizations.find((candidate) => candidate.id === deps.org) ??
      me.organizations[0] ??
      null
    return { me, org }
  },
  staleTime: 30_000,
  component: ConsoleLayout,
})

function ConsoleLayout(): ReactNode {
  const { me, org } = Route.useLoaderData()
  return (
    <ConsoleShell me={me} org={org}>
      <Outlet />
    </ConsoleShell>
  )
}
