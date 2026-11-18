import * as PillButton from "@matchbox/ui/pill-button"
import { createFileRoute, getRouteApi, notFound } from "@tanstack/react-router"
import { type ReactNode, useId, useState } from "react"
import { QuotaOverrides } from "../../app/console/quota-overrides"
import { StaffHeader } from "../../app/console/staff-header"
import { getQuotaOverrides } from "../../app/data/console-api"

const layout = getRouteApi("/_console")

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type Search = { org?: string; environment?: string }

/**
 * Quotas (Classic `/admin/quotas?environment=`, the Admin frame's Quotas
 * tab): an environment's quota overrides by its id, to read, add and
 * expire. Staff only, like every admin page; the server refuses the rest.
 */
export const Route = createFileRoute("/_console/admin/quotas")({
  validateSearch: (input: Record<string, unknown>): Search => {
    const search: Search = {}
    if (typeof input.org === "string") search.org = input.org
    if (typeof input.environment === "string" && uuid.test(input.environment))
      search.environment = input.environment.toLowerCase()
    return search
  },
  loaderDeps: ({ search }) => ({ environment: search.environment ?? null }),
  loader: async ({ deps, parentMatchPromise }) => {
    const parent = await parentMatchPromise
    if (parent.loaderData?.me.staffRole == null) throw notFound()
    return {
      environment: deps.environment,
      overrides:
        deps.environment === null
          ? null
          : await getQuotaOverrides({
              data: { environmentId: deps.environment },
            }),
    }
  },
  component: AdminQuotas,
})

function AdminQuotas(): ReactNode {
  const { environment, overrides } = Route.useLoaderData()
  const { me } = layout.useLoaderData()
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const fieldId = useId()
  const [draft, setDraft] = useState(environment ?? "")
  const valid = uuid.test(draft.trim())
  return (
    <div className="mx-auto flex w-full max-w-[1040px] flex-col">
      <StaffHeader role={me.staffRole ?? "staff"} current="/admin/quotas" />
      <form
        className="mt-7 flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          if (!valid) return
          void navigate({
            search: {
              ...(search.org === undefined ? {} : { org: search.org }),
              environment: draft.trim().toLowerCase(),
            },
          })
        }}
      >
        <span className="flex min-w-72 flex-1 flex-col gap-1.5">
          <label htmlFor={fieldId} className="text-[14px] text-sec">
            Environment ID
          </label>
          <input
            id={fieldId}
            value={draft}
            spellCheck={false}
            onChange={(event) => setDraft(event.target.value)}
            className="h-11 rounded-[16px] border border-line bg-bg px-4 font-mono text-[15px] text-ink outline-none max-md:text-[16px] focus:border-acc"
          />
        </span>
        <PillButton.Root type="submit" disabled={!valid}>
          Find
        </PillButton.Root>
      </form>
      {environment === null ? (
        <p className="mt-8 text-[15.5px] text-sec">
          Paste an environment ID, or open an app under Apps and quotas
        </p>
      ) : (
        <section className="mt-8">
          <QuotaOverrides
            key={environment}
            environmentId={environment}
            initial={overrides}
          />
        </section>
      )}
    </div>
  )
}
