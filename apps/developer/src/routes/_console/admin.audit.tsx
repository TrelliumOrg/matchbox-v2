import * as PillButton from "@matchbox/ui/pill-button"
import { createFileRoute, getRouteApi, notFound } from "@tanstack/react-router"
import { type ReactNode, useId, useState } from "react"
import { StaffHeader } from "../../app/console/staff-header"
import { getAudit } from "../../app/data/console-api"

type Search = { organization?: string; app?: string; org?: string }

const uuid = /^[0-9a-f-]{36}$/i

const time = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  // UTC on the server and in the browser, so hydration agrees.
  timeZone: "UTC",
})

const layout = getRouteApi("/_console")

/**
 * Staff audit search (Classic /admin/audit): the platform audit log, newest
 * first, optionally for one organization or app. Staff only; the server
 * refuses everyone else (403).
 */
export const Route = createFileRoute("/_console/admin/audit")({
  validateSearch: (input: Record<string, unknown>): Search => {
    const search: Search = {}
    if (
      typeof input.organization === "string" &&
      uuid.test(input.organization)
    ) {
      search.organization = input.organization
    }
    if (typeof input.app === "string" && uuid.test(input.app))
      search.app = input.app
    if (typeof input.org === "string") search.org = input.org
    return search
  },
  loaderDeps: ({ search }) => ({
    organization: search.organization,
    app: search.app,
  }),
  loader: async ({ deps, parentMatchPromise }) => {
    const parent = await parentMatchPromise
    if (parent.loaderData?.me.staffRole == null) throw notFound()
    return {
      events: await getAudit({
        data: {
          ...(deps.organization === undefined
            ? {}
            : { organizationId: deps.organization }),
          ...(deps.app === undefined ? {} : { appId: deps.app }),
        },
      }),
    }
  },
  component: AdminAudit,
})

function AdminAudit(): ReactNode {
  const { me } = layout.useLoaderData()
  const { events } = Route.useLoaderData()
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const ids = { organization: useId(), app: useId() }
  const [organization, setOrganization] = useState(search.organization ?? "")
  const [app, setApp] = useState(search.app ?? "")
  return (
    <div className="mx-auto flex w-full max-w-[1040px] flex-col">
      <StaffHeader role={me.staffRole ?? "staff"} current="/admin/audit" />
      <form
        className="mt-6"
        onSubmit={(event) => {
          event.preventDefault()
          void navigate({
            search: {
              ...(search.org === undefined ? {} : { org: search.org }),
              ...(organization === "" ? {} : { organization }),
              ...(app === "" ? {} : { app }),
            },
          })
        }}
      >
        <fieldset>
          <legend className="sr-only">Filters</legend>
          <ol className="flex flex-wrap items-end gap-3">
            <li className="flex flex-col gap-1">
              <label
                htmlFor={ids.organization}
                className="text-[13.5px] text-sec"
              >
                Organization id
              </label>
              <input
                id={ids.organization}
                value={organization}
                onChange={(event) => setOrganization(event.target.value)}
                className="h-11 w-80 rounded-[16px] border border-line bg-bg px-4 font-mono text-[14px] text-ink max-md:text-[16px]"
              />
            </li>
            <li className="flex flex-col gap-1">
              <label htmlFor={ids.app} className="text-[13.5px] text-sec">
                App id
              </label>
              <input
                id={ids.app}
                value={app}
                onChange={(event) => setApp(event.target.value)}
                className="h-11 w-80 rounded-[16px] border border-line bg-bg px-4 font-mono text-[14px] text-ink max-md:text-[16px]"
              />
            </li>
            <li>
              <PillButton.Root
                type="submit"
                intent="neutral"
                className="bg-soft"
              >
                Search
              </PillButton.Root>
            </li>
          </ol>
        </fieldset>
      </form>
      <table className="mt-8 w-full text-left text-[14.5px]">
        <thead>
          <tr className="text-sec">
            <th className="pb-3 font-normal">Time</th>
            <th className="pb-3 font-normal">Action</th>
            <th className="pb-3 font-normal max-md:hidden">Actor</th>
            <th className="pb-3 font-normal max-md:hidden">Target</th>
          </tr>
        </thead>
        <tbody>
          {events.map((event) => (
            <tr key={event.id} className="border-t border-line align-top">
              <td className="py-3 whitespace-nowrap text-sec">
                {time.format(new Date(event.occurredAt))}
              </td>
              <td className="py-3 font-mono text-[13.5px] text-ink">
                {event.action}
              </td>
              <td className="py-3 text-ink2 max-md:hidden">
                {event.actorType} {event.actorId ?? ""}
              </td>
              <td className="py-3 font-mono text-[13px] break-all text-sec max-md:hidden">
                {event.targetType ?? ""} {event.targetId ?? ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {events.length === 0 ? (
        <p className="mt-4 text-[15.5px] text-sec">No events</p>
      ) : null}
    </div>
  )
}
