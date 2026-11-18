import * as SeriesChart from "@matchbox/ui/series-chart"
import type { ReactNode } from "react"
import type { Section } from "../../data/explorer"
import type { DexView, TvlView } from "../../data/network"
import type { SeriesPanelData } from "../../data/scan/series-views"
import {
  Figure,
  Panel,
  PanelEmpty,
  PanelState,
  RangeToggle,
  ShareBar,
  Stats,
} from "../voting/parts"
import type { PeriodView } from "../voting/range"

/**
 * Network's total value locked and DEX volume (`-5H-NByPdL`), read with
 * the page: the TVL figure leads it, so it is in the first paint. Each
 * chart's day reads out in its panel's figure when hovered, touched or
 * focused.
 */

function Chart({
  name,
  data,
  figure,
}: {
  name: string
  data: SeriesPanelData
  figure: string
}): ReactNode {
  return (
    <SeriesChart.Root
      points={data.points}
      kind={data.kind}
      label={`${name}, ${figure}`}
      startLabel={data.startLabel}
      endLabel={data.endLabel}
      height={140}
      className="mt-6"
      readout="figure"
    />
  )
}

/** Total value locked now, split by where it sits, and over the period. */
export function TvlPanel({
  tvl,
  period,
  custom,
}: {
  tvl: TvlView | null
  period: PeriodView
  /** The custom span's button (the page loads it). */
  custom?: ReactNode
}): ReactNode {
  return (
    <Panel
      label="Total value locked"
      aside={
        tvl?.history == null ? (
          <span className="text-[14px] font-semibold">Now</span>
        ) : (
          <RangeToggle period={period} to="/network" search={{}}>
            {custom}
          </RangeToggle>
        )
      }
    >
      {tvl === null ? (
        <PanelEmpty>Not available yet</PanelEmpty>
      ) : (
        <>
          <Figure
            value={tvl.figure}
            note={tvl.change ?? "at the latest daily prices"}
          />
          <ShareBar label="Total value locked" segments={tvl.parts} />
          {tvl.apart === null ? null : (
            <p className="mt-3 text-[14px] text-sec">
              Savings vault {tvl.apart}, not in the total
            </p>
          )}
          {tvl.missing.length === 0 ? null : (
            <p className="mt-1 text-[14px] text-sec">
              Not counted: {tvl.missing.join(", ")}
            </p>
          )}
          {tvl.unpriced.length === 0 ? null : (
            <p className="mt-1 text-[14px] text-sec">
              No price: {tvl.unpriced.join(", ")}
            </p>
          )}
          {tvl.history === null ? null : (
            <>
              <Chart
                name="Total value locked"
                data={tvl.history}
                figure={tvl.figure}
              />
              <p className="mt-2 text-[14px] text-sec">
                veBTC, trove collateral and DEX pools at each day's close
              </p>
            </>
          )}
        </>
      )}
    </Panel>
  )
}

/** DEX volume on Mezo's pools: the last day by pool, and per day. */
export function DexPanel({
  dex,
  period,
  custom,
}: {
  dex: Section<DexView | null>
  period: PeriodView
  /** The custom span's button (the page loads it). */
  custom?: ReactNode
}): ReactNode {
  const data = dex?.status === "ok" ? dex.data : null
  return (
    <Panel
      label="DEX volume"
      aside={
        data?.chart != null ? (
          <RangeToggle period={period} to="/network" search={{}}>
            {custom}
          </RangeToggle>
        ) : data?.day == null ? null : (
          <span className="text-[14px] font-semibold">{data.day}</span>
        )
      }
    >
      {dex.status !== "ok" ? (
        <PanelState section={dex} />
      ) : data === null ? (
        <PanelEmpty>Not available yet</PanelEmpty>
      ) : data.outside === true ? (
        <PanelEmpty>None in this period</PanelEmpty>
      ) : (
        <>
          <Figure
            value={data.figure}
            note={
              data.chart === null
                ? "on Mezo's pools"
                : data.day === null
                  ? null
                  : `on ${data.day}`
            }
          />
          <Stats stats={data.stats} />
          {data.chart === null ? null : (
            <Chart name="DEX volume" data={data.chart} figure={data.figure} />
          )}
          {data.pools.length === 0 ? null : (
            <ul
              aria-label="Volume by pool"
              className="mt-5 flex flex-col gap-3"
            >
              {data.pools.map((pool) => (
                <li
                  key={pool.name}
                  className="grid grid-cols-[minmax(0,11rem)_minmax(0,1fr)_auto] items-center gap-4 text-[15px] max-md:grid-cols-[minmax(0,1fr)_auto]"
                >
                  <span className="truncate font-semibold">{pool.name}</span>
                  <span
                    aria-hidden="true"
                    className="h-2 overflow-hidden rounded-full bg-soft2 max-md:hidden"
                  >
                    <span
                      className="block h-full rounded-full bg-acc"
                      style={{ width: `${Math.max(2, pool.bps / 100)}%` }}
                    />
                  </span>
                  <span className="text-right font-semibold tabular-nums">
                    {pool.volume}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {data.unpriced.length === 0 ? null : (
            <p className="mt-3 text-[14px] text-sec">
              No price: {data.unpriced.join(", ")}
            </p>
          )}
        </>
      )}
    </Panel>
  )
}
