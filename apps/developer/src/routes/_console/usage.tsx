import type { OrgUsageResponse } from "@matchbox/contracts/console"
import type { EnvironmentQuotaStatus } from "@matchbox/contracts/rate-limits"
import { LineChart } from "@matchbox/ui/chart"
import { Icon } from "@matchbox/ui/icons"
import * as Inspect from "@matchbox/ui/inspect"
import { createFileRoute, getRouteApi, Link } from "@tanstack/react-router"
import type { ReactNode } from "react"
import { AppMark } from "../../app/console/app-row"
import { getUsagePage } from "../../app/data/console-api"
import {
  compactNumber,
  dayLabel,
  formatLatency,
  formatRate,
} from "../../app/lib/numbers"

const layout = getRouteApi("/_console")

type Range = "24h" | "7d" | "30d"
type Kind = "both" | "test" | "live"
type Search = { org?: string; range?: Range; env?: Kind }

const ranges: Range[] = ["24h", "7d", "30d"]
const kinds: { value: Kind; label: string }[] = [
  { value: "test", label: "Test" },
  { value: "live", label: "Live" },
  { value: "both", label: "Both" },
]

const hour = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "UTC",
})

const whole = new Intl.NumberFormat("en-US")

/**
 * Usage (`Kz0wFg3gQf`): the organization's requests over 24 hours, 7 or 30
 * days for test, live or both, with 4xx, 5xx, rate limiting and latency,
 * the requests chart, each app with its daily bars and today's quota, and
 * the busiest routes. The frame's 90-day range, app and route pickers,
 * previous-period line and recent error codes need data the usage API does
 * not return; they are listed in the README.
 */
export const Route = createFileRoute("/_console/usage")({
  validateSearch: (input: Record<string, unknown>): Search => {
    const search: Search = {}
    if (typeof input.org === "string") search.org = input.org
    if (input.range === "24h" || input.range === "30d")
      search.range = input.range
    if (input.env === "test" || input.env === "live") search.env = input.env
    return search
  },
  loaderDeps: ({ search }) => ({
    range: search.range ?? "7d",
    env: search.env ?? "both",
  }),
  loader: async ({ deps, parentMatchPromise }) => {
    const parent = await parentMatchPromise
    const org = parent.loaderData?.org ?? null
    const page =
      org === null
        ? { usage: null, quotas: null }
        : await getUsagePage({
            data: {
              orgId: org.id,
              range: deps.range,
              environmentKind: deps.env,
            },
          })
    return { ...page, range: deps.range, env: deps.env }
  },
  component: UsagePage,
})

function searchWith(search: Search, change: Partial<Search>): Search {
  const next: Search = { ...search, ...change }
  if (next.range === "7d") delete next.range
  if (next.env === "both") delete next.env
  return next
}

type AppUsage = {
  id: string
  name: string
  testOnly: boolean
  requests: number
  clientErrors: number
  daily: number[]
  /** Each day's start, for the daily bars' readout. */
  days: string[]
  quota: { used: number; limit: number } | null
}

/** Per app: environments summed, days summed, quotas summed. */
function byApp(
  usage: OrgUsageResponse,
  quotas: EnvironmentQuotaStatus[] | null,
): AppUsage[] {
  const apps = new Map<string, AppUsage>()
  const kinds = new Map<string, Set<string>>()
  for (const entry of usage.byEnvironment) {
    const app = apps.get(entry.app.id) ?? {
      id: entry.app.id,
      name: entry.app.name,
      testOnly: true,
      requests: 0,
      clientErrors: 0,
      daily: [],
      days: [],
      quota: null,
    }
    app.requests += entry.summary.requests
    app.clientErrors += entry.summary.clientErrors
    entry.daily.forEach((day, index) => {
      app.daily[index] = (app.daily[index] ?? 0) + day.requests
      app.days[index] ??= day.start
    })
    const seen = kinds.get(entry.app.id) ?? new Set()
    seen.add(entry.environmentKind)
    kinds.set(entry.app.id, seen)
    app.testOnly = !seen.has("live")
    const quota = quotas?.find(
      (status) => status.environmentId === entry.environmentId,
    )
    const daily = quota?.secret?.daily
    if (daily !== undefined) {
      app.quota = {
        used: (app.quota?.used ?? 0) + daily.used,
        limit: (app.quota?.limit ?? 0) + daily.limit,
      }
    }
    apps.set(entry.app.id, app)
  }
  return [...apps.values()].sort((a, b) => b.requests - a.requests)
}

