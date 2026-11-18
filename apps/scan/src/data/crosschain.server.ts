import {
  bridgedAssets,
  type CrossChain,
  crossChainPools,
} from "@matchbox/chain"
import type {
  ScanBridgedAsset,
  ScanCrossChainPool,
} from "@matchbox/contracts/scan"
import { epochIndexFor, epochStartOf } from "@matchbox/domain/epoch"
import {
  formatDecimal,
  formatUsd,
  unitsToDecimal,
} from "@matchbox/domain/format"
import * as Inspect from "@matchbox/ui/inspect"
import { setCacheClass } from "../cache-class.server"
import { canonicalQuery } from "./caller.server"
import { nowSeconds } from "./clock.server"
import type { Section } from "./explorer"
import {
  type AssetFilter,
  type BridgeView,
  bridgeView,
  type ChainFilter,
  type PoolChain,
  type PoolFilters,
  type PoolRow,
  type PoolsView,
  type PriceView,
  pairOrder,
  percentYear,
  poolRow,
  poolsView,
  pricesByPool,
  priceView,
  type SupplyView,
  supplyView,
  type TradeRow,
  tradeRow,
} from "./scan/crosschain-views"
import { pricedSplit } from "./scan/market-views"
import { pricePanel, scaledDecimal } from "./scan/network-views"
import type { Period } from "./scan/period"
import {
  type ChartFigures,
  chartFigures,
  feeApr,
  liquidityChart,
  liquidityView,
  type PricedDay,
  pricedDays,
  pricedLevels,
  type ReservesView,
  reserveSides,
  reservesView,
  saneFees,
  type VolumeView,
  type VotesView,
  volumeView,
  votesView,
} from "./scan/pool-views"
import { readDailyPrices } from "./scan/prices.server"
import {
  type DailyPrices,
  dayOf,
  tokenBySymbol,
  type Usd,
  usdDecimal,
} from "./scan/pricing"
import { readScan, type ScanRead } from "./scan/read.server"
import { scanSchemas } from "./scan/schemas"
import { metric } from "./scan/series"
import { readSeries, type SeriesView } from "./scan/series.server"
import type { SeriesPanelData } from "./scan/series-views"
import { readSplit } from "./scan/split.server"
import { failedSection, scanSection } from "./scan/voting-views"

/**
 * The cross-chain reads (`/internal/scan/crosschain/*`) as the pages show
 * them (views in scan/crosschain-views). Every read runs at once and
 * degrades only its own section. Until the jobs Worker fills the tables
 * the API answers 200 with every figure null and its reason, and the
 * views say "not counted yet"; without SCAN_DB it answers 503 ("Not
 * available yet").
 */

type Prices = ScanRead<{
  data: Record<ScanBridgedAsset, Parameters<typeof priceView>[0]>
}>

function readPrices(): Promise<Prices> {
  return readScan(
    "crosschain/prices",
    new URLSearchParams(),
    scanSchemas.crossChainPrices,
  )
}

function readSupply() {
  return readScan(
    "crosschain/supply",
    canonicalQuery({ days: 30 }),
    scanSchemas.crossChainSupply,
  )
}

function readPools() {
  return readScan(
    "crosschain/pools",
    new URLSearchParams(),
    scanSchemas.crossChainPools,
  )
}

function readBridge(asset: ScanBridgedAsset) {
  return readScan(
    "crosschain/bridge-flows",
    canonicalQuery({ asset, days: 30 }),
    scanSchemas.bridgeFlows,
  )
}

function deployedOn(asset: ScanBridgedAsset): CrossChain[] {
  return bridgedAssets[asset].deployments.map((each) => each.chain)
}

function priceSection(prices: Prices, asset: ScanBridgedAsset) {
  return scanSection(prices, (body) => priceView(body.data[asset]))
}

/** MUSD's per-pool prices, when the price read answered. */
function poolPrices(prices: Prices): Map<string, string> {
  return prices.status === "ok"
    ? pricesByPool(prices.data.data.musd.venues)
    : new Map()
}

