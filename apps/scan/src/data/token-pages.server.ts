import type { ScanEpochItem, ScanTokenListItem } from "@matchbox/contracts/scan"
import { epochIndexFor, epochStartOf } from "@matchbox/domain/epoch"
import {
  formatBtc,
  formatPrice,
  groupThousands,
  unitsToDecimal,
} from "@matchbox/domain/format"
import { setCacheClass } from "../cache-class.server"
import type { PeriodInput, PeriodView } from "../explorer/voting/range"
import { canonicalQuery } from "./caller.server"
import { nowSeconds } from "./clock.server"
import {
  hubOf,
  listSupply,
  type PageCrossChain,
  pageCrossChain,
  type TokenCrossChain,
  type TokenPools,
  tokenCrossChain,
} from "./crosschain.server"
import type { Section } from "./explorer"
import { type EmissionsView, emissionsView, type Stat } from "./gauges.server"
import type { PriceView, SupplyView } from "./scan/crosschain-views"
import { latestDayOf, tokenInPools } from "./scan/market-views"
import {
  changeOver,
  changeStat,
  compactAmount,
  compactUsd,
  flowSum,
  lastDays,
  type PriceFacts,
  type PricePoint,
  priceFacts,
  pricePanel,
  priceRange,
  scaledDecimal,
  shortHistory,
  signedCompact,
  signedCount,
  statWindow,
  usdValue,
  wholeAmount,
} from "./scan/network-views"
import { type Period, periodOf, periodSeries, periodView } from "./scan/period"
import {
  amountUsd,
  dayOf,
  epochPriceDay,
  mezoToken,
  tokenBySymbol,
  usdCompact,
} from "./scan/pricing"
import { readScan, type ScanRead } from "./scan/read.server"
import { scanSchemas } from "./scan/schemas"
import { metric } from "./scan/series"
import { readSeries, type SeriesView } from "./scan/series.server"
import {
  countText,
  dayLabel,
  latestOf,
  type SeriesPanelData,
  seriesPanel,
} from "./scan/series-views"
import { readSplit, type SplitView } from "./scan/split.server"
import {
  type ListedToken,
  listedTokens,
  type TokenSlug,
  tokenBySlug,
} from "./scan/token-list"
import {
  dollarsOverTime,
  type ValuedToken,
  type ValueView,
  valueOnMezo,
} from "./scan/value-views"
import {
  failedSection,
  percentText,
  scanSection,
  shareBps,
} from "./scan/voting-views"

/**
 * The Tokens pages: the list (`PnId7WLIDs`, from `/tokens`) and the MUSD
 * (`iuXYHNtoLX`) and MEZO (`ZaITnY1T_X`) pages, from the daily series
 * (supply, holders, mints and burns, the savings vault, troves, veMEZO)
 * and the daily BTC and MEZO prices. USD only where the API prices a
 * token (`priced_as`), and the list says when that price is BTC's or
 * MEZO's or $1 taken for a dollar token; the token pages price only MEZO
 * by its own price. Every read runs at once and degrades only its own
 * panel or cell.
 */

/** Series the pages chart (one map, so a rename is one line). */
const charts = {
  supply: metric("token.total_supply"),
  holders: metric("token.holders"),
  minted: metric("token.minted"),
  burned: metric("token.burned"),
  troveCollateral: metric("musd.trove_coll"),
  savingsNet: metric("savings.net"),
  savingsDeposited: metric("savings.deposited"),
  savingsWithdrawn: metric("savings.withdrawn"),
  savingsYield: metric("savings.yield_claimed"),
  locked: metric("escrow.supply"),
  holdersReplayed: metric("token.holders_replayed"),
  stabilityPool: metric("musd.stability_pool"),
  borrowed: metric("musd.borrowed"),
  repaid: metric("musd.repaid"),
  redeemed: metric("musd.redeemed"),
  liquidated: metric("musd.liquidated"),
  poolBalances: metric("pool.balance"),
  inPools: metric("pool.token_balance"),
}

/**
 * Days a backfill-only flow (MUSD minted, burned) is read: its 30 day sum
 * while the backfill ended within the last month.
 */
const backfillDays = 60

/**
 * Days of the replayed holder count read: enough for its 30 day change
 * when the backfill ended within the last two weeks. One that ended
 * earlier gives no change, rather than a long read on every page view.
 */
const replayedDays = 45

/** The fixture world's now in fixtures mode, else the clock. */
function now(): number {
  return nowSeconds()
}

const day = (seconds: number) =>
  new Date(seconds * 1000).toISOString().slice(0, 10)

function okData(section: Section<SeriesView>): SeriesView | null {
  return section.status === "ok" ? section.data : null
}

const tone = (value: bigint): "pos" | "neg" => (value < 0n ? "neg" : "pos")

/** The daily BTC or MEZO price over the last `days` days. */
function readPrices(
  token: "btc" | "mezo",
  days: number,
  at: number,
): Promise<
  ScanRead<{ data: { points: PricePoint[]; firstDay: string | null } }>
> {
  return readScan(
    `prices/${token}`,
    canonicalQuery({ from: day(at - (days - 1) * 86_400), to: day(at) }),
    scanSchemas.prices,
  )
}

/** "+0.0310 BTC" from 18-decimal units. */
function signedBtc(value: bigint): string {
  const text = formatBtc(unitsToDecimal(value.toString(), 18)).text
  return value > 0n ? `+${text}` : text
}

// -- the list ---------------------------------------------------------------

/** A figure the list could not give: no row yet, or no decimals to read it. */
export type Missing = "not-yet" | "unknown"

export type TokenRow = {
  address: string
  /** The symbol, else null (shown by address). */
  symbol: string | null
  /** CoinGecko's name where we list it, else the API's. */
  name: string | null
  /** The bundled coin's ticker, else the symbol. */
  ticker: string
  /** Its page under /tokens, or null for the address page. */
  slug: TokenSlug | null
  /**
   * "$105,710" and what it is: the token's own daily price (BTC, MEZO),
   * BTC's or MEZO's price for a token priced as one, or $1 taken for a
   * dollar token (the API's `priced_as: usd`), or the token's own market
   * price (`priced_as: market`: MUSD's venue median). Null when unpriced.
   */
  price: {
    text: string
    basis: "own" | "btc" | "mezo" | "assumed" | "market" | "usdc" | "usdt"
    /** MEZO's own price: its source, CoinGecko or its Aerodrome fallback. */
    source: string | null
  } | null
  /**
   * MUSD with no price of ours: the API's $1 or CoinGecko fallback is
   * never shown as MUSD's price. The list says "not counted yet".
   */
  priceMissing: boolean
  /** The chains it is on, Mezo first (MUSD and MEZO are bridged). */
  chains: string[]
  /** "85.0% on Mezo": the rest is bridged out, inside the lock. */
  onMezo: string | null
  /**
   * The own price against 7 days before; "short" while the price history
   * is younger than that; null without an own price.
   */
  week: { text: string; tone: "pos" | "neg" } | "short" | null
  /** "19.04M MUSD" at the latest close. */
  supply: string | Missing
  /** The supply in USD at that price ("$205.8M"). */
  supplyUsd: string | null
  /** "42,273" at the latest close. */
  holders: string | Missing
}

