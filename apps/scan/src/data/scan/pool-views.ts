import type { ScanGaugeEpochItem } from "@matchbox/contracts/scan"
import { epochIndexFor } from "@matchbox/domain/epoch"
import {
  formatBtc,
  formatDecimal,
  formatTokenWithSymbol,
  formatUsd,
  groupThousands,
  unitsToDecimal,
} from "@matchbox/domain/format"
import { compactUsd } from "./network-views"
import {
  addPriced,
  type DailyPrices,
  decimalUsd,
  epochPriceDay,
  pricedText,
  priceMap,
  tokenPriceOn,
  type Usd,
  usdDecimal,
} from "./pricing"
import type { SeriesView } from "./series.server"
import { dayLabel, pointLabel, type SeriesPanelData } from "./series-views"
import { percentText, shareBps } from "./voting-views"

/**
 * A Mezo pool's own figures (`ak42S52PlW`) from what the store keeps per
 * pool and token (swap volume in, fees, balances at the close) priced at
 * each day's close, and the pool gauge's epochs. On Mezo these on-chain
 * figures are the page's, never beside a second source's. Exact bigint;
 * a day a token has no close for is left out, never drawn smaller.
 */

/** A token's daily amounts, to price. */
export type TokenDays = { token: string; view: SeriesView }

export type PricedDay = { day: string; usd: Usd; partial: boolean }

/** The days every part prices, summed in USD, oldest first. */
export function pricedDays(
  parts: readonly TokenDays[],
  prices: DailyPrices,
): PricedDay[] {
  const days = new Map<string, PricedDay & { ok: boolean }>()
  for (const part of parts) {
    for (const point of part.view.points) {
      const entry = days.get(point.day) ?? {
        day: point.day,
        usd: 0n,
        partial: false,
        ok: true,
      }
      const price = tokenPriceOn(part.token, point.day, prices)
      if (price === null) entry.ok = false
      else entry.usd += decimalUsd(point.decimal, price)
      entry.partial ||= point.partial
      days.set(point.day, entry)
    }
  }
  return [...days.values()]
    .filter((entry) => entry.ok)
    .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0))
    .map(({ day, usd, partial }) => ({ day, usd, partial }))
}

/**
 * A level's days (balances at the close) priced and summed: only days
 * every part has a row for. A flow's missing row is no activity (zero);
 * a level's is a read that did not happen, so the day is left out rather
 * than drawn without one side.
 */
export function pricedLevels(
  parts: readonly TokenDays[],
  prices: DailyPrices,
): PricedDay[] {
  const counts = new Map<string, number>()
  for (const part of parts) {
    for (const day of new Set(part.view.points.map((point) => point.day))) {
      counts.set(day, (counts.get(day) ?? 0) + 1)
    }
  }
  return pricedDays(parts, prices).filter(
    (day) => counts.get(day.day) === parts.length,
  )
}

/** The highest fee tier on Mezo's pools: fees past it are not fees. */
const maxFeeBps = 100n

/**
 * Fees that agree with the volume: none of a day's fees above its volume
 * at the highest fee tier (1%). Data that breaks it is not shown at all.
 */
export function saneFees(
  volume: readonly PricedDay[],
  fees: readonly PricedDay[] | null,
): readonly PricedDay[] | null {
  if (fees === null) return null
  const byDay = new Map(volume.map((day) => [day.day, day.usd]))
  for (const day of fees) {
    const traded = byDay.get(day.day)
    if (traded === undefined) continue
    if (day.usd * 10_000n > traded * maxFeeBps) return null
  }
  return fees
}

function wholeDays(days: readonly PricedDay[], count: number): PricedDay[] {
  return days.filter((day) => !day.partial).slice(-count)
}

function sum(days: readonly PricedDay[]): Usd {
  return days.reduce((total, day) => total + day.usd, 0n)
}

/** A yearly rate in percent from basis points; null past 1,000%. */
function percentOfBps(bps: bigint): string | null {
  if (bps > 100_000n) return null
  return `${bps / 100n}.${(bps % 100n).toString().padStart(2, "0")}`
}

export type PoolStat = { label: string; value: string; note?: string }

