import { crossChainPools } from "@matchbox/chain"
import { groupThousands, shortAddress } from "@matchbox/domain/format"
import { titleOf } from "./crosschain-views"
import { compactUsd } from "./network-views"
import {
  amountUsd,
  type DailyPrices,
  decimalUsd,
  pricedToken,
  scaled,
  tokenPriceOn,
  type Usd,
  usdDecimal,
} from "./pricing"
import type { SeriesView } from "./series.server"
import { dayLabel, pointLabel, type SeriesPanelData } from "./series-views"
import type { SplitSeries, SplitView } from "./split.server"
import { knownTokens } from "./tokens"
import { weekly } from "./weekly"

/**
 * Mezo's markets over time, from the per-token rollups and the pool-token
 * series (batch 2): every pool's liquidity and swap volume together, in
 * USD at each day's close (BTC and its wrappers at BTC's, MEZO at MEZO's,
 * dollar tokens taken as $1), and what sits in each pool now. Exact bigint
 * throughout; a token with no pricing is left out and named, and a day a
 * priced token has no close for is left out, never drawn smaller.
 */

/** One day's USD at 18 places. */
export type UsdDay = { day: string; usd: Usd; partial: boolean }

/** A token's symbol as Scan names it, else its short address. */
export function tokenSymbol(token: string): string {
  const key = token.toLowerCase()
  return (
    pricedToken(key)?.symbol ?? knownTokens[key]?.symbol ?? shortAddress(key)
  )
}

/**
 * The split's series priced day by day and summed: `unpriced` names the
 * tokens with no pricing that hold anything (their amounts are left out of
 * every day), and a day where a priced token has no close is dropped.
 */
export function pricedSplit(
  series: readonly SplitSeries[],
  prices: DailyPrices,
): { days: UsdDay[]; unpriced: string[] } {
  const days = new Map<string, UsdDay & { ok: boolean }>()
  const unpriced = new Set<string>()
  for (const each of series) {
    const token = each.token
    if (token === null) continue
    if (pricedToken(token) === null) {
      if (each.points.some((point) => point.units !== 0n)) {
        unpriced.add(tokenSymbol(token))
      }
      continue
    }
    for (const point of each.points) {
      const entry = days.get(point.day) ?? {
        day: point.day,
        usd: 0n,
        partial: false,
        ok: true,
      }
      const usd = amountUsd(token, point.units, point.day, prices)
      if (usd === null) entry.ok = point.units === 0n && entry.ok
      else entry.usd += usd
      entry.partial ||= point.partial
      days.set(point.day, entry)
    }
  }
  return {
    days: [...days.values()]
      .filter((entry) => entry.ok)
      .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0))
      .map(({ day, usd, partial }) => ({ day, usd, partial })),
    unpriced: [...unpriced].sort(),
  }
}

/** A part of a sum over days, with what is known about its gaps. */
export type UsdPart = {
  days: readonly UsdDay[]
  /**
   * Days before this one count as zero (the series had not started);
   * null when the part has no row at all (zero throughout).
   */
  firstDay: string | null
  /** Days before this one are unknown (not read). */
  knownFrom: string
}

/**
 * Parts added day by day, on the days any part has a row. A part with no
 * row on a day it should have one makes the day unknown: dropped, never
 * drawn smaller. Before a part's first day it counts as zero.
 */
export function sumParts(parts: readonly UsdPart[]): UsdDay[] {
  const maps = parts.map(
    (part) => new Map(part.days.map((day) => [day.day, day])),
  )
  const all = new Set(parts.flatMap((part) => part.days.map((day) => day.day)))
  const out: UsdDay[] = []
  for (const day of [...all].sort()) {
    let usd = 0n
    let partial = false
    let known = true
    parts.forEach((part, index) => {
      const row = maps[index]?.get(day)
      if (row !== undefined) {
        usd += row.usd
        partial ||= row.partial
        return
      }
      if (day < part.knownFrom) known = false
      else if (part.firstDay !== null && day >= part.firstDay) known = false
    })
    if (known) out.push({ day, usd, partial })
  }
  return out
}

/**
 * A part's USD on a day the sum knows: its row, or zero before its first
 * day (a known day past that always has one).
 */
export function partOn(part: UsdPart, day: string): Usd {
  return part.days.find((each) => each.day === day)?.usd ?? 0n
}

/** A day after every stored day: everything before it is unknown. */
const never = "9999-12-31"

/** The later of two days. */
function laterDay(a: string, b: string): string {
  return a > b ? a : b
}

/**
 * A level series at each day's BTC close (veBTC locked, trove BTC). Days
 * before its first stored day are unknown, not zero: the series may
 * start at the jobs deploy, with its history not backfilled yet.
 */