// -- token pages ----------------------------------------------------------------

/** MUSD's daily headline closes as a level chart, today's marked partial. */
function historyPanel(
  rows: readonly { day: string; price_usd: string | null }[],
  period: Period,
): SeriesPanelData {
  const today = new Date(nowSeconds() * 1000).toISOString().slice(0, 10)
  const points = rows.flatMap((row) =>
    row.price_usd === null
      ? []
      : [{ day: row.day, price: row.price_usd, partial: row.day === today }],
  )
  return pricePanel(points, period, points[0]?.day ?? null)
}

/** How many pools a token page lists; the Pools page has the rest. */
const tokenPoolRows = 5

/**
 * A token page's pools: the largest counted ones (the page's data is in
 * its HTML, so not the whole list), how many more there are, and the
 * liquidity of them all, each pool once.
 */
export type TokenPools = {
  rows: TradeRow[]
  more: number
  /** `pools` counted of `of` tracked: a source can be down for some. */
  liquidity: { text: string; pools: number; of: number; chains: number } | null
}

function tokenPools(view: PoolsView): TokenPools {
  const counted = view.rows.filter((row) => row.aboveLine === true)
  return {
    rows: counted.slice(0, tokenPoolRows).map(tradeRow),
    more:
      view.rows.length + view.hidden - Math.min(counted.length, tokenPoolRows),
    liquidity:
      view.total.text === null
        ? null
        : {
            text: view.total.text,
            pools: view.total.counted,
            of: view.total.pools,
            chains: view.chains.filter((chain) => chain.counted > 0).length,
          },
  }
}

export type TokenCrossChain = {
  price: Section<PriceView>
  supply: Section<SupplyView>
  pools: Section<TokenPools>
  bridge: Section<BridgeView>
  /** MUSD's daily headline closes for the price chart; null for MEZO. */
  history: Section<SeriesPanelData> | null
  /**
   * Mezo's own reading of the asset, base units: its total supply and what
   * its bridge holds locked for the other chains. Null without one.
   */
  hub: { totalSupply: bigint; locked: bigint | null; decimals: number } | null
}

function readHistory(days: number) {
  return readScan(
    "crosschain/prices/history",
    canonicalQuery({ asset: "musd", days: Math.min(days, 365) }),
    scanSchemas.crossChainPriceHistory,
  )
}

/** What the supply panel draws (the rest feeds the header's figures). */
export type SupplyPanel = Pick<
  SupplyView,
  "total" | "rows" | "locked" | "missing" | "mismatch"
>

/** The sections as the page receives them: no more than they draw. */
export type PageCrossChain = Omit<TokenCrossChain, "supply"> & {
  supply: Section<SupplyPanel>
}

export function pageCrossChain(full: TokenCrossChain): PageCrossChain {
  const { supply } = full
  return {
    ...full,
    supply:
      supply.status !== "ok"
        ? supply
        : {
            ...supply,
            data: {
              total: supply.data.total,
              rows: supply.data.rows,
              locked: supply.data.locked,
              missing: supply.data.missing,
              mismatch: supply.data.mismatch,
            },
          },
  }
}

/** The MUSD or MEZO page's cross-chain sections, every read at once. */
export async function tokenCrossChain(
  asset: ScanBridgedAsset,
  period: Period,
): Promise<TokenCrossChain> {
  const [prices, supply, pools, bridge, history] = await Promise.all([
    readPrices(),
    readSupply(),
    readPools(),
    readBridge(asset),
    // Back to the period's first day (the API serves a year at most).
    asset === "musd" ? readHistory(period.read) : Promise.resolve(null),
  ])
  return {
    history:
      history === null
        ? null
        : scanSection(history, (body) => historyPanel(body.days, period)),
    price: priceSection(prices, asset),
    supply: scanSection(supply, (body) =>
      supplyView(body.data[asset], deployedOn(asset)),
    ),
    pools: scanSection(pools, (body) =>
      tokenPools(
        poolsView(body.data, poolPrices(prices), {
          chain: "all",
          asset,
          small: false,
        }),
      ),
    ),
    bridge: scanSection(bridge, bridgeView),
    hub: supply.status === "ok" ? hubOf(supply.data.data[asset]) : null,
  }
}