/** The pool's last whole day of trading, and the week to it. */
export type PoolDay = {
  day: string
  volume: Usd
  fees: Usd | null
  /** The 7 whole days to `day`, when there are 7. */
  volume7d: Usd | null
  fees7d: Usd | null
}

export type VolumeView = {
  chart: SeriesPanelData
  stats: PoolStat[]
  last: PoolDay | null
}

/**
 * Daily swap volume in USD as a chart, with the last whole day's volume
 * and fees, the period's, and that day's volume against the reserves.
 */
export function volumeView(
  volume: readonly PricedDay[],
  fees: readonly PricedDay[] | null,
  reserves: Usd | null,
): VolumeView | null {
  const last = volume.at(-1)
  if (last === undefined) return null
  const first = volume[0]
  const whole = wholeDays(volume, volume.length)
  const lastWhole = whole.at(-1)
  const feeOf = (day: string) =>
    fees === null ? null : (fees.find((each) => each.day === day)?.usd ?? null)
  const week = wholeDays(volume, 7)
  const weekFees = fees === null ? [] : wholeDays(fees, 7)
  const poolDay: PoolDay | null =
    lastWhole === undefined
      ? null
      : {
          day: lastWhole.day,
          volume: lastWhole.usd,
          fees: feeOf(lastWhole.day),
          volume7d: week.length === 7 ? sum(week) : null,
          fees7d: weekFees.length === 7 ? sum(weekFees) : null,
        }
  const stats: PoolStat[] = []
  if (poolDay !== null) {
    stats.push({
      label: `Volume ${dayLabel(poolDay.day)}`,
      value: compactUsd(usdDecimal(poolDay.volume)),
    })
    if (poolDay.fees !== null) {
      stats.push({
        label: `Fees ${dayLabel(poolDay.day)}`,
        value: formatUsd(usdDecimal(poolDay.fees), "whole"),
      })
    }
  }
  if (whole.length > 0) {
    const periodFees = fees === null ? null : sum(wholeDays(fees, fees.length))
    stats.push({
      label: `${whole.length}d volume`,
      value: compactUsd(usdDecimal(sum(whole))),
      ...(periodFees === null
        ? {}
        : { note: `${compactUsd(usdDecimal(periodFees))} fees` }),
    })
  }
  if (poolDay !== null && reserves !== null && reserves > 0n) {
    const ratio = (poolDay.volume * 100n) / reserves
    stats.push({
      label: "Volume to reserves",
      value:
        ratio === 0n
          ? "<0.01×"
          : `${formatDecimal(`${ratio / 100n}.${(ratio % 100n).toString().padStart(2, "0")}`, 2)}×`,
    })
  }
  return {
    chart: {
      kind: "flow",
      points: volume.map((day) => ({
        day: day.day,
        // A chart height only; the figure is formatted from the bigint.
        value: Number(day.usd / 10n ** 16n) / 100,
        partial: day.partial,
        label: pointLabel(day),
        text: compactUsd(usdDecimal(day.usd)),
      })),
      computed: true,
      figure: compactUsd(usdDecimal(last.usd)),
      partial: last.partial,
      latestDay: dayLabel(last.day),
      startLabel: first === undefined ? "" : dayLabel(first.day),
      endLabel: dayLabel(last.day),
      endsOn: null,
    },
    stats: stats.slice(0, 4),
    last: poolDay,
  }
}

/**
 * Fees over 7 days a year, against the reserves, as a percent decimal
 * ("2.61"); null without 7 days, without reserves, or past 1,000%.
 */
export function feeApr(fees7d: Usd, reserves: Usd): string | null {
  if (reserves <= 0n) return null
  return percentOfBps((fees7d * 365n * 10_000n) / (7n * reserves))
}

/**
 * A chart panel's figures in the page's first paint; its days are read
 * after it (`poolPageCharts`), so the points never ride in the hydration data.
 */
export type ChartFigures = {
  /** "$11.42M": the last day's. */
  figure: string
  /** Beside the figure: "+$1.82M in 90d", "today so far", "8 Nov". */
  note: string | null
  stats: PoolStat[]
  /** The widest value and note the chart writes into the figure. */
  reserve: { value: string; note: string }
  startLabel: string
  endLabel: string
}

/** What a chart writes into its figure, for `ChartFigures.reserve`. */
export type ChartReserve = (chart: SeriesPanelData) => {
  value: string
  note: string
}

