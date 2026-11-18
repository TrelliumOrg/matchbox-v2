import type {
  ScanEnclaveEventItem,
  ScanEnclavePositionSummary,
  ScanLiquidationItem,
  ScanMorphoMarket,
  ScanMorphoPosition,
} from "@matchbox/contracts/scan"
import { formatDay, formatDecimal } from "@matchbox/domain/format"
import { setCacheClass } from "../cache-class.server"
import {
  type BorrowTabName,
  borrowInput,
  type PeriodAsked,
  trovesChartId,
} from "./borrow-input"
import { canonicalQuery } from "./caller.server"
import { nowSeconds } from "./clock.server"
import type { Entity, Section } from "./explorer"
import {
  type BorrowedView,
  borrowedView,
  byCollateralRatio,
  byDebt,
  byHealth,
  byOpenThenLatest,
  debtShareOf,
  type EnclavePageView,
  type EnclaveRowView,
  enclaveHistoryView,
  enclavePageView,
  enclaveRowView,
  foldInterest,
  type HistoryView,
  knownMarketIds,
  type MarketDetailView,
  type MorphoRowView,
  marketDetailView,
  marketsById,
  marketTokens,
  marketView,
  morphoEventView,
  morphoHistoryView,
  morphoRowView,
  type TroveRowView,
  troveEventView,
  troveHistoryView,
  troveRowView,
} from "./scan/borrow-views"
import { type LockView, lockView } from "./scan/lock-views"
import { ratioDays, ratioText } from "./scan/market-views"
import {
  type Period,
  type PeriodView,
  periodOf,
  periodSeries,
  periodView,
} from "./scan/period"
import { readDailyPrices } from "./scan/prices.server"
import type { DailyPrices } from "./scan/pricing"
import { readScan, type ScanRead } from "./scan/read.server"
import { scanSchemas } from "./scan/schemas"
import { metric } from "./scan/series"
import { readSeries, type SeriesView, wholeText } from "./scan/series.server"
import { pointLabel } from "./scan/series-views"
import { formatTokenAmount, knownTokens } from "./scan/tokens"
import { sumDecimals, weekly } from "./scan/weekly"
import type { Page } from "./views"

/**
 * The Borrow pages' reads (`/internal/scan/borrow/*` and `/series`), as
 * view models. Every figure (health, LTV, collateral ratio, liquidation
 * price, rates) is the API's, formatted by borrow-views; nothing here
 * recomputes money. Each read degrades only its own section, and reads run
 * in parallel (at most two rounds: a market's series need its loan token).
 *
 * Lists read one page of up to 100 rows: rankings and counts ("closest to
 * liquidation", "3 open") are only called complete when the page was the
 * whole list.
 */

/** The series each page charts, by registry name (one place to rename). */
const charts = {
  supplied: metric("morpho.total_supply"),
  borrowed: metric("morpho.total_borrow"),
  collateral: metric("morpho.total_collateral"),
  troveDebt: metric("musd.trove_debt"),
  troveCollateral: metric("musd.trove_coll"),
}

const btcAddress = "0x7b7c000000000000000000000000000000000000"
const musdAddress = "0xdd468a1ddc392dcdbef6db6e34e89aa338f9f186"

/**
 * Collateral over debt per day as a chart (`ratioDays`: both at each
 * day's close), from two series reads; unread when either did not read.
 */
function ratioChart(
  collateral: { token: string; read: Section<SeriesView> },
  debt: { token: string; read: Section<SeriesView> },
  prices: DailyPrices,
): Section<ChartSeries> {
  if (collateral.read.status !== "ok") return collateral.read
  if (debt.read.status !== "ok") return debt.read
  const days = ratioDays(
    { token: collateral.token, view: collateral.read.data },
    { token: debt.token, view: debt.read.data },
    prices,
  )
  const last = days.at(-1)
  return {
    status: "ok",
    data: {
      kind: "level",
      points: weekly(
        days,
        "level",
        (day) => ({
          day: day.day,
          // A chart height only; the text is the exact ratio.
          value: Number(day.bps) / 100,
          partial: day.partial,
          label: pointLabel(day),
          text: ratioText(day.bps),
        }),
        () => ({ value: 0, text: "" }),
      ),
      latest:
        last === undefined
          ? null
          : { text: ratioText(last.bps), partial: last.partial },
      endsOn: null,
    },
  }
}

const aMarket = /^0x[0-9a-f]{64}$/
const anAddress = /^0x[0-9a-f]{40}$/
const anEnclavePosition = /^(0x[0-9a-f]{64}|[0-9]{1,30})$/
const aCursor = /^[A-Za-z0-9_-]{4,512}$/
/** The largest page the API serves. */
const fullPage = 100