/** Mezo's row of an asset's supply reading, as bigint units. */
export function hubOf(asset: {
  decimals: number
  chains: readonly {
    chain: string
    total_supply: string
    locked: string | null
  }[]
}): TokenCrossChain["hub"] {
  const mezo = asset.chains.find((row) => row.chain === "mezo")
  if (mezo === undefined) return null
  return {
    totalSupply: BigInt(mezo.total_supply),
    locked: mezo.locked === null ? null : BigInt(mezo.locked),
    decimals: asset.decimals,
  }
}

/** The supply per chain for the Tokens list's MUSD and MEZO rows. */
export async function listSupply(): Promise<Record<
  ScanBridgedAsset,
  SupplyView
> | null> {
  const supply = await readSupply()
  if (supply.status !== "ok") return null
  return {
    musd: supplyView(supply.data.data.musd, deployedOn("musd")),
    mezo: supplyView(supply.data.data.mezo, deployedOn("mezo")),
  }
}

// -- pools ----------------------------------------------------------------------

export function chainFilterOf(value: unknown): ChainFilter {
  return value === "mezo" || value === "ethereum" || value === "base"
    ? value
    : "all"
}

export function assetFilterOf(value: unknown): AssetFilter {
  return value === "musd" || value === "mezo" ? value : "all"
}

export type PoolsPage = {
  pools: Section<PoolsView>
  /** MUSD's headline, for the price-venue note. */
  price: Section<PriceView>
}

export async function poolsPage(input: PoolFilters): Promise<PoolsPage> {
  setCacheClass("fresh")
  const filters: PoolFilters = {
    chain: chainFilterOf(input.chain),
    asset: assetFilterOf(input.asset),
    small: input.small === true,
  }
  const [pools, prices] = await Promise.all([readPools(), readPrices()])
  return {
    pools: scanSection(pools, (body) =>
      poolsView(body.data, poolPrices(prices), filters),
    ),
    price: priceSection(prices, "musd"),
  }
}

/** Which source gave a figure, in words. */
export function sourceText(source: string): string {
  if (source === "estimate onchain") {
    return "Our estimate: 7 days of the pool's fees, a year, ÷ its reserves"
  }
  if (source === "mezo balances") {
    return "Mezo: the pool's balances at the close"
  }
  if (source === "mezo swaps") {
    return "Mezo: the pool's swaps"
  }
  if (source.startsWith("estimate")) {
    return "Our estimate: 24h volume × fee × 365 ÷ liquidity"
  }
  if (source.startsWith("matchbox gauges")) {
    return "Our estimate: MEZO sent to the pool's stakers"
  }
  if (source.startsWith("merkl")) {
    const paid = /\(([^)]+)\)/.exec(source)?.[1]
    return paid === undefined ? "Merkl" : `Merkl, paid in ${paid}`
  }
  const names: Record<string, string> = {
    geckoterminal: "GeckoTerminal",
    coingecko: "CoinGecko",
    defillama: "DefiLlama",
    "defillama (savings rate)": "DefiLlama, savings rate",
    curve: "Curve",
  }
  return names[source] ?? source
}

const fieldNames: Record<string, string> = {
  tvl_usd: "Liquidity",
  volume_24h_usd: "Volume 24h",
  apr_fees: "Fees",
  apr_rewards: "Protocol rewards",
  apr_merkl: "Merkl",
  apr_gauge: "Matchbox MEZO",
}

export type PoolDetail = {
  row: PoolRow
  /** "$251,340"; null with fewer than 7 days stored. */
  volume7d: string | null
  /** Mean yearly rate over 7 days, at or above the line only. */
  rate7d: string | null
  /** "3.7% of liquidity across tracked pools". */
  share: string | null
  /** Each figure present and where it came from. */
  sources: { figure: string; source: string }[]
  /** MUSD's headline, so "price here" reads against it. */
  headline: string | null
  /** Mezo pools only: what the store and the gauge hold for it. */
  mezo: MezoPoolFigures | null
}

