import { type ReactNode, Suspense } from "react"
import type { MezoPoolFigures } from "../../data/pools"
import { Figure, Panel, ShareBar, Stats } from "../voting/parts"
import { PoolChartPanels } from "./pool-charts"
import { VotesPanel } from "./pool-gauge"

/**
 * A Mezo pool's panels (`ak42S52PlW`): its liquidity per day and share
 * of DEX, volume and fees per day in USD, its gauge's veBTC votes per
 * epoch, and the reserves now. A panel whose
 * data did not read is left out; the page's facts and rates stand.
 */
export function MezoPoolPanels({
  pool,
  figures,
}: {
  /** The pool's address. */
  pool: string
  figures: MezoPoolFigures
}): ReactNode {
  const { reserves } = figures
  return (
    <>
      <PoolChartPanels pool={pool} figures={figures} />
      {figures.gauge === null ? null : (
        <Suspense fallback={null}>
          <VotesPanel gauge={figures.gauge} />
        </Suspense>
      )}
      {reserves === null ? null : (
        <Panel
          label="Reserves"
          aside={<span className="text-[14px] font-semibold">Now</span>}
        >
          {reserves.figure === null ? null : (
            <Figure value={reserves.figure} note="at the latest closes" />
          )}
          <ShareBar label="Reserves" segments={reserves.segments} />
          <Stats stats={reserves.stats} />
        </Panel>
      )}
    </>
  )
}