/** The dollar tokens the stablecoins panel counts, MUSD first. */
const stablecoinSymbols = ["MUSD", "mUSDC", "mUSDT"] as const

/** Days the stablecoins chart draws (its 30 day change reads back too). */
const stablecoinDays = 90

/**
 * Receipts and wrappers of tokens already counted: xSolvBTC wraps
 * mSolvBTC, the liquid locks hold BTC and MEZO, sMUSD holds MUSD. Value on
 * Mezo leaves them out so nothing is counted twice.
 */
const wrappers: ReadonlySet<string> = new Set([
  "mxSolvBTC",
  "avBTCm",
  "avMEZOm",
  "sMUSD",
])

/** A token's supply and USD now, by the list's own pricing rules. */
function valuedToken(item: ScanTokenListItem): ValuedToken | null {
  if (item.supply === null || item.decimals === null) return null
  const symbol = item.symbol ?? null
  if (symbol === null || wrappers.has(symbol)) return null
  const listed = listedTokens.find((token) => token.address === item.address)
  return {
    symbol,
    ticker: listed?.ticker ?? coinTickers[symbol] ?? symbol,
    amount: unitsToDecimal(item.supply.value, item.decimals),
    // MUSD only at our venue price, as the list shows it (never $1 taken).
    usd: basisOf(item) === null ? null : item.supply_usd,
  }
}

/**
 * The dollar tokens on Mezo: each one's supply now at its price now, and
 * every day of the last 90 at today's prices. MUSD counts only with our
 * venue price. Null when none of them has a price.
 */
function stablecoinsView(
  items: readonly ScanTokenListItem[],
  reads: readonly (Section<SeriesView> | null)[],
): TokensPage["stablecoins"] {
  const uncounted: string[] = []
  const parts = stablecoinSymbols.flatMap((symbol, index) => {
    const item = items.find((each) => each.symbol === symbol)
    if (item === undefined || item.supply === null) return []
    if (
      item.price_usd === null ||
      basisOf(item) === null ||
      item.supply_usd === null
    ) {
      uncounted.push(symbol)
      return []
    }
    const read = reads[index] ?? null
    return [
      {
        symbol,
        price: item.price_usd,
        usd: scaledDecimal(item.supply_usd, 18),
        view: read === null ? null : okData(read),
      },
    ]
  })
  if (parts.length === 0) return null
  const total = parts.reduce((sum, part) => sum + part.usd, 0n)
  const stats: Stat[] = []
  const musd = parts.find((part) => part.symbol === "MUSD")
  if (musd !== undefined && total > 0n) {
    stats.push({
      label: "MUSD share",
      value: percentText(shareBps(musd.usd, total)),
    })
  }
  for (const part of parts) {
    if (part.symbol === "MUSD") continue
    stats.push({
      label: part.symbol,
      value: compactUsd(unitsToDecimal(part.usd.toString(), 18)),
    })
  }
  const history = dollarsOverTime(parts)
  if (history !== null) {
    const change = changeStat("Change 30d", changeOver(history, 30, 18), (v) =>
      v < 0n
        ? `-${compactUsd(unitsToDecimal((-v).toString(), 18))}`
        : `+${compactUsd(unitsToDecimal(v.toString(), 18))}`,
    )
    if (change !== null) stats.push(change)
  }
  const data: Section<SeriesPanelData> =
    history === null
      ? { status: "unavailable" }
      : seriesPanel({ status: "ok", data: history }, compactUsd)
  return {
    figure: compactUsd(unitsToDecimal(total.toString(), 18)),
    data,
    stats: stats.slice(0, 4),
    uncounted,
  }
}

/** The list's orders: the registry's, value on Mezo, holders. */
export type TokenSort = "listed" | "value" | "holders"

export function tokenSortOf(value: unknown): TokenSort {
  return value === "value" || value === "holders" ? value : "listed"
}

export type TokensPage = {
  sort: TokenSort
  /** What the priced tokens on Mezo are worth now. */
  value: ValueView | null
  /** The dollar tokens on Mezo over time, at today's prices. */
  stablecoins: {
    figure: string
    data: Section<SeriesPanelData>
    stats: Stat[]
    /** Dollar tokens with a supply but no price of ours: not counted. */
    uncounted: string[]
  } | null
  /**
   * `tracked`: the tokens with a daily supply or holder count (the jobs
   * Worker reads only a few); the rest are the API's registry only.
   */
  table: Section<{ rows: TokenRow[]; incomplete: boolean; tracked: number }>
}

/** The bundled coins under another symbol (Mezo's bridged wrappers). */
const coinTickers: Readonly<Record<string, string>> = {
  mSolvBTC: "SolvBTC",
  mxSolvBTC: "xSolvBTC",
}

const musdAddress = "0xdd468a1ddc392dcdbef6db6e34e89aa338f9f186"

function basisOf(
  item: ScanTokenListItem,
): NonNullable<TokenRow["price"]>["basis"] | null {
  if (item.priced_as === null) return null
  // MUSD is priced only by our venues, never at $1 or by CoinGecko alone.
  if (item.address === musdAddress) {
    return item.priced_as === "market" && item.price_source === "venues"
      ? "market"
      : null
  }
  if (item.priced_as === "usd") {
    if (item.symbol === "mUSDC") return "usdc"
    if (item.symbol === "mUSDT") return "usdt"
    return "assumed"
  }
  if (item.priced_as === "market") return "market"
  const own = item.priced_as === "btc" ? "BTC" : "MEZO"
  return item.symbol === own ? "own" : item.priced_as
}

