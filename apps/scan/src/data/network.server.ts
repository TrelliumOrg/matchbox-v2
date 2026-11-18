import type { ScanCrossChainPool } from "@matchbox/contracts/scan"
import { setCacheClass } from "../cache-class.server"
import type { PeriodInput, PeriodView } from "../explorer/voting/range"
import { canonicalQuery } from "./caller.server"
import { nowSeconds } from "./clock.server"
import type { Section } from "./explorer"
import type { Stat } from "./gauges.server"
import { type ActivityView, activityViews } from "./scan/activity-view"
import { titleOf } from "./scan/crosschain-views"
import {
  btcPart,
  partOn,
  peakDay,
  poolValuesOn,
  pricedSplit,
  splitPart,
  sumParts,
  sumUsd,
  type UsdDay,
  usdChart,
  wholeDays,
} from "./scan/market-views"
import {
  changeOver,
  changeStat,
  compactUsd,
  countAverage,
  countFigure,
  countPeak,
  flowSum,
  signedCompact,
  signedCount,
  statWindow,
  wholeAmount,
} from "./scan/network-views"
import {
  type Period,
  periodName,
  periodOf,
  periodPoints,
  periodSeries,
  periodView,
} from "./scan/period"
import {
  type DailyPrice,
  type DailyPrices,
  dayOf,
  decimalUsd,
  latestPrice,
  scaled,
  type Usd,
  usdDecimal,
  usdShort,
} from "./scan/pricing"
import { readScan } from "./scan/read.server"
import { scanSchemas } from "./scan/schemas"
import { metric } from "./scan/series"
import { readSeries, type SeriesView } from "./scan/series.server"
import {
  countText,
  dayLabel,
  latestOf,
  rangeDays,
  type SeriesPanelData,
  seriesPanel,
} from "./scan/series-views"
import { readMarkets, type SplitSeries } from "./scan/split.server"
import { tokenBySlug } from "./scan/token-list"
import { tokenLookup } from "./scan/tokens"
import { scanSection, shareBps } from "./scan/voting-views"

/**
 * The Network overview (`-5H-NByPdL`): total value locked now and its
 * split, addresses, daily active addresses, transactions per day, DEX
 * volume on Mezo's pools (the pool snapshot's latest day), MUSD's supply,
 * and the latest activity in plain words. USD from the stored daily closes. Every
 * read runs at once and degrades only its own panel. TVL and DEX volume
 * over the period come from the per-token pool rollups (`/markets`, one
 * read with the day's pools and the closes), priced at each day's close;
 * until the API serves them the panels fall back to the pool snapshot's
 * latest day. Left out until
 * their data exists: protocol fees by source, paid to veBTC voters (epoch totals do not
 * split voter sources; every voter's pay is on Gauges and Epochs), transactions per block and success rate,
 * active addresses over 30 days (not a sum of days), MUSD's peg and
 * savings vault share.
 */

/** Series the panels chart (one map, so a rename is one line). */
const charts = {
  addresses: metric("chain.addresses_total"),
  newAddresses: metric("chain.new_addresses"),
  active: metric("chain.active_addresses"),
  transactions: metric("chain.transactions"),
  transactionsTotal: metric("chain.transactions_total"),
  supply: metric("token.total_supply"),
  holders: metric("token.holders"),
  locked: metric("escrow.supply"),
  troveCollateral: metric("musd.trove_coll"),
}

/** The longest window a series is read for (seriesRanges.All). */
const allDays = rangeDays("All")

/** The fixture world's now in fixtures mode, else the clock. */
function now(): number {
  return nowSeconds()
}

export type NetworkOverview = {
  period: PeriodView
  now: number
  addresses: Section<SeriesPanelData>
  addressStats: Stat[]
  active: Section<SeriesPanelData>
  activeStats: Stat[]
  transactions: Section<SeriesPanelData>
  transactionStats: Stat[]
  musd: Section<SeriesPanelData>
  musdStats: Stat[]
  /** Total value locked and DEX volume, in the first paint. */
  values: NetworkValues
  activity: Section<{ rows: ActivityView[]; more: boolean }>
}