/**
 * A chart's figures without its days: its latest value, the note beside
 * it (the day, as `SeriesBody` writes it, unless given), its labels and
 * room for what its days write into the figure. Null for no days.
 */
export function chartFigures(
  chart: SeriesPanelData,
  stats: PoolStat[],
  reserve: ChartReserve,
  note: string | null = chart.partial ? "today so far" : chart.latestDay,
): ChartFigures | null {
  if (chart.figure === null) return null
  return {
    figure: chart.figure,
    note,
    stats,
    reserve: reserve(chart),
    startLabel: chart.startLabel,
    endLabel: chart.endLabel,
  }
}

/** "+$1.82M", "-$1,200". */
function signedUsd(usd: Usd): string {
  if (usd === 0n) return "$0"
  const text = compactUsd(usdDecimal(usd < 0n ? -usd : usd))
  return `${usd < 0n ? "-" : "+"}${text}`
}

/** The pool's liquidity per day as a chart (`SeriesChart` draws it). */
export function liquidityChart(days: readonly PricedDay[]): SeriesPanelData {
  const first = days[0]
  const last = days.at(-1)
  return {
    kind: "level",
    points: days.map((day) => ({
      day: day.day,
      // A chart height only; the text is formatted from the bigint.
      value: Number(day.usd / 10n ** 16n) / 100,
      partial: day.partial,
      label: pointLabel(day),
      text: compactUsd(usdDecimal(day.usd)),
    })),
    computed: true,
    figure: last === undefined ? null : compactUsd(usdDecimal(last.usd)),
    partial: last?.partial ?? false,
    latestDay: last === undefined ? null : dayLabel(last.day),
    startLabel: first === undefined ? "" : dayLabel(first.day),
    endLabel: last === undefined ? "" : dayLabel(last.day),
    endsOn: null,
  }
}

/**
 * The pool's liquidity in the page's first paint, without its days (the
 * chart reads them after paint, `liquidityChart`): the last day's
 * figure, its change over the `span` days from `from`, the high, its
 * share of every Mezo pool's liquidity (`dexTotal`, the per-token rollup
 * priced, on the same day) when known, and room for what the chart
 * writes into the figure, so nothing moves when it is drawn.
 */
export function liquidityView(
  days: readonly PricedDay[],
  dexTotal: { day: string; usd: Usd } | null,
  span: { days: number; from: string },
  reserve: ChartReserve,
): { view: ChartFigures | null; share: string | null } | null {
  const first = days[0]
  const last = days.at(-1)
  if (first === undefined || last === undefined) return null
  let high = first
  for (const day of days) if (day.usd > high.usd) high = day
  const share =
    dexTotal !== null && dexTotal.day === last.day && dexTotal.usd > 0n
      ? `${percentText(shareBps(last.usd, dexTotal.usd))} of DEX`
      : null
  const stats: PoolStat[] = [
    {
      label: `${span.days}d high`,
      value: compactUsd(usdDecimal(high.usd)),
      note: dayLabel(high.day),
    },
  ]
  if (share !== null) {
    stats.push({ label: "Share of DEX", value: share.replace(" of DEX", "") })
  }
  const view = chartFigures(
    liquidityChart(days),
    stats,
    reserve,
    first === last
      ? null
      : `${signedUsd(last.usd - first.usd)} ${
          first.day <= span.from
            ? `in ${span.days}d`
            : `since ${dayLabel(first.day)}`
        }`,
  )
  // "46.2% of DEX": its share of every Mezo pool's liquidity now, for the
  // page's header.
  return { view, share }
}

/** One side of the pool now, from its balance at the close. */
export type ReserveSide = {
  token: string
  symbol: string
  /** Whole units, a decimal string. */
  amount: string
  usd: Usd | null
}