function tokenRow(
  item: ScanTokenListItem,
  weeks: { btc: PriceFacts | null; mezo: PriceFacts | null },
  supplies: Record<TokenSlug, SupplyView> | null,
): TokenRow {
  const listed = listedTokens.find((token) => token.address === item.address)
  const symbol = item.symbol ?? listed?.symbol ?? null
  const basis = basisOf(item)
  const own =
    basis === "own" && (item.priced_as === "btc" || item.priced_as === "mezo")
      ? weeks[item.priced_as]
      : null
  const supply: TokenRow["supply"] =
    item.supply === null
      ? "not-yet"
      : item.decimals === null
        ? "unknown"
        : compactAmount(
            unitsToDecimal(item.supply.value, item.decimals),
            symbol ?? "",
          ).trim()
  return {
    address: item.address,
    symbol,
    name: listed?.name ?? item.name,
    ticker: listed?.ticker ?? coinTickers[symbol ?? ""] ?? symbol ?? "?",
    slug: listed?.slug ?? null,
    price:
      basis === null || item.price_usd === null
        ? null
        : {
            text: formatPrice(item.price_usd),
            basis,
            source:
              basis === "own" ? priceSourceLabel(item.price_source) : null,
          },
    priceMissing:
      item.address === musdAddress &&
      (basis === null || item.price_usd === null),
    chains: chainsOf(listed?.slug ?? null),
    onMezo: onMezoOf(listed?.slug ?? null, supplies),
    week: own?.week ?? null,
    supply,
    supplyUsd:
      basis === null || item.supply_usd === null
        ? null
        : compactUsd(item.supply_usd),
    holders:
      item.holders === null
        ? "not-yet"
        : groupThousands(BigInt(item.holders.value)),
  }
}

const bridgedChains: Record<TokenSlug, string[]> = {
  musd: ["Mezo", "Ethereum", "Base"],
  mezo: ["Mezo", "Ethereum", "Base", "BNB Chain"],
}

function chainsOf(slug: TokenSlug | null): string[] {
  return slug === null ? ["Mezo"] : bridgedChains[slug]
}

function onMezoOf(
  slug: TokenSlug | null,
  supplies: Record<TokenSlug, SupplyView> | null,
): string | null {
  if (slug === null || supplies === null) return null
  const mezo = supplies[slug].rows.find((row) => row.chain === "mezo")
  return mezo === undefined ? null : `${mezo.share} on Mezo`
}

/** Listed tokens first, in their order, then the rest as the API lists them. */
function listOrder(a: ScanTokenListItem, b: ScanTokenListItem): number {
  const rank = (item: ScanTokenListItem) => {
    const index = listedTokens.findIndex(
      (token) => token.address === item.address,
    )
    return index === -1 ? listedTokens.length : index
  }
  return rank(a) - rank(b)
}

/** Largest first, exactly; a token without the figure after the rest. */
function byFigure(
  figure: (item: ScanTokenListItem) => bigint | null,
): (a: ScanTokenListItem, b: ScanTokenListItem) => number {
  return (a, b) => {
    const left = figure(a)
    const right = figure(b)
    if (left === null || right === null) {
      return left === right ? listOrder(a, b) : left === null ? 1 : -1
    }
    if (left !== right) return left > right ? -1 : 1
    return listOrder(a, b)
  }
}

const sorts: Record<
  TokenSort,
  (a: ScanTokenListItem, b: ScanTokenListItem) => number
> = {
  listed: listOrder,
  value: byFigure((item) =>
    item.supply_usd === null ? null : scaledDecimal(item.supply_usd, 18),
  ),
  holders: byFigure((item) =>
    item.holders === null ? null : BigInt(item.holders.value),
  ),
}

/**
 * Three reads: `/tokens` (every token's latest supply, holders and price
 * in one D1 batch) and the BTC and MEZO daily prices, for the 7 day change
 * the list route does not carry. A failed price read only drops that
 * change. `sort` orders the rows: the registry's order, value on Mezo
 * (USD, where the API prices it) or holders, largest first.
 */
export async function tokensPage(
  input: { sort?: TokenSort } = {},
): Promise<TokensPage> {
  const sort = tokenSortOf(input.sort)
  setCacheClass("fresh")
  const at = now()
  // The price a week before the latest close, with a week to spare for a
  // close that is days old.
  const days = 15
  const dollarSeries = Promise.all(
    stablecoinSymbols.map((symbol) => {
      const address = tokenBySymbol(symbol)
      return address === null
        ? Promise.resolve(null)
        : readSeries({
            metric: charts.supply,
            dimension: address,
            days: stablecoinDays,
            now: at,
          })
    }),
  )
  const [list, btcPrice, mezoPrice, supplies, dollars] = await Promise.all([
    readScan("tokens", new URLSearchParams(), scanSchemas.tokenList),
    readPrices("btc", days, at),
    readPrices("mezo", days, at),
    listSupply(),
    dollarSeries,
  ])
  if (list.status !== "ok") {
    return {
      sort,
      value: null,
      stablecoins: null,
      table: failedSection(list),
    }
  }
  const weeks = {
    btc:
      btcPrice.status === "ok"
        ? priceFacts(btcPrice.data.data.points, btcPrice.data.data.firstDay)
        : null,
    mezo:
      mezoPrice.status === "ok"
        ? priceFacts(mezoPrice.data.data.points, mezoPrice.data.data.firstDay)
        : null,
  }
  const rows = [...list.data.data]
    .sort(sorts[sort])
    .map((item) => tokenRow(item, weeks, supplies))
  const valued = list.data.data.map(valuedToken)
  return {
    sort,
    value: valueOnMezo(
      valued.flatMap((token) => (token === null ? [] : [token])),
    ),
    stablecoins: stablecoinsView(list.data.data, dollars),
    table: {
      status: "ok",
      data: {
        rows,
        incomplete: btcPrice.status !== "ok" || mezoPrice.status !== "ok",
        tracked: rows.filter(
          (row) => row.supply !== "not-yet" || row.holders !== "not-yet",
        ).length,
      },
      ...(list.skipped > 0 ? { skipped: list.skipped } : {}),
    },
  }
}

// -- MUSD and MEZO ----------------------------------------------------------

export type TokenPanel = {
  id: string
  label: string
  data: Section<SeriesPanelData>
  stats: Stat[]
  empty: string
}

/** A header figure, with its change where one is known. */
export type Fact = {
  label: string
  value: string
  change: { text: string; tone: "pos" | "neg" } | null
  /**
   * A quiet line under the figure ("All chains, counted once"); a price's
   * names its source first.
   */
  note: string | { source: string; rest: string } | null
}

const aerodromeLabel = "Aerodrome MEZO/MUSD on Base"

/**
 * MEZO's price source as its label: CoinGecko or the Aerodrome pool it
 * falls back to; null for any other source, which is named another way.
 */
export function priceSourceLabel(source: string | null): string | null {
  if (source === "coingecko") return "CoinGecko"
  if (source === "aerodrome-cl") return aerodromeLabel
  return null
}

