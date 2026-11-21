import { createFileRoute } from "@tanstack/react-router"
import { type ReactNode, Suspense, useEffect } from "react"
import { type BorrowOverview, getBorrowOverview } from "../data/borrow"
import { trovesChartId } from "../data/borrow-input"
import { openPositionWords } from "../data/scan/words"
import { ChartSpace, RangeLinks } from "../explorer/borrow/chart"
import { readCharts } from "../explorer/borrow/charts-read"
import {
  BorrowHeader,
  EnclavesTable,
  LiquidationList,
  MarketsTable,
  MoreLink,
  TroveList,
} from "../explorer/borrow/lists"
import {
  BorrowDelayed,
  Panel,
  RowsNotShown,
  Stat,
} from "../explorer/borrow/parts"
import { PositionsTable } from "../explorer/borrow/positions-table"
import { chartPeriod, periodKey, readSearch } from "../explorer/borrow/search"
import { deferred } from "../shell/deferred"

/** The market charts' series load after first paint, with their code. */
const MarketChart = deferred(() =>
  import("../explorer/borrow/market-charts").then(
    (module) => module.MarketChart,
  ),
)

import { SectionHeading, SectionState } from "../explorer/parts"

/**
 * Borrow (`mGK4_HnGnZ`, phone `50amLHcSFw`): MUSD borrowed across troves,
 * Enclaves and MUSD markets (in MUSD, with the share in Enclaves: nothing
 * prices MUSD, so never dollars), open positions by venue, the Stability
 * Pool and liquidations, the Enclave positions (open first, each linking
 * to its page), the Morpho Blue markets with each market's
 * borrowed series, the Morpho positions closest to liquidation, recent
 * trove and Morpho liquidations, and the troves' MUSD debt, collateral and
 * the troves with the lowest collateral ratio.
 * Each market chart's series loads after first paint (one request for
 * every market), so the loader reads only what the first screen shows.
 * Tabs are their own routes. Left out until their data exists: Enclave
 * debt with interest, collateral ratio and the price it reaches the
 * minimum at (no job reads live Enclave state: the section shows
 * principal), the Enclave debt chart, totals in USD and the collateral tile (no MUSD or mUSDC price; mUSDC is never
 * taken as $1), the Enclave mint cap, supply APY, the utilization chart,
 * tab counts and Watch.
 */
export const Route = createFileRoute("/borrow/")({
  // One chunk per route: every new chunk adds a stub and a file name to
  // the entry, which every Scan page loads.
  codeSplitGroupings: [["loader", "component"]],
  loaderDeps: ({ search }) => ({ search }),
  loader: async ({ deps }) => ({
    overview: await getBorrowOverview({
      data: readSearch(deps.search).period,
    }),
  }),
  head: () => ({ meta: [{ title: "Borrow, Matchscan" }] }),
  component: BorrowPage,
})

