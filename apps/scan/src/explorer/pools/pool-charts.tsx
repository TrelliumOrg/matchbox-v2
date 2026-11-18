import * as SeriesChart from "@matchbox/ui/series-chart"
import type { ReactNode } from "react"
import {
  type ChartFigures,
  getPoolCharts,
  type MezoPoolFigures,
  type PoolCharts,
} from "../../data/pools"
import { Figure, Panel, Stats } from "../voting/parts"
import { useAfterPaint } from "./after-paint"

/**
 * A Mezo pool's liquidity over 90 days and volume and fees over 30
 * (`ak42S52PlW`). Their figures are in the first paint; the days are read
 * in one request once the page has painted (`poolPageCharts`), so the points
 * do not ride in the page's hydration data. Until they answer each
 * chart's box is empty at its full size, its day labels in place, so
 * nothing moves when it is drawn; a failed read leaves the boxes empty.
 */

const pending = new Map<string, Promise<PoolCharts>>()

function ChartPanel({
  label,
  days,
  figures,
  chart,
  kind,
}: {
  label: string
  days: number
  figures: ChartFigures
  chart: PoolCharts["volume"] | undefined
  kind: "flow" | "level"
}): ReactNode {
  return (
    <Panel
      label={label}
      aside={
        <span className="text-[14px] text-sec">
          {days}d, at each day's close
        </span>
      }
    >
      <Figure
        value={figures.figure}
        note={figures.note}
        reserve={figures.reserve}
      />
      <Stats stats={figures.stats} />
      <SeriesChart.Root
        points={chart?.points ?? []}
        kind={kind}
        label={`${label}, ${figures.figure}`}
        startLabel={figures.startLabel}
        endLabel={figures.endLabel}
        height={140}
        className="mt-6"
        readout="figure"
      />
    </Panel>
  )
}

export function PoolChartPanels({
  pool,
  figures,
}: {
  pool: string
  figures: MezoPoolFigures
}): ReactNode {
  const read = useAfterPaint(pool, pending, () =>
    getPoolCharts({ data: { pool } }),
  )
  const charts = typeof read === "string" ? null : read
  return (
    <>
      {figures.liquidity === null ? null : (
        <ChartPanel
          label="Liquidity"
          days={90}
          figures={figures.liquidity}
          chart={charts?.liquidity}
          kind="level"
        />
      )}
      {figures.volume === null ? null : (
        <ChartPanel
          label="Volume and fees"
          days={30}
          figures={figures.volume}
          chart={charts?.volume}
          kind="flow"
        />
      )}
    </>
  )
}