function percent(part: number, total: number): string {
  if (total <= 0) return "0%"
  const share = part / total
  if (share > 0 && share < 0.01) return "Under 1%"
  return `${Math.round(share * 100)}%`
}

/**
 * An app's requests per day. Hovering, touching or focusing a day shows
 * its date and count in a tooltip; the arrow keys move between days.
 */
function DailyBars({
  values,
  days,
  name,
}: {
  values: number[]
  days: string[]
  name: string
}): ReactNode {
  Inspect.useInspect(values.length > 0)
  const top = Math.max(1, ...values)
  return (
    <span
      role="img"
      aria-label={`${name}, requests per day`}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: the arrow keys read each day
      tabIndex={0}
      className="flex h-[30px] items-end gap-[3px] rounded-[2px] outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink"
      {...Inspect.root("x", "tip", true)}
    >
      {values.map((value, index) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: one bar per day, in order
          key={index}
          className={`w-[7px] rounded-[2px] ${index === values.length - 1 ? "bg-acc/45" : "bg-acc"}`}
          style={{ height: `${Math.max(12, (value / top) * 100)}%` }}
          {...Inspect.point(
            {
              label:
                index === values.length - 1
                  ? "Today"
                  : dayLabel(days[index] ?? ""),
              value: `${whole.format(value)} requests`,
            },
            value,
          )}
        />
      ))}
    </span>
  )
}

function Stat({
  term,
  value,
  unit,
}: {
  term: string
  value: string
  unit?: string | undefined
}): ReactNode {
  return (
    <div>
      <dt className="text-[14px] text-sec">{term}</dt>
      <dd className="mt-1.5 text-[22px] font-[650] text-ink tabular-nums">
        {value}
        {unit === undefined ? null : (
          <span className="ml-0.5 text-[15px] font-normal text-sec">
            {unit}
          </span>
        )}
      </dd>
    </div>
  )
}

