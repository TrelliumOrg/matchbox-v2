import type { PeriodView, Range } from "../../explorer/voting/range"
import { isDay, spanText } from "../../explorer/voting/span-text"
import type { Section } from "../explorer"
import { seriesRanges } from "./series"
import type { SeriesView } from "./series.server"

/**
 * A captioned panel's period on the server: 30d, 90d, All, or a custom
 * span (`?from=&to=`). A span is checked here, whatever the URL says: a
 * day that is not a real date drops the span (the range stands), days
 * past today or before the first day there is (the later of the All
 * range's start and `firstDataDay`, as the form's own bounds) are clamped
 * to them, and a reversed span is put in order. Every read for a span
 * ends today (the stats beside a chart count back from today), reaching
 * back past the span's first day by a fixed number of days
 * (`readBuckets`), so spans share the API's cache entries with each other
 * and with the ranges; the chart shows the span's days alone.
 */

/** The first day Scan holds data for (Mezo's mainnet, 6 May 2025). */
export const firstDataDay = "2025-05-06"

export type Period = {
  /** The range asked for; null for a custom span. */
  range: Range | null
  /** The first and last days shown, "2026-01-01". */
  from: string
  to: string
  /** Days shown. */
  days: number
  /**
   * Days to read, back from today, to reach `from`: one of `readBuckets`
   * for a span, the range's own days for a range.
   */
  read: number
}

/**
 * The days a span reads upstream: the fewest of these that reach its
 * first day. Never the span's own count, which would make each first
 * day its own cache entry in the API; 30, 90 and 730 are the ranges'.
 */
export const readBuckets = [30, 90, 180, 365, seriesRanges.All] as const

/** The fewest bucketed days that reach back `days`. */
function bucketed(days: number): number {
  return readBuckets.find((bucket) => bucket >= days) ?? seriesRanges.All
}

export type { PeriodView }

const daySeconds = (day: string): number =>
  Math.floor(Date.parse(`${day}T00:00:00Z`) / 1000)

const dayOf = (seconds: number): string =>
  new Date(seconds * 1000).toISOString().slice(0, 10)

/** "2026-02-30" is no day: only a date that round-trips is. */
const realDay = (value: unknown): string | null => (isDay(value) ? value : null)

function field(input: unknown, key: string): unknown {
  return typeof input === "object" && input !== null && key in input
    ? Reflect.get(input, key)
    : undefined
}

const between = (day: string, low: string, high: string): string =>
  day < low ? low : day > high ? high : day

const daysFrom = (from: string, to: string): number =>
  Math.round((daySeconds(to) - daySeconds(from)) / 86_400) + 1

/** The first day a span may start on at `now`: the form's `min`. */
function earliestDay(now: number): string {
  const earliest = dayOf(now - (seriesRanges.All - 1) * 86_400)
  return earliest > firstDataDay ? earliest : firstDataDay
}

/**
 * The period a loader's input asks for at `now` (seconds): its span when
 * both days are real dates, else its range (30d unless 90d or All).
 */
export function periodOf(input: unknown, now: number): Period {
  const today = dayOf(now)
  const earliest = earliestDay(now)
  const from = realDay(field(input, "from"))
  const to = realDay(field(input, "to"))
  if (from !== null && to !== null) {
    const [low, high] = from <= to ? [from, to] : [to, from]
    const first = between(low, earliest, today)
    const last = between(high, earliest, today)
    return {
      range: null,
      from: first,
      to: last,
      days: daysFrom(first, last),
      read: bucketed(daysFrom(first, today)),
    }
  }
  const asked = field(input, "range")
  const range: Range = asked === "90d" || asked === "All" ? asked : "30d"
  const days = seriesRanges[range]
  return {
    range,
    from: dayOf(now - (days - 1) * 86_400),
    to: today,
    days,
    read: days,
  }
}

/** The period as its toggle shows it. */
export function periodView(period: Period, now: number): PeriodView {
  const today = dayOf(now)
  return {
    range: period.range,
    from: period.from,
    to: period.to,
    min: earliestDay(now),
    max: today,
    text: period.range ?? spanText(period.from, period.to, today),
  }
}

/** The period's name in a label: "30d", "All", "1 Jan to 31 Mar". */
export function periodName(period: Period, now: number): string {
  return period.range ?? spanText(period.from, period.to, dayOf(now))
}

/**
 * Days of a list (oldest first) that fall in the period: a range counts
 * back from the last day there is (a backfill-only series ends in the
 * past), a span keeps its own days.
 */
export function periodPoints<Point extends { day: string }>(
  points: readonly Point[],
  period: Period,
): Point[] {
  if (period.range === null) {
    return points.filter(
      (point) => point.day >= period.from && point.day <= period.to,
    )
  }
  const last = points.at(-1)
  if (last === undefined) return []
  const from = dayOf(daySeconds(last.day) - (period.days - 1) * 86_400)
  return points.filter((point) => point.day >= from)
}

/** A series cut to the period, its latest point the period's last. */
export function periodSeries(
  section: Section<SeriesView>,
  period: Period,
): Section<SeriesView> {
  if (section.status !== "ok") return section
  const points = periodPoints(section.data.points, period)
  const last = points.at(-1)
  return {
    ...section,
    data: {
      ...section.data,
      points,
      latest:
        last === undefined ? null : { text: last.text, partial: last.partial },
      outside:
        period.range === null &&
        points.length === 0 &&
        section.data.points.length > 0,
    },
  }
}
