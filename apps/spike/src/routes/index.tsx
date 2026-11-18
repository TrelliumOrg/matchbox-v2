import { Await, createFileRoute, Link } from "@tanstack/react-router"
import { type ReactNode, Suspense } from "react"
import { formatCount, formatUsd } from "../lib/format"
import {
  type EpochStats,
  type Gauge,
  getEpochStats,
  listGauges,
} from "../lib/gauges"

export const Route = createFileRoute("/")({
  loader: async () => {
    const stats = getEpochStats()
    const gauges = await listGauges()
    return { gauges, stats }
  },
  component: Home,
})

function Home(): ReactNode {
  const { gauges, stats } = Route.useLoaderData()
  const totalVotes = gauges.reduce((sum, gauge) => sum + gauge.votes, 0)
  return (
    <>
      <h1 className="page-title">Vote</h1>
      <p className="headline">
        <span className="headline-label">veMEZO voted</span>
        <span className="headline-figure">{formatCount(totalVotes)}</span>
      </p>
      <Suspense fallback={<StatsSkeleton />}>
        <Await promise={stats}>{(value) => <Stats stats={value} />}</Await>
      </Suspense>
      <ul className="gauge-grid">
        {gauges.map((gauge) => (
          <GaugeCard key={gauge.id} gauge={gauge} />
        ))}
      </ul>
    </>
  )
}

function Stats({ stats }: { stats: EpochStats }): ReactNode {
  return (
    <dl className="stats small">
      <div>
        <dt>Epoch</dt>
        <dd>{stats.epoch}</dd>
      </div>
      <div>
        <dt>Gauges</dt>
        <dd>{stats.gauges}</dd>
      </div>
      <div>
        <dt>Average per gauge</dt>
        <dd>{formatCount(Math.round(stats.totalVotes / stats.gauges))}</dd>
      </div>
    </dl>
  )
}

function StatsSkeleton(): ReactNode {
  return (
    <dl className="stats small" aria-busy="true" aria-label="Loading epoch">
      <div>
        <dt>Epoch</dt>
        <dd className="skeleton">00</dd>
      </div>
      <div>
        <dt>Gauges</dt>
        <dd className="skeleton">00</dd>
      </div>
      <div>
        <dt>Average per gauge</dt>
        <dd className="skeleton">0,000,000</dd>
      </div>
    </dl>
  )
}

function GaugeCard({ gauge }: { gauge: Gauge }): ReactNode {
  return (
    <li className="gauge-card">
      <Link
        to="/gauge/$id"
        params={{ id: String(gauge.id) }}
        className="gauge-link"
      >
        <span
          className="gauge-picture"
          style={{ viewTransitionName: `gauge-${gauge.id}` }}
          aria-hidden="true"
        >
          {gauge.name.slice(0, 1)}
        </span>
        <span className="gauge-name">{gauge.name}</span>
        <span className="gauge-sub">{gauge.tagline}</span>
        <span className="gauge-apy">{gauge.apy}% APY</span>
        <span className="gauge-sub">
          {formatUsd(gauge.incentivesUsd)} incentives
        </span>
      </Link>
    </li>
  )
}