export type TokenPage = {
  slug: TokenSlug
  period: PeriodView
  token: Omit<ListedToken, "price" | "slug">
  /** The header's figures, under the name. */
  facts: Fact[]
  panels: TokenPanel[]
  /** Shares of a whole now: where MUSD sits, MEZO's supply and emissions. */
  splits: SplitPanel[]
  /** MUSD: more panels load after first paint (`musdLater`). */
  later: boolean
  /** MEZO only: emissions per epoch (`/epochs`). */
  emissions: Section<EmissionsView | null> | null
  /** Price by venue, supply by chain, its pools and the bridge. */
  crossChain: PageCrossChain
}

/** A whole split into parts now, with its stats (no chart). */
export type SplitPanel = {
  id: string
  label: string
  aside: string | null
  figure: string
  note: string | null
  segments: { label: string; value: string; bps: number }[]
  /** The parts add up to more than the whole: said, not scaled to fit. */
  mismatch: string | null
  stats: Stat[]
}

/**
 * Parts of a whole, the rest of the whole as `rest`. Shares are of the
 * whole as read; when the parts exceed it (figures of different days),
 * that is said in `mismatch` rather than the shares scaled to fit.
 */
function splitOf(
  whole: bigint,
  parts: readonly { label: string; value: bigint }[],
  rest: string | null,
  format: (value: bigint) => string,
  wholeName = "supply",
): { segments: SplitPanel["segments"]; mismatch: string | null } {
  const counted = parts.reduce((sum, part) => sum + part.value, 0n)
  const over = counted > whole
  const all = [
    ...parts,
    ...(rest === null || over ? [] : [{ label: rest, value: whole - counted }]),
  ]
  return {
    segments: all.map((part) => ({
      label: part.label,
      value: format(part.value),
      // Shares of the whole as read, even when the parts exceed it.
      bps: shareBps(part.value, whole),
    })),
    mismatch: over
      ? `Parts exceed ${wholeName} by ${format(counted - whole)}`
      : null,
  }
}

/** 18-decimal units as a compact whole amount ("4.92M MUSD"). */
function compactUnits(units: bigint, symbol: string): string {
  return compactAmount(unitsToDecimal(units.toString(), 18), symbol)
}

function panel(
  id: string,
  label: string,
  data: Section<SeriesPanelData>,
  stats: Stat[],
  empty: string,
): TokenPanel {
  return { id, label, data, stats, empty }
}

/** "Minted 30d to 31 Oct": a backfill-only total names where it ends. */
function backfillLabel(label: string, view: SeriesView): string {
  return view.endsOn === null ? label : `${label} to ${dayLabel(view.endsOn)}`
}

function changeStats(
  view: SeriesView | null,
  periods: readonly number[],
  places: number,
  format: (value: bigint) => string,
  label: (days: number) => string,
): Stat[] {
  if (view === null) return []
  const stats: Stat[] = []
  for (const days of periods) {
    const stat = changeStat(label(days), changeOver(view, days, places), format)
    if (stat !== null) stats.push(stat)
  }
  return stats
}

/** "+1,284 30d": a count's change over `days`, for a header figure. */
function countChange(view: SeriesView | null, days: number): Fact["change"] {
  // Only a change the series reaches back for: none while it is younger.
  const change = view === null ? null : changeOver(view, days)
  if (change?.status !== "ok") return null
  return {
    text: `${signedCount(change.value)} ${days}d`,
    tone: tone(change.value),
  }
}

/**
 * New holders over 7 and 30 days: Blockscout's count where its history
 * reaches back that far, else the replayed balances' count (a backfill,
 * counted back from where it ends and saying so). The two count holders
 * differently, so a period takes one or the other, never a mix.
 */
function holderStats(
  holders: Section<SeriesView>,
  replayed: Section<SeriesView> | null = null,
): Stat[] {
  const live = okData(holders)
  const backfill = replayed === null ? null : okData(replayed)
  const stats: Stat[] = []
  for (const days of [7, 30]) {
    const label = `New ${days}d`
    const change = live === null ? null : changeOver(live, days)
    if (change?.status === "ok") {
      stats.push({
        label,
        value: signedCount(change.value),
        tone: tone(change.value),
      })
      continue
    }
    const fallback = backfill === null ? null : changeOver(backfill, days)
    if (backfill !== null && fallback?.status === "ok") {
      stats.push({
        label: backfillLabel(label, backfill),
        value: signedCount(fallback.value),
        tone: tone(fallback.value),
      })
      continue
    }
    if (change?.status === "short") stats.push({ label, value: shortHistory })
  }
  return stats
}

/**
 * The live headline price: ours for MUSD ("On chain"), MEZO's named by its
 * source (CoinGecko, or the Aerodrome fallback).
 */
function priceFact(price: Section<PriceView>): Fact | null {
  if (price.status !== "ok" || price.data.headline === null) return null
  const { headline, asset, basis } = price.data
  const rest = headline.stale
    ? `delayed, read ${headline.at}`
    : headline.at.replace(/^\w+ /, "")
  const source = asset === "musd" ? null : priceSourceLabel(basis)
  return {
    label: "Price",
    value: headline.text,
    change: null,
    note: source === null ? `On chain, ${rest}` : { source, rest },
  }
}

/** What sits on other chains, inside the bridge's lock. */
function elsewhereFact(
  supply: Section<SupplyView>,
  label: string,
): Fact | null {
  const elsewhere = supply.status === "ok" ? supply.data.elsewhere : null
  if (elsewhere === null) return null
  return {
    label,
    value: elsewhere.compact,
    change: null,
    note: `${elsewhere.share} of supply`,
  }
}

/** Liquidity in the token's pools on every chain, each pool once. */
function liquidityFact(pools: Section<TokenPools>): Fact | null {
  const liquidity = pools.status === "ok" ? pools.data.liquidity : null
  if (liquidity === null) return null
  return {
    label: "Pool liquidity",
    value: liquidity.text,
    change: null,
    note:
      liquidity.pools < liquidity.of
        ? `${liquidity.pools} of ${liquidity.of} pools counted`
        : `${liquidity.pools} pools, ${liquidity.chains} ${liquidity.chains === 1 ? "chain" : "chains"}`,
  }
}