/** The fixture world's now in fixtures mode, else the clock. */
function now(): number {
  return nowSeconds()
}

function sectionOf<In, Out>(
  read: ScanRead<In>,
  map: (data: In) => Out,
): Section<Out> {
  if (read.status === "ok") {
    return {
      status: "ok",
      data: map(read.data),
      ...(read.skipped > 0 ? { skipped: read.skipped } : {}),
      ...(read.restarted === true ? { restarted: true } : {}),
    }
  }
  if (read.status === "rate-limited") return { status: "rate-limited" }
  if (read.status === "disabled") return { status: "disabled" }
  return { status: "unavailable" }
}

type Failure = Exclude<Section<never>, { status: "ok" }>

/** A read that did not answer, as its section's state. */
function failed(read: ScanRead<unknown>): Failure {
  if (read.status === "rate-limited") return { status: "rate-limited" }
  if (read.status === "disabled") return { status: "disabled" }
  return { status: "unavailable" }
}

/**
 * Whether any of a page's live reads came from a snapshot the API calls
 * stale (`snapshot.stale`): the page then says its Borrow data is
 * delayed. False when unknown, as the snapshot's own `stale` is.
 */
function delayedOf(
  ...reads: readonly ScanRead<{
    snapshot?: { stale: boolean | null } | undefined
  }>[]
): boolean {
  return reads.some(
    (read) => read.status === "ok" && read.data.snapshot?.stale === true,
  )
}

/** Rows the API left out of these reads, together. */
function skippedIn(reads: readonly ScanRead<unknown>[]): number {
  return reads.reduce(
    (sum, read) => sum + (read.status === "ok" ? read.skipped : 0),
    0,
  )
}

function cursorOf(cursor: string | null): string | null {
  return cursor !== null && aCursor.test(cursor) ? cursor : null
}

const unavailable = { status: "unavailable" } as const

// -- shared reads -------------------------------------------------------------

function readMarkets() {
  return readScan("borrow/markets", new URLSearchParams(), scanSchemas.markets)
}

function readPositions(market: string) {
  return readScan(
    `borrow/markets/${market}/positions`,
    canonicalQuery({ limit: fullPage }),
    scanSchemas.positionPage,
  )
}

function readTroves(cursor: string | null, limit: number) {
  return readScan(
    "borrow/troves",
    canonicalQuery({ cursor, limit }),
    scanSchemas.trovePage,
  )
}

function readEnclavePositions(cursor: string | null) {
  return readScan(
    "borrow/enclave/positions",
    canonicalQuery({ cursor, limit: fullPage }),
    scanSchemas.enclavePositionPage,
  )
}

export type EnclavesView = {
  /** Open positions first, then the most recently changed. */
  rows: EnclaveRowView[]
  open: number
  /** Positions on this page, open or closed. */
  positions: number
  /** MUSD minted and repaid across them; null when any is not whole. */
  minted: string | null
  repaid: string | null
  /** The page was the whole list: counts are not lower bounds. */
  complete: boolean
  next: { cursor: string } | null
}

const musd = { symbol: "MUSD", decimals: 18 }

/** A page of Enclave positions as the Enclaves tab and section show it. */
function enclavesView(body: {
  data: readonly ScanEnclavePositionSummary[]
  nextCursor: string | null
}): EnclavesView {
  const sum = (pick: (each: ScanEnclavePositionSummary) => string | null) => {
    let total = 0n
    for (const each of body.data) {
      const value = pick(each)
      if (value === null) return null
      total += BigInt(value)
    }
    return formatTokenAmount(total.toString(), musd)
  }
  return {
    rows: [...body.data].sort(byOpenThenLatest).map(enclaveRowView),
    open: body.data.filter((each) => each.status === "open").length,
    positions: body.data.length,
    minted: sum((each) => each.minted),
    repaid: sum((each) => each.repaid),
    complete: body.nextCursor === null,
    next: body.nextCursor === null ? null : { cursor: body.nextCursor },
  }
}

function readStabilityPool() {
  return readScan(
    "borrow/stability-pool",
    new URLSearchParams(),
    scanSchemas.stabilityPool,
  )
}

/**
 * A series as a chart draws it: each point with its day and text, which
 * the chart reads out on hover, touch or focus (not the exact decimal).
 */
export type ChartSeries = {
  kind: "flow" | "level"
  points: {
    day: string
    value: number
    partial: boolean
    label: string
    text: string
  }[]
  latest: { text: string; partial: boolean } | null
  endsOn: string | null
}