/**
 * A Mezo pool's own figures (`ak42S52PlW`): daily volume and fees priced
 * at each day's close, its reserves now from its balances, and its gauge's
 * veBTC votes per epoch. They replace the snapshot's liquidity, volume and
 * fee rate on the page, so each figure has one source.
 */
export type MezoPoolFigures = {
  /**
   * Its liquidity over 90 days, and its volume and fees per day with the
   * last whole day's fees ("$442"): the figures in the first paint, the
   * days after it (`poolCharts`).
   */
  liquidity: ChartFigures | null
  volume: (ChartFigures & { fees: string | null }) | null
  reserves: ReservesView | null
  /**
   * The pool's gauge, whose votes and voter APY load after first paint
   * (`poolGauge`); null without one.
   */
  gauge: string | null
}

export type PoolPage = {
  /** Null when no tracked pool matches (the page's 404). */
  pool: Section<PoolDetail> | { status: "missing" }
}

function detailOf(
  pool: ScanCrossChainPool,
  all: readonly ScanCrossChainPool[],
  prices: Map<string, string>,
  headline: string | null,
): PoolDetail | null {
  const row = poolRow(pool, prices)
  if (row === null) return null
  const tvl = (each: ScanCrossChainPool) =>
    each.tvl_usd === null ? null : scaledDecimal(each.tvl_usd, 18)
  const counted = all.flatMap((each) => {
    const value = tvl(each)
    return value === null ? [] : [value]
  })
  const whole = counted.reduce((sum, value) => sum + value, 0n)
  const own = tvl(pool)
  let share: string | null = null
  if (own !== null && whole > 0n) {
    const tenths = Number((own * 1_000n + whole / 2n) / whole)
    share = `${Math.floor(tenths / 10)}.${tenths % 10}% of ${counted.length === all.length ? "liquidity across tracked pools" : "the liquidity counted so far"}`
  }
  return {
    row,
    volume7d:
      pool.volume_7d_usd === null
        ? null
        : formatUsd(pool.volume_7d_usd, "whole"),
    rate7d:
      pool.apr_7d === null || row.aboveLine !== true
        ? null
        : percentYear(pool.apr_7d),
    share,
    sources: Object.entries(pool.sources).flatMap(([field, source]) => {
      const figure = fieldNames[field]
      return figure === undefined
        ? []
        : [{ figure, source: sourceText(source) }]
    }),
    headline,
    mezo: null,
  }
}

/** Days of daily volume and fees the pool page charts. */
const poolDays = 30
/**
 * Days of liquidity the pool page charts, as the design's default. The
 * figures are in the first paint; the days are read after it
 * (`poolLiquidity`), so 90 points never ride in the hydration data.
 */
const liquidityDays = 90

/** Series the pool page reads (one map, so a rename is one line). */
const poolCharts = {
  volume: metric("dex.volume_in"),
  fees: metric("dex.fees"),
  balance: metric("pool.balance"),
  dexBalances: metric("pool.token_balance"),
}

/** The pair's two tokens by the pricing registry's symbols, else null. */
function pairTokens(
  pair: string,
):
  | [{ token: string; symbol: string }, { token: string; symbol: string }]
  | null {
  const [left, right] = pair.split("/")
  const first = left === undefined ? null : tokenBySymbol(left)
  const second = right === undefined ? null : tokenBySymbol(right)
  if (left === undefined || right === undefined) return null
  return first === null || second === null
    ? null
    : [
        { token: first, symbol: left },
        { token: second, symbol: right },
      ]
}

type PoolSeries = {
  /** Both sides' balances priced per day, oldest first. */
  liquidity: readonly PricedDay[] | null
  /** Every Mezo pool's liquidity on its latest day, priced. */
  dexTotal: { day: string; usd: Usd } | null
  volume: readonly PricedDay[] | null
  fees: readonly PricedDay[] | null
  reserves: ReturnType<typeof reserveSides>
  prices: DailyPrices
}