async function musdPage(period: Period, at: number): Promise<TokenPage> {
  const token = tokenBySlug("musd")
  const statDays = statWindow(period.read)
  const series = (name: string, length: number, dimension = "") =>
    readSeries({ metric: name, dimension, days: length, now: at })
  const [crossChain, supply, holders, minted, burned, collateral] =
    await Promise.all([
      tokenCrossChain("musd", period),
      series(charts.supply, statDays, token.address),
      series(charts.holders, statDays, token.address),
      // Backfill-only: counted back from where they end, which is within
      // the window while the backfill is recent; else no figure.
      series(charts.minted, backfillDays, token.address),
      series(charts.burned, backfillDays, token.address),
      series(charts.troveCollateral, statDays),
    ])
  const replayed = await replayedIfShort(holders, token.address, at)
  const musd = (decimal: string) => wholeAmount(decimal, "MUSD")
  const btc = (decimal: string) => formatBtc(decimal).text

  const supplyStats = changeStats(
    okData(supply),
    [30],
    18,
    (value) => signedCompact(value, 18, "MUSD"),
    () => "Change 30d",
  )
  for (const [label, read] of [
    ["Minted 30d", minted],
    ["Burned 30d", burned],
  ] as const) {
    const view = okData(lastDays(read, 30))
    if (view === null) continue
    const sum = flowSum(view, 30, 18)
    if (sum === null) continue
    supplyStats.push({
      label: backfillLabel(label, view),
      value: compactAmount(unitsToDecimal(sum.toString(), 18), "MUSD"),
    })
  }

  const facts: Fact[] = []
  const price = priceFact(crossChain.price)
  if (price !== null) facts.push(price)
  const lastSupply = latestOf(supply, musd)
  if (lastSupply !== null) {
    // Mezo's total supply: every chain, the bridged part counted once.
    facts.push({
      label: "Supply",
      value: lastSupply.text,
      change: null,
      note: "All chains, counted once",
    })
  }
  const bridged = elsewhereFact(crossChain.supply, "On Ethereum and Base")
  if (bridged !== null) facts.push(bridged)
  const holderCount = latestOf(holders, countText)
  if (holderCount !== null) {
    facts.push({
      label: "Holders on Mezo",
      value: holderCount.text,
      change: countChange(okData(holders), 30),
      note: null,
    })
  }
  const liquidity = liquidityFact(crossChain.pools)
  if (liquidity !== null) facts.push(liquidity)
  const backing = latestOf(collateral, btc)
  if (backing !== null) {
    // Troves hold a small part of MUSD's supply: not "backed by".
    facts.push({
      label: "Collateral in troves",
      value: backing.text,
      change: null,
      note: null,
    })
  }

  const { price: _price, slug: _slug, ...identity } = token
  return {
    slug: "musd",
    period: periodView(period, at),
    token: identity,
    crossChain: pageCrossChain(crossChain),
    facts,
    panels: [
      panel(
        "supply",
        "MUSD supply",
        seriesPanel(periodSeries(supply, period), musd),
        supplyStats,
        "No supply yet",
      ),
      panel(
        "holders",
        "Holders",
        seriesPanel(periodSeries(holders, period), countText),
        holderStats(holders, replayed),
        "No holders yet",
      ),
      panel(
        "collateral",
        "Trove collateral",
        seriesPanel(periodSeries(collateral, period), btc),
        changeStats(okData(collateral), [7, 30], 18, signedBtc, (span) =>
          span === 7 ? "Change 7d" : "Change 30d",
        ),
        "No troves yet",
      ),
    ],
    // The savings vault and where MUSD sits load after first paint
    // (`musdLater`): their six reads would take this loader past budget.
    splits: [],
    later: true,
    emissions: null,
  }
}

/** MUSD's panels read after first paint, so the page's loader stays fast. */
export type MusdLater = { panels: TokenPanel[]; splits: SplitPanel[] }

/**
 * The savings vault (net per day, deposited, withdrawn and yield claimed
 * over 30 days), MUSD borrowed from and repaid to troves per day (the
 * copy step's split of each trove event's debt change), MUSD in DEX pools
 * per day (the per-token rollup), and where MUSD sits (Mezo's supply
 * reading, the Stability Pool's close and each pool's MUSD at the latest
 * close), for the MUSD page once it has painted.
 */
export async function musdLater(input: PeriodInput): Promise<MusdLater> {
  setCacheClass("fresh")
  const at = now()
  const period = periodOf(input, at)
  const statDays = statWindow(period.read)
  const series = (name: string, length: number, dimension = "") =>
    readSeries({ metric: name, dimension, days: length, now: at })
  const musdToken = tokenBySlug("musd").address
  const [
    net,
    deposited,
    withdrawn,
    claimed,
    stability,
    supply,
    totals,
    btc,
    collateral,
    borrowed,
    repaid,
    redeemed,
    liquidated,
    inPools,
    pools,
  ] = await Promise.all([
    series(charts.savingsNet, statDays),
    series(charts.savingsDeposited, statDays),
    series(charts.savingsWithdrawn, statDays),
    series(charts.savingsYield, statDays),
    series(charts.stabilityPool, 7),
    readScan(
      "crosschain/supply",
      canonicalQuery({ days: 30 }),
      scanSchemas.crossChainSupply,
    ),
    readScan("borrow/totals", new URLSearchParams(), scanSchemas.borrowTotals),
    readPrices("btc", 7, at),
    series(charts.troveCollateral, 7),
    series(charts.borrowed, statDays),
    series(charts.repaid, statDays),
    series(charts.redeemed, statDays),
    series(charts.liquidated, statDays),
    series(charts.inPools, statDays, musdToken),
    // Each pool's balances on the last two days: the latest close.
    readSplit({ metric: charts.poolBalances, days: 2, now: at }),
  ])
  const musd = (decimal: string) => wholeAmount(decimal, "MUSD")
  const byPool = musdInPools(pools, musdToken)
  const savingsStats: Stat[] = []
  for (const [label, read] of [
    ["Deposited 30d", deposited],
    ["Withdrawn 30d", withdrawn],
    ["Yield claimed 30d", claimed],
  ] as const) {
    const view = okData(read)
    const sum = view === null ? null : flowSum(view, 30, 18)
    if (sum !== null) {
      savingsStats.push({
        label,
        value: compactAmount(unitsToDecimal(sum.toString(), 18), "MUSD"),
      })
    }
  }
  return {
    panels: [
      panel(
        "savings",
        "Net into the savings vault per day",
        seriesPanel(periodSeries(net, period), (decimal) =>
          scaledDecimal(decimal, 18) > 0n ? `+${musd(decimal)}` : musd(decimal),
        ),
        savingsStats,
        "No deposits yet",
      ),
      ...troveFlowPanels(
        { borrowed, repaid, redeemed, liquidated },
        period,
        totals.status === "ok" && totals.data.data.venues.troves.status === "ok"
          ? totals.data.data.venues.troves.data.open
          : null,
        at,
      ),
      panel(
        "pools",
        "MUSD in DEX pools",
        seriesPanel(periodSeries(inPools, period), musd),
        changeStats(
          okData(inPools),
          [7, 30],
          18,
          (value) => signedCompact(value, 18, "MUSD"),
          (span) => `Change ${span}d`,
        ),
        "No MUSD in pools yet",
      ),
    ],
    splits: [
      ...musdSits({
        pools: byPool,
        stability,
        hub: supply.status === "ok" ? hubOf(supply.data.data.musd) : null,
        troves:
          totals.status === "ok" &&
          totals.data.data.venues.troves.status === "ok"
            ? totals.data.data.venues.troves.data
            : null,
        collateral: okData(collateral)?.points.at(-1)?.decimal ?? null,
        btc:
          btc.status === "ok"
            ? (btc.data.data.points.at(-1)?.price ?? null)
            : null,
      }),
      ...musdByPool(byPool),
    ],
  }
}

