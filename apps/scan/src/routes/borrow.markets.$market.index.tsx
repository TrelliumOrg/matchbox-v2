import { shortAddress } from "@matchbox/domain/format"
import * as Breadcrumbs from "@matchbox/ui/breadcrumbs"
import * as HashChip from "@matchbox/ui/hash-chip"
import { shapes } from "@matchbox/ui/icons"
import {
  createFileRoute,
  Link,
  notFound,
  redirect,
} from "@tanstack/react-router"
import type { ReactNode } from "react"
import { type ChartSeries, getMarketPage } from "../data/borrow"
import { canonicalHash } from "../data/canonical"
import type { Section } from "../data/explorer"
import type { MarketDetailView } from "../data/scan/borrow-views"
import { RangeLinks, SeriesFigure } from "../explorer/borrow/chart"
import { DetailCard, DetailRow, HistoryList } from "../explorer/borrow/history"
import {
  BorrowDelayed,
  CoinPair,
  HealthBar,
  MezoAction,
  Panel,
  RowsNotShown,
  Stat,
} from "../explorer/borrow/parts"
import { PositionsTable } from "../explorer/borrow/positions-table"
import {
  chartPeriod,
  periodParams,
  readSearch,
} from "../explorer/borrow/search"
import { Pager, SectionHeading, SectionState } from "../explorer/parts"
import { EntityPage } from "../shell/entity"

/**
 * A Morpho Blue market (`BeSXytOlBc`): LLTV, borrow APR, supply APY
 * (computed: the borrow rate compounded as Morpho does, times utilization,
 * less the fee), the liquidation incentive (computed from the LLTV with
 * Morpho's formula), available liquidity (supplied less borrowed) with
 * utilization, the oracle price, supplied and borrowed with their daily
 * series, the positions by debt with each one's share of the market's
 * debt, and the market's activity in words (keyset pager). Left out until
 * their data exists: the rate curve (IRM parameters), bad debt, suppliers
 * and vaults, the liquidations panel, "16 all time" (no count of every
 * account that ever held a position) and Watch.
 */
/** A series' latest value as the panel's figure ("None" without one). */
function latestText(
  series: Section<ChartSeries>,
  symbol: string | null | undefined,
): string {
  if (series.status !== "ok" || series.data.latest === null) return "None"
  const text = series.data.latest.text
  return symbol == null ? text : `${text} ${symbol}`
}

export const Route = createFileRoute("/borrow/markets/$market/")({
  // One chunk per route: every new chunk adds a stub and a file name to
  // the entry, which every Scan page loads.
  codeSplitGroupings: [["loader", "component", "notFoundComponent"]],
  loaderDeps: ({ search }) => ({ search }),
  loader: async ({ params, deps }) => {
    const { period, cursor } = readSearch(deps.search)
    const market = canonicalHash(params.market)
    if (market === null) throw notFound()
    if (market !== params.market) {
      throw redirect({
        to: "/borrow/markets/$market",
        params: { market },
        statusCode: 301,
      })
    }
    const page = await getMarketPage({
      data: { market, ...period, cursor },
    })
    if (page.market.status === "missing") throw notFound()
    return {
      id: market,
      page,
      paged: cursor !== null,
      title: `${page.market.status === "ok" ? page.market.data.name : "Market"}, Matchscan`,
    }
  },
  head: ({ loaderData }) => ({
    meta: [{ title: loaderData?.title ?? "Market, Matchscan" }],
  }),
  component: MarketPage,
  notFoundComponent: MarketNotFound,
})

function Header({
  id,
  market,
}: {
  id: string
  market: MarketDetailView | null
}): ReactNode {
  return (
    <>
      <Breadcrumbs.Root className="mt-8 max-xl:mt-5">
        <Breadcrumbs.Item asChild>
          <Link to="/borrow">Borrow</Link>
        </Breadcrumbs.Item>
        <Breadcrumbs.Current>{market?.name ?? "Market"}</Breadcrumbs.Current>
      </Breadcrumbs.Root>
      <header className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-4">
        <CoinPair
          collateral={market?.collateral?.symbol ?? null}
          loan={market?.loan?.symbol ?? null}
          size={48}
        />
        <div className="min-w-0 flex-1">
          <h1 className="text-[34px] leading-tight font-[650] tracking-[-0.02em] max-md:text-[28px]">
            {market?.name ?? "Market"}
          </h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[15px] text-sec">
            <HashChip.Root value={id} kind="hash" />
            <span>Morpho Blue</span>
          </p>
        </div>
        <MezoAction label="Borrow on Mezo" />
      </header>
    </>
  )
}

