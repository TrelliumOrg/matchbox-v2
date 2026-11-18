import { type ReactNode, Suspense } from "react"
import type { Section } from "../../data/explorer"
import type { NetworkOverview } from "../../data/network"
import type { SeriesPanelData } from "../../data/scan/series-views"
import { deferred } from "../../shell/deferred"
import { NetworkHeader } from "../network-tabs"
import { Panel, PanelState, RangeToggle, type StatView } from "../voting/parts"
import type { PeriodView } from "../voting/range"
import { SeriesBody } from "../voting/series-panel"
import { DexPanel, TvlPanel } from "./network-values"

/**
 * The Network overview (`-5H-NByPdL`): total value locked now and its
 * split, captioned panels for addresses, daily active addresses (a
 * backfill that says where it ends), transactions per day, DEX volume
 * and MUSD's supply, the series on one period toggle, then the latest
 * activity in plain words. Protocol fees by source and paid to veBTC
 * voters are left out (no source splits them), not drawn empty.
 */

/** The custom span's button and box, off the first paint's scripts. */
const CustomPeriod = deferred(() =>
  import("../voting/custom-period").then((module) => module.CustomPeriod),
)

function SeriesPanel({
  label,
  data,
  stats,
  empty,
  period,
  custom,
}: {
  label: string
  data: Section<SeriesPanelData>
  stats: readonly StatView[]
  empty: string
  period: PeriodView
  custom: ReactNode
}): ReactNode {
  return (
    <Panel
      label={label}
      aside={
        <RangeToggle period={period} to="/network" search={{}}>
          {custom}
        </RangeToggle>
      }
    >
      {data.status !== "ok" ? (
        <PanelState section={data} />
      ) : (
        <SeriesBody name={label} data={data.data} stats={stats} empty={empty} />
      )}
    </Panel>
  )
}

/** Below the panels: its own chunk, off the first paint's budget. */
const LatestActivity = deferred(() =>
  import("./overview-activity").then((module) => module.LatestActivity),
)

export function NetworkOverviewView({
  page,
}: {
  page: NetworkOverview
}): ReactNode {
  const custom = (
    <Suspense fallback={null}>
      <CustomPeriod period={page.period} search={{}} />
    </Suspense>
  )
  return (
    <>
      <NetworkHeader current="overview" />
      <div className="grid grid-cols-2 gap-4 max-lg:grid-cols-1">
        <TvlPanel tvl={page.values.tvl} period={page.period} custom={custom} />
        <SeriesPanel
          label="Addresses"
          data={page.addresses}
          stats={page.addressStats}
          empty="No addresses yet"
          period={page.period}
          custom={custom}
        />
        <SeriesPanel
          label="Daily active addresses"
          data={page.active}
          stats={page.activeStats}
          empty="No active addresses yet"
          period={page.period}
          custom={custom}
        />
        <SeriesPanel
          label="Transactions per day"
          data={page.transactions}
          stats={page.transactionStats}
          empty="No transactions yet"
          period={page.period}
          custom={custom}
        />
        <DexPanel dex={page.values.dex} period={page.period} custom={custom} />
        <SeriesPanel
          label="MUSD supply"
          data={page.musd}
          stats={page.musdStats}
          empty="No supply yet"
          period={page.period}
          custom={custom}
        />
      </div>
      <Suspense fallback={null}>
        <LatestActivity activity={page.activity} now={page.now} />
      </Suspense>
    </>
  )
}
