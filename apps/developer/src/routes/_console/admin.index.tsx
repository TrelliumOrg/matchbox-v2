import type { AdminReview } from "@matchbox/contracts/console"
import {
  createFileRoute,
  getRouteApi,
  Link,
  notFound,
} from "@tanstack/react-router"
import { type ReactNode, useId, useState } from "react"
import { Empty } from "../../app/components/states"
import { AppMark } from "../../app/console/app-row"
import { Glyph, type GlyphName } from "../../app/console/glyphs"
import { StaffHeader } from "../../app/console/staff-header"
import { getAdminReviews } from "../../app/data/console-api"

const layout = getRouteApi("/_console")

type State = "open" | "changes-requested" | "approved" | "rejected"

const states: { value: State; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "changes-requested", label: "Changes requested" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
]

const scopeIcons: Record<string, { glyph: GlyphName; label: string }> = {
  openid: { glyph: "key", label: "Sign-in ID" },
  wallet: { glyph: "wallet", label: "Wallet" },
  "discord:id": { glyph: "user-round", label: "Discord ID" },
  "discord:profile": { glyph: "user", label: "Discord profile" },
  "discord:membership": { glyph: "users", label: "Mezo Discord membership" },
  "gauge-profiles:read": { glyph: "chart", label: "Gauge and market data" },
}

const submitted = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
  timeZone: "UTC",
})

const dayMs = 86_400_000

function waited(from: string, now: number): string {
  const days = Math.floor((now - Date.parse(from)) / dayMs)
  if (days >= 1) return `${days}d`
  return `${Math.max(1, Math.floor((now - Date.parse(from)) / 3_600_000))}h`
}

function medianWait(seconds: number | null): string {
  if (seconds === null) return "—"
  const days = seconds / 86_400
  if (days >= 1) return `${days.toFixed(1)}d`
  return `${Math.max(1, Math.round(seconds / 3600))}h`
}

/**
 * Admin reviews (`YY4uOHeVTm`). Staff only: everyone else gets Not found,
 * as Classic's admin layout did, and the server refuses the reads anyway
 * (classic-staff.test.ts).
 */
export const Route = createFileRoute("/_console/admin/")({
  validateSearch: (
    input: Record<string, unknown>,
  ): { org?: string; state?: State } => {
    const search: { org?: string; state?: State } = {}
    if (typeof input.org === "string") search.org = input.org
    if (
      input.state === "changes-requested" ||
      input.state === "approved" ||
      input.state === "rejected"
    )
      search.state = input.state
    return search
  },
  loaderDeps: ({ search }) => ({ state: search.state ?? "open" }),
  loader: async ({ deps, parentMatchPromise }) => {
    const parent = await parentMatchPromise
    const role = parent.loaderData?.me.staffRole ?? null
    if (role === null) throw notFound()
    const page = await getAdminReviews({ data: { state: deps.state } })
    return { ...page, role, state: deps.state, now: Date.now() }
  },
  component: AdminReviews,
})

function matches(review: AdminReview, needle: string): boolean {
  if (needle === "") return true
  return [
    review.app.name,
    review.organization.name,
    review.environment.clientId,
  ].some((value) => value.toLowerCase().includes(needle))
}