function Figures({ market }: { market: MarketDetailView }): ReactNode {
  return (
    <section
      aria-label="Market figures"
      className="mt-8 rounded-[24px] bg-soft p-6 max-md:p-5"
    >
      <dl className="grid grid-cols-3 gap-6 max-lg:grid-cols-2">
        <div>
          <dt className="text-[15px] text-ink2">LLTV</dt>
          <dd className="mt-1 text-[23px] font-[650] tabular-nums">
            {market.lltv}
          </dd>
          <dd className="text-[14px] text-sec">Fixed</dd>
        </div>
        <div>
          <dt className="text-[15px] text-ink2">Borrow APR</dt>
          <dd className="mt-1 text-[23px] font-[650] tabular-nums">
            {market.borrowApr ?? "None"}
          </dd>
          <dd className="text-[14px] text-sec">Variable</dd>
        </div>
        <div>
          <dt className="text-[15px] text-ink2">Supply APY</dt>
          <dd
            className={`mt-1 text-[23px] font-[650] tabular-nums ${market.supplyApy === null || !/[1-9]/.test(market.supplyApy) ? "" : "text-pos"}`}
          >
            {market.supplyApy ?? "None"}
          </dd>
          <dd className="text-[14px] text-sec">Fee {market.fee}</dd>
        </div>
        <div>
          <dt className="text-[15px] text-ink2">Liquidation incentive</dt>
          <dd className="mt-1 text-[23px] font-[650] tabular-nums">
            {market.liquidationIncentive}
          </dd>
          <dd className="text-[14px] text-sec">From LLTV</dd>
        </div>
        <div>
          <dt className="text-[15px] text-ink2">Available</dt>
          <dd className="mt-1 text-[23px] font-[650] tabular-nums">
            {market.available ?? "None"}
          </dd>
          <dd className="text-[14px] text-sec">
            Utilization {market.utilization ?? "None"}
          </dd>
          <dd className="mt-2 max-w-[160px]">
            <HealthBar
              share={market.utilizationShare}
              limit={null}
              band="near_liquidation"
              label={`Utilization ${market.utilization ?? "unknown"}`}
            />
          </dd>
        </div>
        <div>
          <dt className="text-[15px] text-ink2">Oracle price</dt>
          <dd className="mt-1 text-[23px] font-[650] tabular-nums">
            {market.price ?? "None"}
          </dd>
          <dd className="text-[14px] text-sec">
            {market.collateral?.symbol ?? "Collateral"} in{" "}
            {market.loan?.symbol ?? "loan token"}
          </dd>
        </div>
      </dl>
    </section>
  )
}

