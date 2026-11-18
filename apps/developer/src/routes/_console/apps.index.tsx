import type { App, EnvironmentSummary } from "@matchbox/contracts/console"
import { createFileRoute, getRouteApi, Link } from "@tanstack/react-router"
import { type ReactNode, useId, useState } from "react"
import { Glyph, type GlyphName } from "../../app/console/glyphs"
import { NewAppButton } from "../../app/console/new-app"
import { getApps, getUsage } from "../../app/data/console-api"
import { compactNumber } from "../../app/lib/numbers"

const layout = getRouteApi("/_console")

/**
 * Apps (`ZqnXTBKb9u`): every app in the organization as a card with its
 * requests over seven days, website, each environment's state and the
 * scopes live has, filtered by status and searched by name.
 */
export const Route = createFileRoute("/_console/apps/")({
  loader: async ({ parentMatchPromise }) => {
    const parent = await parentMatchPromise
    const org = parent.loaderData?.org ?? null
    if (org === null) return { apps: [], requests: null }
    const [apps, usage] = await Promise.all([
      getApps({ data: { orgId: org.id } }),
      getUsage({ data: { orgId: org.id, range: "7d" } }),
    ])
    return { apps, requests: requestsByApp(usage) }
  },
  component: AppsPage,
})

/** Requests over the usage window per app id; null when usage is down. */
function requestsByApp(
  usage: Awaited<ReturnType<typeof getUsage>>,
): Record<string, number> | null {
  if (usage === null) return null
  const totals: Record<string, number> = {}
  for (const entry of usage.byEnvironment) {
    totals[entry.app.id] = (totals[entry.app.id] ?? 0) + entry.summary.requests
  }
  return totals
}

type Filter = "all" | "active" | "retired"

const filterNames: Record<Filter, string> = {
  all: "All",
  active: "Active",
  retired: "Retired",
}

const reviewChips: Record<
  EnvironmentSummary["reviewState"],
  { label: string; tone: string }
> = {
  development: { label: "Not submitted", tone: "bg-bg text-ink2" },
  submitted: { label: "In review", tone: "bg-soft2 text-ink2" },
  approved: { label: "Approved", tone: "bg-pos-soft text-pos" },
  "changes-requested": {
    label: "Changes requested",
    tone: "bg-acc-soft text-acc-ink",
  },
  rejected: { label: "Rejected", tone: "bg-neg-soft text-neg" },
}

const scopeIcons: Record<string, { glyph: GlyphName; label: string }> = {
  "gauge-profiles:read": { glyph: "chart", label: "Gauge and market data" },
  openid: { glyph: "key", label: "Sign-in ID" },
  wallet: { glyph: "wallet", label: "Wallet" },
  "discord:id": { glyph: "user-round", label: "Discord ID" },
  "discord:profile": { glyph: "user", label: "Discord profile" },
  "discord:membership": { glyph: "users", label: "Mezo Discord membership" },
}

function keepOrg(current: { org?: string }): { org?: string } {
  return current.org === undefined ? {} : { org: current.org }
}

function Chip({ label, tone }: { label: string; tone: string }): ReactNode {
  return (
    <span
      className={`inline-flex h-6 items-center whitespace-nowrap rounded-full px-[9px] text-[13px] font-semibold ${tone}`}
    >
      {label}
    </span>
  )
}

function websiteHost(url: string | null): string | null {
  if (url === null) return null
  try {
    return new URL(url).host
  } catch {
    return null
  }
}

function Row({
  term,
  children,
}: {
  term: string
  children: ReactNode
}): ReactNode {
  return (
    <div className="flex min-h-6 items-center justify-between gap-5">
      <dt className="flex-none text-sec">{term}</dt>
      <dd className="flex min-w-0 items-center gap-2 truncate">{children}</dd>
    </div>
  )
}

const none = <span className="text-mut">None</span>