function UsagePage(): ReactNode {
  const { usage, quotas, range, env } = Route.useLoaderData()
  const search = Route.useSearch()
  const { org } = layout.useLoaderData()
  const apps = usage === null ? [] : byApp(usage, quotas)
  const routeTotal =
    usage === null
      ? 0
      : usage.topRoutes.reduce((sum, route) => sum + route.requests, 0)
  const p95 = usage?.totals.p95LatencyMs ?? null
  const p50 = usage?.totals.p50LatencyMs ?? null
  return (
    <div className="mx-auto flex w-full max-w-[1040px] flex-col">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[15px] text-sec">{org?.name}</p>
          <h1 className="mt-1 text-[32px] font-[650] tracking-[-0.02em] text-ink">
            Usage
          </h1>
        </div>
        {usage === null || org === null ? null : (
          <a
            href={`/api/orgs/${encodeURIComponent(org.id)}/usage.csv?${new URLSearchParams(
              {
                from: usage.from,
                to: usage.to,
                bucket: usage.bucket,
                environmentKind: usage.environmentKind,
              },
            )}`}
            className="flex h-11 items-center gap-2 rounded-full bg-soft px-5 text-[16px] font-semibold text-ink outline-none hover:bg-soft2 focus-visible:outline-2 focus-visible:outline-ink"
          >
            <Icon name="cloud-download" size={18} strokeWidth={2} />
            Export CSV
          </a>
        )}
      </header>

      <div className="mt-7 flex flex-wrap items-center justify-between gap-4">
        <nav aria-label="Range" className="flex gap-1">
          {ranges.map((value) => (
            <Link
              key={value}
              to="/usage"
              search={searchWith(search, { range: value })}
              replace
              aria-current={value === range ? "page" : undefined}
              className={`grid h-10 min-w-12 place-items-center rounded-full px-3.5 text-[15px] font-semibold ${value === range ? "bg-ink text-bg" : "text-sec hover:text-ink"}`}
            >
              {value}
            </Link>
          ))}
        </nav>
        <nav
          aria-label="Environment"
          className="flex gap-0.5 rounded-full bg-soft p-[3px]"
        >
          {kinds.map((kind) => (
            <Link
              key={kind.value}
              to="/usage"
              search={searchWith(search, { env: kind.value })}
              replace
              aria-current={kind.value === env ? "page" : undefined}
              className={`grid h-[38px] place-items-center rounded-full px-4 text-[15px] font-medium ${kind.value === env ? "bg-raised text-ink shadow-lift" : "text-sec hover:text-ink"}`}
            >
              {kind.label}
            </Link>
          ))}
        </nav>
      </div>

      {usage === null ? (
        <p className="mt-12 text-[15.5px] text-sec">Usage unavailable</p>
      ) : (
        <>
          <section
            aria-label="Totals"
            className="mt-8 flex flex-wrap items-end gap-x-14 gap-y-6"
          >
            <div>
              <p className="text-[15px] text-sec">Requests, all apps</p>
              <p className="mt-1 text-[48px] font-[650] leading-none tracking-[-0.03em] text-ink tabular-nums">
                {compactNumber(usage.totals.requests)}
              </p>
            </div>
            <dl className="grid flex-1 grid-cols-2 gap-x-10 gap-y-5 sm:grid-cols-5">
              <Stat
                term="4xx"
                value={formatRate(
                  usage.totals.requests === 0
                    ? null
                    : usage.totals.clientErrors / usage.totals.requests,
                )}
              />
              <Stat
                term="5xx"
                value={formatRate(
                  usage.totals.requests === 0
                    ? null
                    : usage.totals.serverErrors / usage.totals.requests,
                )}
              />
              <Stat
                term="Rate limited"
                value={whole.format(usage.totals.rateLimited)}
              />
              <Stat
                term="p50"
                value={p50 === null ? "—" : whole.format(Math.round(p50))}
                unit={p50 === null ? undefined : "ms"}
              />
              <Stat
                term="p95"
                value={p95 === null ? "—" : whole.format(Math.round(p95))}
                unit={p95 === null ? undefined : "ms"}
              />
            </dl>
          </section>

          {usage.series.length < 2 ? null : (
            <section
              aria-labelledby="requests-chart"
              className="mt-9 rounded-[24px] bg-soft px-6 pt-6 pb-4"
            >
              <h2
                id="requests-chart"
                className="text-[16px] font-semibold text-ink"
              >
                Requests
              </h2>
              <p className="text-[14px] text-sec">
                Per {range === "24h" ? "hour" : "day"}
              </p>
              <LineChart
                id={`usage-${range}-${env}`}
                points={usage.series.map((point) => point.requests)}
                inspect={usage.series.map((point, index) => ({
                  label:
                    index === usage.series.length - 1
                      ? range === "24h"
                        ? "This hour"
                        : "Today"
                      : range === "24h"
                        ? hour.format(new Date(point.start))
                        : dayLabel(point.start),
                  value: `${whole.format(point.requests)} requests`,
                }))}
                startLabel={
                  range === "24h"
                    ? hour.format(new Date(usage.series[0]?.start ?? ""))
                    : dayLabel(usage.series[0]?.start ?? "")
                }
                endLabel={range === "24h" ? "Now" : "Today"}
                label={`Requests per ${range === "24h" ? "hour" : "day"}, ${compactNumber(usage.totals.requests)} in all`}
                width={1000}
                height={240}
                className="mt-2 w-full"
              />
            </section>
          )}

          <section aria-labelledby="by-app" className="mt-14">
            <h2 id="by-app" className="mb-4 text-[24px] font-[650] text-ink">
              By app
            </h2>
            {apps.length === 0 ? (
              <p className="text-[15.5px] text-sec">No traffic</p>
            ) : (
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-line text-[14px] text-sec">
                    <th className="pb-3 pl-16 font-normal">App</th>
                    <th className="pb-3 font-normal max-md:hidden">{range}</th>
                    <th className="pb-3 font-normal max-md:hidden">
                      Quota today
                    </th>
                    <th className="pb-3 text-right font-normal">Requests</th>
                  </tr>
                </thead>
                <tbody>
                  {apps.map((app) => (
                    <tr key={app.id}>
                      <td className="py-3">
                        <span className="flex items-center gap-4">
                          <AppMark app={{ name: app.name, logoUrl: null }} />
                          <span>
                            <span className="flex items-center gap-1.5 text-[16px] font-semibold text-ink">
                              {app.name}
                              {app.testOnly ? (
                                <span title="Test">
                                  <Icon
                                    name="flask-conical"
                                    size={15}
                                    strokeWidth={1.8}
                                    className="text-sec"
                                  />
                                  <span className="sr-only">Test</span>
                                </span>
                              ) : null}
                            </span>
                            <span className="block text-[15px] text-sec">
                              4xx{" "}
                              {formatRate(
                                app.requests === 0
                                  ? null
                                  : app.clientErrors / app.requests,
                              )}
                            </span>
                          </span>
                        </span>
                      </td>
                      <td className="py-3 max-md:hidden">
                        <DailyBars
                          values={app.daily}
                          days={app.days}
                          name={app.name}
                        />
                      </td>
                      <td className="w-[240px] py-3 pr-8 max-md:hidden">
                        {app.quota === null ? (
                          <span className="text-[14.5px] text-mut">—</span>
                        ) : (
                          <>
                            <span className="flex justify-between text-[14px] text-sec tabular-nums">
                              <span>
                                <span className="font-semibold text-ink">
                                  {whole.format(app.quota.used)}
                                </span>{" "}
                                of {whole.format(app.quota.limit)}
                              </span>
                              {percent(app.quota.used, app.quota.limit)}
                            </span>
                            <span className="mt-2 block h-1.5 rounded-full bg-soft2">
                              <span
                                className="block h-full rounded-full bg-acc"
                                style={{
                                  width: `${Math.min(100, (app.quota.used / app.quota.limit) * 100)}%`,
                                }}
                              />
                            </span>
                          </>
                        )}
                      </td>
                      <td className="py-3 text-right">
                        <span className="block text-[16px] font-semibold text-ink tabular-nums">
                          {compactNumber(app.requests)}
                        </span>
                        <span className="block text-[15px] text-sec">
                          {percent(app.requests, usage.totals.requests)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          {usage.topRoutes.length === 0 ? null : (
            <section aria-labelledby="top-routes" className="mt-14">
              <h2
                id="top-routes"
                className="mb-4 text-[24px] font-[650] text-ink"
              >
                Top routes
              </h2>
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-line text-[14px] text-sec">
                    <th className="pb-3 font-normal">Route</th>
                    <th className="pb-3 font-normal max-md:hidden">Share</th>
                    <th className="pb-3 text-right font-normal max-sm:hidden">
                      p95
                    </th>
                    <th className="pb-3 text-right font-normal max-sm:hidden">
                      Errors
                    </th>
                    <th className="pb-3 text-right font-normal">Requests</th>
                  </tr>
                </thead>
                <tbody>
                  {usage.topRoutes.map((route) => (
                    <tr
                      key={`${route.method} ${route.route}`}
                      className="border-b border-line"
                    >
                      <td className="py-3.5 pr-3 font-mono text-[14px] text-ink [overflow-wrap:anywhere]">
                        {route.method} {route.route}
                      </td>
                      <td className="py-3.5 max-md:hidden">
                        <span className="block h-1.5 w-[120px] rounded-full bg-soft2">
                          <span
                            className="block h-full rounded-full bg-acc"
                            style={{
                              width: `${routeTotal === 0 ? 0 : (route.requests / routeTotal) * 100}%`,
                            }}
                          />
                        </span>
                      </td>
                      <td className="py-3.5 text-right text-[15px] text-ink tabular-nums max-sm:hidden">
                        {formatLatency(route.p95LatencyMs)}
                      </td>
                      <td className="py-3.5 text-right text-[15px] text-ink tabular-nums max-sm:hidden">
                        {formatRate(
                          route.requests === 0
                            ? null
                            : route.errors / route.requests,
                        )}
                      </td>
                      <td className="py-3.5 text-right text-[15px] font-semibold text-ink tabular-nums">
                        {compactNumber(route.requests)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
        </>
      )}
    </div>
  )
}