function chartOf(
  series: Section<SeriesView>,
  /** Each point's text from its exact decimal; the series' own if unset. */
  format?: (decimal: string) => string,
): Section<ChartSeries> {
  if (series.status !== "ok") return series
  const view = series.data
  const last = view.points.at(-1)
  return {
    status: "ok",
    data: {
      kind: view.kind,
      points: weekly(
        view.points,
        view.kind,
        ({ day, value, partial, text, decimal }) => ({
          day,
          value,
          partial,
          label: pointLabel({ day, partial }),
          text: format === undefined ? text : format(decimal),
        }),
        (days) => {
          const total = sumDecimals(days.map((each) => each.decimal))
          return {
            value: Number(total),
            text: format === undefined ? wholeText(total) : format(total),
          }
        },
      ),
      latest:
        format === undefined || last === undefined
          ? view.latest
          : { text: format(last.decimal), partial: last.partial },
      endsOn: view.endsOn,
    },
  }
}

/**
 * A market's daily series. The API resolves a market's decimals (read on
 * chain, `resolvedDecimals`), which win; the market answer's are passed
 * for an API that resolves none. With neither, the series is not drawn
 * (readSeries never guesses them).
 */
async function marketSeries(
  name: string,
  marketId: string,
  loanDecimals: number | null,
  period: Period,
): Promise<Section<ChartSeries>> {
  return chartOf(await marketSeriesView(name, marketId, loanDecimals, period))
}

/**
 * A market's daily series over the period (`marketSeries` before
 * drawing): read back to its first day, cut to its days.
 */
async function marketSeriesView(
  name: string,
  marketId: string,
  decimals: number | null,
  period: Period,
): Promise<Section<SeriesView>> {
  const read = await readSeries({
    metric: name,
    dimension: marketId,
    days: period.read,
    now: now(),
    ...(decimals === null ? {} : { tokenDecimals: decimals }),
  })
  return periodSeries(read, period)
}

function loanDecimalsOf(market: ScanMorphoMarket): number | null {
  return marketTokens(market).loan.decimals
}

const btc = knownTokens["0x7b7c000000000000000000000000000000000000"] ?? null

export type StabilityPoolView = {
  /** "1,840,221.40 MUSD". */
  deposits: string | null
  /** "2.1180 BTC" from liquidations, waiting to be claimed. */
  collateral: string | null
}

function stabilityPoolView(data: {
  total_musd_deposits: string
  total_collateral: string
}): StabilityPoolView {
  return {
    deposits: formatTokenAmount(data.total_musd_deposits, {
      symbol: "MUSD",
      decimals: 18,
    }),
    collateral: formatTokenAmount(data.total_collateral, btc),
  }
}

export type LiquidationView = {
  key: string
  day: string
  timestamp: number
  /** The trove's owner, or the Morpho position's account (null unknown). */
  borrower: string | null
  /** Which loan: a trove, or a Morpho position in `market`. */
  loan: { kind: "trove" } | { kind: "morpho"; market: string; name: string }
  /**
   * "-2,192.30 MUSD, -0.0310 BTC" for a trove; "Seized 0.0310 BTC, repaid
   * 2,000.00 mUSDC" for a Morpho position.
   */
  detail: string | null
  txHash: string
}

/** A trove event (a liquidation or a redemption) as a list row. */
function troveLiquidationView(
  event: Parameters<typeof troveEventView>[0] & { borrower: string },
): LiquidationView {
  const view = troveEventView(event)
  return {
    key: view.key,
    day: formatDay(event.timestamp),
    timestamp: event.timestamp,
    borrower: event.borrower,
    loan: { kind: "trove" },
    detail: view.detail,
    txHash: event.tx_hash,
  }
}

/** A row of `/borrow/liquidations`: a trove's or a Morpho position's. */
function liquidationView(
  item: ScanLiquidationItem,
  markets: ReadonlyMap<string, ScanMorphoMarket>,
): LiquidationView {
  if (item.kind === "trove") return troveLiquidationView(item)
  // The market answer names a discovered market and carries its decimals;
  // without it, a configured market by the token registry.
  const market = markets.get(item.market_id) ?? null
  const view = morphoHistoryView(item, market)
  return {
    key: view.key,
    day: view.day,
    timestamp: item.timestamp,
    borrower: item.on_behalf,
    loan: {
      kind: "morpho",
      market: item.market_id,
      name:
        market === null ? morphoEventView(item).loan : marketView(market).name,
    },
    detail: view.subline,
    txHash: item.tx_hash,
  }
}

// -- overview -----------------------------------------------------------------

export type MarketChart = {
  id: string
  name: string
  /** The loan token's symbol, the series' unit; null when unknown. */
  unit: string | null
  borrowed: string | null
  supplied: string | null
  utilization: string | null
  borrowApr: string | null
  /** The loan token's decimals the market list gave, for the chart read. */
  decimals: number | null
}