/**
 * Where MUSD sits now, from Mezo's own supply reading (its total supply
 * and what the bridge holds locked for the other chains, one reading) and
 * the Stability Pool's close: in the Stability Pool, bridged to other
 * chains, and on Mezo otherwise (wallets, DEX pools, the savings vault
 * and other contracts). Parts that exceed the whole (a pool close of
 * another day) are drawn as read and say so, never scaled to fit.
 */
function musdSits(input: {
  /** Each pool's MUSD at the latest close, largest first. */
  pools: { day: string; rows: { name: string; units: bigint }[] } | null
  stability: Section<SeriesView>
  hub: TokenCrossChain["hub"]
  /** Open troves now (`/borrow/totals`): count and debt, base units. */
  troves: { open: number; debt: string } | null
  /** BTC in troves at the latest close, whole BTC. */
  collateral: string | null
  /** BTC's latest daily close. */
  btc: string | null
}): SplitPanel[] {
  const stability = okData(input.stability)?.points.at(-1)?.decimal ?? null
  const hub = input.hub
  if (stability === null || hub === null || hub.locked === null) return []
  const scale = 10n ** BigInt(hub.decimals)
  // To 18 places, as the series are.
  const toWad = (units: bigint) => (units * 10n ** 18n) / scale
  const whole = toWad(hub.totalSupply)
  const bridged = toWad(hub.locked)
  const pool = scaledDecimal(stability, 18)
  if (whole <= 0n) return []
  // DEX pools are one part of the bar (its palette has five colours);
  // pool by pool is its own panel (`musdByPool`).
  const poolRows = input.pools?.rows ?? []
  const inPools = poolRows.reduce((sum, row) => sum + row.units, 0n)
  const split = splitOf(
    whole,
    [
      ...(input.pools === null ? [] : [{ label: "DEX pools", value: inPools }]),
      { label: "Stability Pool", value: pool },
      { label: "Bridged to other chains", value: bridged },
    ],
    input.pools === null ? "On Mezo otherwise" : "Wallets and other contracts",
    (value) => compactUnits(value, "MUSD"),
  )
  return [
    {
      id: "sits",
      label: "Where MUSD sits",
      aside: "Now",
      figure: percentText(shareBps(pool, whole)),
      note: "in the Stability Pool",
      segments: split.segments,
      mismatch: split.mismatch,
      stats: [
        { label: "Supply on Mezo", value: compactUnits(whole, "MUSD") },
        ...troveStats(input.troves, input.collateral, input.btc),
      ],
    },
  ]
}

/** Pools a split panel names; the rest are one part. */
const namedPools = 4

/**
 * MUSD in each DEX pool at the latest close: the largest four by name,
 * the rest as one part, with their total; none when the pools were not
 * read or hold no MUSD.
 */
function musdByPool(
  pools: { day: string; rows: { name: string; units: bigint }[] } | null,
): SplitPanel[] {
  if (pools === null || pools.rows.length === 0) return []
  const whole = pools.rows.reduce((sum, row) => sum + row.units, 0n)
  const rest = pools.rows
    .slice(namedPools)
    .reduce((sum, row) => sum + row.units, 0n)
  const split = splitOf(
    whole,
    [
      ...pools.rows
        .slice(0, namedPools)
        .map((row) => ({ label: row.name, value: row.units })),
      ...(rest > 0n ? [{ label: "Other pools", value: rest }] : []),
    ],
    null,
    (value) => compactUnits(value, "MUSD"),
  )
  return [
    {
      id: "by-pool",
      label: "MUSD by pool",
      aside: dayLabel(pools.day),
      figure: compactUnits(whole, "MUSD"),
      note: `in ${pools.rows.length} DEX ${pools.rows.length === 1 ? "pool" : "pools"}`,
      segments: split.segments,
      mismatch: split.mismatch,
      stats: [],
    },
  ]
}

/** Each pool's MUSD on the split's latest day; null when not read. */
function musdInPools(
  split: Section<SplitView>,
  musd: string,
): { day: string; rows: { name: string; units: bigint }[] } | null {
  if (split.status !== "ok") return null
  const day = latestDayOf(split.data.series)
  if (day === null) return null
  return {
    day,
    rows: tokenInPools(split.data.series, musd, day).map((row) => ({
      name: row.name,
      units: row.units,
    })),
  }
}

/**
 * A flow's total over the `days` whole UTC days before `at`'s day, 18
 * places; a day with no row counts zero (a day with no event has none).
 * `since` is the first day it covers when that is inside the window: the
 * series' first stored day, or `coveredFrom` when earlier (the first day
 * a sibling written by the same step has, for a sparse flow). Before the
 * trove history is re-aggregated the series starts at the jobs deploy,
 * and a sum labelled 30d would hold a few days. Null for a series never
 * computed.
 */
export function calendarSum(
  view: SeriesView,
  days: number,
  at: number,
  coveredFrom: string | null = null,
): { sum: bigint; since: string | null } | null {
  if (view.firstDay === null) return null
  const today = dayOf(at)
  const from = dayOf(at - days * 86_400)
  const first =
    coveredFrom !== null && coveredFrom < view.firstDay
      ? coveredFrom
      : view.firstDay
  // Today is never in the sum, so a history that starts today has nothing
  // to sum yet.
  if (first >= today) return null
  return {
    sum: view.points
      .filter((point) => point.day >= from && point.day < today)
      .reduce((sum, point) => sum + scaledDecimal(point.decimal, 18), 0n),
    since: first > from ? first : null,
  }
}

/**
 * MUSD borrowed from troves (minted, fees and gas compensation included)
 * and repaid per day, from the copy step's split of each trove event's
 * debt change. A day
 * with no such event has no row: zero. Redemptions and liquidations,
 * which also clear debt, are their own stats beside the repayments.
 */
