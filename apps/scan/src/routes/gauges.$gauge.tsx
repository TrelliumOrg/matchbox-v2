import { nameWithPoolType } from "@matchbox/domain/pool-type"
import { createFileRoute, notFound, redirect } from "@tanstack/react-router"
import type { ReactNode } from "react"
import { canonicalAddress } from "../data/canonical"
import { getGaugePage } from "../data/gauges"
import { GaugeView } from "../explorer/voting/gauge-page"
import {
  type PeriodInput,
  periodInput,
  periodSearch,
  type Range,
  type Span,
} from "../explorer/voting/range"

/**
 * A gauge, by its address (`kChmtpKRqP`), from Pro's gauge profile and the
 * Scan rows; a pool gauge adds its pool's series (`ak42S52PlW`). `range`
 * (or a custom span's `from` and `to`) picks the pool panels' period.
 */
export const Route = createFileRoute("/gauges/$gauge")({
  validateSearch: (
    search: Record<string, unknown>,
  ): { range?: Range } & Partial<Span> => periodSearch(search),
  loaderDeps: ({ search }): PeriodInput => periodInput(search),
  loader: async ({ params, deps }) => {
    const gauge = canonicalAddress(params.gauge)
    if (gauge === null) throw notFound()
    if (gauge !== params.gauge) {
      throw redirect({
        to: "/gauges/$gauge",
        params: { gauge },
        statusCode: 301,
      })
    }
    const page = await getGaugePage({ data: { gauge, ...deps } })
    if (page.header.status === "missing") throw notFound()
    return page
  },
  head: ({ loaderData }) => ({
    meta: [
      {
        title:
          loaderData?.header.status === "ok" &&
          loaderData.header.data.gauge.name !== null
            ? `${nameWithPoolType(
                loaderData.header.data.gauge.name,
                loaderData.header.data.gauge.poolLabel,
              )}, Matchscan`
            : "Gauge, Matchscan",
      },
    ],
  }),
  component: function GaugeRoute(): ReactNode {
    return <GaugeView page={Route.useLoaderData()} />
  },
})
