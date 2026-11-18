import * as DataTable from "@matchbox/ui/data-table"
import * as SeriesChart from "@matchbox/ui/series-chart"
import { Link } from "@tanstack/react-router"
import type { ReactNode } from "react"
import type { TradeRow } from "../../data/pools"
import type { TokenPage } from "../../data/token-pages"
import { SectionHeading } from "../parts"
import {
  ChainMark,
  ExternalLink,
  PoolName,
  poolLinkProps,
  RateText,
  textLink,
} from "../pools/parts"
import {
  Figure,
  Panel,
  PanelEmpty,
  PanelState,
  ShareBar,
  Stats,
  type StatView,
} from "../voting/parts"

/**
 * MUSD's and MEZO's cross-chain sections (`h6PmVdwDRq`, `w0_Z8WNatb`):
 * price with its sources, supply by chain counted once, the pools on every
 * chain and the bridge. Their own chunk, loaded after first paint (the
 * token pages sit close to the JS budget). Every figure the API cannot
 * give says so in place. Left out until their data exists: holders on
 * Ethereum and Base, MEZO's exchange volumes by venue, MEZO sent to other
 * chains a week, the bridge lock's split chart and per-address bridge
 * flows. Where MUSD sits, pool by pool, is on the MUSD page (musdLater).
 */

type CrossChain = TokenPage["crossChain"]