/**
 * A Mezo pool's own series, read alongside the pool snapshot (its pair and
 * address come from the static catalog and the URL): volume in and fees
 * per token, each token's balance at the close over 30 days, every
 * Mezo pool's balances per token on the latest day (its share of DEX),
 * and BTC's and MEZO's daily closes (the other pools hold both).
 */
async function readPoolSeries(
  address: string,
  tokens: NonNullable<ReturnType<typeof pairTokens>>,
  at: number,
): Promise<PoolSeries> {
  const series = (metric: string, token: string, days: number) =>
    readSeries({ metric, dimension: `${address}:${token}`, days, now: at })
  const both = (metric: string, days: number) =>
    Promise.all(tokens.map((each) => series(metric, each.token, days)))
  const [volumes, fees, balances, prices, dex] = await Promise.all([
    both(poolCharts.volume, poolDays),
    both(poolCharts.fees, poolDays),
    both(poolCharts.balance, liquidityDays),
    // Every token's closes: the other pools' tokens price the DEX total.
    readDailyPrices(at, at - (liquidityDays - 1) * 86_400),
    readSplit({ metric: poolCharts.dexBalances, days: 2, now: at }),
  ])
  const views = (reads: typeof volumes): SeriesView[] | null => {
    const out = reads.map((read) => (read.status === "ok" ? read.data : null))
    return out.some((view) => view === null) ? null : (out as SeriesView[])
  }
  const priced = (reads: typeof volumes) => {
    const each = views(reads)
    return each === null
      ? null
      : pricedDays(
          tokens.map((token, index) => ({
            token: token.token,
            view: each[index] as SeriesView,
          })),
          prices,
        )
  }
  const balanceViews = views(balances)
  const volume = priced(volumes)
  const dexDays =
    dex.status === "ok" ? pricedSplit(dex.data.series, prices).days : []
  const dexLast = dexDays.at(-1)
  const balanceDays = views(balances)
  return {
    // A level: a day missing one side's balance is left out, never drawn
    // without it.
    liquidity:
      balanceDays === null
        ? null
        : pricedLevels(
            tokens.map((token, index) => ({
              token: token.token,
              view: balanceDays[index] as SeriesView,
            })),
            prices,
          ),
    dexTotal:
      dexLast === undefined ? null : { day: dexLast.day, usd: dexLast.usd },
    volume,
    fees: volume === null ? null : saneFees(volume, priced(fees)),
    reserves:
      balanceViews === null
        ? null
        : reserveSides(
            tokens.map((token, index) => ({
              ...token,
              view: balanceViews[index] as SeriesView,
            })),
            prices,
          ),
    prices,
  }
}

/** Sum of percent decimal strings, two places. */
function percentSum(parts: readonly (string | null)[]): string | null {
  const present = parts.filter((part): part is string => part !== null)
  if (present.length === 0) return null
  const total = present.reduce((sum, part) => sum + scaledDecimal(part, 18), 0n)
  return unitsToDecimal(total.toString(), 18)
}

/**
 * The snapshot row with Mezo's own figures in place: liquidity from the
 * reserves, the last whole day's volume and its week, the fee rate from
 * 7 days of fees against the reserves, and the total recomputed from the
 * parts shown. A figure ours lacks stays the snapshot's, never both.
 */