function AdminReviews(): ReactNode {
  const { reviews, stats, role, state, now } = Route.useLoaderData()
  const search = Route.useSearch()
  const { org } = layout.useLoaderData()
  const searchId = useId()
  const [query, setQuery] = useState("")
  const needle = query.trim().toLowerCase()
  const shown = reviews.filter((review) => matches(review, needle))
  const oldestDays =
    stats.oldestOpen === null ? null : waited(stats.oldestOpen.createdAt, now)
  return (
    <div className="mx-auto flex w-full max-w-[1040px] flex-col">
      <StaffHeader role={role} current="/admin" />

      <section
        aria-label="Review stats"
        className="mt-7 grid grid-cols-2 gap-6 rounded-[24px] bg-soft p-6 md:grid-cols-4"
      >
        <div>
          <p className="text-[14px] text-sec">Open</p>
          <p className="mt-1 text-[22px] font-[650] text-ink tabular-nums">
            {stats.open}
          </p>
          <p className="text-[14px] text-sec">Live access requests</p>
        </div>
        <div>
          <p className="text-[14px] text-sec">Oldest</p>
          <p className="mt-1 text-[22px] font-[650] text-acc-ink tabular-nums">
            {oldestDays ?? "—"}
          </p>
          <p className="truncate text-[14px] text-sec">
            {stats.oldestOpen?.appName ?? "None open"}
          </p>
        </div>
        <div>
          <p className="text-[14px] text-sec">Decided, 7d</p>
          <p className="mt-1 text-[22px] font-[650] text-ink tabular-nums">
            {stats.decided7d.total}
          </p>
          <p className="flex flex-wrap gap-x-3 text-[14px] text-sec">
            <span>
              Approved <b className="text-ink">{stats.decided7d.approved}</b>
            </span>
            <span>
              Changes{" "}
              <b className="text-ink">{stats.decided7d.changesRequested}</b>
            </span>
            <span>
              Rejected <b className="text-ink">{stats.decided7d.rejected}</b>
            </span>
          </p>
        </div>
        <div>
          <p className="text-[14px] text-sec">Median wait</p>
          <p className="mt-1 text-[22px] font-[650] text-ink tabular-nums">
            {medianWait(stats.medianWaitSeconds)}
          </p>
          <p className="text-[14px] text-sec">7d</p>
        </div>
      </section>

      <div className="mt-9 flex flex-wrap items-center justify-between gap-4">
        <nav aria-label="Review state" className="flex flex-wrap gap-1">
          {states.map((entry) => (
            <Link
              key={entry.value}
              to="/admin"
              search={{
                ...(search.org === undefined ? {} : { org: search.org }),
                ...(entry.value === "open" ? {} : { state: entry.value }),
              }}
              replace
              aria-current={entry.value === state ? "page" : undefined}
              className={`flex h-10 items-center gap-1.5 rounded-full px-4 text-[15px] font-semibold ${entry.value === state ? "bg-ink text-bg" : "text-sec hover:text-ink"}`}
            >
              {entry.label}
              {entry.value === "open" ? (
                <span className="font-medium opacity-70">{stats.open}</span>
              ) : null}
            </Link>
          ))}
        </nav>
        <label
          htmlFor={searchId}
          className="flex h-11 w-[280px] max-w-full items-center gap-2.5 rounded-full bg-soft px-[18px] text-sec focus-within:outline-2 focus-within:outline-ink"
        >
          <Glyph name="search" size={18} />
          <span className="sr-only">Search reviews</span>
          <input
            id={searchId}
            type="search"
            placeholder="App, org or client ID"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="min-w-0 flex-1 bg-transparent text-[16px] text-ink outline-none placeholder:text-sec"
          />
        </label>
      </div>

      <section className="mt-4">
        {shown.length === 0 ? (
          <Empty title={state === "open" ? "No open reviews" : "No reviews"} />
        ) : (
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-line text-[14px] text-sec">
                <th className="pb-3 font-normal">App</th>
                <th className="pb-3 font-normal">Requests</th>
                <th className="pb-3 font-normal max-md:hidden">Approved now</th>
                <th className="pb-3 font-normal max-sm:hidden">Submitted</th>
                <th className="pb-3 font-normal max-sm:hidden">Waiting</th>
                <th className="pb-3">
                  <span className="sr-only">Open</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((review) => {
                const approvedNow = review.environment.approvedScopes.flatMap(
                  (scope) => {
                    const icon = scopeIcons[scope]
                    return icon === undefined ? [] : [{ scope, ...icon }]
                  },
                )
                const wait = waited(review.createdAt, now)
                return (
                  <tr key={review.id} className="border-b border-line">
                    <td className="py-3">
                      <Link
                        to="/admin/reviews/$reviewId"
                        params={{ reviewId: review.id }}
                        search={org === null ? {} : { org: org.id }}
                        className="flex items-center gap-3.5 outline-none focus-visible:underline"
                      >
                        <AppMark
                          app={{ name: review.app.name, logoUrl: null }}
                          size={44}
                        />
                        <span>
                          <span className="block text-[16px] font-semibold text-ink">
                            {review.app.name}
                            <span className="sr-only">
                              , {review.environment.kind}
                            </span>
                          </span>
                          <span className="block text-[15px] text-sec">
                            {review.organization.name}
                          </span>
                        </span>
                      </Link>
                    </td>
                    <td className="py-3 font-mono text-[14px] text-ink">
                      {review.requestedScopes
                        .filter(
                          (scope) =>
                            !review.environment.approvedScopes.includes(scope),
                        )
                        .join(" ") || review.requestedScopes.join(" ")}
                    </td>
                    <td className="py-3 max-md:hidden">
                      <span className="flex items-center gap-2 text-sec">
                        {approvedNow.map((icon) => (
                          <span key={icon.scope} title={icon.label}>
                            <Glyph name={icon.glyph} size={16} />
                            <span className="sr-only">{icon.label}</span>
                          </span>
                        ))}
                      </span>
                    </td>
                    <td className="py-3 text-[15.5px] text-ink max-sm:hidden">
                      {submitted.format(new Date(review.createdAt))}
                    </td>
                    <td
                      className={`py-3 text-[15.5px] font-semibold tabular-nums max-sm:hidden ${review.state === "open" && Date.parse(review.createdAt) < now - 3 * dayMs ? "text-acc-ink" : "text-ink"}`}
                    >
                      {review.state === "open" ? wait : "—"}
                    </td>
                    <td className="py-3 text-right text-sec">
                      <Glyph name="chevron-right" size={18} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </section>
    </div>
  )
}