function Tiles({ overview }: { overview: BorrowOverview }): ReactNode {
  const { borrowed, counts, stabilityPool, liquidations } = overview
  const total =
    counts === null
      ? null
      : counts.morpho + counts.troves + (counts.enclaves ?? 0)
  return (
    <dl className="grid grid-cols-4 gap-4 max-lg:grid-cols-2 max-md:gap-3">
      <div className="rounded-[24px] bg-soft p-6 max-md:p-4">
        <dt className="text-[15px] text-ink2">Borrowed</dt>
        <dd className="mt-1 text-[32px] font-[650] tabular-nums max-md:text-[24px]">
          {borrowed.status === "ok" && borrowed.data.total !== null
            ? borrowed.data.total
            : "None"}
        </dd>
        <dd className="text-[14px] text-sec">
          {borrowed.status === "ok" && borrowed.data.total !== null
            ? (borrowed.data.enclavesShare ?? "Troves, Enclaves, markets")
            : "Not available yet"}
        </dd>
      </div>
      <div className="rounded-[24px] bg-soft p-6 max-md:p-4">
        <dt className="text-[15px] text-ink2">Open positions</dt>
        <dd className="mt-1 text-[32px] font-[650] tabular-nums max-md:text-[24px]">
          {counts === null || total === null
            ? "None"
            : `${total}${counts.complete ? "" : "+"}`}
        </dd>
        <dd className="text-[14px] text-sec">
          {counts === null ? "Not available yet" : openPositionWords(counts)}
        </dd>
      </div>
      <div className="rounded-[24px] bg-soft p-6 max-md:p-4">
        <dt className="text-[15px] text-ink2">Stability Pool</dt>
        <dd className="mt-1 text-[32px] font-[650] tabular-nums max-md:text-[24px]">
          {stabilityPool.status === "ok"
            ? (stabilityPool.data.deposits ?? "None")
            : "None"}
        </dd>
        <dd className="text-[14px] text-sec">
          {stabilityPool.status === "ok"
            ? `${stabilityPool.data.collateral ?? "No"} collateral`
            : "Not available yet"}
        </dd>
      </div>
      <div className="rounded-[24px] bg-soft p-6 max-md:p-4">
        <dt className="text-[15px] text-ink2">Liquidations</dt>
        <dd className="mt-1 text-[32px] font-[650] tabular-nums max-md:text-[24px]">
          {liquidations.status === "ok"
            ? `${liquidations.data.count}${liquidations.data.complete ? "" : "+"}`
            : "None"}
        </dd>
        <dd className="text-[14px] text-sec">
          {liquidations.status === "ok" ? "All time" : "Not available yet"}
        </dd>
      </div>
    </dl>
  )
}

