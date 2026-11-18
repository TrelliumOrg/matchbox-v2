import {
  type CrossChain,
  crossChainPools,
  crossChains,
  musdPriceVenues,
  tigrisPoolTypes,
} from "@matchbox/chain"
import type {
  ScanAssetPrice,
  ScanBridgedAsset,
  ScanBridgeFlows,
  ScanCrossChainPool,
  ScanVenueQuote,
} from "@matchbox/contracts/scan"
import {
  formatDayTime,
  formatDecimal,
  formatPrice,
  formatUsd,
  groupThousands,
  unitsToDecimal,
} from "@matchbox/domain/format"
import { matchesWords } from "@matchbox/domain/pool-search"
import {
  nameWithPoolType,
  poolTypeDescription,
  poolTypeLabel,
} from "@matchbox/domain/pool-type"
import { compactUsd, scaledDecimal } from "./network-views"
import { dayLabel } from "./series-views"
import { shareBps } from "./voting-views"

/**
 * MUSD and MEZO beyond Mezo, as the pages show them, from the API's
 * `/crosschain/*` answers (apps/api `scan/crosschain.ts`). Pure, so every
 * rule is tested without the API. Money is bigint maths on decimal
 * strings, never floats.
 *
 * The rules the owner set (12 Nov 2026):
 * - MUSD's headline price is our on-chain, liquidity-weighted price across
 *   the venues, with each venue under it. CoinGecko is never MUSD's
 *   headline: when the API falls back to it, the headline is "not counted
 *   yet" and CoinGecko's figure is a comparison line.
 * - Supply is counted once: Mezo mints it all, the bridge locks on Mezo
 *   what Ethereum and Base mint, so other chains add up to the lock and
 *   never on top of it. Total value locked sums pools, one each.
 * - Pools show from $25,000 of liquidity by default. A yearly rate is
 *   shown only for a pool at or above that line, and an estimate says
 *   "est.". A pool under it shows no rate at all (a $2.3k pool computes
 *   to 370%, which is noise).
 * - A figure the API cannot give is "not counted yet" (or, for a pool,
 *   "not available yet"), never 0 or $1. A pool whose liquidity is not
 *   available shows no rate: the line cannot be applied to it.
 */

export const notCounted = "Not counted yet"

/** The liquidity line, USD: smaller pools are hidden and show no rates. */
export const liquidityLine = 25_000n
const wad = 10n ** 18n
const lineWad = liquidityLine * wad

export type PoolChain = "mezo" | "ethereum" | "base"
export const poolChains: readonly PoolChain[] = ["mezo", "ethereum", "base"]

function isPoolChain(chain: CrossChain): chain is PoolChain {
  return chain === "mezo" || chain === "ethereum" || chain === "base"
}

export function chainName(chain: string): string {
  return chain in crossChains
    ? crossChains[chain as CrossChain].name
    : chain.replace(/^wormhole-/, "Wormhole chain ")
}

/** "Thu 12 Nov, 14:05 UTC". */
export function readTime(seconds: number): string {
  return `${formatDayTime(seconds)} UTC`
}

// -- percentages -------------------------------------------------------------

/** A percent a year ("8.24", "370.1") as "8.24%"; whole from 100% up. */
export function percentYear(value: string): string {
  const places = scaledDecimal(value, 0) >= 100n ? 0 : 2
  return `${formatDecimal(value, places)}%`
}