/** Each side's latest balance, priced at its latest close. */
export function reserveSides(
  sides: readonly { token: string; symbol: string; view: SeriesView }[],
  prices: DailyPrices,
): { sides: ReserveSide[]; total: Usd | null; day: string | null } | null {
  const out: ReserveSide[] = []
  const days: string[] = []
  for (const side of sides) {
    const last = side.view.points.at(-1)
    if (last === undefined) return null
    days.push(last.day)
    const price = tokenPriceOn(side.token, last.day, prices)
    out.push({
      token: side.token,
      symbol: side.symbol,
      amount: last.decimal,
      usd: price === null ? null : decimalUsd(last.decimal, price),
    })
  }
  const total = out.every((side) => side.usd !== null)
    ? out.reduce((sum, side) => sum + (side.usd ?? 0n), 0n)
    : null
  return { sides: out, total, day: days.sort().at(-1) ?? null }
}

export type ReservesView = {
  /** "$1.08M": both sides now, priced; null when a side is not. */
  figure: string | null
  segments: { label: string; value: string; bps: number }[]
  stats: PoolStat[]
}

function sideText(side: ReserveSide): string {
  const amount =
    side.symbol === "BTC"
      ? formatBtc(side.amount).text
      : formatTokenWithSymbol(side.amount, side.symbol)
  return side.usd === null
    ? amount
    : `${amount}, ${compactUsd(usdDecimal(side.usd))}`
}

/**
 * The pool's two sides now, headlined by their dollar total and split by
 * value. No price is read off the balances: on a concentrated-liquidity
 * pool their ratio is not one.
 */
export function reservesView(
  sides: readonly ReserveSide[],
  stats: PoolStat[],
): ReservesView | null {
  if (sides.length < 2) return null
  const total = sides.every((side) => side.usd !== null)
    ? sides.reduce((sum, side) => sum + (side.usd ?? 0n), 0n)
    : null
  return {
    figure: total === null ? null : compactUsd(usdDecimal(total)),
    segments: sides.map((side) => ({
      label: side.symbol,
      value: sideText(side),
      bps:
        total === null || total === 0n
          ? Math.round(10_000 / sides.length)
          : shareBps(side.usd ?? 0n, total),
    })),
    stats,
  }
}

export type VotesView = {
  /** "88.10 veBTC". */
  figure: string
  /** "2.84%": the gauge's voter APY, from its profile. */
  apy: string | null
  stats: PoolStat[]
  bars: { epoch: number; value: number; text: string; current: boolean }[]
}

/** veBTC votes from 18-decimal units, two places: "88.10 veBTC". */
function veBtc(units: string | bigint): string {
  return `${formatDecimal(unitsToDecimal(units.toString(), 18), 2)} veBTC`
}

/**
 * The pool gauge's veBTC votes per epoch: the last 12 epochs, the epoch
 * before (as its own figure while this one runs), voters, what its voters
 * were paid (at the epoch's close, so far while it runs) and their APY.
 */
export function votesView(
  rows: readonly ScanGaugeEpochItem[],
  current: number,
  prices: DailyPrices,
  at: number,
  apy: string | null,
): VotesView | null {
  const ordered = [...rows].sort((a, b) => a.epoch_start - b.epoch_start)
  const last = ordered.at(-1)
  if (last === undefined) return null
  const running = epochIndexFor(last.epoch_start) === current
  const before = ordered.at(-2)
  const stats: PoolStat[] = []
  if (before !== undefined) {
    stats.push({
      label: `Epoch ${epochIndexFor(before.epoch_start)}`,
      value: veBtc(before.vote_weight),
    })
  }
  stats.push({ label: "Voters", value: groupThousands(BigInt(last.voters)) })
  const day = epochPriceDay(last.epoch_start, at)
  const paid = pricedText(
    addPriced(
      priceMap(last.incentives, day, prices),
      priceMap(last.fees, day, prices),
    ),
  )
  if (paid !== null) {
    stats.push({
      label: running ? "To voters so far" : "To voters",
      value: paid,
    })
  }
  const apyText = apy === null ? null : `${formatDecimal(apy, 2)}%`
  if (apyText !== null) stats.push({ label: "Voter APY", value: apyText })
  return {
    figure: veBtc(last.vote_weight),
    apy: apyText,
    stats: stats.slice(0, 4),
    bars: ordered.slice(-12).map((row) => ({
      epoch: epochIndexFor(row.epoch_start),
      value: Number(BigInt(row.vote_weight) / 10n ** 14n) / 10_000,
      text: veBtc(row.vote_weight),
      current: epochIndexFor(row.epoch_start) === current,
    })),
  }
}