function onChain(
  pool: ScanCrossChainPool,
  volume: VolumeView | null,
  series: PoolSeries,
): ScanCrossChainPool {
  const reserves = series.reserves?.total ?? null
  const last = volume?.last ?? null
  const fees =
    last?.fees7d == null || reserves === null
      ? null
      : feeApr(last.fees7d, reserves)
  const sources = { ...pool.sources }
  const apr = { ...pool.apr }
  if (fees !== null) {
    apr.fees = fees
    sources.apr_fees = "estimate onchain"
  }
  apr.total = percentSum([apr.fees, apr.rewards, apr.merkl, apr.gauge])
  const row: ScanCrossChainPool = { ...pool, apr, sources }
  if (reserves !== null) {
    row.tvl_usd = usdDecimal(reserves)
    sources.tvl_usd = "mezo balances"
  }
  if (last !== null) {
    row.volume_24h_usd = usdDecimal(last.volume)
    row.volume_7d_usd =
      last.volume7d === null ? null : usdDecimal(last.volume7d)
    row.day = last.day
    sources.volume_24h_usd = "mezo swaps"
  }
  return row
}

/**
 * A Mezo pool gauge's veBTC votes per epoch and voter APY, for the pool
 * page once it has painted: its epochs, its profile and the closes that
 * price what its voters were paid. Kept off the page's loader, which would
 * otherwise wait for the snapshot to name the gauge before reading it.
 */
export async function poolGauge(input: {
  gauge: string
}): Promise<{ votes: VotesView | null }> {
  setCacheClass("fresh")
  const gauge = input.gauge.toLowerCase()
  if (!/^0x[0-9a-f]{40}$/.test(gauge)) return { votes: null }
  const at = nowSeconds()
  const current = epochIndexFor(epochStartOf(at))
  const [epochs, profile, prices] = await Promise.all([
    readScan(
      `gauges/${gauge}/epochs`,
      canonicalQuery({ limit: 12 }),
      scanSchemas.gaugeHistory,
    ),
    readScan(
      `gauges/${gauge}`,
      new URLSearchParams(),
      scanSchemas.gaugeProfile,
    ),
    readDailyPrices(at, epochStartOf(at) - 7 * 86_400),
  ])
  const doc = profile.status === "ok" ? profile.data.data : null
  return {
    votes:
      epochs.status === "ok"
        ? votesView(
            epochs.data.data,
            current,
            prices,
            at,
            doc?.card.apy ?? null,
          )
        : null,
  }
}

/** The volume panel's figures, and the last whole day's fees as text. */
function volumeFigures(volume: VolumeView | null): MezoPoolFigures["volume"] {
  const figures =
    volume === null
      ? null
      : chartFigures(volume.chart, volume.stats, chartReserve)
  if (volume === null || figures === null) return null
  return {
    ...figures,
    fees:
      volume.last?.fees == null
        ? null
        : formatUsd(usdDecimal(volume.last.fees), "whole"),
  }
}

/** What a chart writes into its figure, as `SeriesBody` reserves it. */
function chartReserve(chart: SeriesPanelData): { value: string; note: string } {
  return {
    value: Inspect.widest(chart.points.map((point) => point.text)),
    note: Inspect.noteReserve(
      chart.points.map((point) => ({ ...point, n: point.value })),
      chart.kind === "level",
    ),
  }
}

/** A Mezo pool's two charts, drawn after first paint. */
export type PoolCharts = {
  liquidity: SeriesPanelData | null
  volume: SeriesPanelData | null
}

/**
 * A Mezo pool's liquidity per day over 90 days and volume per day over
 * 30, for its page once it has painted (the page's loader carries their
 * figures): both sides' balances at each day's close and their swaps in,
 * priced at that day's close. The loader's own reads, so the API answers
 * from its cache. Nothing for a pool the catalog does not list.
 */