/** One part of total value locked. */
export type TvlPart = { label: string; value: string; bps: number }

export type TvlView = {
  /** "$214.6M" of the parts counted. */
  figure: string
  /** "+$43.6M in 90d": the history's change over the period. */
  change: string | null
  parts: TvlPart[]
  /** Parts whose figure did not read: the total leaves them out. */
  missing: string[]
  /**
   * The savings vault's figure, always beside the total: the total and the
   * chart are veBTC, trove collateral and DEX pools (the vault has no
   * history, and its MUSD is minted against trove BTC). Null when the vault
   * did not read.
   */
  apart: string | null
  /**
   * veBTC, trove collateral and DEX pools at each day's close over the
   * period, on the days every part is known; null until the rollups are
   * served. Its last day is the figure.
   */
  history: SeriesPanelData | null
  /** Pool tokens with no price, left out of the DEX part. */
  unpriced: string[]
}

/**
 * Left out of TVL by design: MEZO locked as veMEZO (about 1% of it; one
 * more read would take the loader over its budget).
 */
export const tvlLeftOut = ["veMEZO"] as const

function okData(section: Section<SeriesView>): SeriesView | null {
  return section.status === "ok" ? section.data : null
}

/**
 * New addresses over 7 and 30 days from the daily first-seen counts (a
 * backfill: its window counts back from where it ends, and says so), then
 * Blockscout's own total's change where its history reaches back that far.
 * The two count different things (transaction parties, every address
 * Blockscout has seen), so neither stands in for the other: while the
 * total is younger than a period, its change is left out rather than
 * shown as "not enough history" beside a figure that exists.
 */
function addressStats(
  total: Section<SeriesView>,
  fresh: Section<SeriesView>,
): Stat[] {
  // Blockscout's own total's change, where its history reaches back.
  const added: Stat[] = []
  const totals = okData(total)
  if (totals !== null) {
    for (const days of [7, 30]) {
      const change = changeOver(totals, days)
      if (change.status !== "ok") continue
      added.push({ label: `Added ${days}d`, value: signedCount(change.value) })
    }
  }
  // The first-seen counts count something else (transaction parties, a
  // backfill that ends): only while the total has no change of its own.
  if (added.length > 0) return added
  const stats: Stat[] = []
  const news = okData(fresh)
  if (news !== null) {
    const ends = news.endsOn === null ? null : dayLabel(news.endsOn)
    for (const days of [7, 30]) {
      const sum = flowSum(news, days)
      if (sum === null) continue
      stats.push({
        label: ends === null ? `New ${days}d` : `New ${days}d to ${ends}`,
        value: countFigure(sum),
      })
    }
  }
  return stats
}

function activeStats(active: Section<SeriesView>): Stat[] {
  const view = okData(active)
  if (view === null) return []
  const stats: Stat[] = []
  const week = countAverage(view, 7)
  if (week !== null)
    stats.push({ label: "7d average", value: countFigure(week) })
  const month = countAverage(view, 30)
  if (month !== null) {
    stats.push({ label: "30d average", value: countFigure(month) })
  }
  const peak = countPeak(view, 90)
  if (peak !== null) stats.push({ label: "90d high", value: countFigure(peak) })
  return stats
}

function transactionStats(
  daily: Section<SeriesView>,
  total: Section<SeriesView>,
  period: Period,
): Stat[] {
  const stats: Stat[] = []
  const view = okData(daily)
  if (view !== null) {
    const month = countAverage(view, 30)
    if (month !== null) {
      stats.push({ label: "30d average", value: countFigure(month) })
    }
    // The period's busiest day, from the daily counts (never a week's).
    const shown = okData(periodSeries(daily, period))
    const peak = shown === null ? null : countPeak(shown, period.days)
    if (peak !== null) {
      stats.push({
        label:
          period.range === null || period.range === "All"
            ? "Peak"
            : `${period.range} high`,
        value: countFigure(peak),
      })
    }
  }
  const allTime = latestOf(total, countText)
  if (allTime !== null) stats.push({ label: "All time", value: allTime.text })
  return stats
}