export type BorrowOverview = {
  markets: Section<MarketDetailView[]>
  charts: MarketChart[]
  /**
   * Morpho positions with debt and open troves, closest to liquidation
   * first: both rank by health factor (a trove's is its collateral ratio
   * over the 110% minimum). `troves` is false when the trove list could
   * not be read, so the ranking is Morpho's only.
   */
  closest: Section<{
    rows: (MorphoRowView | TroveRowView)[]
    complete: boolean
    troves: boolean
  }>
  /**
   * MUSD owed across the three venues (`/borrow/totals`), with the share
   * in Enclaves and the open Enclave count.
   */
  borrowed: Section<BorrowedView>
  /** Enclave positions, open first (the first five drawn). */
  enclaves: Section<EnclavesView>
  /**
   * Open position counts; `complete` when every list was read whole.
   * `enclaves` is null when the Enclave count could not be read (the
   * total is then not complete).
   */
  counts: {
    morpho: number
    troves: number
    enclaves: number | null
    complete: boolean
  } | null
  troves: Section<{
    lowest: TroveRowView[]
    open: number
    /**
     * Open troves' principal plus interest from `/borrow/totals` (every
     * open trove): "57,360.75 MUSD"; null when it could not be read.
     */
    debt: string | null
    /** BTC held by the open troves read: "1.0141 BTC". */
    collateral: string | null
    complete: boolean
  }>
  stabilityPool: Section<StabilityPoolView>
  liquidations: Section<{
    recent: LiquidationView[]
    count: number
    complete: boolean
  }>
  period: PeriodView
  /** A live read came from a stale snapshot. */
  delayed: boolean
}

/**
 * The overview's market charts, read once the page has painted: each
 * market's borrowed series over the period. Kept off the overview's
 * loader (a series read per market, and another round for a market the
 * list adds), which the page's first paint does not need.
 */
export async function borrowCharts(
  data: PeriodAsked & {
    markets: { id: string; decimals: number | null }[]
  },
): Promise<Record<string, Section<ChartSeries>>> {
  // Daily series: a minute at the edge (cache-policy, withDataPolicy).
  setCacheClass("series")
  const at = now()
  const period = periodOf(data, at)
  const days = period.read
  const troveSeries = (name: string) =>
    readSeries({ metric: name, days, now: at }).then((read) =>
      periodSeries(read, period),
    )
  const [series, troveDebt, troveCollateral, prices] = await Promise.all([
    Promise.all(
      data.markets.map((market) =>
        marketSeries(charts.borrowed, market.id, market.decimals, period),
      ),
    ),
    troveSeries(charts.troveDebt),
    troveSeries(charts.troveCollateral),
    readDailyPrices(at, at - days * 86_400, ["btc"]),
  ])
  return {
    ...Object.fromEntries(
      data.markets.map((market, index) => [
        market.id,
        series[index] ?? unavailable,
      ]),
    ),
    // The troves' collateral ratio per day, MUSD at $1 as the protocol
    // counts it, BTC at each day's close.
    [trovesChartId]: ratioChart(
      { token: btcAddress, read: troveCollateral },
      { token: musdAddress, read: troveDebt },
      prices,
    ),
  }
}