function troveFlowPanels(
  reads: {
    borrowed: Section<SeriesView>
    repaid: Section<SeriesView>
    redeemed: Section<SeriesView>
    liquidated: Section<SeriesView>
  },
  period: Period,
  open: number | null,
  at: number,
): TokenPanel[] {
  const musd = (decimal: string) => wholeAmount(decimal, "MUSD")
  // The four are written by one step for the same days: the earliest
  // first day of any is how far back all of them are known.
  const covered =
    [reads.borrowed, reads.repaid, reads.redeemed, reads.liquidated]
      .map((read) => okData(read)?.firstDay ?? null)
      .filter((day): day is string => day !== null)
      .sort()[0] ?? null
  const sumStat = (label: string, read: Section<SeriesView>): Stat[] => {
    const view = okData(read)
    // A sparse flow (no row on a day with no event): the 30 calendar days
    // before today, not its last 30 rows.
    const total = view === null ? null : calendarSum(view, 30, at, covered)
    return total === null
      ? []
      : [
          {
            label:
              total.since === null
                ? `${label} 30d`
                : `${label} since ${dayLabel(total.since)}`,
            value: compactAmount(
              unitsToDecimal(total.sum.toString(), 18),
              "MUSD",
            ),
          },
        ]
  }
  const borrowedStats = sumStat("Borrowed", reads.borrowed)
  if (open !== null) {
    borrowedStats.push({
      label: "Open troves",
      value: groupThousands(BigInt(open)),
    })
  }
  return [
    panel(
      "borrowed",
      "MUSD borrowed per day",
      seriesPanel(periodSeries(reads.borrowed, period), musd),
      borrowedStats,
      "No loans opened yet",
    ),
    panel(
      "repaid",
      "MUSD repaid per day",
      seriesPanel(periodSeries(reads.repaid, period), musd),
      [
        ...sumStat("Repaid", reads.repaid),
        ...sumStat("Redeemed", reads.redeemed),
        ...sumStat("Liquidated", reads.liquidated),
      ],
      "No repayments yet",
    ),
  ]
}

/**
 * The troves behind MUSD: how many are open, their debt (principal and
 * interest), and the system's collateral ratio, BTC in troves at the
 * latest close over that debt (MUSD counted at $1, as the protocol does).
 */
function troveStats(
  troves: { open: number; debt: string } | null,
  collateral: string | null,
  btc: string | null,
): Stat[] {
  if (troves === null) return []
  const debt = BigInt(troves.debt)
  const stats: Stat[] = [
    { label: "Open troves", value: groupThousands(BigInt(troves.open)) },
    { label: "Trove debt", value: compactUnits(debt, "MUSD") },
  ]
  if (collateral !== null && btc !== null && debt > 0n) {
    const value = scaledDecimal(usdValue(collateral, btc), 18)
    stats.push({
      label: "Collateral ratio",
      value: percentText(Number((value * 10_000n) / debt)),
    })
  }
  return stats
}

/**
 * The replayed holder count, read only while Blockscout's own count is
 * younger than 30 days (its fallback for "New 30d"); null otherwise.
 */
async function replayedIfShort(
  holders: Section<SeriesView>,
  token: string,
  at: number,
): Promise<Section<SeriesView> | null> {
  const live = okData(holders)
  if (live !== null && changeOver(live, 30).status !== "short") return null
  return readSeries({
    metric: charts.holdersReplayed,
    dimension: token,
    days: replayedDays,
    now: at,
  })
}

async function mezoPage(period: Period, at: number): Promise<TokenPage> {
  const token = tokenBySlug("mezo")
  const statDays = statWindow(period.read)
  const series = (name: string, dimension: string) =>
    readSeries({ metric: name, dimension, days: statDays, now: at })
  const [crossChain, prices, supply, holders, locked, epochs, replayed] =
    await Promise.all([
      tokenCrossChain("mezo", period),
      readPrices("mezo", statDays, at),
      series(charts.supply, token.address),
      series(charts.holders, token.address),
      series(charts.locked, "vemezo"),
      readScan("epochs", canonicalQuery({ limit: 100 }), scanSchemas.epochPage),
      readSeries({
        metric: charts.holdersReplayed,
        dimension: token.address,
        days: replayedDays,
        now: at,
      }),
    ])
  const mezo = (decimal: string) => wholeAmount(decimal, "MEZO")
  const points = prices.status === "ok" ? prices.data.data.points : []
  const quote =
    prices.status === "ok"
      ? priceFacts(points, prices.data.data.firstDay)
      : null

  const priceStats: Stat[] = []
  if (quote !== null) {
    for (const [label, change] of [
      ["7d", quote.week],
      ["30d", quote.month],
    ] as const) {
      if (change === "short") {
        priceStats.push({ label, value: shortHistory })
      } else if (change !== null) {
        priceStats.push({ label, value: change.text, tone: change.tone })
      }
    }
    const span = priceRange(points, period)
    if (span !== null) {
      // A custom span's low and high are its own: "Low", "High".
      const name = period.range === "All" ? "All time" : period.range
      priceStats.push({
        label: name === null ? "Low" : `${name} low`,
        value: span.low,
      })
      priceStats.push({
        label: name === null ? "High" : `${name} high`,
        value: span.high,
      })
    }
  }

  const lastLocked = okData(locked)?.points.at(-1) ?? null
  const lastSupply = okData(supply)?.points.at(-1) ?? null
  const lockedStats: Stat[] = []
  if (lastLocked !== null && quote !== null) {
    lockedStats.push({
      label: "In USD",
      value: compactUsd(usdValue(lastLocked.decimal, quote.decimal)),
    })
  }
  if (lastLocked !== null && lastSupply !== null) {
    const share = shareBps(
      scaledDecimal(lastLocked.decimal, 18),
      scaledDecimal(lastSupply.decimal, 18),
    )
    lockedStats.push({ label: "Of supply", value: percentText(share) })
  }
  lockedStats.push(
    ...changeStats(
      okData(locked),
      [30],
      18,
      (value) => signedCompact(value, 18, "MEZO"),
      () => "Change 30d",
    ),
  )

  const supplyStats = changeStats(
    okData(supply),
    [30],
    18,
    (value) => signedCompact(value, 18, "MEZO"),
    () => "Change 30d",
  )
  if (lastSupply !== null && quote !== null) {
    supplyStats.unshift({
      label: "In USD",
      value: compactUsd(usdValue(lastSupply.decimal, quote.decimal)),
    })
  }

  const factList: Fact[] = []
  const live = priceFact(crossChain.price)
  if (live !== null) {
    factList.push({
      ...live,
      change:
        quote?.day === null || quote === null
          ? null
          : { text: `${quote.day.text} 1d`, tone: quote.day.tone },
    })
  } else if (quote !== null) {
    factList.push({
      label: "Price",
      value: quote.price,
      change:
        quote.day === null
          ? null
          : { text: `${quote.day.text} 1d`, tone: quote.day.tone },
      note: "Daily close",
    })
  }
  if (quote !== null && lastSupply !== null) {
    // The supply at the latest daily price. No fully diluted value: no
    // source gives MEZO's maximum supply.
    factList.push({
      label: "Market cap",
      value: compactUsd(usdValue(lastSupply.decimal, quote.decimal)),
      change: null,
      note: null,
    })
  }
  const holderCount = latestOf(holders, countText)
  if (holderCount !== null) {
    factList.push({
      label: "Holders",
      value: holderCount.text,
      change: countChange(okData(holders), 30),
      note: null,
    })
  }
  if (lastLocked !== null) {
    factList.push({
      label: "Locked as veMEZO",
      value: compactAmount(lastLocked.decimal, "MEZO"),
      change: null,
      note: null,
    })
  }
  if (lastSupply !== null) {
    factList.push({
      label: "Supply",
      value: compactAmount(lastSupply.decimal, "MEZO"),
      change: null,
      note: "All chains, counted once",
    })
  }
  const bridged = elsewhereFact(crossChain.supply, "Bridged out")
  if (bridged !== null) factList.push(bridged)

  const current = epochIndexFor(epochStartOf(at))
  const priceSection: Section<SeriesPanelData> =
    prices.status === "ok"
      ? {
          status: "ok",
          data: pricePanel(points, period, prices.data.data.firstDay),
        }
      : failedSection(prices)
  const { price: _price, slug: _slug, ...identity } = token
  return {
    slug: "mezo",
    period: periodView(period, at),
    token: identity,
    crossChain: pageCrossChain(crossChain),
    facts: factList,
    panels: [
      panel("price", "Price", priceSection, priceStats, "No price yet"),
      panel(
        "locked",
        "MEZO locked as veMEZO",
        seriesPanel(periodSeries(locked, period), mezo),
        lockedStats,
        "Nothing locked yet",
      ),
      panel(
        "supply",
        "Supply",
        seriesPanel(periodSeries(supply, period), mezo),
        supplyStats,
        "No supply yet",
      ),
      panel(
        "holders",
        "Holders",
        seriesPanel(periodSeries(holders, period), countText),
        holderStats(holders, replayed),
        "No holders yet",
      ),
    ],
    splits: [
      ...mezoSupplySplit(
        lastLocked?.decimal ?? null,
        lastSupply?.decimal ?? null,
        epochs,
      ),
      ...emissionsSplit(epochs, points, at),
    ],
    later: false,
    emissions: scanSection(epochs, (page) =>
      emissionsView(
        page.data,
        page.meta.complete,
        page.meta.asOf,
        current,
        { btc: [], mezo: points },
        at,
      ),
    ),
  }
}

