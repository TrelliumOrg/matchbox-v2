import { type ReactNode, useCallback, useEffect, useState } from "react"
import type { ChartSeries } from "../../data/borrow"
import type { Section } from "../../data/explorer"
import { ChartSpace, SeriesFigure } from "./chart"
import { type ChartMarket, chartFailed, readCharts } from "./charts-read"
import { type ChartPeriod, periodKey } from "./search"

/**
 * The overview's market charts, read once the page has painted (one
 * request for every market, see charts-read): each panel's figures are in
 * the page, only the drawing waits, in a space its height keeps so
 * nothing moves. A chart whose series failed asks once more after a few
 * seconds, then waits for "Try again".
 */

/** How long the one automatic retry waits. */
export const retryAfterMs = 3_000

const unavailable: Section<ChartSeries> = { status: "unavailable" }

// The drawing's code loads beside the series, not after it.
if (!import.meta.env.SSR) void import("./series-drawing")

function seriesOf(
  id: string,
  period: ChartPeriod,
  markets: readonly ChartMarket[],
): Promise<Section<ChartSeries>> {
  return readCharts(period, markets).then(
    (charts) => charts[id] ?? unavailable,
    () => unavailable,
  )
}

export function useMarketChart(
  id: string,
  period: ChartPeriod,
  markets: readonly ChartMarket[],
): { series: Section<ChartSeries> | "waiting"; retry: (() => void) | null } {
  const [series, setSeries] = useState<Section<ChartSeries> | "waiting">(
    "waiting",
  )
  // Bumped by "Try again": reads again with no automatic retry after it.
  const [attempt, setAttempt] = useState(0)
  const key = `${id}:${periodKey(period)}:${markets.map((market) => market.id).join(",")}`
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` names the market, the period and the request's markets
  useEffect(() => {
    let live = true
    let timer: ReturnType<typeof setTimeout> | undefined
    setSeries("waiting")
    seriesOf(id, period, markets).then((first) => {
      if (!live) return
      setSeries(first)
      if (!chartFailed(first) || attempt > 0) return
      timer = setTimeout(() => {
        seriesOf(id, period, markets).then((second) => {
          if (live) setSeries(second)
        })
      }, retryAfterMs)
    })
    return () => {
      live = false
      if (timer !== undefined) clearTimeout(timer)
    }
  }, [key, attempt])
  const retry = useCallback(() => {
    setSeries("waiting")
    setAttempt((count) => count + 1)
  }, [])
  return {
    series,
    retry: series !== "waiting" && chartFailed(series) ? retry : null,
  }
}

export function MarketChart({
  id,
  period,
  markets,
  label,
  unit,
}: {
  id: string
  period: ChartPeriod
  markets: readonly ChartMarket[]
  label: string
  unit: string | null
}): ReactNode {
  const { series, retry } = useMarketChart(id, period, markets)
  if (series === "waiting") return <ChartSpace busy />
  return (
    <SeriesFigure series={series} label={label} unit={unit} retry={retry} />
  )
}