export async function borrowOverview(
  data: PeriodAsked,
): Promise<BorrowOverview> {
  setCacheClass("list")
  const period = periodView(periodOf(borrowInput.overview(data), now()), now())
  // The markets we know are read with the list, so the page reads in one
  // round. A market the list adds (none today on mainnet) is read as soon
  // as the list answers, beside the round's other reads, not after them.
  const listed = readMarkets()
  const addedReads = listed.then((read) => {
    const ids = (read.status === "ok" ? read.data.data : [])
      .map((market) => market.market_id)
      .filter((id) => !knownMarketIds.includes(id))
    return Promise.all(ids.map((id) => readPositions(id)))
  })
  const [
    markets,
    troves,
    pool,
    liquidations,
    knownPositions,
    totals,
    enclaves,
    addedPositions,
  ] = await Promise.all([
    listed,
    readTroves(null, fullPage),
    readStabilityPool(),
    readScan(
      "borrow/liquidations",
      canonicalQuery({ limit: fullPage }),
      scanSchemas.liquidationPage,
    ),
    Promise.all(knownMarketIds.map((id) => readPositions(id))),
    readScan("borrow/totals", new URLSearchParams(), scanSchemas.borrowTotals),
    readEnclavePositions(null),
    addedReads,
  ])
  const list = markets.status === "ok" ? markets.data.data : []
  const added = list.filter(
    (market) => !knownMarketIds.includes(market.market_id),
  )
  function readFor<T>(
    id: string,
    known: readonly T[],
    late: readonly T[],
  ): T | undefined {
    const early = knownMarketIds.indexOf(id)
    return early >= 0
      ? known[early]
      : late[added.findIndex((market) => market.market_id === id)]
  }
  const positionReads = list.flatMap((market) => {
    const read = readFor(market.market_id, knownPositions, addedPositions)
    return read === undefined ? [] : [read]
  })
  const byId = new Map(list.map((market) => [market.market_id, market]))
  const positionFailure = positionReads.find((read) => read.status !== "ok")
  const positions: ScanMorphoPosition[] = positionReads.flatMap((read) =>
    read.status === "ok" ? read.data.data : [],
  )
  // Rows the API left out (failed their schema): a ranking or count that
  // missed one is not whole.
  const positionsSkipped = skippedIn(positionReads)
  const positionsComplete =
    markets.status === "ok" &&
    positionFailure === undefined &&
    positionReads.every(
      (read) => read.status === "ok" && read.data.nextCursor === null,
    )
  const withDebt = positions.filter((each) => each.borrow_assets !== "0")
  const troveRows = troves.status === "ok" ? troves.data.data : []
  const openTroves = troveRows.filter((each) => each.status === "active")
  const trovesComplete =
    troves.status === "ok" &&
    troves.data.nextCursor === null &&
    skippedIn([troves]) === 0
  const borrowed = sectionOf(totals, (body) => borrowedView(body.data))
  const openEnclaves =
    borrowed.status === "ok" ? (borrowed.data.enclaves?.open ?? null) : null
  return {
    borrowed,
    enclaves: sectionOf(enclaves, (body) => {
      const view = enclavesView(body)
      return { ...view, rows: view.rows.slice(0, 5) }
    }),
    markets: sectionOf(markets, (body) => body.data.map(marketDetailView)),
    charts: list.map((market) => {
      const view = marketDetailView(market)
      return {
        id: view.id,
        name: view.name,
        unit: view.loan?.symbol ?? null,
        borrowed: view.borrowed,
        supplied: view.supplied,
        utilization: view.utilization,
        borrowApr: view.borrowApr,
        decimals: loanDecimalsOf(market),
      }
    }),
    closest:
      markets.status !== "ok"
        ? failed(markets)
        : positionFailure !== undefined && positions.length === 0
          ? failed(positionFailure)
          : {
              status: "ok",
              data: {
                rows: [
                  ...withDebt.map((position) => ({
                    health: position.health,
                    view: () =>
                      morphoRowView(
                        position,
                        byId.get(position.market_id) ?? null,
                      ),
                  })),
                  ...openTroves.map((trove) => ({
                    health: trove.health,
                    view: () => troveRowView(trove),
                  })),
                ]
                  .sort(byHealth)
                  .slice(0, 5)
                  .map((each) => each.view()),
                complete: positionsComplete && trovesComplete,
                troves: troves.status === "ok",
              },
              ...(positionsSkipped > 0 ? { skipped: positionsSkipped } : {}),
            },
    counts:
      markets.status === "ok" &&
      positionFailure === undefined &&
      troves.status === "ok"
        ? {
            morpho: withDebt.length,
            troves: openTroves.length,
            enclaves: openEnclaves,
            complete:
              positionsComplete &&
              positionsSkipped === 0 &&
              trovesComplete &&
              openEnclaves !== null,
          }
        : null,
    troves: sectionOf(troves, () => ({
      lowest: [...openTroves]
        .sort(byCollateralRatio)
        .slice(0, 3)
        .map(troveRowView),
      open: openTroves.length,
      debt: borrowed.status === "ok" ? borrowed.data.troveDebt : null,
      collateral: formatTokenAmount(
        openTroves
          .reduce((sum, trove) => sum + BigInt(trove.coll), 0n)
          .toString(),
        btc,
      ),
      complete: trovesComplete,
    })),
    stabilityPool: sectionOf(pool, (body) => stabilityPoolView(body.data)),
    liquidations: sectionOf(liquidations, (body) => ({
      recent: body.data
        .slice(0, 4)
        .map((item) => liquidationView(item, marketsById(list))),
      count: body.data.length,
      complete: body.nextCursor === null,
    })),
    period,
    delayed: delayedOf(
      markets,
      troves,
      pool,
      totals,
      ...knownPositions,
      ...addedPositions,
    ),
  }
}

// -- tabs ---------------------------------------------------------------------

export async function borrowMarkets(): Promise<{
  markets: Section<MarketDetailView[]>
  delayed: boolean
}> {
  setCacheClass("list")
  const read = await readMarkets()
  return {
    markets: sectionOf(read, (body) => body.data.map(marketDetailView)),
    delayed: delayedOf(read),
  }
}

