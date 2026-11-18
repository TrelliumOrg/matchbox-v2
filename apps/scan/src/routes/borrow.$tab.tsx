import { createFileRoute, notFound } from "@tanstack/react-router"
import type { ReactNode } from "react"
import { type BorrowTabPage, getBorrowTab } from "../data/borrow"
import {
  BorrowHeader,
  EnclavesTable,
  LiquidationList,
  MarketsTable,
  TrovesTable,
} from "../explorer/borrow/lists"
import {
  BorrowDelayed,
  Panel,
  RowsNotShown,
  Stat,
} from "../explorer/borrow/parts"
import { PositionsTable } from "../explorer/borrow/positions-table"
import { readSearch } from "../explorer/borrow/search"
import { Pager, SectionHeading, SectionState } from "../explorer/parts"

/** The tabs after Overview, by their path segment. */
const tabPattern = /^(enclaves|markets|positions|liquidations|troves)$/

type TabName = "enclaves" | "markets" | "positions" | "liquidations" | "troves"

function isTab(value: string): value is TabName {
  return tabPattern.test(value)
}

/**
 * Borrow's tabs (`mGK4_HnGnZ`) as one route: Enclaves (every Enclave
 * position from its events: veBTC pledged, principal, MUSD minted and
 * repaid, open or closed, keyset pager), Markets (every Morpho Blue
 * market with LLTV, borrow APR, utilization and borrowed), Positions
 * (Morpho positions across markets, closest to liquidation first),
 * Liquidations (trove and Morpho liquidations, keyset pager) and Troves, the legacy
 * MUSD tab (open troves with the keyset pager, the Stability Pool and
 * recent redemptions). One route keeps the entry small: each route adds
 * its definition and chunk names to every page's first paint. Left out
 * until their data exists: Enclave debt with interest, collateral value,
 * collateral ratio and the BTC price it reaches the minimum at (no job
 * reads live Enclave state; principal is shown instead), supply APY and
 * tab counts.
 */
export const Route = createFileRoute("/borrow/$tab")({
  // One chunk per route: every new chunk adds a stub and a file name to
  // the entry, which every Scan page loads.
  codeSplitGroupings: [["loader", "component"]],
  loaderDeps: ({ search }) => ({ search }),
  loader: async ({ params, deps }) => {
    if (!isTab(params.tab)) throw notFound()
    const { cursor } = readSearch(deps.search)
    return {
      page: await getBorrowTab({
        data: { tab: params.tab, cursor },
      }),
      paged: cursor !== null,
    }
  },
  head: ({ params }) => ({
    meta: [
      {
        title: isTab(params.tab)
          ? `${params.tab.charAt(0).toUpperCase()}${params.tab.slice(1)}, Borrow, Matchscan`
          : "Borrow, Matchscan",
      },
    ],
  }),
  component: TabPage,
})

function Troves({
  page,
  paged,
}: {
  page: Extract<BorrowTabPage, { tab: "troves" }>
  paged: boolean
}): ReactNode {
  const pool = page.stabilityPool
  return (
    <>
      <section aria-labelledby="troves">
        <SectionHeading id="troves" aside="MUSD">
          Open troves
        </SectionHeading>
        {page.troves.status === "ok" ? (
          <>
            <TrovesTable rows={page.troves.data.items} />
            <Pager
              label="Trove pages"
              paged={paged}
              next={page.troves.data.next}
              skipped={page.troves.skipped}
              restarted={page.troves.restarted}
              to="/borrow/$tab"
              params={{ tab: "troves" }}
            />
          </>
        ) : (
          <SectionState section={page.troves} />
        )}
      </section>
      <div className="mt-11 grid items-start gap-4 lg:grid-cols-2">
        <Panel label="Stability Pool">
          {pool.status === "ok" ? (
            <>
              <p className="mt-2 text-[34px] leading-tight font-[650] tabular-nums max-md:text-[26px]">
                {pool.data.deposits ?? "None"}
              </p>
              <p className="mt-1 text-[15px] text-sec tabular-nums">
                {pool.data.collateral ?? "No"} collateral
              </p>
            </>
          ) : (
            <div className="mt-4">
              <SectionState section={pool} />
            </div>
          )}
        </Panel>
        <Panel label="Redemptions">
          {page.redemptions.status === "ok" ? (
            <div className="mt-2">
              <LiquidationList
                rows={page.redemptions.data}
                label="Recent redemptions"
                empty="No redemptions"
              />
              <RowsNotShown skipped={page.redemptions.skipped} />
            </div>
          ) : (
            <div className="mt-4">
              <SectionState section={page.redemptions} />
            </div>
          )}
        </Panel>
      </div>
    </>
  )
}