export function btcPart(
  view: SeriesView,
  prices: DailyPrices,
  knownFrom: string,
): UsdPart {
  const btc = "0x7b7c000000000000000000000000000000000000"
  const days: UsdDay[] = []
  for (const point of view.points) {
    // Whole BTC back to its 18-decimal base units, exactly.
    const usd = amountUsd(btc, scaled(point.decimal), point.day, prices)
    if (usd !== null) {
      days.push({ day: point.day, usd, partial: point.partial })
    }
  }
  return {
    days,
    firstDay: view.firstDay,
    knownFrom: laterDay(knownFrom, view.firstDay ?? never),
  }
}

/**
 * A split's priced days as a part of a sum. Days before its first priced
 * day are unknown, never zero: the rollups start at the jobs deploy until
 * the backfill runs, and a pool's days before its token's first close
 * drop out of the priced split.
 */
export function splitPart(
  split: SplitView,
  priced: { days: UsdDay[] },
): UsdPart {
  const first = priced.days[0]?.day ?? null
  return {
    days: priced.days,
    firstDay: first,
    knownFrom: laterDay(split.from, first ?? never),
  }
}

/**
 * USD days as a chart (`SeriesBody` and `SeriesChart` draw it), by the
 * week past `dailyMost` days (a flow's week summed exactly).
 */
export function usdChart(
  days: readonly UsdDay[],
  kind: "flow" | "level",
): SeriesPanelData {
  const first = days[0]
  const last = days.at(-1)
  return {
    kind,
    points: weekly(
      days,
      kind,
      (day) => ({
        day: day.day,
        // A chart height only; the text is formatted from the bigint.
        value: Number(day.usd / 10n ** 16n) / 100,
        partial: day.partial,
        label: pointLabel(day),
        text: compactUsd(usdDecimal(day.usd)),
      }),
      (week) => {
        const usd = sumUsd(week)
        return {
          value: Number(usd / 10n ** 16n) / 100,
          text: compactUsd(usdDecimal(usd)),
        }
      },
    ),
    computed: true,
    figure: last === undefined ? null : compactUsd(usdDecimal(last.usd)),
    partial: last?.partial ?? false,
    latestDay: last === undefined ? null : dayLabel(last.day),
    startLabel: first === undefined ? "" : dayLabel(first.day),
    endLabel: last === undefined ? "" : dayLabel(last.day),
    endsOn: null,
  }
}

/** Whole (not partial) days of a flow, the last `count` of them. */
export function wholeDays(days: readonly UsdDay[], count: number): UsdDay[] {
  return days.filter((day) => !day.partial).slice(-count)
}

export function sumUsd(days: readonly UsdDay[]): Usd {
  return days.reduce((total, day) => total + day.usd, 0n)
}

/** The day with the most, null for none. */
export function peakDay(days: readonly UsdDay[]): UsdDay | null {
  let peak: UsdDay | null = null
  for (const day of days) if (peak === null || day.usd > peak.usd) peak = day
  return peak
}

// -- pools -------------------------------------------------------------------

/** A Mezo pool the catalog tracks (it has a page), else undefined. */
function trackedPool(address: string) {
  return crossChainPools.find(
    (pool) =>
      pool.chain === "mezo" &&
      pool.venue === "tigris" &&
      pool.address.toLowerCase() === address,
  )
}

export type PoolRow = {
  pool: string
  /** "BTC/MUSD" from the pool's two tokens. */
  name: string
  /** Its page on Matchscan, when there is one. */
  href: string | null
}

/**
 * Pools by address from a pool-token split: a tracked pool by its title
 * ("BTC/MUSD CL200", as its gauge reads), any other by its tokens; two
 * untracked pools with the same pair get their short address after it.
 */
export function poolRows(series: readonly SplitSeries[]): Map<string, PoolRow> {
  const tokens = new Map<string, string[]>()
  for (const each of series) {
    const [pool, token] = each.dimension.split(":")
    if (pool === undefined || token === undefined) continue
    const list = tokens.get(pool) ?? []
    if (!list.includes(token)) list.push(token)
    tokens.set(pool, list)
  }
  const names = new Map<string, string>()
  for (const [pool, list] of tokens) {
    names.set(pool, list.map(tokenSymbol).join("/"))
  }
  const counts = new Map<string, number>()
  for (const name of names.values()) {
    counts.set(name, (counts.get(name) ?? 0) + 1)
  }
  const rows = new Map<string, PoolRow>()
  for (const [pool, name] of names) {
    const tracked = trackedPool(pool)
    rows.set(pool, {
      pool,
      name:
        tracked !== undefined
          ? titleOf(tracked.pair, tracked.kind, false, tracked.id)
          : (counts.get(name) ?? 0) > 1
            ? `${name} ${shortAddress(pool)}`
            : name,
      href: tracked === undefined ? null : `/pools/${pool}`,
    })
  }
  return rows
}