export type PositionsList = Section<{
  rows: MorphoRowView[]
  complete: boolean
}>

export async function borrowPositions(): Promise<{
  positions: PositionsList
  delayed: boolean
}> {
  setCacheClass("list")
  const markets = await readMarkets()
  if (markets.status !== "ok") {
    return { positions: failed(markets), delayed: false }
  }
  const list = markets.data.data
  const reads = await Promise.all(
    list.map((market) => readPositions(market.market_id)),
  )
  const delayed = delayedOf(markets, ...reads)
  const failure = reads.find((read) => read.status !== "ok")
  if (failure !== undefined && reads.every((read) => read.status !== "ok")) {
    return { positions: failed(failure), delayed }
  }
  const byId = new Map(list.map((market) => [market.market_id, market]))
  // A lender's row (supply only, no debt and no collateral) is not a
  // borrow position.
  const rows = reads
    .flatMap((read) => (read.status === "ok" ? read.data.data : []))
    .filter((each) => each.borrow_assets !== "0" || each.collateral !== "0")
    .sort(byHealth)
    .map((each) => morphoRowView(each, byId.get(each.market_id) ?? null))
  const skipped = skippedIn(reads)
  return {
    positions: {
      status: "ok",
      data: {
        rows,
        complete:
          failure === undefined &&
          reads.every(
            (read) => read.status === "ok" && read.data.nextCursor === null,
          ),
      },
      ...(skipped > 0 ? { skipped } : {}),
    },
    delayed,
  }
}

export async function borrowLiquidations(data: {
  cursor: string | null
}): Promise<Section<Page<LiquidationView>>> {
  setCacheClass("list")
  // The market list in the same round, to name and size positions in
  // markets the configured list does not have.
  const [read, marketList] = await Promise.all([
    readScan(
      "borrow/liquidations",
      canonicalQuery({ cursor: cursorOf(data.cursor) }),
      scanSchemas.liquidationPage,
    ),
    readMarkets(),
  ])
  const markets = marketsById(
    marketList.status === "ok" ? marketList.data.data : null,
  )
  return sectionOf(read, (body) => ({
    items: body.data.map((item) => liquidationView(item, markets)),
    next: body.nextCursor === null ? null : { cursor: body.nextCursor },
  }))
}

export type TrovesTab = {
  troves: Section<Page<TroveRowView>>
  stabilityPool: Section<StabilityPoolView>
  redemptions: Section<LiquidationView[]>
  /** A live read came from a stale snapshot. */
  delayed: boolean
}

export async function borrowTroves(data: {
  cursor: string | null
}): Promise<TrovesTab> {
  setCacheClass("list")
  const [troves, pool, redemptions] = await Promise.all([
    readTroves(cursorOf(data.cursor), 25),
    readStabilityPool(),
    readScan(
      "borrow/redemptions",
      canonicalQuery({ limit: 10 }),
      scanSchemas.troveEventPage,
    ),
  ])
  return {
    troves: sectionOf(troves, (body) => ({
      items: body.data.map(troveRowView),
      next: body.nextCursor === null ? null : { cursor: body.nextCursor },
    })),
    stabilityPool: sectionOf(pool, (body) => stabilityPoolView(body.data)),
    redemptions: sectionOf(redemptions, (body) =>
      body.data.map(troveLiquidationView),
    ),
    delayed: delayedOf(troves, pool),
  }
}

/** The Borrow tabs past the overview, one route (`/borrow/$tab`). */
export type { BorrowTabName } from "./borrow-input"

export type BorrowTabPage =
  | {
      tab: "enclaves"
      enclaves: Section<EnclavesView>
      /** History only: no live read to be delayed. */
      delayed: false
    }
  | {
      tab: "markets"
      markets: Section<MarketDetailView[]>
      delayed: boolean
    }
  | { tab: "positions"; positions: PositionsList; delayed: boolean }
  | {
      tab: "liquidations"
      liquidations: Section<Page<LiquidationView>>
      /** History only: no live read to be delayed. */
      delayed: false
    }
  | ({ tab: "troves" } & TrovesTab)

export async function borrowTab(data: {
  tab: BorrowTabName
  cursor: string | null
}): Promise<BorrowTabPage> {
  const checked = borrowInput.tab(data)
  switch (checked.tab) {
    case "enclaves":
      setCacheClass("list")
      return {
        tab: "enclaves",
        enclaves: sectionOf(
          await readEnclavePositions(cursorOf(checked.cursor)),
          enclavesView,
        ),
        delayed: false,
      }
    case "markets":
      return { tab: "markets", ...(await borrowMarkets()) }
    case "positions":
      return { tab: "positions", ...(await borrowPositions()) }
    case "liquidations":
      return {
        tab: "liquidations",
        liquidations: await borrowLiquidations({ cursor: checked.cursor }),
        delayed: false,
      }
    default:
      return {
        tab: "troves",
        ...(await borrowTroves({ cursor: checked.cursor })),
      }
  }
}