function Enclaves({
  page,
  paged,
}: {
  page: Extract<BorrowTabPage, { tab: "enclaves" }>
  paged: boolean
}): ReactNode {
  const list = page.enclaves
  if (list.status !== "ok") return <SectionState section={list} />
  const more = list.data.complete ? "" : "+"
  return (
    <section aria-labelledby="enclaves">
      <SectionHeading id="enclaves" aside="MUSD against veBTC">
        Enclave positions
      </SectionHeading>
      <dl className="mb-6 grid grid-cols-4 gap-4 max-lg:grid-cols-2">
        <Stat label="Open">{`${list.data.open}${more}`}</Stat>
        <Stat label="All time">{`${list.data.positions}${more}`}</Stat>
        <Stat label="Minted">{list.data.minted ?? "None"}</Stat>
        <Stat label="Repaid">{list.data.repaid ?? "None"}</Stat>
      </dl>
      <EnclavesTable rows={list.data.rows} caption="Enclave positions" />
      <Pager
        label="Enclave pages"
        paged={paged}
        next={list.data.next}
        skipped={list.skipped}
        restarted={list.restarted}
        to="/borrow/$tab"
        params={{ tab: "enclaves" }}
      />
    </section>
  )
}

function Content({
  page,
  paged,
}: {
  page: BorrowTabPage
  paged: boolean
}): ReactNode {
  switch (page.tab) {
    case "enclaves":
      return <Enclaves page={page} paged={paged} />
    case "markets":
      return page.markets.status === "ok" ? (
        <>
          <MarketsTable markets={page.markets.data} />
          <RowsNotShown skipped={page.markets.skipped} />
        </>
      ) : (
        <SectionState section={page.markets} />
      )
    case "positions":
      return page.positions.status === "ok" ? (
        <>
          <PositionsTable
            rows={page.positions.data.rows}
            caption="Morpho Blue positions"
            showMarket
          />
          {page.positions.data.complete ? null : (
            <p className="mt-3 text-[14.5px] text-sec">
              First 100 positions per market
            </p>
          )}
          <RowsNotShown skipped={page.positions.skipped} />
        </>
      ) : (
        <SectionState section={page.positions} />
      )
    case "liquidations":
      return (
        <>
          <h2 className="mb-2 text-[24px] font-[650] tracking-[-0.015em]">
            Troves and Morpho Blue
          </h2>
          {page.liquidations.status === "ok" ? (
            <>
              <LiquidationList
                rows={page.liquidations.data.items}
                label="Liquidations"
                empty="No liquidations"
              />
              <Pager
                label="Liquidation pages"
                paged={paged}
                next={page.liquidations.data.next}
                skipped={page.liquidations.skipped}
                restarted={page.liquidations.restarted}
                to="/borrow/$tab"
                params={{ tab: "liquidations" }}
              />
            </>
          ) : (
            <SectionState section={page.liquidations} />
          )}
        </>
      )
    default:
      return <Troves page={page} paged={paged} />
  }
}

function TabPage(): ReactNode {
  const { page, paged } = Route.useLoaderData()
  return (
    <>
      <BorrowDelayed delayed={page.delayed} />
      <BorrowHeader current={page.tab} />
      <Content page={page} paged={paged} />
    </>
  )
}