function musdStats(
  supply: Section<SeriesView>,
  holders: Section<SeriesView>,
): Stat[] {
  const stats: Stat[] = []
  const holderView = okData(holders)
  const latest = latestOf(holders, countText)
  if (latest !== null) stats.push({ label: "Holders", value: latest.text })
  if (holderView !== null) {
    const stat = changeStat(
      "Holders 30d",
      changeOver(holderView, 30),
      signedCount,
    )
    if (stat !== null) stats.push(stat)
  }
  const supplyView = okData(supply)
  if (supplyView !== null) {
    const stat = changeStat("Supply 30d", changeOver(supplyView, 30, 18), (v) =>
      signedCompact(v, 18, "MUSD"),
    )
    if (stat !== null) stats.push(stat)
  }
  return stats
}

/** A level series' latest amount at the latest close of its token. */
function levelUsd(
  section: Section<SeriesView>,
  closes: readonly DailyPrice[],
): Usd | null {
  const last = okData(section)?.points.at(-1)
  const close = latestPrice(closes)
  if (last === undefined || close === null) return null
  return decimalUsd(last.decimal, close.price)
}

/** Mezo's savings vault: a pool in the catalog, but not a swap pool. */
const savingsVenue = "mezo-savings"
const savingsLabel = "Savings vault"

/**
 * Total value locked on Mezo now: BTC locked as veBTC and BTC in troves
 * (at the latest daily BTC close), and the liquidity of Mezo's DEX pools
 * and the savings vault (the pool snapshot's latest day). MEZO locked as
 * veMEZO (about 1% of it) is left out: one more read would take the
 * loader over its budget. A part that did not read is named in `missing`, never counted as
 * zero; with none read there is no figure.
 */
export function tvlView(
  parts: { label: string; usd: Usd | null }[],
  history: {
    days: readonly UsdDay[]
    /** Each history part on its last day, in `days`' terms. */
    latest: { label: string; usd: Usd }[]
    unpriced: string[]
    /** "30d", "All", "1 Jan to 31 Mar"; a range's name says "in 30d". */
    name: string
    /** A custom span: the change runs from its first day to its last. */
    custom?: boolean
    /** The period's first day. */
    from: string
  } = { days: [], latest: [], unpriced: [], name: "30d", from: "" },
): TvlView | null {
  const first = history.days[0]
  const last = history.days.at(-1)
  const drawn =
    first !== undefined && last !== undefined && first !== last
      ? { first, last }
      : null
  const vault = parts.find((part) => part.label === savingsLabel)?.usd ?? null
  // With the history drawn, the figure is its last day: the same parts at
  // the same closes, so a hovered last day reads the headline. Without it
  // the vault stays apart too, so the figure means the same either way.
  const counted =
    drawn === null
      ? parts.filter(
          (part): part is { label: string; usd: Usd } =>
            part.usd !== null && part.label !== savingsLabel,
        )
      : history.latest
  if (counted.length === 0) return null
  const total = counted.reduce((sum, part) => sum + part.usd, 0n)
  return {
    figure: compactUsd(usdDecimal(total)),
    change:
      drawn === null
        ? null
        : `${signedUsd(drawn.last.usd - drawn.first.usd)} ${
            drawn.first.day === history.from && /^\d+d$/.test(history.name)
              ? `in ${history.name}`
              : history.custom
                ? `from ${dayLabel(drawn.first.day)} to ${dayLabel(drawn.last.day)}`
                : `since ${dayLabel(drawn.first.day)}`
          }`,
    history: drawn === null ? null : usdChart(history.days, "level"),
    unpriced: history.unpriced,
    apart: vault === null ? null : compactUsd(usdDecimal(vault)),
    parts: counted
      .sort((a, b) => (a.usd === b.usd ? 0 : a.usd > b.usd ? -1 : 1))
      .map((part) => ({
        label: part.label,
        value: compactUsd(usdDecimal(part.usd)),
        bps: shareBps(part.usd, total),
      })),
    missing: [
      ...parts
        .filter((part) => part.usd === null && part.label !== savingsLabel)
        .map((part) => part.label),
      ...tvlLeftOut,
    ],
  }
}