// -- market -------------------------------------------------------------------

export type MarketPage = {
  market: Entity<MarketDetailView>
  positions: Section<{ rows: MorphoRowView[]; complete: boolean }>
  activity: Section<Page<HistoryView>>
  supplied: Section<ChartSeries>
  borrowed: Section<ChartSeries>
  /** The positions' collateral at each close, in the collateral token. */
  collateral: Section<ChartSeries>
  /** Collateral over borrowed per day, both at each day's close. */
  ratio: Section<ChartSeries>
  period: PeriodView
  /** A live read came from a stale snapshot. */
  delayed: boolean
}

export async function marketPage(
  input: {
    market: string
    cursor: string | null
  } & PeriodAsked,
): Promise<MarketPage> {
  setCacheClass("fresh")
  const data = borrowInput.market(input)
  const period = periodOf(data, now())
  if (!aMarket.test(data.market)) {
    return {
      market: { status: "missing" },
      positions: unavailable,
      activity: unavailable,
      supplied: unavailable,
      borrowed: unavailable,
      collateral: unavailable,
      ratio: unavailable,
      period: periodView(period, now()),
      delayed: false,
    }
  }
  const [market, positions, events] = await Promise.all([
    readScan(
      `borrow/markets/${data.market}`,
      new URLSearchParams(),
      scanSchemas.market,
    ),
    readPositions(data.market),
    readScan(
      `borrow/markets/${data.market}/events`,
      canonicalQuery({ cursor: cursorOf(data.cursor) }),
      scanSchemas.morphoEventPage,
    ),
  ])
  const found = market.status === "ok" ? market.data.data : null
  const at = now()
  const [supplied, borrowed, collateral, prices] =
    found === null
      ? [unavailable, unavailable, unavailable, null]
      : await Promise.all([
          marketSeriesView(
            charts.supplied,
            found.market_id,
            loanDecimalsOf(found),
            period,
          ),
          marketSeriesView(
            charts.borrowed,
            found.market_id,
            loanDecimalsOf(found),
            period,
          ),
          marketSeriesView(
            charts.collateral,
            found.market_id,
            marketTokens(found).collateral.decimals,
            period,
          ),
          readDailyPrices(at, at - period.read * 86_400),
        ])
  return {
    market:
      market.status === "missing"
        ? { status: "missing" }
        : sectionOf(market, (body) => marketDetailView(body.data)),
    positions: sectionOf(positions, (body) => ({
      rows: body.data
        .filter((each) => each.borrow_assets !== "0" || each.collateral !== "0")
        .sort(byDebt)
        .map((each) => ({
          ...morphoRowView(each, found),
          debtShare: found === null ? null : debtShareOf(each, found),
        })),
      // A row the API left out is a position not counted.
      complete:
        body.nextCursor === null &&
        (positions.status !== "ok" || positions.skipped === 0),
    })),
    activity: sectionOf(events, (body) => ({
      items: foldInterest(body.data).map((event) =>
        morphoHistoryView(event, found),
      ),
      next: body.nextCursor === null ? null : { cursor: body.nextCursor },
    })),
    supplied: chartOf(supplied),
    borrowed: chartOf(borrowed),
    // To four places ("1.3504" BTC): its whole part alone would read 0.
    collateral: chartOf(collateral, (decimal) => formatDecimal(decimal, 4)),
    ratio:
      found === null || prices === null
        ? unavailable
        : ratioChart(
            {
              token: found.collateral_token.toLowerCase(),
              read: collateral,
            },
            { token: found.loan_token.toLowerCase(), read: borrowed },
            prices,
          ),
    period: periodView(period, at),
    delayed: delayedOf(market, positions),
  }
}

// -- Morpho position ----------------------------------------------------------

export type MorphoPositionPage = {
  market: Entity<MarketDetailView>
  /** Null when the account holds nothing in the market now. */
  position: Section<MorphoRowView | null>
  history: Section<HistoryView[]>
  /** Never held a position here: the page's 404. */
  missing: boolean
  /** A live read came from a stale snapshot. */
  delayed: boolean
}