/** The latest day any series of a split has a row for. */
export function latestDayOf(series: readonly SplitSeries[]): string | null {
  let latest: string | null = null
  for (const each of series) {
    const day = each.points.at(-1)?.day
    if (day !== undefined && (latest === null || day > latest)) latest = day
  }
  return latest
}

/** One pool's value on one day. */
export type PoolValue = PoolRow & { usd: Usd; partial: boolean }

/**
 * Each pool's volume in on `day` from a pool-token split, each token at
 * that day's close, largest first: the same tokens the day's figure
 * (`pricedSplit` of the per-token rollup) counts, so the pools add up to
 * it. A token with no pricing is left out of its pool and named in
 * `unpriced`; a pool with nothing priced is left out.
 */
export function poolValuesOn(
  series: readonly SplitSeries[],
  day: string,
  prices: DailyPrices,
): { pools: PoolValue[]; unpriced: string[] } {
  const rows = poolRows(series)
  const sums = new Map<string, { usd: Usd; partial: boolean }>()
  const unpriced = new Set<string>()
  for (const each of series) {
    const [pool] = each.dimension.split(":")
    if (pool === undefined || each.token === null) continue
    const point = each.points.find((candidate) => candidate.day === day)
    if (point === undefined) continue
    const entry = sums.get(pool) ?? { usd: 0n, partial: false }
    const usd = amountUsd(each.token, point.units, day, prices)
    if (usd === null) {
      if (point.units !== 0n) unpriced.add(tokenSymbol(each.token))
    } else {
      entry.usd += usd
    }
    entry.partial ||= point.partial
    sums.set(pool, entry)
  }
  const pools: PoolValue[] = []
  for (const [pool, entry] of sums) {
    const row = rows.get(pool)
    if (row === undefined) continue
    pools.push({ ...row, usd: entry.usd, partial: entry.partial })
  }
  pools.sort((a, b) => (a.usd === b.usd ? 0 : a.usd > b.usd ? -1 : 1))
  return { pools, unpriced: [...unpriced].sort() }
}

/** Each pool's balance of one token on `day`, largest first. */
export function tokenInPools(
  series: readonly SplitSeries[],
  token: string,
  day: string,
): (PoolRow & { units: bigint })[] {
  const rows = poolRows(series)
  const out: (PoolRow & { units: bigint })[] = []
  for (const each of series) {
    if (each.token !== token.toLowerCase()) continue
    const [pool] = each.dimension.split(":")
    const row = pool === undefined ? undefined : rows.get(pool)
    const point = each.points.find((candidate) => candidate.day === day)
    if (row === undefined || point === undefined || point.units === 0n) {
      continue
    }
    out.push({ ...row, units: point.units })
  }
  return out.sort((a, b) =>
    a.units === b.units ? 0 : a.units > b.units ? -1 : 1,
  )
}

// -- collateral ratios ---------------------------------------------------------

/** A day's collateral over debt, both in USD at that day's close. */
export type RatioDay = { day: string; bps: bigint; partial: boolean }

/**
 * Collateral over debt per day, in basis points (19,020 is 190.2%): each
 * side's close (whole units) priced at that day's close, on the days both
 * have a row, a price and some debt. A day missing either side is left
 * out, never drawn at zero.
 */
export function ratioDays(
  collateral: { token: string; view: SeriesView },
  debt: { token: string; view: SeriesView },
  prices: DailyPrices,
): RatioDay[] {
  const debts = new Map(debt.view.points.map((point) => [point.day, point]))
  const out: RatioDay[] = []
  for (const point of collateral.view.points) {
    const owed = debts.get(point.day)
    if (owed === undefined) continue
    const collateralPrice = tokenPriceOn(collateral.token, point.day, prices)
    const debtPrice = tokenPriceOn(debt.token, point.day, prices)
    if (collateralPrice === null || debtPrice === null) continue
    const debtUsd = decimalUsd(owed.decimal, debtPrice)
    if (debtUsd <= 0n) continue
    out.push({
      day: point.day,
      bps: (decimalUsd(point.decimal, collateralPrice) * 10_000n) / debtUsd,
      partial: point.partial || owed.partial,
    })
  }
  return out
}

/** "190.2%" from basis points. */
export function ratioText(bps: bigint): string {
  const tenths = (bps + 5n) / 10n
  return `${groupThousands(tenths / 10n)}.${tenths % 10n}%`
}