/** The Mezo pools' latest liquidity, swap pools and the vault apart. */
function poolLiquidity(pools: readonly ScanCrossChainPool[] | null): {
  dex: Usd | null
  savings: Usd | null
} {
  if (pools === null) return { dex: null, savings: null }
  let dex: Usd | null = null
  let savings: Usd | null = null
  for (const pool of pools) {
    if (pool.chain !== "mezo" || pool.tvl_usd === null) continue
    const usd = scaled(pool.tvl_usd)
    if (pool.venue === savingsVenue) {
      savings = (savings ?? 0n) + usd
    } else {
      dex = (dex ?? 0n) + usd
    }
  }
  return { dex, savings }
}

/** One Mezo pool's latest day of trading. */
export type DexPoolRow = {
  name: string
  volume: string
  /** 0 to 10,000 of the busiest pool's. */
  bps: number
}

export type DexView = {
  /** "$428k", the last day's volume across Mezo's pools. */
  figure: string
  /** "14 Nov": the day the figure is for. */
  day: string | null
  stats: Stat[]
  pools: DexPoolRow[]
  /** Volume per day over the period; null from the snapshot. */
  chart: SeriesPanelData | null
  /** Tokens or pools with no price, left out. */
  unpriced: string[]
  /** A custom span holds none of the volume days: "None in this period". */
  outside?: boolean
}

/**
 * DEX volume on Mezo from the pool snapshot (`/crosschain/pools`, the
 * latest day): the last day's volume across Mezo's swap pools, their last
 * 7 days where every pool has them, their liquidity, and each pool's day.
 * A pool with no figure is counted out and said so ("6 of 7 pools").
 */
export function dexView(pools: readonly ScanCrossChainPool[]): DexView | null {
  const mezo = pools.filter(
    (pool) => pool.chain === "mezo" && pool.venue !== savingsVenue,
  )
  const traded = mezo.filter((pool) => pool.volume_24h_usd !== null)
  if (traded.length === 0) return null
  const volumes = traded.map((pool) => ({
    pool,
    usd: scaled(pool.volume_24h_usd ?? "0"),
  }))
  const total = volumes.reduce((sum, each) => sum + each.usd, 0n)
  const busiest = volumes.reduce(
    // biome-ignore lint/complexity/useMathMinMax: bigint, Math.max takes numbers
    (max, each) => (each.usd > max ? each.usd : max),
    0n,
  )
  const stats: Stat[] = []
  if (mezo.every((pool) => pool.volume_7d_usd !== null)) {
    const week = mezo.reduce(
      (sum, pool) => sum + scaled(pool.volume_7d_usd ?? "0"),
      0n,
    )
    stats.push({ label: "7d", value: usdShort(week) })
  }
  const liquidity = poolLiquidity(pools).dex
  if (liquidity !== null) {
    stats.push({ label: "Liquidity", value: usdShort(liquidity) })
  }
  stats.push({
    label: "Pools",
    value:
      traded.length === mezo.length
        ? String(mezo.length)
        : `${traded.length} of ${mezo.length}`,
  })
  const days = traded
    .map((pool) => pool.day)
    .filter((day): day is string => day !== null)
    .sort()
  const day = days.at(-1)
  return {
    figure: usdShort(total),
    day: day === undefined ? null : dayLabel(day),
    stats,
    chart: null,
    unpriced: [],
    pools: volumes
      .sort((a, b) => (a.usd === b.usd ? 0 : a.usd > b.usd ? -1 : 1))
      .map((each) => ({
        name: titleOf(each.pool.pair, each.pool.kind, false, each.pool.id),
        volume: usdShort(each.usd),
        bps: shareBps(each.usd, busiest),
      })),
  }
}

/** "+$43.6M", "-$1,200": a USD change. */
function signedUsd(usd: Usd): string {
  if (usd === 0n) return "$0"
  const text = compactUsd(usdDecimal(usd < 0n ? -usd : usd))
  return `${usd < 0n ? "-" : "+"}${text}`
}