function MarketPage(): ReactNode {
  const { id, page, paged } = Route.useLoaderData()
  const market = page.market.status === "ok" ? page.market.data : null
  const period = page.period
  return (
    <>
      <BorrowDelayed delayed={page.delayed} />
      <Header id={id} market={market} />
      {market === null ? (
        <div className="mt-8">
          <SectionState
            section={
              page.market.status === "ok"
                ? { status: "unavailable" }
                : page.market
            }
          />
        </div>
      ) : (
        <>
          <Figures market={market} />
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <Panel
              label="Supplied"
              aside={
                <RangeLinks
                  period={period}
                  to="/borrow/markets/$market"
                  params={{ market: id }}
                />
              }
            >
              <p className="mt-2 text-[34px] leading-tight font-[650] tabular-nums max-md:text-[26px]">
                {market.supplied ?? "None"}
              </p>
              <SeriesFigure
                series={page.supplied}
                label={`${market.name} supplied over ${period.text}`}
                unit={market.loan?.symbol ?? null}
              />
            </Panel>
            <Panel
              label="Borrowed"
              aside={
                <RangeLinks
                  period={period}
                  to="/borrow/markets/$market"
                  params={{ market: id }}
                />
              }
            >
              <p className="mt-2 text-[34px] leading-tight font-[650] tabular-nums max-md:text-[26px]">
                {market.borrowed ?? "None"}
              </p>
              <dl className="mt-3 grid grid-cols-2 gap-4">
                <Stat label="Utilization">{market.utilization ?? "None"}</Stat>
                <Stat label="Borrow APR">{market.borrowApr ?? "None"}</Stat>
              </dl>
              <SeriesFigure
                series={page.borrowed}
                label={`${market.name} borrowed over ${period.text}`}
                unit={market.loan?.symbol ?? null}
              />
            </Panel>
            <Panel
              label="Collateral"
              aside={
                <RangeLinks
                  period={period}
                  to="/borrow/markets/$market"
                  params={{ market: id }}
                />
              }
            >
              <p className="mt-2 text-[34px] leading-tight font-[650] tabular-nums max-md:text-[26px]">
                {latestText(page.collateral, market.collateral?.symbol)}
              </p>
              <SeriesFigure
                series={page.collateral}
                label={`${market.name} collateral over ${period.text}`}
                unit={market.collateral?.symbol ?? null}
              />
            </Panel>
            <Panel
              label="Collateral ratio"
              aside={
                <RangeLinks
                  period={period}
                  to="/borrow/markets/$market"
                  params={{ market: id }}
                />
              }
            >
              <p className="mt-2 text-[34px] leading-tight font-[650] tabular-nums max-md:text-[26px]">
                {latestText(page.ratio, null)}
              </p>
              <p className="mt-1 text-[14px] text-sec">
                Collateral over borrowed, at each day's close
              </p>
              <SeriesFigure
                series={page.ratio}
                label={`${market.name} collateral ratio over ${period.text}`}
              />
            </Panel>
          </div>
        </>
      )}

      <section aria-labelledby="positions" className="mt-11">
        <SectionHeading
          id="positions"
          aside={
            page.positions.status === "ok"
              ? `${page.positions.data.rows.length}${page.positions.data.complete ? "" : "+"} open`
              : undefined
          }
        >
          Positions
        </SectionHeading>
        {page.positions.status === "ok" ? (
          <>
            <PositionsTable
              rows={page.positions.data.rows}
              caption="Positions in this market"
            />
            <RowsNotShown skipped={page.positions.skipped} />
          </>
        ) : (
          <SectionState section={page.positions} />
        )}
      </section>

      <div className="mt-11 grid items-start gap-8 xl:grid-cols-[minmax(0,1fr)_400px]">
        <section aria-labelledby="activity" className="min-w-0">
          <SectionHeading id="activity">Activity</SectionHeading>
          {page.activity.status === "ok" ? (
            <>
              <HistoryList
                rows={page.activity.data.items}
                label="Market activity"
                showAccount
              />
              <Pager
                label="Activity pages"
                paged={paged}
                next={page.activity.data.next}
                skipped={page.activity.skipped}
                restarted={page.activity.restarted}
                to="/borrow/markets/$market"
                params={{ market: id }}
                {...(period.range === "30d"
                  ? {}
                  : { extra: periodParams(chartPeriod(period)) })}
              />
            </>
          ) : (
            <SectionState section={page.activity} />
          )}
        </section>
        {market === null ? null : (
          <DetailCard title="Market details">
            <DetailRow label="Collateral">
              <span
                className="font-mono text-[14px]"
                title={market.collateralToken}
              >
                {market.collateral?.symbol ??
                  shortAddress(market.collateralToken)}
              </span>
            </DetailRow>
            <DetailRow label="Loan">
              <span className="font-mono text-[14px]" title={market.loanToken}>
                {market.loan?.symbol ?? shortAddress(market.loanToken)}
              </span>
            </DetailRow>
            <DetailRow label="LLTV">{market.lltv}</DetailRow>
            <DetailRow label="Fee">{market.fee}</DetailRow>
            <DetailRow label="Oracle">
              <Link
                to="/address/$address"
                params={{ address: market.oracle }}
                title={market.oracle}
                className="rounded-sm font-mono text-[14px] underline decoration-line underline-offset-4 outline-none focus-visible:outline-2 focus-visible:outline-ink"
              >
                {shortAddress(market.oracle)}
              </Link>
            </DetailRow>
            <DetailRow label="Rate model">
              <Link
                to="/address/$address"
                params={{ address: market.irm }}
                title={market.irm}
                className="rounded-sm font-mono text-[14px] underline decoration-line underline-offset-4 outline-none focus-visible:outline-2 focus-visible:outline-ink"
              >
                {shortAddress(market.irm)}
              </Link>
            </DetailRow>
            <DetailRow label="Block">
              <Link
                to="/block/$id"
                params={{ id: String(market.block) }}
                className="rounded-sm font-mono text-[14px] underline decoration-line underline-offset-4 outline-none focus-visible:outline-2 focus-visible:outline-ink"
              >
                {market.block.toLocaleString("en-US")}
              </Link>
            </DetailRow>
          </DetailCard>
        )}
      </div>
    </>
  )
}

/** Not found: not a market id, or no Morpho Blue market with it. */
function MarketNotFound(): ReactNode {
  const { market } = Route.useParams()
  const valid = canonicalHash(market)
  return (
    <EntityPage
      icon={shapes.creditCard}
      title="Market"
      kind="Market"
      crumbs={[{ label: "Borrow", to: "/borrow" }]}
      current={valid === null ? market.slice(0, 20) : shortAddress(valid)}
      checks={[
        {
          label: "Format",
          value: valid === null ? "Not a market id" : "Valid market id",
          detail: "0x + 64 hex",
          passed: valid !== null,
        },
        {
          label: "Morpho Blue",
          value: "Not found",
          detail: "Mezo markets",
          passed: false,
        },
      ]}
    />
  )
}
