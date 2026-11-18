import * as DataTable from "@matchbox/ui/data-table"
import { useScrollRow } from "@matchbox/ui/scroll-row"
import { Link } from "@tanstack/react-router"
import { type ReactNode, useRef } from "react"
import type {
  AssetFilter,
  ChainFilter,
  PoolsPage,
  PoolsView,
  PoolTableRow,
} from "../../data/pools"
import { PageTitle } from "../../shell/page"
import { SectionState } from "../parts"
import { ChainMark, NotAvailable, PoolName, RateText, textLink } from "./parts"
import { searchOf } from "./search"

/**
 * Pools (`dMc3N9KRX2`, phone `HznXg9AzIL`): every MUSD and MEZO pool and
 * the savings vault on Mezo, Ethereum and Base in one table, with total
 * value locked (each pool once, never bridged supply), per-chain
 * liquidity, the yearly rate split into fees, the venue's rewards and
 * Matchbox MEZO, and filters by chain and token as links (the page works
 * without script). Pools under $25,000 are hidden until asked for and show
 * no rate. Left out until their data exists: MEZO sent to other chains a
 * week (no route serves a gauge's weekly MEZO), the DEX pools, Savings and
 * Lending tabs, the per-pool CRV boosters (Stake DAO, Convex), the sort
 * menu, and the gauge-to-pool panel.
 */

const chip =
  "flex h-9 items-center gap-1.5 rounded-[18px] px-3.5 text-[15px] font-semibold whitespace-nowrap text-sec outline-none hover:text-ink focus-visible:outline-2 focus-visible:outline-ink [&[aria-current]]:bg-raised [&[aria-current]]:text-ink"

const chainNames: Record<ChainFilter, string> = {
  all: "All chains",
  mezo: "Mezo",
  ethereum: "Ethereum",
  base: "Base",
}

const assetNames: Record<AssetFilter, string> = {
  all: "MUSD and MEZO",
  musd: "MUSD",
  mezo: "MEZO",
}

function Count({ value }: { value: number }): ReactNode {
  return <span className="font-normal text-sec tabular-nums">{value}</span>
}