/**
 * DEX volume from the store (`ak42S52PlW`'s source for one pool, here for
 * all): the period's volume per day priced at each day's close, the last
 * whole day as the figure with each pool's share of it, the last 7 and 30
 * days, the busiest day, and the pools' liquidity now.
 */
export function ownDexView(input: {
  days: readonly UsdDay[]
  unpriced: string[]
  /** Each pool's volume in per token over the last days (a split). */
  pools: readonly SplitSeries[] | null
  prices: DailyPrices
  liquidity: Usd | null
  period: Period
}): DexView | null {
  // The figure is the last whole day shown, as the other panels' are: a
  // span's own last day, never one after it.
  const upTo =
    input.period.range === null
      ? input.days.filter((day) => day.day <= input.period.to)
      : input.days
  const last = wholeDays(upTo, 1).at(-1)
  if (last === undefined) {
    // Days exist, none in the span: the panel keeps its toggle and says
    // so, never the snapshot's latest day inside an older span.
    if (input.period.range === null && wholeDays(input.days, 1).length > 0) {
      return {
        figure: "",
        day: null,
        stats: [],
        chart: usdChart([], "flow"),
        unpriced: [],
        pools: [],
        outside: true,
      }
    }
    return null
  }
  const stats: Stat[] = []
  for (const count of [7, 30]) {
    const window = wholeDays(input.days, count)
    if (window.length === count) {
      stats.push({ label: `${count}d`, value: usdShort(sumUsd(window)) })
    }
  }
  const shown = periodPoints(input.days, input.period)
  const peak = peakDay(wholeDays(shown, shown.length))
  if (peak !== null) {
    stats.push({
      label: `Peak ${dayLabel(peak.day)}`,
      value: usdShort(peak.usd),
    })
  }
  if (input.liquidity !== null) {
    stats.push({ label: "Liquidity", value: usdShort(input.liquidity) })
  }
  // Each pool on the figure's day, so the list adds up to the figure.
  const byPool =
    input.pools === null
      ? null
      : poolValuesOn(input.pools, last.day, input.prices)
  const pools = byPool?.pools.filter((pool) => pool.usd > 0n) ?? []
  const busiest = pools[0]?.usd ?? 0n
  return {
    figure: usdShort(last.usd),
    day: dayLabel(last.day),
    stats,
    chart: usdChart(shown, "flow"),
    unpriced: [...new Set([...input.unpriced, ...(byPool?.unpriced ?? [])])],
    pools: pools.map((pool) => ({
      name: pool.name,
      volume: usdShort(pool.usd),
      bps: shareBps(pool.usd, busiest),
    })),
  }
}

export async function networkOverview(
  input: PeriodInput,
): Promise<NetworkOverview> {
  setCacheClass("list")
  const at = now()
  const period = periodOf(input, at)
  const statDays = statWindow(period.read)
  const musd = tokenBySlug("musd").address
  const series = (name: string, length: number, dimension = "") =>
    readSeries({ metric: name, dimension, days: length, now: at })
  const [
    addresses,
    newAddresses,
    active,
    transactions,
    transactionsTotal,
    supply,
    holders,
    activity,
    values,
  ] = await Promise.all([
    series(charts.addresses, statDays),
    // Backfill-only: read whole, then counted back from where it ends.
    series(charts.newAddresses, allDays),
    series(charts.active, allDays),
    series(charts.transactions, statDays),
    series(charts.transactionsTotal, 7),
    series(charts.supply, statDays, musd),
    series(charts.holders, statDays, musd),
    readScan(
      "activity",
      canonicalQuery({ limit: 10 }),
      scanSchemas.activityPage,
    ),
    networkValues(at, period),
  ])
  const context = { tokens: tokenLookup(), labels: {} }
  return {
    period: periodView(period, at),
    now: at,
    addresses: seriesPanel(periodSeries(addresses, period), countText),
    addressStats: addressStats(addresses, newAddresses),
    active: seriesPanel(periodSeries(active, period), countText),
    activeStats: activeStats(active),
    transactions: seriesPanel(periodSeries(transactions, period), countText),
    transactionStats: transactionStats(transactions, transactionsTotal, period),
    musd: seriesPanel(periodSeries(supply, period), (decimal) =>
      wholeAmount(decimal, "MUSD"),
    ),
    musdStats: musdStats(supply, holders),
    values,
    activity: scanSection(activity, (page) => ({
      rows: activityViews(page.data, context),
      more: page.nextCursor !== null,
    })),
  }
}

