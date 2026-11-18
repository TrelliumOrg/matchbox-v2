import type { ReactNode } from "react"
import type { PoolPanels } from "../../data/gauges"
import { CustomPeriod } from "./custom-period"
import { Panel, PanelState, RangeToggle } from "./parts"
import type { PeriodView } from "./range"
import { SeriesBody } from "./series-panel"

/**
 * A pool gauge's pool (`ak42S52PlW`) as far as the series serve it: its
 * first token swapped in (with that day's fees and swaps) and held, each
 * labelled as that one token, the other side's balance in the stats.
 * Its own module, loaded only on pool gauges, so other gauges do not load
 * the chart (nor the custom span's button, imported here directly).
 */

export function PoolCards({
  pool,
  period,
  gauge,
}: {
  pool: PoolPanels
  period: PeriodView
  gauge: string
}): ReactNode {
  const toggle = (label: string) => (
    <RangeToggle
      period={period}
      to="/gauges/$gauge"
      params={{ gauge }}
      search={{}}
      label={`Period, ${label}`}
    >
      <CustomPeriod period={period} search={{}} />
    </RangeToggle>
  )
  return (
    <>
      <Panel label={pool.volumeLabel} aside={toggle(pool.volumeLabel)}>
        {pool.volume.status !== "ok" ? (
          <PanelState section={pool.volume} />
        ) : (
          <SeriesBody
            name={pool.volumeLabel}
            data={pool.volume.data}
            stats={pool.volumeStats}
            empty="No swaps yet"
          />
        )}
      </Panel>
      <Panel label={pool.liquidityLabel} aside={toggle(pool.liquidityLabel)}>
        {pool.liquidity.status !== "ok" ? (
          <PanelState section={pool.liquidity} />
        ) : (
          <SeriesBody
            name={pool.liquidityLabel}
            data={pool.liquidity.data}
            stats={pool.liquidityStats}
            empty="No liquidity yet"
          />
        )}
      </Panel>
    </>
  )
}