export async function morphoPositionPage(data: {
  market: string
  account: string
}): Promise<MorphoPositionPage> {
  setCacheClass("fresh")
  if (!aMarket.test(data.market) || !anAddress.test(data.account)) {
    return {
      market: { status: "missing" },
      position: unavailable,
      history: unavailable,
      missing: true,
      delayed: false,
    }
  }
  const [market, owner, events] = await Promise.all([
    readScan(
      `borrow/markets/${data.market}`,
      new URLSearchParams(),
      scanSchemas.market,
    ),
    readScan(
      `borrow/owners/${data.account}`,
      new URLSearchParams(),
      scanSchemas.borrowOwner,
    ),
    readScan(
      `borrow/markets/${data.market}/positions/${data.account}/events`,
      canonicalQuery({ limit: 50 }),
      scanSchemas.morphoEventPage,
    ),
  ])
  const found = market.status === "ok" ? market.data.data : null
  const held =
    owner.status === "ok"
      ? (owner.data.data.morpho.find(
          (each) => each.market_id === data.market,
        ) ?? null)
      : null
  const position = sectionOf(owner, () =>
    held === null ? null : morphoRowView(held, found),
  )
  const history = sectionOf(events, (body) =>
    body.data.map((event) => morphoHistoryView(event, found)),
  )
  return {
    market:
      market.status === "missing"
        ? { status: "missing" }
        : sectionOf(market, (body) => marketDetailView(body.data)),
    position,
    history,
    missing:
      market.status === "missing" ||
      (position.status === "ok" &&
        position.data === null &&
        history.status === "ok" &&
        history.data.length === 0),
    delayed: delayedOf(market, owner),
  }
}

// -- trove --------------------------------------------------------------------

export type TrovePage = {
  trove: Entity<TroveRowView>
  history: Section<HistoryView[]>
  /** No trove and no history: the page's 404. */
  missing: boolean
  /** The trove's live read came from a stale snapshot. */
  delayed: boolean
}

export async function trovePage(data: { owner: string }): Promise<TrovePage> {
  setCacheClass("fresh")
  if (!anAddress.test(data.owner)) {
    return {
      trove: { status: "missing" },
      history: unavailable,
      missing: true,
      delayed: false,
    }
  }
  const [trove, events] = await Promise.all([
    readScan(
      `borrow/troves/${data.owner}`,
      new URLSearchParams(),
      scanSchemas.trove,
    ),
    readScan(
      `borrow/troves/${data.owner}/events`,
      canonicalQuery({ limit: 50 }),
      scanSchemas.troveEventPage,
    ),
  ])
  const history = sectionOf(events, (body) => body.data.map(troveHistoryView))
  return {
    trove:
      trove.status === "missing"
        ? { status: "missing" }
        : sectionOf(trove, (body) => troveRowView(body.data)),
    history,
    missing:
      trove.status === "missing" &&
      history.status === "ok" &&
      history.data.length === 0,
    delayed: delayedOf(trove),
  }
}

// -- Enclave position ---------------------------------------------------------

export type EnclavePage = {
  position: Entity<EnclavePageView>
  history: Section<HistoryView[]>
  /** The pledged veBTC locks, read from the locks routes. */
  locks: Section<LockView[]>
}

/** Pledged locks read per page. */
const pledgedLocks = 4

export async function enclavePage(data: {
  position: string
}): Promise<EnclavePage> {
  setCacheClass("fresh")
  if (!anEnclavePosition.test(data.position)) {
    return {
      position: { status: "missing" },
      history: unavailable,
      locks: unavailable,
    }
  }
  const events = await readScan(
    `borrow/enclave/positions/${data.position}/events`,
    canonicalQuery({ limit: fullPage }),
    scanSchemas.enclaveEventPage,
  )
  if (events.status === "missing") {
    return {
      position: { status: "missing" },
      history: unavailable,
      locks: unavailable,
    }
  }
  if (events.status !== "ok") {
    const state = failed(events)
    return { position: state, history: state, locks: state }
  }
  const rows: ScanEnclaveEventItem[] = events.data.data
  const view = enclavePageView(data.position, rows)
  if (view === null) {
    return {
      position: { status: "missing" },
      history: unavailable,
      locks: unavailable,
    }
  }
  const reads = await Promise.all(
    view.pledged
      .slice(0, pledgedLocks)
      .map((id) =>
        readScan(`locks/vebtc/${id}`, new URLSearchParams(), scanSchemas.lock),
      ),
  )
  const lockFailure = reads.find(
    (read) => read.status !== "ok" && read.status !== "missing",
  )
  const at = now()
  return {
    position: { status: "ok", data: view },
    history: { status: "ok", data: rows.map(enclaveHistoryView) },
    locks:
      lockFailure !== undefined
        ? failed(lockFailure)
        : {
            status: "ok",
            data: reads.flatMap((read) =>
              read.status === "ok" ? [lockView(read.data.data, at)] : [],
            ),
          },
  }
}