function PricePanel({ crossChain }: { crossChain: CrossChain }): ReactNode {
  const price = crossChain.price
  if (price.status !== "ok") {
    return (
      <Panel label="Price">
        <PanelState section={price} />
      </Panel>
    )
  }
  const view = price.data
  const history =
    crossChain.history?.status === "ok" ? crossChain.history.data : null
  const stats: StatView[] = []
  if (view.spread !== null) {
    stats.push({ label: "Spread across venues", value: view.spread })
  }
  if (view.peg !== null) stats.push({ label: "Against $1.00", value: view.peg })
  if (view.venues.length > 0) {
    stats.push({ label: "Venues", value: String(view.venues.length) })
  }
  return (
    <Panel label="Price" className="lg:col-span-2">
      {view.headline === null ? (
        <PanelEmpty>Price not counted yet</PanelEmpty>
      ) : (
        <>
          <Figure
            value={view.headline.text}
            note={
              view.headline.stale
                ? `Delayed, read ${view.headline.at}`
                : `${view.headline.basis}, ${view.headline.at}`
            }
          />
          {view.diverged ? (
            <p className="mt-1 text-[14.5px] font-semibold text-acc-ink">
              Sources disagree by more than 0.5%
            </p>
          ) : null}
          <Stats stats={stats} />
        </>
      )}
      {view.comparison === null ? null : (
        <p className="mt-2 text-[14.5px] text-sec">
          CoinGecko {view.comparison.text}, {view.comparison.at}. Not our price:
          no venue answered
        </p>
      )}
      {history !== null && history.points.length > 1 ? (
        <SeriesChart.Root
          points={history.points}
          kind="level"
          label={`MUSD daily price, ${history.figure ?? ""}`}
          startLabel={history.startLabel}
          endLabel={history.endLabel}
          height={120}
          className="mt-6"
        />
      ) : view.headline === null ? null : (
        <p className="mt-4 text-[14px] text-sec">
          Daily history builds from the first reading
        </p>
      )}
      {view.venues.length === 0 ? null : (
        <ul aria-label="Price by venue" className="mt-5">
          {view.venues.map((venue) => (
            <li
              key={venue.id}
              className="flex items-center gap-3 border-t border-line py-3"
            >
              {venue.chain === "bsc" ? null : (
                <ChainMark chain={venue.chain} size={20} />
              )}
              <span className="flex min-w-0 flex-1 flex-col">
                {venue.pool === null ? (
                  <span className="font-semibold">{venue.label}</span>
                ) : (
                  <Link
                    {...poolLinkProps(venue.pool)}
                    className="font-semibold hover:underline hover:underline-offset-4"
                  >
                    {venue.label}
                  </Link>
                )}
                <span className="truncate text-[14px] text-sec">
                  {venue.where}, {venue.method}
                  {venue.stale ? ", delayed" : ""}
                </span>
              </span>
              <span className="text-right tabular-nums">
                <span className="block font-semibold">{venue.price}</span>
                {venue.vsHeadline === null ? null : (
                  <span
                    className={`block text-[14px] ${venue.vsHeadline.tone === "neg" ? "text-neg" : venue.vsHeadline.tone === "pos" ? "text-pos" : "text-sec"}`}
                  >
                    {venue.vsHeadline.text}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}

function SupplyPanel({ crossChain }: { crossChain: CrossChain }): ReactNode {
  const supply = crossChain.supply
  return (
    <Panel label="Supply by chain">
      {supply.status !== "ok" ? (
        <PanelState section={supply} />
      ) : supply.data.total === null ? (
        <PanelEmpty>Supply by chain not counted yet</PanelEmpty>
      ) : (
        <>
          <Figure
            value={supply.data.total}
            note="Minted on Mezo, counted once"
          />
          <ShareBar
            label="Supply by chain"
            segments={supply.data.rows.slice(0, 3).map((row) => ({
              label: row.name,
              value: row.share,
              bps: row.bps,
            }))}
          />
          <ul className="mt-4">
            {supply.data.rows.map((row) => (
              <li
                key={row.chain}
                className="flex items-baseline gap-3 border-t border-line py-2.5 tabular-nums"
              >
                <span className="flex-1 font-semibold">{row.name}</span>
                <span>{row.amount}</span>
                <span className="w-16 text-right text-sec">{row.share}</span>
              </li>
            ))}
          </ul>
          {supply.data.locked === null ? null : (
            <p className="mt-3 flex flex-wrap gap-x-3 rounded-[16px] bg-raised px-4 py-3 text-[14.5px] tabular-nums">
              <span className="flex-1 text-sec">
                Locked in the bridge on Mezo
              </span>
              <span className="font-semibold">{supply.data.locked}</span>
              <span className="text-sec">not counted again</span>
            </p>
          )}
          {supply.data.missing.length === 0 ? null : (
            <p className="mt-3 text-[14px] text-sec">
              {supply.data.missing.join(", ")} not counted yet
            </p>
          )}
          {supply.data.mismatch ? (
            <p className="mt-3 text-[14px] text-sec">
              Other chains add up to more than the lock: readings out of step
            </p>
          ) : null}
        </>
      )}
    </Panel>
  )
}

function BridgePanel({
  crossChain,
  symbol,
}: {
  crossChain: CrossChain
  symbol: string
}): ReactNode {
  const bridge = crossChain.bridge
  const label = `Bridged ${symbol}`
  if (bridge.status !== "ok") {
    return (
      <Panel label={label}>
        <PanelState section={bridge} />
      </Panel>
    )
  }
  const view = bridge.data
  if (view.missing !== null || view.total === null) {
    return (
      <Panel label={label}>
        <PanelEmpty>
          {view.missing === "unsupported"
            ? "Not available yet: Wormholescan does not report MEZO"
            : "Bridge transfers not counted yet"}
        </PanelEmpty>
      </Panel>
    )
  }
  const stats: StatView[] = [
    { label: "Transfers", value: view.transfers ?? "" },
    { label: "Routes", value: String(view.routes.length) },
  ]
  if (view.recent !== null) {
    stats.push({
      label: `Last ${view.recent.days} ${view.recent.days === 1 ? "day" : "days"}`,
      value: view.recent.usd,
    })
  }
  return (
    <Panel label={label}>
      <Figure value={view.total} note="Wormhole, every route, all time" />
      <Stats stats={stats} />
      <ul className="mt-4">
        {view.routes.map((route) => (
          <li
            key={`${route.from}-${route.to}`}
            className="flex items-baseline gap-3 border-t border-line py-2.5 tabular-nums"
          >
            <span className="flex-1 font-semibold">
              {route.from} to {route.to}
            </span>
            <span className="text-sec">{route.transfers} transfers</span>
            <span className="w-24 text-right">{route.usd}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 flex flex-wrap gap-4 text-[14px] text-sec">
        {view.asOf === null ? null : <span>Read {view.asOf}</span>}
        <ExternalLink href="https://wormholescan.io">Wormholescan</ExternalLink>
      </p>
    </Panel>
  )
}

function TradeTable({
  rows,
  caption,
  musd,
}: {
  rows: readonly TradeRow[]
  caption: string
  musd: boolean
}): ReactNode {
  return (
    <DataTable.Root caption={caption} captionHidden reflow="md">
      <DataTable.Header>
        <DataTable.Column>Pool</DataTable.Column>
        <DataTable.Column>Chain</DataTable.Column>
        <DataTable.Column align="end">Liquidity</DataTable.Column>
        <DataTable.Column align="end">Volume 24h</DataTable.Column>
        {musd ? (
          <DataTable.Column align="end">MUSD price here</DataTable.Column>
        ) : null}
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
                {row.where.replace(/^.* on /, "")}
              </span>
            </DataTable.Cell>
            <DataTable.Cell
              align="end"
              phone="detail"
              className="tabular-nums max-md:text-left"
            >
              <span className="md:hidden">Liquidity </span>
              {row.liquidity}
            </DataTable.Cell>
            <DataTable.Cell align="end" phone="hidden" className="tabular-nums">
              {row.volume}
            </DataTable.Cell>
            {musd ? (
              <DataTable.Cell
                align="end"
                phone="hidden"
                className="tabular-nums"
              >
                {row.priceHere ?? (
                  <span className="whitespace-nowrap text-sec">
                    Not a price venue
                  </span>
                )}
              </DataTable.Cell>
            ) : null}
            <DataTable.Cell align="end" phone="value" className="tabular-nums">
              <RateText rate={row.rate} strong />
            </DataTable.Cell>
          </DataTable.Row>
        ))}
      </DataTable.Body>
    </DataTable.Root>
  )
}

function Pools({
  crossChain,
  symbol,
  slug,
}: {
  crossChain: CrossChain
  symbol: string
  slug: TokenPage["slug"]
}): ReactNode {
  const pools = crossChain.pools
  return (
    <section aria-labelledby="token-pools" className="mt-12">
      <SectionHeading
        id="token-pools"
        aside={
          <Link to="/pools" search={{ token: slug }} className={textLink}>
            All {symbol} pools
          </Link>
        }
      >
        {symbol} pools on every chain
      </SectionHeading>
      {pools.status !== "ok" ? (
        <Panel label={`${symbol} pools`}>
          <PanelState section={pools} />
        </Panel>
      ) : (
        <>
          {pools.data.rows.length === 0 ? (
            <p className="rounded-[24px] bg-soft px-6 py-10 text-center text-[15px] text-sec">
              Pool liquidity not available yet
            </p>
          ) : (
            <TradeTable
              rows={pools.data.rows}
              caption={`${symbol} pools`}
              musd={slug === "musd"}
            />
          )}
          {pools.data.more === 0 || pools.data.rows.length === 0 ? null : (
            <p className="mt-3 text-[14px] text-sec">
              <Link to="/pools" search={{ token: slug }} className={textLink}>
                {pools.data.more} more {symbol}{" "}
                {pools.data.more === 1 ? "pool" : "pools"}
              </Link>
            </p>
          )}
        </>
      )}
    </section>
  )
}

export function CrossChainSections({ page }: { page: TokenPage }): ReactNode {
  const symbol = page.token.symbol
  return (
    <>
      <div className="mt-8 grid grid-cols-2 gap-4 max-lg:grid-cols-1">
        {page.slug === "musd" ? (
          <PricePanel crossChain={page.crossChain} />
        ) : null}
        <SupplyPanel crossChain={page.crossChain} />
        <BridgePanel crossChain={page.crossChain} symbol={symbol} />
      </div>
      <Pools crossChain={page.crossChain} symbol={symbol} slug={page.slug} />
    </>
  )
}