function Filters({ view }: { view: PoolsView }): ReactNode {
  const { filters } = view
  const chains = useRef<HTMLElement | null>(null)
  const tokens = useRef<HTMLElement | null>(null)
  useScrollRow(chains)
  useScrollRow(tokens)
  return (
    <div className="mt-8 flex flex-wrap items-center gap-3">
      <nav ref={chains} aria-label="Chain" className="scroll-row max-w-full">
        <ul className="flex gap-1 rounded-[22px] bg-soft p-1">
          {(Object.keys(chainNames) as ChainFilter[]).map((chain) => (
            <li key={chain}>
              <Link
                to="/pools"
                search={searchOf({ ...filters, chain })}
                resetScroll={false}
                aria-current={chain === filters.chain ? "true" : undefined}
                activeOptions={{ exact: true, includeSearch: true }}
                activeProps={{}}
                className={chip}
              >
                {chain === "all" ? null : <ChainMark chain={chain} />}
                {chainNames[chain]}
                {chain === "all" ? null : (
                  <Count value={view.counts.chain[chain]} />
                )}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <nav ref={tokens} aria-label="Token" className="scroll-row max-w-full">
        <ul className="flex gap-1 rounded-[22px] bg-soft p-1">
          {(Object.keys(assetNames) as AssetFilter[]).map((asset) => (
            <li key={asset}>
              <Link
                to="/pools"
                search={searchOf({ ...filters, asset })}
                resetScroll={false}
                aria-current={asset === filters.asset ? "true" : undefined}
                activeOptions={{ exact: true, includeSearch: true }}
                activeProps={{}}
                className={chip}
              >
                {assetNames[asset]}
                {asset === "all" ? null : (
                  <Count value={view.counts.asset[asset]} />
                )}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  )
}

function Totals({ view }: { view: PoolsView }): ReactNode {
  const cards = [
    {
      key: "all",
      label: "Total value locked",
      icon: null,
      figure: view.total,
      note:
        view.total.counted === view.total.pools
          ? `${view.total.pools} pools and vaults`
          : `${view.total.counted} of ${view.total.pools} pools counted`,
    },
    ...view.chains.map((chain) => ({
      key: chain.chain,
      label: chain.name,
      icon: <ChainMark chain={chain.chain} />,
      figure: chain,
      note:
        chain.counted === chain.pools
          ? `${chain.pools} ${chain.pools === 1 ? "pool" : "pools"}`
          : `${chain.counted} of ${chain.pools} pools counted`,
    })),
  ]
  return (
    <dl className="mt-8 grid grid-cols-4 gap-4 max-lg:grid-cols-2">
      {cards.map((card) => (
        <div
          key={card.key}
          className="min-w-0 rounded-[20px] bg-soft px-5 py-4"
        >
          <dt className="flex items-center gap-2 text-[14.5px] text-sec">
            {card.icon}
            {card.label}
          </dt>
          <dd className="mt-1 text-[23px] font-[650] tracking-[-0.01em] tabular-nums">
            {card.figure.text ?? (
              <span className="text-[17px] font-normal text-sec">
                Not available yet
              </span>
            )}
          </dd>
          <dd className="text-[14px] text-sec">{card.note}</dd>
        </div>
      ))}
    </dl>
  )
}

function Volume({ row }: { row: PoolTableRow }): ReactNode {
  if (row.volume === null) return <NotAvailable />
  if (row.volume.kind === "none") return null
  return row.volume.text
}

function Rewards({ row }: { row: PoolTableRow }): ReactNode {
  const { rewards, merkl } = row.rates
  return (
    <span className="flex flex-col items-end">
      <RateText rate={rewards} />
      {merkl.kind === "value" ? (
        <span className="text-[14px] text-sec">
          Merkl <RateText rate={merkl} />
        </span>
      ) : null}
    </span>
  )
}

function MatchboxMezo({ row }: { row: PoolTableRow }): ReactNode {
  if (row.gauge === null) return <RateText rate={row.rates.gauge} />
  return (
    <span className="flex flex-col items-end">
      {row.rates.gauge.kind === "value" ? (
        <RateText rate={row.rates.gauge} />
      ) : (
        <NotAvailable />
      )}
      <Link
        to="/gauges/$gauge"
        params={{ gauge: row.gauge.address }}
        className={`text-[14px] ${textLink}`}
      >
        Gauge
      </Link>
    </span>
  )
}

export function PoolsTable({
  rows,
  caption,
}: {
  rows: readonly PoolTableRow[]
  caption: string
}): ReactNode {
  return (
    <DataTable.Root caption={caption} captionHidden reflow="lg">
      <DataTable.Header>
        <DataTable.Column>Pool</DataTable.Column>
        <DataTable.Column>Chain</DataTable.Column>
        <DataTable.Column align="end">Liquidity</DataTable.Column>
        <DataTable.Column align="end">Volume 24h</DataTable.Column>
        <DataTable.Column align="end">Fees or yield</DataTable.Column>
        <DataTable.Column align="end">Protocol rewards</DataTable.Column>
        <DataTable.Column align="end">Matchbox MEZO</DataTable.Column>
        <DataTable.Column align="end">Yearly rate</DataTable.Column>
      </DataTable.Header>
      <DataTable.Body>
        {rows.map((row) => (
          <DataTable.Row key={row.id}>
            <DataTable.Cell phone="title">
              <PoolName row={row} />
            </DataTable.Cell>
            <DataTable.Cell phone="hidden">
              <span className="flex items-center gap-2 whitespace-nowrap">
                <ChainMark chain={row.chain} />
                {row.chainName}
              </span>
            </DataTable.Cell>
            <DataTable.Cell
              align="end"
              phone="detail"
              className="tabular-nums max-lg:text-left"
            >
              {row.liquidity === null ? (
                <NotAvailable>
                  <span className="lg:hidden">Liquidity not available yet</span>
                  <span className="max-lg:hidden">Not available yet</span>
                </NotAvailable>
              ) : (
                <>
                  <span className="lg:hidden">Liquidity </span>
                  {row.liquidity}
                </>
              )}
            </DataTable.Cell>
            <DataTable.Cell align="end" phone="hidden" className="tabular-nums">
              <Volume row={row} />
            </DataTable.Cell>
            <DataTable.Cell align="end" phone="hidden" className="tabular-nums">
              <RateText rate={row.rates.fees} />
            </DataTable.Cell>
            <DataTable.Cell align="end" phone="hidden" className="tabular-nums">
              <Rewards row={row} />
            </DataTable.Cell>
            <DataTable.Cell align="end" phone="hidden" className="tabular-nums">
              <MatchboxMezo row={row} />
            </DataTable.Cell>
            <DataTable.Cell align="end" phone="value" className="tabular-nums">
              <RateText rate={row.rates.total} strong />
            </DataTable.Cell>
          </DataTable.Row>
        ))}
      </DataTable.Body>
    </DataTable.Root>
  )
}

function SmallToggle({ view }: { view: PoolsView }): ReactNode {
  const { filters } = view
  if (!filters.small && view.hidden === 0) return null
  return (
    <p className="mt-5 text-center text-[15px]">
      <Link
        to="/pools"
        search={searchOf({ ...filters, small: !filters.small })}
        resetScroll={false}
        className={textLink}
      >
        {filters.small
          ? "Hide pools under $25,000"
          : `Show ${view.hidden} ${view.hidden === 1 ? "pool" : "pools"} under $25,000`}
      </Link>
    </p>
  )
}

export function PoolsList({ page }: { page: PoolsPage }): ReactNode {
  const pools = page.pools
  return (
    <>
      <PageTitle>Pools</PageTitle>
      {pools.status !== "ok" ? (
        <div className="mt-8">
          <SectionState section={pools} />
        </div>
      ) : (
        <>
          <Totals view={pools.data} />
          <Filters view={pools.data} />
          <section aria-label="Pools" className="mt-4">
            {pools.data.rows.length === 0 ? (
              <p className="rounded-[24px] bg-soft px-6 py-10 text-center text-[15px] text-sec">
                No pools over $25,000 here
              </p>
            ) : (
              <PoolsTable rows={pools.data.rows} caption="Pools" />
            )}
            <SmallToggle view={pools.data} />
          </section>
          <p className="mt-6 text-[14px] text-sec">
            est.: our estimate. No yearly rate is shown for a pool under
            $25,000.
            {pools.data.day === null
              ? " No figures yet."
              : ` Figures for ${pools.data.day}.`}{" "}
            Sources: GeckoTerminal, Curve, DefiLlama, Merkl, the Mezo index.
          </p>
        </>
      )}
    </>
  )
}