export async function poolPageCharts(input: {
  pool: string
}): Promise<PoolCharts> {
  setCacheClass("series")
  const none: PoolCharts = { liquidity: null, volume: null }
  const address = input.pool.toLowerCase()
  if (!/^0x[0-9a-f]{40}$/.test(address)) return none
  const catalog = crossChainPools.find(
    (each) =>
      each.chain === "mezo" &&
      each.venue === "tigris" &&
      each.address.toLowerCase() === address,
  )
  const tokens =
    catalog === undefined ? null : pairTokens(pairOrder(catalog.pair))
  if (tokens === null) return none
  const at = nowSeconds()
  const both = (metric: string, days: number) =>
    Promise.all(
      tokens.map((each) =>
        readSeries({
          metric,
          dimension: `${address}:${each.token}`,
          days,
          now: at,
        }),
      ),
    )
  const [balances, volumes, prices] = await Promise.all([
    both(poolCharts.balance, liquidityDays),
    both(poolCharts.volume, poolDays),
    readDailyPrices(at, at - (liquidityDays - 1) * 86_400),
  ])
  const parts = (reads: typeof balances) => {
    const views = reads.map((read) => (read.status === "ok" ? read.data : null))
    return views.some((view) => view === null)
      ? null
      : tokens.map((token, index) => ({
          token: token.token,
          view: views[index] as SeriesView,
        }))
  }
  const levels = parts(balances)
  const flows = parts(volumes)
  const days = levels === null ? [] : pricedLevels(levels, prices)
  return {
    liquidity: days.length === 0 ? null : liquidityChart(days),
    volume:
      flows === null
        ? null
        : (volumeView(pricedDays(flows, prices), null, null)?.chart ?? null),
  }
}

export async function poolPage(input: {
  chain: PoolChain
  pool: string
}): Promise<PoolPage> {
  setCacheClass("fresh")
  const at = nowSeconds()
  const address = input.pool.toLowerCase()
  // A Mezo pool's own series start with the snapshot read, from the
  // catalog's pair and the URL's address; only its gauge waits.
  const catalog =
    input.chain === "mezo"
      ? crossChainPools.find(
          (each) =>
            each.chain === "mezo" &&
            each.venue === "tigris" &&
            each.address.toLowerCase() === address,
        )
      : undefined
  const tokens =
    catalog === undefined ? null : pairTokens(pairOrder(catalog.pair))
  const [pools, prices, series] = await Promise.all([
    readPools(),
    readPrices(),
    tokens === null ? null : readPoolSeries(address, tokens, at),
  ])
  if (pools.status !== "ok") {
    return { pool: failedSection(pools) }
  }
  const all = pools.data.data
  const pool = all.find(
    (each) => each.chain === input.chain && each.pool.toLowerCase() === address,
  )
  if (pool === undefined) return { pool: { status: "missing" } }
  const price = priceSection(prices, "musd")
  const headline =
    price.status === "ok" ? (price.data.headline?.text ?? null) : null
  if (series === null) {
    const detail = detailOf(pool, all, poolPrices(prices), headline)
    if (detail === null) return { pool: { status: "missing" } }
    return { pool: { status: "ok", data: detail } }
  }
  const gauge = pool.gauge?.address.toLowerCase() ?? null
  const volume =
    series.volume === null
      ? null
      : volumeView(series.volume, series.fees, series.reserves?.total ?? null)
  const liquidity =
    series.liquidity === null
      ? null
      : liquidityView(
          series.liquidity,
          series.dexTotal,
          {
            days: liquidityDays,
            from: dayOf(at - (liquidityDays - 1) * 86_400),
          },
          chartReserve,
        )
  const shown = onChain(pool, volume, series)
  const detail = detailOf(shown, all, poolPrices(prices), headline)
  if (detail === null) return { pool: { status: "missing" } }
  return {
    pool: {
      status: "ok",
      data: {
        ...detail,
        // Its share of every Mezo pool's liquidity from our own balances
        // (the per-token rollup), never against the snapshot's figures.
        share: liquidity?.share ?? null,
        rate7d: null,
        mezo: {
          liquidity: liquidity?.view ?? null,
          // The page writes the last day's fees as text; the rest of the
          // day's figures stay on the server.
          volume: volumeFigures(volume),
          reserves:
            series.reserves === null
              ? null
              : reservesView(
                  series.reserves.sides,
                  catalog?.feeBps == null
                    ? []
                    : [
                        {
                          label: "Swap fee",
                          value: `${formatDecimal(`${catalog.feeBps / 100}`, 2)}%`,
                        },
                      ],
                ),
          gauge,
        },
      },
    },
  }
}
