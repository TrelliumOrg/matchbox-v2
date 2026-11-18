import {
  formatCompact,
  formatPrice,
  formatTokenWithSymbol,
  formatUsd,
  groupThousands,
  parseDecimal,
  unitsToDecimal,
} from "@matchbox/domain/format"
import type { Section } from "../explorer"
import { type Period, periodPoints } from "./period"
import type { SeriesView } from "./series.server"
import {
  dayLabel,
  pointLabel,
  rangeDays,
  type SeriesPanelData,
} from "./series-views"
import { changeText } from "./voting-views"
import { weekly } from "./weekly"

/**
 * Figures the Network and Tokens pages derive from one daily series at a
 * time: sums, averages and peaks of a flow over its last days, a level's
 * change over a period, and USD at a daily price. Every figure is bigint
 * arithmetic on the points' exact decimals (financial-precision.md); only
 * chart heights are floats. Two metrics are never added together.
 */

const daySeconds = (day: string): number =>
  Math.floor(Date.parse(`${day}T00:00:00Z`) / 1000)

/**
 * Days to read for a panel of `days` whose stats look up to 30 days back:
 * a week more, since a level's last row may be days old and its stats
 * count back from it. Never past one series request (the All range).
 */
export function statWindow(days: number): number {
  return Math.min(Math.max(days, 30) + 8, rangeDays("All"))
}

/** A decimal string as an integer at `places` (digits beyond are cut). */
export function scaledDecimal(decimal: string, places: number): bigint {
  const { negative, int, fraction } = parseDecimal(decimal)
  const kept = fraction.padEnd(places, "0").slice(0, places)
  const value = int * 10n ** BigInt(places) + (kept === "" ? 0n : BigInt(kept))
  return negative ? -value : value
}

/** The points of the `days` days up to the series' last point. */
function lastPoints<Point extends { day: string }>(
  points: readonly Point[],
  days: number,
): Point[] {
  const last = points.at(-1)
  if (last === undefined) return []
  const from = daySeconds(last.day) - (days - 1) * 86_400
  return points.filter((point) => daySeconds(point.day) >= from)
}

/**
 * The series from `days` before its last point. A backfill-only series
 * ends in the past, so its window is counted back from where it ends, not
 * from today.
 */
export function lastDays(
  section: Section<SeriesView>,
  days: number,
): Section<SeriesView> {
  if (section.status !== "ok") return section
  const points = lastPoints(section.data.points, days)
  const last = points.at(-1)
  return {
    ...section,
    data: {
      ...section.data,
      points,
      latest:
        last === undefined ? null : { text: last.text, partial: last.partial },
    },
  }
}

/** Complete days only: today's value so far is not a day's total. */
function completeDays(view: SeriesView, days: number) {
  return lastPoints(
    view.points.filter((point) => !point.partial),
    days,
  )
}

/** A flow's total over its last `days` complete days at `places`. */
export function flowSum(
  view: SeriesView,
  days: number,
  places = 0,
): bigint | null {
  const points = completeDays(view, days)
  if (points.length === 0) return null
  return points.reduce(
    (sum, point) => sum + scaledDecimal(point.decimal, places),
    0n,
  )
}

/** A count flow's mean per complete day, rounded half up. */
export function countAverage(view: SeriesView, days: number): bigint | null {
  const points = completeDays(view, days)
  if (points.length === 0) return null
  const sum = points.reduce(
    (total, point) => total + scaledDecimal(point.decimal, 0),
    0n,
  )
  const count = BigInt(points.length)
  return (sum * 2n + count) / (count * 2n)
}

/** A count flow's largest day among its last `days`. */
export function countPeak(view: SeriesView, days: number): bigint | null {
  const points = lastPoints(view.points, days)
  if (points.length === 0) return null
  // Bigints: Math.max does not take them.
  let peak: bigint | null = null
  for (const point of points) {
    const value = scaledDecimal(point.decimal, 0)
    if (peak === null || value > peak) peak = value
  }
  return peak
}