type EpochsRead = ScanRead<{ data: readonly ScanEpochItem[] }>

function emittedEpochs(epochs: EpochsRead): ScanEpochItem[] {
  if (epochs.status !== "ok") return []
  return epochs.data.data
    .filter((item) => item.emission !== null)
    .sort((a, b) => a.epoch_start - b.epoch_start)
}

/**
 * MEZO's supply now: locked as veMEZO and the rest, with what has been
 * emitted all time, per epoch now, and since when. No "not yet emitted"
 * part: no source gives MEZO's maximum supply.
 */
function mezoSupplySplit(
  locked: string | null,
  supply: string | null,
  epochs: EpochsRead,
): SplitPanel[] {
  if (locked === null || supply === null) return []
  const whole = scaledDecimal(supply, 18)
  if (whole <= 0n) return []
  const format = (value: bigint) => compactUnits(value, "MEZO")
  const lockedUnits = scaledDecimal(locked, 18)
  const stats: Stat[] = []
  let mismatch: string | null = null
  const emitted = emittedEpochs(epochs)
  const first = emitted[0]
  const latest = emitted.at(-1)
  if (first !== undefined && latest?.emission != null) {
    const total = emitted.reduce(
      (sum, item) => sum + BigInt(item.emission ?? "0"),
      0n,
    )
    // Emissions are minted into the supply: more emitted than the supply
    // holds means one of the two readings is off, and it is said.
    if (total > whole) {
      mismatch = `Emitted exceeds supply by ${format(total - whole)}`
    }
    stats.push({ label: "Emitted all time", value: format(total) })
    stats.push({
      label: "Per epoch now",
      value: format(BigInt(latest.emission)),
    })
    stats.push({
      label: "Emitting since",
      value: `Epoch ${epochIndexFor(first.epoch_start)}`,
    })
  }
  return [
    {
      id: "supply-split",
      label: "Where MEZO's supply sits",
      aside: "Now",
      figure: percentText(shareBps(lockedUnits, whole)),
      note: "locked as veMEZO",
      ...(() => {
        const split = splitOf(
          whole,
          [{ label: "Locked as veMEZO", value: lockedUnits }],
          "Not locked",
          format,
        )
        return {
          segments: split.segments,
          mismatch: split.mismatch ?? mismatch,
        }
      })(),
      stats,
    },
  ]
}

/**
 * Where the latest epoch's emissions went: to gauges, the rebase to
 * veMEZO, and the rest of the epoch's emission. Per gauge type is not
 * stored, so it is not split further. In USD at the epoch's close.
 */
function emissionsSplit(
  epochs: EpochsRead,
  mezoPrices: readonly PricePoint[],
  at: number,
): SplitPanel[] {
  const latest = emittedEpochs(epochs).at(-1)
  if (latest === undefined || latest.emission === null) return []
  const whole = BigInt(latest.emission)
  if (whole <= 0n) return []
  const parts: { label: string; value: bigint }[] = []
  if (latest.gauge_rewards !== null) {
    parts.push({ label: "To gauges", value: BigInt(latest.gauge_rewards) })
  }
  if (latest.rebase !== null) {
    parts.push({ label: "Rebase to veMEZO", value: BigInt(latest.rebase) })
  }
  if (parts.length === 0) return []
  const usd = amountUsd(
    mezoToken,
    whole,
    epochPriceDay(latest.epoch_start, at),
    { btc: [], mezo: mezoPrices },
  )
  const number = epochIndexFor(latest.epoch_start)
  return [
    {
      id: "emissions-split",
      label: "Where emissions go",
      aside: `Epoch ${number}`,
      figure: groupThousands(whole / 10n ** 18n),
      note: usd === null ? "MEZO" : `MEZO, ${usdCompact(usd)}`,
      ...splitOf(whole, parts, "Other", (value) => compactUnits(value, "MEZO")),
      stats: [],
    },
  ]
}

export async function tokenPage(
  input: { slug: TokenSlug } & PeriodInput,
): Promise<TokenPage> {
  setCacheClass("fresh")
  const at = now()
  const period = periodOf(input, at)
  return input.slug === "mezo" ? mezoPage(period, at) : musdPage(period, at)
}
