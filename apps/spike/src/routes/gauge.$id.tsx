import { createFileRoute, Link, notFound } from "@tanstack/react-router"
import type { ReactNode } from "react"
import { formatCount, formatUsd } from "../lib/format"
import { getGauge } from "../lib/gauges"

export const Route = createFileRoute("/gauge/$id")({
  loader: async ({ params }) => {
    const gauge = await getGauge({ data: { id: Number(params.id) } })
    if (gauge === null) throw notFound()
    return gauge
  },
  head: ({ loaderData }) => ({
    meta: [{ title: loaderData ? loaderData.name : "Gauge" }],
  }),
  component: GaugeProfile,
  notFoundComponent: () => <p>Gauge not found</p>,
})

function GaugeProfile(): ReactNode {
  const gauge = Route.useLoaderData()
  return (
    <article className="profile">
      <Link to="/" className="back">
        Vote
      </Link>
      <header className="profile-head">
        <span
          className="gauge-picture large"
          style={{ viewTransitionName: `gauge-${gauge.id}` }}
          aria-hidden="true"
        >
          {gauge.name.slice(0, 1)}
        </span>
        <h1 className="page-title">{gauge.name}</h1>
      </header>
      <dl className="stats">
        <div>
          <dt>APY</dt>
          <dd>{gauge.apy}%</dd>
        </div>
        <div>
          <dt>Votes</dt>
          <dd>{formatCount(gauge.votes)}</dd>
        </div>
        <div>
          <dt>Incentives</dt>
          <dd>{formatUsd(gauge.incentivesUsd)}</dd>
        </div>
      </dl>
    </article>
  )
}
