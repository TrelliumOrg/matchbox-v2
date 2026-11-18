import * as PillButton from "@matchbox/ui/pill-button"
import { createFileRoute, getRouteApi, notFound } from "@tanstack/react-router"
import { type ReactNode, useId, useState } from "react"
import {
  QuotaOverrides,
  useStaffAction,
} from "../../app/console/quota-overrides"
import { StaffHeader } from "../../app/console/staff-header"
import { getAdminApps } from "../../app/data/console-api"
import type { AdminApp } from "../../app/data/reads.server"

const statuses = ["active", "restricted", "suspended", "retired"] as const

type Status = (typeof statuses)[number]

const layout = getRouteApi("/_console")

/**
 * Staff apps (Classic /admin/apps and /admin/quotas): find an app, change
 * its status with a reason, and manage its environments' quota overrides.
 * Staff only; the server refuses everyone else (403).
 */
export const Route = createFileRoute("/_console/admin/apps")({
  validateSearch: (
    input: Record<string, unknown>,
  ): { q?: string; org?: string } => {
    const search: { q?: string; org?: string } = {}
    if (typeof input.q === "string") search.q = input.q.slice(0, 120)
    if (typeof input.org === "string") search.org = input.org
    return search
  },
  loaderDeps: ({ search }) => ({ q: search.q ?? "" }),
  loader: async ({ deps, parentMatchPromise }) => {
    const parent = await parentMatchPromise
    if (parent.loaderData?.me.staffRole == null) throw notFound()
    return { apps: await getAdminApps({ data: { query: deps.q } }) }
  },
  component: AdminApps,
})

function AppRow({ app }: { app: AdminApp }): ReactNode {
  const action = useStaffAction()
  const reasonId = useId()
  const [status, setStatus] = useState<Status>(app.status)
  const [reason, setReason] = useState("")
  return (
    <li className="flex flex-col gap-3 border-t border-line py-5 first:border-t-0">
      <div className="flex flex-wrap items-center gap-4">
        <p className="min-w-0 flex-1">
          <span className="block text-[16px] font-semibold text-ink">
            {app.name}
          </span>
          <span className="block text-[14.5px] text-sec">
            {app.organization.name},{" "}
            <span className="font-mono">{app.slug}</span>
          </span>
        </p>
        <span className="text-[15px] font-medium text-ink capitalize">
          {app.status}
        </span>
      </div>
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          void action.run("status", async () => {
            const { admin } = await import("../../app/lib/api")
            await admin.changeAppStatus(app.id, { status, reason })
          })
        }}
      >
        <label className="flex flex-col gap-1 text-[13.5px] text-sec">
          Status
          <select
            value={status}
            onChange={(event) => {
              const next = statuses.find(
                (value) => value === event.target.value,
              )
              if (next !== undefined) setStatus(next)
            }}
            className="h-10 rounded-[12px] border border-line bg-bg px-3 text-[15px] text-ink capitalize max-md:text-[16px]"
          >
            {statuses.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <span className="flex min-w-48 flex-1 flex-col gap-1">
          <label htmlFor={reasonId} className="text-[13.5px] text-sec">
            Reason
          </label>
          <input
            id={reasonId}
            required
            maxLength={2000}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            className="h-10 rounded-[12px] border border-line bg-bg px-3 text-[15px] text-ink max-md:text-[16px]"
          />
        </span>
        <PillButton.Root
          type="submit"
          size="sm"
          disabled={status === app.status}
          pending={action.pending === "status"}
        >
          Change status
        </PillButton.Root>
      </form>
      {action.error === null ? null : (
        <p role="alert" className="text-[14.5px] font-medium text-neg">
          {action.error}
        </p>
      )}
      <ul className="flex flex-col gap-2">
        {app.environments.map((environment) => (
          <li key={environment.id} className="flex flex-col gap-2">
            <span className="text-[14px] text-sec">
              {environment.kind === "live" ? "Live" : "Test"},{" "}
              <span className="font-mono">{environment.clientId}</span>
            </span>
            <QuotaOverrides environmentId={environment.id} />
          </li>
        ))}
      </ul>
      {action.sheet}
    </li>
  )
}

function AdminApps(): ReactNode {
  const { me } = layout.useLoaderData()
  const { apps } = Route.useLoaderData()
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const queryId = useId()
  const [query, setQuery] = useState(search.q ?? "")
  return (
    <div className="mx-auto flex w-full max-w-[1040px] flex-col">
      <StaffHeader role={me.staffRole ?? "staff"} current="/admin/apps" />
      <form
        className="mt-6 flex gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          void navigate({ search: { ...search, q: query } })
        }}
      >
        <label htmlFor={queryId} className="sr-only">
          Find an app
        </label>
        <input
          id={queryId}
          value={query}
          placeholder="Name or slug"
          onChange={(event) => setQuery(event.target.value)}
          className="h-11 min-w-0 flex-1 rounded-[16px] border border-line bg-bg px-4 text-[16px] text-ink"
        />
        <PillButton.Root type="submit" intent="neutral" className="bg-soft">
          Find
        </PillButton.Root>
      </form>
      <ul className="mt-8">
        {apps.map((app) => (
          <AppRow key={app.id} app={app} />
        ))}
      </ul>
    </div>
  )
}