function AppCard({
  app,
  requests,
}: {
  app: App
  requests: number | null
}): ReactNode {
  const test = app.environments.find((entry) => entry.kind === "test")
  const live = app.environments.find((entry) => entry.kind === "live")
  const verified = live !== undefined && live.verifiedAt !== null
  const website = websiteHost(app.websiteUrl)
  const liveScopes = (live?.approvedScopes ?? []).flatMap((scope) => {
    const icon = scopeIcons[scope]
    return icon === undefined ? [] : [{ scope, ...icon }]
  })
  return (
    <li className="flex min-h-[340px] flex-col overflow-hidden rounded-[24px] bg-soft">
      <div className="flex h-[54px] flex-none items-center justify-between gap-3 rounded-t-[24px] bg-ink px-5 text-[15px] font-[650] text-bg">
        <Link
          to="/apps/$appId"
          params={{ appId: app.id }}
          search={keepOrg}
          className="flex min-w-0 items-center gap-1.5 outline-none focus-visible:underline"
        >
          <span className="truncate">{app.name}</span>
          <Glyph name="chevron-right" size={16} />
        </Link>
        <span
          className={`flex flex-none items-center gap-1.5 text-[14px] font-semibold ${verified ? "" : "text-mut"}`}
        >
          <Glyph name={verified ? "badge-check" : "circle-alert"} size={18} />
          {verified ? "Verified" : "Not verified"}
        </span>
      </div>
      <div className="flex flex-1 flex-col p-5">
        <p className="text-[23px] font-[650] tracking-[-0.015em] text-ink tabular-nums">
          {requests === null ? "—" : compactNumber(requests)}
        </p>
        <p className="mt-0.5 text-[15px] text-sec">
          {app.status === "active"
            ? "Requests, 7d"
            : `Requests, 7d · ${app.status}`}
        </p>
        <dl className="mt-4 mb-5 flex flex-col gap-2.5 text-[15px] text-ink2">
          <Row term="Website">{website ?? none}</Row>
          <Row term="Test">
            {test === undefined ? (
              none
            ) : (
              <Chip label="Active" tone="bg-pos-soft text-pos" />
            )}
          </Row>
          <Row term="Live review">
            {live === undefined ? (
              none
            ) : (
              <Chip {...reviewChips[live.reviewState]} />
            )}
          </Row>
          <Row term="Live scopes">
            {liveScopes.length === 0
              ? none
              : liveScopes.map((icon) => (
                  <span
                    key={icon.scope}
                    title={icon.label}
                    className="text-sec"
                  >
                    <Glyph name={icon.glyph} size={17} />
                    <span className="sr-only">{icon.label}</span>
                  </span>
                ))}
          </Row>
        </dl>
        <Link
          to="/apps/$appId"
          params={{ appId: app.id }}
          search={keepOrg}
          aria-label={`Open ${app.name}`}
          className="mt-auto flex h-9 w-fit items-center rounded-full bg-bg px-4 text-[14.5px] font-semibold text-ink outline-none hover:bg-soft2 focus-visible:outline-2 focus-visible:outline-ink"
        >
          Open
        </Link>
      </div>
    </li>
  )
}

function AppsPage(): ReactNode {
  const { apps, requests } = Route.useLoaderData()
  const { org } = layout.useLoaderData()
  const searchId = useId()
  const [filter, setFilter] = useState<Filter>("all")
  const [query, setQuery] = useState("")
  const counts: Record<Filter, number> = {
    all: apps.length,
    active: apps.filter((app) => app.status !== "retired").length,
    retired: apps.filter((app) => app.status === "retired").length,
  }
  const needle = query.trim().toLowerCase()
  const shown = apps.filter(
    (app) =>
      (filter === "all" ||
        (filter === "retired") === (app.status === "retired")) &&
      (needle === "" ||
        app.name.toLowerCase().includes(needle) ||
        app.slug.includes(needle)),
  )
  return (
    <div className="mx-auto flex w-full max-w-[1040px] flex-col">
      <header className="flex items-end justify-between gap-4">
        <div>
          <p className="text-[15px] text-sec">{org?.name}</p>
          <h1 className="mt-1 text-[32px] font-[650] tracking-[-0.02em] text-ink">
            Apps
          </h1>
        </div>
        {org === null ? null : <NewAppButton orgId={org.id} />}
      </header>
      <div className="mt-7 flex flex-wrap items-center justify-between gap-4">
        <div role="radiogroup" aria-label="Status" className="flex gap-1">
          {(["all", "active", "retired"] as const).map((key) => (
            // biome-ignore lint/a11y/useSemanticElements: a pill radio group, as in Pro's segmented filters
            <button
              key={key}
              type="button"
              role="radio"
              aria-checked={filter === key}
              onClick={() => setFilter(key)}
              className="flex h-10 cursor-pointer items-center gap-1.5 rounded-full px-4 text-[15px] font-semibold text-sec outline-none focus-visible:outline-2 focus-visible:outline-ink aria-checked:bg-ink aria-checked:text-bg"
            >
              {filterNames[key]}
              <span className="font-medium opacity-70">{counts[key]}</span>
            </button>
          ))}
        </div>
        <label
          htmlFor={searchId}
          className="flex h-11 w-[360px] max-w-full items-center gap-2.5 rounded-full bg-soft px-[18px] text-sec focus-within:outline-2 focus-within:outline-ink"
        >
          <Glyph name="search" size={18} />
          <span className="sr-only">Search apps</span>
          <input
            id={searchId}
            type="search"
            placeholder="Search apps"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="min-w-0 flex-1 bg-transparent text-[16px] text-ink outline-none placeholder:text-sec"
          />
        </label>
      </div>
      <ul className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
        {shown.map((app) => (
          <AppCard
            key={app.id}
            app={app}
            requests={requests === null ? null : (requests[app.id] ?? 0)}
          />
        ))}
        {org === null ? null : (
          <li className="flex flex-col">
            <NewAppButton orgId={org.id} variant="card" />
          </li>
        )}
      </ul>
    </div>
  )
}