/**
 * A level's change over `days` at `places`: its last point against the
 * latest point at least `days` before it. Null without one (a level has no
 * row for days its source was not read, so an earlier point stands in).
 */
export function levelChange(
  view: SeriesView,
  days: number,
  places = 0,
): bigint | null {
  const last = view.points.at(-1)
  if (last === undefined) return null
  const before = daySeconds(last.day) - days * 86_400
  const earlier = view.points
    .filter((point) => daySeconds(point.day) <= before)
    .at(-1)
  if (earlier === undefined) return null
  return (
    scaledDecimal(last.decimal, places) - scaledDecimal(earlier.decimal, places)
  )
}

/** What a change stat says while its series is younger than the period. */
export const shortHistory = "Not enough history yet"

export type LevelChange =
  | { status: "ok"; value: bigint }
  /** The series starts after the period's first day: no change exists yet. */
  | { status: "short" }
  /** Nothing far enough back in what was read (a gap, or no points). */
  | { status: "none" }

/**
 * A level's change over `days`, only when the series itself reaches back
 * that far (`firstDay`): a series that started last week has no 30 day
 * change, whatever its points say. Never a stand-in from another metric.
 */
export function changeOver(
  view: SeriesView,
  days: number,
  places = 0,
): LevelChange {
  const last = view.points.at(-1)
  if (last === undefined) return { status: "none" }
  const needed = daySeconds(last.day) - days * 86_400
  if (view.firstDay === null || daySeconds(view.firstDay) > needed) {
    return { status: "short" }
  }
  const value = levelChange(view, days, places)
  return value === null ? { status: "none" } : { status: "ok", value }
}

/**
 * A change as a panel stat: the signed figure, "Not enough history yet"
 * while the series is younger than the period, nothing for a gap.
 */
export function changeStat(
  label: string,
  change: LevelChange,
  format: (value: bigint) => string,
): { label: string; value: string; tone?: "pos" | "neg" } | null {
  if (change.status === "short") return { label, value: shortHistory }
  if (change.status === "none") return null
  return {
    label,
    value: format(change.value),
    tone: change.value < 0n ? "neg" : "pos",
  }
}

/** "1,906" for a count. */
export function countFigure(value: bigint): string {
  return groupThousands(value)
}

/** "+1,284", "-12", "0" for a change in a count. */
export function signedCount(value: bigint): string {
  if (value === 0n) return "0"
  return value < 0n ? `-${groupThousands(-value)}` : `+${groupThousands(value)}`
}

/** "+833.4k MUSD" for a change in whole units, from `places`. */
export function signedCompact(
  value: bigint,
  places: number,
  symbol: string,
): string {
  const whole = value / 10n ** BigInt(places)
  const sign = value < 0n ? "-" : value > 0n ? "+" : ""
  return `${sign}${formatCompact(whole < 0n ? -whole : whole)} ${symbol}`
}

/** "19,043,276 MUSD": whole units, grouped. */
export function wholeAmount(decimal: string, symbol: string): string {
  const { negative, int } = parseDecimal(decimal)
  return `${negative && int > 0n ? "-" : ""}${groupThousands(int)} ${symbol}`
}

/** "19.04M MUSD": whole units, compact (tables). */
export function compactAmount(decimal: string, symbol: string): string {
  // Compact from a thousand up; below that the whole part alone would
  // read 0.5 mcbBTC as "0 mcbBTC".
  if (parseDecimal(decimal).int < 1_000n) {
    return formatTokenWithSymbol(decimal, symbol)
  }
  return `${formatCompact(parseDecimal(decimal).int)} ${symbol}`
}

/** An amount's USD at a price, both decimal strings, exact. */
export function usdValue(amount: string, price: string): string {
  const places = 18
  const product = scaledDecimal(amount, places) * scaledDecimal(price, places)
  return unitsToDecimal(product.toString(), places * 2)
}

/** "$205.8M", "$75.92M", "$8,400": compact above $100,000. */
export function compactUsd(decimal: string): string {
  const { negative, int } = parseDecimal(decimal)
  if (int < 100_000n) return formatUsd(decimal, "whole")
  return `${negative ? "-" : ""}$${formatCompact(int)}`
}