/** Network's value panels, read after first paint (`networkLater`). */
export type NetworkValues = {
  tvl: TvlView | null
  dex: Section<DexView | null>
}

/**
 * Total value locked and DEX volume, read beside the overview's other
 * reads: their figures lead the page, so they are in its first paint. The
 * per-token rollups give both over the period (`/markets`, one read); the
 * pool snapshot gives the savings vault, and the DEX figures while the
 * rollups are not served.
 */
async function networkValues(
  at: number,
  period: Period,
): Promise<NetworkValues> {
  // Read back to the period's first day; the charts show its days alone.
  const days = period.read
  const series = (name: string, dimension = "") =>
    readSeries({ metric: name, dimension, days, now: at })
  const [markets, crossPools, vebtc, troves] = await Promise.all([
    // The rollups, the day's pools and the closes, in one request.
    readMarkets({ days }),
    readScan(
      "crosschain/pools",
      new URLSearchParams(),
      scanSchemas.crossChainPools,
    ),
    series(charts.locked, "vebtc"),
    series(charts.troveCollateral),
  ])
  const market = markets.status === "ok" ? markets.data : null
  // Without /markets there are no closes: veBTC and trove collateral are
  // named as not counted rather than read in a second round, and DEX
  // pools and the vault come from the pool snapshot.
  const prices: DailyPrices = market?.prices ?? { btc: [], mezo: [] }
  const balances = market?.balances ?? null
  const snapshot = poolLiquidity(
    crossPools.status === "ok" ? crossPools.data.data : null,
  )
  const knownFrom = dayOf(at - (days - 1) * 86_400)
  const dex = balances === null ? null : pricedSplit(balances.series, prices)
  const dexNow = dex?.days.at(-1)?.usd ?? null
  const vebtcView = okData(vebtc)
  const troveView = okData(troves)
  const historyParts =
    dex !== null &&
    balances !== null &&
    vebtcView !== null &&
    troveView !== null
      ? [
          { label: "veBTC", part: btcPart(vebtcView, prices, knownFrom) },
          {
            label: "Trove collateral",
            part: btcPart(troveView, prices, knownFrom),
          },
          { label: "DEX pools", part: splitPart(balances, dex) },
        ]
      : []
  // The period's days; its last is the figure's (today's for a range).
  const history = periodPoints(
    sumParts(historyParts.map((each) => each.part)),
    period,
  )
  const lastDay = history.at(-1)?.day
  const latest =
    lastDay === undefined
      ? []
      : historyParts.map((each) => ({
          label: each.label,
          usd: partOn(each.part, lastDay),
        }))
  const volume =
    market === null ? null : pricedSplit(market.volume.series, prices)
  const own =
    volume === null
      ? null
      : ownDexView({
          days: volume.days,
          unpriced: volume.unpriced,
          pools: market?.pools.series ?? null,
          prices,
          liquidity: dexNow,
          period,
        })
  return {
    tvl: tvlView(
      [
        { label: "veBTC", usd: levelUsd(vebtc, prices.btc) },
        { label: "Trove collateral", usd: levelUsd(troves, prices.btc) },
        // Our pools' balances where the rollup is served, else the
        // snapshot's: one reading either way, never both.
        { label: "DEX pools", usd: dex === null ? snapshot.dex : dexNow },
        { label: savingsLabel, usd: snapshot.savings },
      ],
      {
        days: history,
        latest,
        unpriced: dex?.unpriced ?? [],
        name: periodName(period, at),
        custom: period.range === null,
        from: period.from,
      },
    ),
    dex:
      own !== null
        ? { status: "ok", data: own }
        : crossPools.status === "ok"
          ? { status: "ok", data: dexView(crossPools.data.data) }
          : scanSection(crossPools, () => null),
  }
}