/** Basis points as "0.06%", two places. */
export function bpsText(bps: number): string {
  const sign = bps < 0 ? "-" : ""
  const abs = Math.abs(bps)
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}%`
}

/** `part` against `whole` in basis points, rounded half away from zero. */
function signedBps(part: bigint, whole: bigint): number {
  if (whole <= 0n) return 0
  const scaled = (part * 100_000n) / whole
  const rounded = (scaled < 0n ? scaled - 5n : scaled + 5n) / 10n
  return Number(rounded)
}

/** A share in basis points as "13.8%", "0.05%" under 1%, "<0.01%". */
export function shareText(bps: number, partPositive: boolean): string {
  if (bps === 0) return partPositive ? "<0.01%" : "0%"
  if (bps < 100) return bpsText(bps)
  const tenths = Math.round(bps / 10)
  return `${Math.floor(tenths / 10)}.${tenths % 10}%`
}

// -- price ---------------------------------------------------------------------

/** MUSD's price to four places ("$0.9936"), a venue's to five. */
export function pegPrice(decimal: string, places: 4 | 5 = 4): string {
  return `$${formatDecimal(decimal, places)}`
}

export type VenueView = {
  id: string
  /** "Curve MUSD/2pool". */
  label: string
  /** "Curve on Ethereum". */
  where: string
  chain: PoolChain | "bsc"
  price: string
  /** Against the headline: "+0.08%"; null without a headline. */
  vsHeadline: { text: string; tone: "pos" | "neg" | "flat" } | null
  /** "30-minute TWAP". */
  method: string
  /** Read more than 10 minutes ago: not in the headline. */
  stale: boolean
  /** The pool's page on Matchscan. */
  pool: PoolLink | null
}

export type PriceView = {
  asset: ScanBridgedAsset
  /** How the headline was read: "venues", "coingecko", "aerodrome-cl". */
  basis: string | null
  /** Null until the first reading (or for MUSD on CoinGecko's fallback). */
  headline: {
    text: string
    /** "On chain, liquidity-weighted across 3 venues", "CoinGecko". */
    basis: string
    at: string
    /** Older than 10 minutes: shown with its time, never as current. */
    stale: boolean
  } | null
  /** CoinGecko beside our price, never instead of it (MUSD's fallback). */
  comparison: { text: string; at: string } | null
  venues: VenueView[]
  /** "0.06%" across the fresh venues. */
  spread: string | null
  /** Fresh venues differ by more than 0.5%. */
  diverged: boolean
  /** "Under $1.00 by 0.64%": MUSD only, from the headline. */
  peg: string | null
}

/** A pool page: `/pools/{pool}` on Mezo, `/pools/{chain}/{pool}` elsewhere. */
export type PoolLink = { chain: PoolChain; pool: string }

const venueNames: Record<string, string> = {
  tigris: "Tigris",
  curve: "Curve",
  "uniswap-v4": "Uniswap v4",
  aerodrome: "Aerodrome",
  "mezo-savings": "Mezo",
}

function venueOf(id: string): string {
  return venueNames[id] ?? id
}

function poolLinkOf(chain: CrossChain, pool: string): PoolLink | null {
  return isPoolChain(chain) ? { chain, pool: pool.toLowerCase() } : null
}

function venueView(quote: ScanVenueQuote, headline: string | null): VenueView {
  const tracked = crossChainPools.find(
    (pool) => pool.address.toLowerCase() === quote.pool.toLowerCase(),
  )
  let vsHeadline: VenueView["vsHeadline"] = null
  if (headline !== null) {
    const bps = signedBps(
      scaledDecimal(quote.price_usd, 18) - scaledDecimal(headline, 18),
      scaledDecimal(headline, 18),
    )
    vsHeadline = {
      text: bps > 0 ? `+${bpsText(bps)}` : bpsText(bps),
      tone: bps > 0 ? "pos" : bps < 0 ? "neg" : "flat",
    }
  }
  return {
    id: quote.venue,
    label: quote.label,
    where: `${venueOf(tracked?.venue ?? "")} on ${chainName(quote.chain)}`,
    chain: quote.chain,
    price: pegPrice(quote.price_usd, 5),
    vsHeadline,
    method: quote.method,
    stale: quote.stale,
    pool: poolLinkOf(quote.chain, quote.pool),
  }
}

/** Under or over $1.00 by how much, from MUSD's headline. */
function pegText(price: string): string | null {
  const value = scaledDecimal(price, 18)
  if (value === wad) return "At $1.00"
  const bps = signedBps(value - wad, wad)
  if (bps === 0) return "Within 0.01% of $1.00"
  return bps < 0
    ? `Under $1.00 by ${bpsText(-bps)}`
    : `Over $1.00 by ${bpsText(bps)}`
}

export function priceView(price: ScanAssetPrice): PriceView {
  const usd = price.price_usd
  const fromVenues = price.basis === "venues"
  const freshVenues = price.venues.filter((venue) => !venue.stale).length
  // MUSD on CoinGecko is the API's fallback: a comparison, not a headline.
  const musdFallback = price.asset === "musd" && !fromVenues
  const headline =
    usd === null || price.read_at === null || musdFallback
      ? null
      : {
          text: price.asset === "musd" ? pegPrice(usd) : formatPrice(usd),
          basis: fromVenues
            ? `On chain, liquidity-weighted across ${freshVenues} ${freshVenues === 1 ? "venue" : "venues"}`
            : price.basis === "coingecko"
              ? "CoinGecko"
              : "Aerodrome MEZO/MUSD on Base, a thin pool",
          at: readTime(price.read_at),
          stale: price.stale,
        }
  const comparison =
    musdFallback && usd !== null && price.read_at !== null
      ? { text: pegPrice(usd), at: readTime(price.read_at) }
      : null
  return {
    asset: price.asset,
    basis: price.basis,
    headline,
    comparison,
    venues: price.venues.map((venue) =>
      venueView(venue, headline === null || !fromVenues ? null : usd),
    ),
    spread: price.spread_bps === null ? null : bpsText(price.spread_bps),
    diverged: price.diverged,
    peg:
      price.asset === "musd" && headline !== null && usd !== null
        ? pegText(usd)
        : null,
  }
}

// -- supply --------------------------------------------------------------------

export type SupplyRow = {
  chain: CrossChain | "transit"
  name: string
  amount: string
  share: string
  bps: number
}

export type SupplyView = {
  asset: ScanBridgedAsset
  symbol: string
  /** What Mezo minted: every chain, counted once. Null before a reading. */
  total: string | null
  /** "18.99M" for a header figure. */
  totalCompact: string | null
  /** Mezo, then each other chain largest first, then in transit. */
  rows: SupplyRow[]
  /** Held by the bridge on Mezo for the other chains, not counted again. */
  locked: string | null
  /** On chains other than Mezo together ("2,833,827.17"), with its share. */
  elsewhere: { amount: string; compact: string; share: string } | null
  /** Chains with no reading yet, by name. */
  missing: string[]
  /** Other chains add up to more than the lock (a reading out of step). */
  mismatch: boolean
  /** "Mon 9 Nov" of the readings. */
  day: string | null
}

type ChainSupply = {
  chain: CrossChain
  total_supply: string
  locked: string | null
  circulating: string
  day: string
}

/** Two decimals, grouped: "18,995,044.82". */
function tokenText(units: bigint, decimals: number): string {
  return formatDecimal(unitsToDecimal(units.toString(), decimals), 2)
}

/** Whole tokens, compact ("18.99M"); grouped below a million. */
function compactTokens(units: bigint, decimals: number): string {
  const whole = units / 10n ** BigInt(decimals)
  return compactUsd(whole.toString()).replace("$", "")
}

export function supplyView(
  supply: {
    asset: ScanBridgedAsset
    decimals: number
    chains: readonly ChainSupply[]
    unavailable: Record<string, string>
  },
  deployed: readonly CrossChain[],
): SupplyView {
  const symbol = supply.asset === "musd" ? "MUSD" : "MEZO"
  const decimals = supply.decimals
  const hub = supply.chains.find((chain) => chain.chain === "mezo")
  const others = supply.chains.filter((chain) => chain.chain !== "mezo")
  const missing = deployed
    .filter((chain) => !supply.chains.some((row) => row.chain === chain))
    .map(chainName)
  const empty: SupplyView = {
    asset: supply.asset,
    symbol,
    total: null,
    totalCompact: null,
    rows: [],
    locked: null,
    elsewhere: null,
    missing,
    mismatch: false,
    day: null,
  }
  if (hub === undefined) return empty
  const total = BigInt(hub.total_supply)
  const locked = hub.locked === null ? null : BigInt(hub.locked)
  const onMezo = BigInt(hub.circulating)
  const row = (
    chain: SupplyRow["chain"],
    name: string,
    amount: bigint,
  ): SupplyRow => {
    const bps = shareBps(amount, total)
    return {
      chain,
      name,
      amount: tokenText(amount, decimals),
      share: shareText(bps, amount > 0n),
      bps,
    }
  }
  const elsewhereUnits = others.reduce(
    (sum, chain) => sum + BigInt(chain.total_supply),
    0n,
  )
  const rows = [
    row("mezo", "Mezo", onMezo),
    ...[...others]
      .sort((a, b) => {
        const left = BigInt(a.total_supply)
        const right = BigInt(b.total_supply)
        return left === right ? 0 : left > right ? -1 : 1
      })
      .map((chain) =>
        row(chain.chain, chainName(chain.chain), BigInt(chain.total_supply)),
      ),
  ]
  // In transit: locked on Mezo, not yet minted elsewhere. Only when every
  // chain was read, and never below zero (that is a reading out of step).
  const transit =
    locked === null || missing.length > 0 ? null : locked - elsewhereUnits
  if (transit !== null && transit > 0n) {
    rows.push(row("transit", "In transit or on other chains", transit))
  }
  const elsewhereBps = shareBps(elsewhereUnits, total)
  return {
    asset: supply.asset,
    symbol,
    total: tokenText(total, decimals),
    totalCompact: compactTokens(total, decimals),
    rows,
    locked: locked === null ? null : tokenText(locked, decimals),
    elsewhere:
      missing.length > 0
        ? null
        : {
            amount: tokenText(elsewhereUnits, decimals),
            compact: compactTokens(elsewhereUnits, decimals),
            share: shareText(elsewhereBps, elsewhereUnits > 0n),
          },
    missing,
    mismatch: transit !== null && transit < 0n,
    day: dayLabel(hub.day),
  }
}

// -- pools ---------------------------------------------------------------------

/**
 * A yearly rate as a cell shows it: a figure ("est." when ours), none
 * (the pool has no such reward), not counted yet, or hidden under the
 * liquidity line.
 */
export type Rate =
  | { kind: "value"; text: string; est: boolean; from: boolean }
  | { kind: "none" }
  | { kind: "not-yet" }
  | { kind: "hidden" }

export type PoolRow = {
  id: string
  chain: PoolChain
  chainName: string
  link: PoolLink
  /** "mUSDC/MUSD CL10", "MUSD/BTC Volatile", "Savings vault". */
  title: string
  /** "Tigris on Mezo". */
  where: string
  venue: string
  /** Coin tickers for the stack, MUSD first where it is a side. */
  tickers: string[]
  assets: ScanBridgedAsset[]
  legacy: boolean
  /** "$3,355,432"; null when not counted yet. */
  liquidity: string | null
  /** At or above $25,000; null when the liquidity is not counted yet. */
  aboveLine: boolean | null
  volume: { kind: "value"; text: string } | { kind: "none" } | null
  rates: {
    fees: Rate
    rewards: Rate
    merkl: Rate
    gauge: Rate
    total: Rate
  }
  /** The Matchbox gauge sending MEZO here. */
  gauge: { address: string; name: string | null } | null
  /** MUSD's price read at this venue ("$0.99361"), when it is one. */
  priceHere: string | null
  venueUrl: string
  /** Etherscan or Basescan for a pool off Mezo with an address. */
  explorer: { name: string; url: string } | null
  /** "Mon 9 Nov": the day of the figures. */
  day: string | null
}

const explorerNames: Partial<Record<CrossChain, string>> = {
  ethereum: "Etherscan",
  base: "Basescan",
}

/** The bundled coin for a pair's side ("USDC" is drawn as mUSDC's art). */
const sideTickers: Record<string, readonly string[]> = {
  USDC: ["mUSDC"],
  USDT: ["mUSDT"],
  "2pool": ["mUSDC", "mUSDT"],
  sMUSD: ["MUSD"],
}

function tickersOf(pair: string): string[] {
  const sides = pair.split("/")
  const ordered = sides.includes("MUSD")
    ? ["MUSD", ...sides.filter((side) => side !== "MUSD")]
    : sides
  return ordered.flatMap((side) => sideTickers[side] ?? [side])
}

/**
 * A pair in the order Matchbox's gauges name it: MUSD last ("BTC/MUSD",
 * "mUSDC/MUSD"), so a pool, its gauge and every list read the same.
 */
export function pairOrder(pair: string): string {
  const sides = pair.split("/")
  if (sides.length !== 2 || sides[0] !== "MUSD") return pair
  return `${sides[1]}/${sides[0]}`
}

/**
 * A pool's title. Tigris pools on Mezo carry the pool type label pool
 * gauges use ("BTC/MUSD CL200", "mUSDC/MUSD Stable"), so a pool and its
 * gauge read the same; other venues keep their own fee or kind.
 */
export function titleOf(
  rawPair: string,
  kind: string | null,
  vault: boolean,
  id: string,
): string {
  if (vault) return "Savings vault"
  // Mezo's pools read as their gauges do; other venues keep their own.
  const pair = id.startsWith("mezo-") ? pairOrder(rawPair) : rawPair
  const shape = tigrisPoolTypes[id]
  if (shape !== undefined) {
    return nameWithPoolType(pair, poolTypeLabel(shape))
  }
  const plain = (kind ?? "").replace(/\s*\(legacy\)/, "").trim()
  const fee = /([0-9.]+%)/.exec(plain)?.[1]
  if (fee !== undefined) return `${pair} ${fee}`
  if (plain === "stable" || plain === "classic") return `${pair} ${plain}`
  return pair
}

/** A reason the API gives for a null that means the pool has none. */
function meansNone(reason: string | undefined): boolean {
  return (
    reason !== undefined &&
    /^No (live Merkl campaign|Matchbox gauge|venue rewards|pool gauge emissions)/.test(
      reason,
    )
  )
}

type RateField = "fees" | "rewards" | "merkl" | "gauge"

/** Ours, worked out from other figures, rather than read from a source. */
function isEstimate(field: RateField, source: string | undefined): boolean {
  if (field === "gauge") return true
  if (field === "fees") return source?.startsWith("estimate") ?? false
  if (field === "rewards") return source?.startsWith("matchbox") ?? false
  return false
}

function rateOf(
  pool: ScanCrossChainPool,
  field: RateField,
  aboveLine: boolean | null,
): Rate {
  const value = pool.apr[field]
  if (value === null) {
    return meansNone(pool.unavailable[`apr_${field}`])
      ? { kind: "none" }
      : { kind: "not-yet" }
  }
  // Liquidity not available: the line cannot be applied, so no rate.
  if (aboveLine === null) return { kind: "not-yet" }
  if (!aboveLine) return { kind: "hidden" }
  return {
    kind: "value",
    text: percentYear(value),
    est: isEstimate(field, pool.sources[`apr_${field}`]),
    from: false,
  }
}

function totalOf(
  pool: ScanCrossChainPool,
  parts: readonly Rate[],
  aboveLine: boolean | null,
): Rate {
  const total = pool.apr.total
  if (total === null) {
    return parts.some((part) => part.kind === "not-yet")
      ? { kind: "not-yet" }
      : { kind: "none" }
  }
  if (aboveLine === null) return { kind: "not-yet" }
  if (!aboveLine) return { kind: "hidden" }
  return {
    kind: "value",
    text: percentYear(total),
    est: parts.some((part) => part.kind === "value" && part.est),
    from: parts.some((part) => part.kind === "not-yet"),
  }
}

/** MUSD's price per tracked pool id, from the venue quotes. */
export function pricesByPool(
  venues: readonly ScanVenueQuote[],
): Map<string, string> {
  const byPool = new Map<string, string>()
  for (const quote of venues) {
    const venue =
      quote.venue in musdPriceVenues
        ? musdPriceVenues[quote.venue as keyof typeof musdPriceVenues]
        : undefined
    if (venue !== undefined) {
      byPool.set(venue.poolId, pegPrice(quote.price_usd, 5))
    }
  }
  return byPool
}

export function poolRow(
  pool: ScanCrossChainPool,
  prices: ReadonlyMap<string, string>,
): PoolRow | null {
  if (!isPoolChain(pool.chain)) return null
  const vault = pool.venue === "mezo-savings"
  const tvl = pool.tvl_usd === null ? null : scaledDecimal(pool.tvl_usd, 18)
  const aboveLine = tvl === null ? null : tvl >= lineWad
  const parts = {
    fees: rateOf(pool, "fees", aboveLine),
    rewards: rateOf(pool, "rewards", aboveLine),
    merkl: rateOf(pool, "merkl", aboveLine),
    gauge: rateOf(pool, "gauge", aboveLine),
  }
  const explorerName = explorerNames[pool.chain]
  const hasAddress = /^0x[0-9a-f]{40}$/i.test(pool.pool)
  return {
    id: pool.id,
    chain: pool.chain,
    chainName: chainName(pool.chain),
    link: { chain: pool.chain, pool: pool.pool.toLowerCase() },
    title: titleOf(pool.pair, pool.kind, vault, pool.id),
    where: vault
      ? `${pool.pair} on Mezo`
      : `${venueOf(pool.venue)} on ${chainName(pool.chain)}${feeNote(pool.id)}`,
    venue: venueOf(pool.venue),
    tickers: tickersOf(
      pool.chain === "mezo" ? pairOrder(pool.pair) : pool.pair,
    ),
    assets: [
      ...(pool.pair.includes("MUSD") ? (["musd"] as const) : []),
      ...(pool.pair.includes("MEZO") ? (["mezo"] as const) : []),
    ],
    legacy: pool.legacy,
    liquidity: pool.tvl_usd === null ? null : formatUsd(pool.tvl_usd, "whole"),
    aboveLine,
    volume:
      pool.volume_24h_usd !== null
        ? { kind: "value", text: formatUsd(pool.volume_24h_usd, "whole") }
        : vault
          ? { kind: "none" }
          : null,
    rates: {
      ...parts,
      total: totalOf(pool, Object.values(parts), aboveLine),
    },
    gauge:
      pool.gauge === null
        ? null
        : { address: pool.gauge.address, name: pool.gauge.name },
    priceHere: prices.get(pool.id) ?? null,
    venueUrl: pool.url,
    explorer:
      explorerName === undefined || !hasAddress
        ? null
        : {
            name: explorerName,
            url: `${crossChains[pool.chain].explorer}/address/${pool.pool.toLowerCase()}`,
          },
    day: pool.day === null ? null : dayLabel(pool.day),
  }
}

/** What a pools table draws: a row without its page-only fields. */
export type PoolTableRow = Omit<
  PoolRow,
  "venueUrl" | "explorer" | "day" | "assets" | "venue" | "priceHere"
>

export function tableRow(row: PoolRow): PoolTableRow {
  const {
    venueUrl: _venueUrl,
    explorer: _explorer,
    day: _day,
    assets: _assets,
    venue: _venue,
    priceHere: _priceHere,
    ...rest
  } = row
  return rest
}

/**
 * A token page's "where it trades" row (`h6PmVdwDRq`): the pool, its
 * liquidity and volume, MUSD's price there and the total yearly rate. The
 * page's data rides in its HTML, so it carries no more than it draws.
 */
export type TradeRow = Pick<
  PoolRow,
  "id" | "chain" | "link" | "title" | "where" | "tickers" | "legacy"
> & {
  liquidity: string
  volume: string | null
  priceHere: string | null
  rate: Rate
}

export function tradeRow(row: PoolRow): TradeRow {
  return {
    id: row.id,
    chain: row.chain,
    link: row.link,
    title: row.title,
    where: row.where,
    tickers: row.tickers,
    legacy: row.legacy,
    liquidity: row.liquidity ?? "",
    volume: row.volume?.kind === "value" ? row.volume.text : null,
    priceHere: row.priceHere,
    rate: row.rates.total,
  }
}

/** Largest liquidity first; not counted yet last, in the catalog's order. */
function byLiquidity(
  a: { tvl: bigint | null; index: number },
  b: { tvl: bigint | null; index: number },
): number {
  if (a.tvl === null || b.tvl === null) {
    return a.tvl === b.tvl ? a.index - b.index : a.tvl === null ? 1 : -1
  }
  if (a.tvl !== b.tvl) return a.tvl > b.tvl ? -1 : 1
  return a.index - b.index
}

export type ChainFilter = "all" | PoolChain
export type AssetFilter = "all" | ScanBridgedAsset

export type PoolFilters = {
  chain: ChainFilter
  asset: AssetFilter
  /** Show the pools under the $25,000 line too. */
  small: boolean
}

export type LiquidityTotal = {
  /** "$5.78M"; null when no pool is counted yet. */
  text: string | null
  pools: number
  /** Pools whose liquidity is counted. */
  counted: number
}

export type PoolsView = {
  filters: PoolFilters
  rows: PoolRow[]
  /** Pools under the line, hidden by default (0 when shown). */
  hidden: number
  /** Every tracked pool of the token filter once, the line and chain aside. */
  total: LiquidityTotal
  chains: (LiquidityTotal & { chain: PoolChain; name: string })[]
  /** Pools under the current line rule, per chain and per token. */
  counts: {
    chain: Record<ChainFilter, number>
    asset: Record<AssetFilter, number>
  }
  day: string | null
}

function liquidityTotal(
  pools: readonly { tvl: bigint | null }[],
): LiquidityTotal {
  const counted = pools.filter((pool) => pool.tvl !== null)
  const sum = counted.reduce((total, pool) => total + (pool.tvl ?? 0n), 0n)
  return {
    text:
      counted.length === 0
        ? null
        : compactUsd(unitsToDecimal(sum.toString(), 18)),
    pools: pools.length,
    counted: counted.length,
  }
}

export function poolsView(
  pools: readonly ScanCrossChainPool[],
  prices: ReadonlyMap<string, string>,
  filters: PoolFilters,
): PoolsView {
  const all = pools.flatMap((pool, index) => {
    const row = poolRow(pool, prices)
    if (row === null) return []
    const tvl = pool.tvl_usd === null ? null : scaledDecimal(pool.tvl_usd, 18)
    return [{ row, tvl, index }]
  })
  all.sort(byLiquidity)
  // Under the line is hidden unless asked for; a pool not counted yet stays,
  // so an empty table never hides the catalog.
  const shown = all.filter(
    (item) => filters.small || item.row.aboveLine !== false,
  )
  const inChain = (item: (typeof all)[number], chain: ChainFilter) =>
    chain === "all" || item.row.chain === chain
  const inAsset = (item: (typeof all)[number], asset: AssetFilter) =>
    asset === "all" || item.row.assets.includes(asset)
  const rows = shown.filter(
    (item) => inChain(item, filters.chain) && inAsset(item, filters.asset),
  )
  const hidden = filters.small
    ? 0
    : all.filter(
        (item) =>
          item.row.aboveLine === false &&
          inChain(item, filters.chain) &&
          inAsset(item, filters.asset),
      ).length
  const chainCounts = {} as Record<ChainFilter, number>
  for (const chain of ["all", ...poolChains] as const) {
    chainCounts[chain] = shown.filter(
      (item) => inChain(item, chain) && inAsset(item, filters.asset),
    ).length
  }
  const assetCounts = {} as Record<AssetFilter, number>
  for (const asset of ["all", "musd", "mezo"] as const) {
    assetCounts[asset] = shown.filter(
      (item) => inAsset(item, asset) && inChain(item, filters.chain),
    ).length
  }
  const days = all.flatMap((item) =>
    item.row.day === null ? [] : [item.row.day],
  )
  return {
    filters,
    rows: rows.map((item) => item.row),
    hidden,
    total: liquidityTotal(all.filter((item) => inAsset(item, filters.asset))),
    chains: poolChains.map((chain) => ({
      chain,
      name: chainName(chain),
      ...liquidityTotal(
        all.filter(
          (item) => item.row.chain === chain && inAsset(item, filters.asset),
        ),
      ),
    })),
    counts: { chain: chainCounts, asset: assetCounts },
    day: days[0] ?? null,
  }
}

// -- bridge --------------------------------------------------------------------

export type BridgeRouteView = {
  from: string
  to: string
  /** "6,676". */
  transfers: string
  /** "$934,420". */
  usd: string
}

export type BridgeView = {
  routes: BridgeRouteView[]
  /** Every route, all time, Wormholescan's USD: "$1,531,685". */
  total: string | null
  transfers: string | null
  /** The days the API returned, together: "$50,328" over "2 days". */
  recent: { usd: string; transfers: string; days: number } | null
  asOf: string | null
  /** Why there is nothing to show (MEZO: Wormholescan has no NTT data). */
  missing: "not-yet" | "unsupported" | null
}

export function bridgeView(flows: ScanBridgeFlows): BridgeView {
  const missing =
    flows.routes.length > 0
      ? null
      : flows.asset === "mezo"
        ? ("unsupported" as const)
        : ("not-yet" as const)
  const usdSum = (values: readonly string[]) =>
    unitsToDecimal(
      values
        .reduce((sum, value) => sum + scaledDecimal(value, 18), 0n)
        .toString(),
      18,
    )
  return {
    routes: flows.routes.map((route) => ({
      from: chainName(route.from),
      to: chainName(route.to),
      transfers: groupThousands(BigInt(route.transfers_total)),
      usd: formatUsd(route.notional_usd_total, "whole"),
    })),
    total:
      flows.routes.length === 0
        ? null
        : formatUsd(
            usdSum(flows.routes.map((route) => route.notional_usd_total)),
            "whole",
          ),
    transfers:
      flows.routes.length === 0
        ? null
        : groupThousands(
            BigInt(
              flows.routes.reduce(
                (sum, route) => sum + route.transfers_total,
                0,
              ),
            ),
          ),
    recent:
      flows.daily.length === 0
        ? null
        : {
            usd: formatUsd(
              usdSum(flows.daily.map((each) => each.notional_usd)),
              "whole",
            ),
            transfers: groupThousands(
              BigInt(
                flows.daily.reduce((sum, each) => sum + each.transfers, 0),
              ),
            ),
            days: flows.daily.length,
          },
    asOf: flows.as_of === null ? null : readTime(flows.as_of),
    missing,
  }
}

/**
 * ", 0.3% fee" for a Tigris pool whose title now names its type: the fee
 * the title used to carry, from the catalog. Empty for other pools.
 */
function feeNote(id: string): string {
  if (tigrisPoolTypes[id] === undefined) return ""
  const fee = crossChainPools.find((pool) => pool.id === id)?.feeBps ?? null
  return fee === null ? "" : `, ${fee / 100}% fee`
}

// -- search -------------------------------------------------------------------

export type PoolMatch = { title: string; where: string; path: string }

/**
 * Tracked pools for the search palette, from the catalog (no read): a name
 * query matches every word against the pool's pair, fee, venue and chain
 * ("curve 2pool", "mezo musd base"), an address or its start matches the
 * pool's address or Uniswap v4 pool id. At most `limit`, largest venue
 * pools first as the catalog lists them.
 */
export function poolMatches(
  q: string,
  kind: "name" | "address" | "address-prefix",
  limit = 5,
): PoolMatch[] {
  const query = q.trim().toLowerCase()
  if (query.length < 2) return []
  return crossChainPools
    .filter((pool) => isPoolChain(pool.chain))
    .filter((pool) => {
      if (kind !== "name") return pool.address.toLowerCase().startsWith(query)
      const vault = pool.venue === "mezo-savings"
      const text = [
        titleOf(pool.pair, pool.kind, vault, pool.id),
        pool.kind ?? "",
        poolTypeDescription(tigrisPoolTypes[pool.id] ?? { poolType: null }) ??
          "",
        pool.pair,
        venueOf(pool.venue),
        chainName(pool.chain),
        vault ? "savings vault smusd" : "pool",
        pool.legacy ? "legacy" : "",
      ].join(" ")
      return matchesWords(query, text)
    })
    .slice(0, limit)
    .map((pool) => {
      const vault = pool.venue === "mezo-savings"
      const address = pool.address.toLowerCase()
      return {
        title: titleOf(pool.pair, pool.kind, vault, pool.id),
        where: vault
          ? "Savings vault on Mezo"
          : `${venueOf(pool.venue)} on ${chainName(pool.chain)}${pool.legacy ? ", legacy pool" : ""}`,
        path:
          pool.chain === "mezo"
            ? `/pools/${address}`
            : `/pools/${pool.chain}/${address}`,
      }
    })
}
