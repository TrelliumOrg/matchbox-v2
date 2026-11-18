import type { OrgUsageResponse } from "@matchbox/contracts/console"
import { BarChart } from "@matchbox/ui/chart"
import * as Inspect from "@matchbox/ui/inspect"
import { createFileRoute, getRouteApi, Link } from "@tanstack/react-router"
import type { ReactNode } from "react"
import { Empty } from "../../app/components/states"
import { AppRow } from "../../app/console/app-row"
import { NewAppButton } from "../../app/console/new-app"
import {
  PlatformStatus,
  RecentReviews,
} from "../../app/console/overview-panels"
import { getOverview } from "../../app/data/console-api"
import {
  compactNumber,
  dayLabel,
  formatLatency,
  formatRate,
} from "../../app/lib/numbers"

const layout = getRouteApi("/_console")

const whole = new Intl.NumberFormat("en-US")

/**
 * Overview (`WpDLhNZgA7`, phone `X2lfH-yNT2`): platform status, usage, the
 * apps, and the latest reviews with the changelog link, as Classic had.
 */
export const Route = createFileRoute("/_console/")({
  loaderDeps: ({ search }) => ({ org: search.org }),
  // The organization comes from the layout's loader.
  loader: async ({ parentMatchPromise }) => {
    const parent = await parentMatchPromise
    const org = parent.loaderData?.org ?? null
    if (org === null)
      return { apps: [], usage: null, health: null, reviews: null }
    return getOverview({ data: { orgId: org.id } })
  },
  component: Overview,
})

function Usage({ usage }: { usage: OrgUsageResponse }): ReactNode {
  const totals = usage.totals
  // A day hovered, touched or focused reads into the big number.
  const bars = usage.series.map((point) => ({
    label: dayLabel(point.start),
    value: point.requests,
    text: whole.format(point.requests),
  }))
  return (
    <div
      className="grid gap-10 lg:grid-cols-[minmax(0,380px)_1fr] lg:items-end"
      {...Inspect.scope}
    >
      <div>
        <p className="text-[15.5px] text-sec">
          <Inspect.Note>Requests, all apps</Inspect.Note>
        </p>
        <p className="mt-1 text-[48px] font-[650] tracking-[-0.03em] text-ink tabular-nums">
          <Inspect.Value
            reserve={Inspect.widest([
              compactNumber(totals.requests),
              ...bars.map((bar) => bar.text),
            ])}
          >
            {compactNumber(totals.requests)}
          </Inspect.Value>
        </p>
        <dl className="mt-5 grid grid-cols-3 gap-6">
          <div>
            <dt className="text-[14.5px] text-sec">Error rate</dt>
            <dd className="mt-1 text-[17px] font-semibold text-ink tabular-nums">
              {formatRate(totals.errorRate)}
            </dd>
          </div>
          <div>
            <dt className="text-[14.5px] text-sec">p95 latency</dt>
            <dd className="mt-1 text-[17px] font-semibold text-ink tabular-nums">
              {formatLatency(totals.p95LatencyMs)}
            </dd>
          </div>
          <div>
            <dt className="text-[14.5px] text-sec">Rate limited</dt>
            <dd className="mt-1 text-[17px] font-semibold text-ink tabular-nums">
              {compactNumber(totals.rateLimited)}
            </dd>
          </div>
        </dl>
      </div>
      {bars.length === 0 ? null : (
        <BarChart
          bars={bars}
          id="overview-requests"
          label="Requests per day, last 7 days"
          readout="figure"
          height={170}
        />
      )}
    </div>
  )
}

function Overview(): ReactNode {
  const { apps, usage, health, reviews } = Route.useLoaderData()
  const { org } = layout.useLoaderData()
  return (
    <div className="mx-auto flex w-full max-w-[1040px] flex-col">
      <header className="flex items-end justify-between gap-4">
        <div>
          <p className="text-[15.5px] text-sec">{org?.name}</p>
          <h1 className="mt-1 text-[34px] font-[650] tracking-[-0.02em] text-ink">
            Overview
          </h1>
        </div>
        {org === null ? null : <NewAppButton orgId={org.id} />}
      </header>

      <div className="mt-8">
        <PlatformStatus health={health} />
      </div>

      <section aria-labelledby="usage-title" className="mt-12">
        <h2 id="usage-title" className="mb-8 text-[22px] font-[650] text-ink">
          Usage <span className="text-[15.5px] font-normal text-sec">7d</span>
        </h2>
        {usage === null ? (
          <p className="text-[15.5px] text-sec">Usage unavailable</p>
        ) : (
          <Usage usage={usage} />
        )}
      </section>

      <section aria-labelledby="apps-title" className="mt-14">
        <div className="mb-4 flex items-baseline justify-between">
          <h2 id="apps-title" className="text-[22px] font-[650] text-ink">
            Apps
          </h2>
          <Link
            to="/apps"
            search={(current: { org?: string }) =>
              current.org === undefined ? {} : { org: current.org }
            }
            className="text-[15.5px] font-semibold text-ink underline underline-offset-[3px]"
          >
            See all
          </Link>
        </div>
        {apps.length === 0 ? (
          <Empty title="No apps yet">
            {org === null ? null : <NewAppButton orgId={org.id} />}
          </Empty>
        ) : (
          <ul className="flex flex-col">
            {apps.slice(0, 5).map((app) => {
              const requests =
                usage?.byEnvironment
                  .filter((entry) => entry.app.id === app.id)
                  .reduce((sum, entry) => sum + entry.summary.requests, 0) ??
                null
              return (
                <AppRow
                  key={app.id}
                  app={app}
                  aside={
                    requests === null ? null : (
                      <p className="text-right">
                        <span className="block text-[16px] font-semibold text-ink tabular-nums">
                          {compactNumber(requests)}
                        </span>
                        <span className="block text-[14.5px] text-sec">
                          Requests, 7d
                        </span>
                      </p>
                    )
                  }
                />
              )
            })}
          </ul>
        )}
      </section>

      <RecentReviews reviews={reviews} />
    </div>
  )
}