function BorrowPage(): ReactNode {
  const { overview } = Route.useLoaderData()
  const period = overview.period
  const asked = chartPeriod(period)
  const chartMarkets = overview.charts.map((chart) => ({
    id: chart.id,
    decimals: chart.decimals,
  }))
  const chartsKey = `${periodKey(asked)}:${chartMarkets.map((market) => market.id).join(",")}`
  // The charts' series are asked for as the page mounts, while their code
  // loads; each chart then joins this request (charts-read).
  // biome-ignore lint/correctness/useExhaustiveDependencies: `chartsKey` names the period and the markets
  useEffect(() => {
    if (chartMarkets.length > 0) void readCharts(asked, chartMarkets)
  }, [chartsKey])
  return (
    <>
      <BorrowDelayed delayed={overview.delayed} />
      <BorrowHeader current="overview" />
      <Tiles overview={overview} />

      <section aria-labelledby="enclaves" className="mt-11">
        <SectionHeading
          id="enclaves"
          aside={<MoreLink tab="enclaves">All Enclaves</MoreLink>}
        >
          Enclaves
        </SectionHeading>
        {overview.enclaves.status === "ok" ? (
          <>
            <EnclavesTable
              rows={overview.enclaves.data.rows}
              caption="Enclave positions"
            />
            <p className="mt-3 text-[14.5px] text-sec">
              {overview.enclaves.data.open} open,{" "}
              {overview.enclaves.data.positions}
              {overview.enclaves.data.complete ? "" : "+"} all time
            </p>
            <RowsNotShown skipped={overview.enclaves.skipped} />
          </>
        ) : (
          <SectionState section={overview.enclaves} />
        )}
      </section>

      <section aria-labelledby="markets" className="mt-11">
        <SectionHeading
          id="markets"
          aside={<MoreLink tab="markets">All markets</MoreLink>}
        >
          Markets
        </SectionHeading>
        {overview.markets.status === "ok" ? (
          <>
            <MarketsTable markets={overview.markets.data} />
            <RowsNotShown skipped={overview.markets.skipped} />
          </>
        ) : (
          <SectionState section={overview.markets} />
        )}
      </section>

      {overview.charts.length === 0 ? null : (
        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          {overview.charts.map((chart) => (
            <Panel
              key={chart.id}
              label={`Borrowed, ${chart.name}`}
              aside={<RangeLinks period={period} to="/borrow" />}
            >
              <p className="mt-2 text-[34px] leading-tight font-[650] tabular-nums max-md:text-[28px]">
                {chart.borrowed ?? "None"}
              </p>
              <dl className="mt-4 grid grid-cols-3 gap-4">
                <Stat label="Supplied">{chart.supplied ?? "None"}</Stat>
                <Stat label="Utilization">{chart.utilization ?? "None"}</Stat>
                <Stat label="Borrow APR">{chart.borrowApr ?? "None"}</Stat>
              </dl>
              <Suspense fallback={<ChartSpace busy />}>
                <MarketChart
                  id={chart.id}
                  period={asked}
                  markets={chartMarkets}
                  label={`${chart.name} borrowed over ${period.text}`}
                  unit={chart.unit}
                />
              </Suspense>
            </Panel>
          ))}
        </div>
      )}

      <section aria-labelledby="closest" className="mt-11">
        <SectionHeading
          id="closest"
          aside={<MoreLink tab="positions">All positions</MoreLink>}
        >
          Closest to liquidation
        </SectionHeading>
        {overview.closest.status === "ok" ? (
          <>
            <PositionsTable
              rows={overview.closest.data.rows}
              caption="Closest to liquidation"
              showMarket
            />
            <p className="mt-3 text-[14.5px] text-sec">
              {overview.closest.data.troves
                ? "Morpho positions and troves, by health factor"
                : "Morpho positions only: troves are not available"}
              {overview.closest.data.complete
                ? ""
                : ", ranked from the first 100 of each list"}
            </p>
            <RowsNotShown skipped={overview.closest.skipped} />
          </>
        ) : (
          <SectionState section={overview.closest} />
        )}
      </section>

      <div className="mt-11 grid items-start gap-4 lg:grid-cols-2">
        <Panel
          label="Liquidations"
          aside={<MoreLink tab="liquidations">All</MoreLink>}
        >
          {overview.liquidations.status === "ok" ? (
            <div className="mt-2">
              <LiquidationList
                rows={overview.liquidations.data.recent}
                label="Recent liquidations"
                empty="No liquidations"
              />
              <RowsNotShown skipped={overview.liquidations.skipped} />
            </div>
          ) : (
            <div className="mt-4">
              <SectionState section={overview.liquidations} />
            </div>
          )}
        </Panel>
        <Panel
          label="Troves"
          aside={<MoreLink tab="troves">All troves</MoreLink>}
        >
          {overview.troves.status === "ok" ? (
            <>
              <p className="mt-2 text-[34px] leading-tight font-[650] tabular-nums max-md:text-[28px]">
                {overview.troves.data.debt ?? "None"}
                <span className="ml-2 text-[15px] font-normal text-sec">
                  debt
                </span>
              </p>
              <dl className="mt-4 grid grid-cols-2 gap-4">
                <Stat label="Open">
                  {`${overview.troves.data.open}${overview.troves.data.complete ? "" : "+"}`}
                </Stat>
                <Stat label="Collateral">
                  {overview.troves.data.collateral === null
                    ? "None"
                    : `${overview.troves.data.collateral}${overview.troves.data.complete ? "" : "+"}`}
                </Stat>
              </dl>
              {chartMarkets.length === 0 ? null : (
                <>
                  {/* A div: the period links are a nav, never inside a p. */}
                  <div className="mt-6 flex flex-wrap items-baseline justify-between gap-2 text-[14px] text-sec">
                    <span>Collateral ratio, BTC at each day's close</span>
                    <RangeLinks period={period} to="/borrow" />
                  </div>
                  <Suspense fallback={<ChartSpace busy />}>
                    <MarketChart
                      id={trovesChartId}
                      period={asked}
                      markets={chartMarkets}
                      label={`Trove collateral ratio over ${period.text}`}
                      unit={null}
                    />
                  </Suspense>
                </>
              )}
              <div className="mt-2">
                <TroveList rows={overview.troves.data.lowest} />
                <RowsNotShown skipped={overview.troves.skipped} />
              </div>
            </>
          ) : (
            <div className="mt-4">
              <SectionState section={overview.troves} />
            </div>
          )}
        </Panel>
      </div>
    </>
  )
}