// -- prices ------------------------------------------------------------------

export type PricePoint = { day: string; price: string; partial: boolean }

export type PriceFacts = {
  /** "$0.184" from the latest daily price. */
  price: string
  /** The latest price, a decimal string, for USD values. */
  decimal: string
  /** Against the day before ("+1.8%"), null without one. */
  day: { text: string; tone: "pos" | "neg" } | null
  /**
   * Against 7 days before; "short" when the price history does not reach
   * back that far (a new series), null when it does but has no such day.
   */
  week: PriceChange | "short" | null
  /** Against 30 days before, as `week`. */
  month: PriceChange | "short" | null
}

type PriceChange = { text: string; tone: "pos" | "neg" }

function priceChange(
  points: readonly PricePoint[],
  days: number,
  firstDay: string | null,
): PriceChange | "short" | null {
  const last = points.at(-1)
  if (last === undefined) return null
  const before = daySeconds(last.day) - days * 86_400
  const earlier = points
    .filter((point) => daySeconds(point.day) <= before)
    .at(-1)
  if (earlier === undefined) {
    // The series starts after that day: too new, which is not "no change".
    const first = firstDay ?? points[0]?.day ?? last.day
    return daySeconds(first) > before ? "short" : null
  }
  const text = changeText(
    scaledDecimal(last.price, 18),
    scaledDecimal(earlier.price, 18),
  )
  if (text === null) return null
  return { text, tone: text.startsWith("-") ? "neg" : "pos" }
}

/**
 * The latest price and its changes; null for an empty series. `firstDay`
 * is the series' first day anywhere (the read may start later).
 */
export function priceFacts(
  points: readonly PricePoint[],
  firstDay: string | null,
): PriceFacts | null {
  const last = points.at(-1)
  if (last === undefined) return null
  const day = priceChange(points, 1, firstDay)
  return {
    price: formatPrice(last.price),
    decimal: last.price,
    day: day === "short" ? null : day,
    week: priceChange(points, 7, firstDay),
    month: priceChange(points, 30, firstDay),
  }
}

/**
 * A daily price as a captioned panel draws it (a level, in USD), over the
 * last `days` or a period's days.
 */
export function pricePanel(
  points: readonly PricePoint[],
  days: number | Period,
  firstDay: string | null,
): SeriesPanelData {
  const shown =
    typeof days === "number"
      ? lastPoints(points, days)
      : periodPoints(points, days)
  const first = shown[0]
  const last = shown.at(-1)
  return {
    kind: "level",
    // A level: past `dailyMost` days, each week's last close.
    points: weekly(
      shown,
      "level",
      (point) => ({
        day: point.day,
        // A chart height only; every figure is formatted from the decimal.
        value: Number(point.price),
        partial: point.partial,
        label: pointLabel(point),
        text: formatPrice(point.price),
      }),
      () => ({ value: 0, text: "" }),
    ),
    computed: firstDay !== null,
    figure: last === undefined ? null : formatPrice(last.price),
    partial: last?.partial ?? false,
    latestDay: last === undefined ? null : dayLabel(last.day),
    startLabel: first === undefined ? "" : dayLabel(first.day),
    endLabel: last === undefined ? "" : dayLabel(last.day),
    endsOn: null,
  }
}

/** The lowest and highest daily price among the last `days` or a period's. */
export function priceRange(
  points: readonly PricePoint[],
  days: number | Period,
): { low: string; high: string } | null {
  const shown =
    typeof days === "number"
      ? lastPoints(points, days)
      : periodPoints(points, days)
  const first = shown[0]
  if (first === undefined) return null
  let low = first
  let high = first
  for (const point of shown) {
    const value = scaledDecimal(point.price, 18)
    if (value < scaledDecimal(low.price, 18)) low = point
    if (value > scaledDecimal(high.price, 18)) high = point
  }
  return { low: formatPrice(low.price), high: formatPrice(high.price) }
}
