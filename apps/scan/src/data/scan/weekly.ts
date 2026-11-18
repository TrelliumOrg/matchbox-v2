import {
  formatDay,
  parseDecimal,
  unitsToDecimal,
} from "@matchbox/domain/format"

/**
 * Long charts by the week. A panel over more than `dailyMost` days draws
 * one bar per week (a flow: the week's days summed exactly) or one point
 * per week (a level: the week's last day, its closing value, after the
 * series' first day), so a bar
 * never shrinks to nothing and the page stays small. Weeks start on
 * Monday (UTC). The first and last weeks cover only the days the chart
 * has, and say so: "Week of 3 Mar" for a whole week, "6 to 9 Mar" for
 * part of one, "Week of 10 Nov so far" for the week still filling; a
 * part week's bar is drawn dashed, as the filling week's is.
 * Figures and stats beside a chart are computed from the daily series,
 * never from these buckets.
 */

/** A chart over more days than this draws a bar or point per week. */
export const dailyMost = 120

/** A point as the charts draw it. */
export type DrawnPoint = {
  day: string
  value: number
  partial: boolean
  label: string
  text: string
}

const daySeconds = (day: string): number =>
  Math.floor(Date.parse(`${day}T00:00:00Z`) / 1000)

const dayOf = (seconds: number): string =>
  new Date(seconds * 1000).toISOString().slice(0, 10)

/** "5 Nov" from "2026-11-05". */
function dayText(day: string): string {
  return formatDay(daySeconds(day)).slice(4)
}

/** The Monday of the day's week, UTC: "2026-11-09" for "2026-11-12". */
export function weekOf(day: string): string {
  const seconds = daySeconds(day)
  const weekday = (new Date(seconds * 1000).getUTCDay() + 6) % 7
  return dayOf(seconds - weekday * 86_400)
}

/** "6 to 9 Mar", "28 Feb to 2 Mar". */
function spanText(first: string, last: string): string {
  const [from, to] = [dayText(first), dayText(last)]
  const [fromDate, fromMonth] = from.split(" ")
  const [, toMonth] = to.split(" ")
  return fromMonth === toMonth ? `${fromDate} to ${to}` : `${from} to ${to}`
}

/**
 * What a weekly bucket covers, from its first to its last day shown:
 * "Week of 3 Mar" for a whole week, "6 to 9 Mar" for part of one, a day's
 * own label for one day, with "so far" while it is still filling.
 */
export function weekLabel(
  first: string,
  last: string,
  partial: boolean,
): string {
  const whole = daySeconds(last) - daySeconds(first) === 6 * 86_400
  const text = whole
    ? `Week of ${dayText(first)}`
    : first === last
      ? dayText(first)
      : spanText(first, last)
  return partial ? `${text} so far` : text
}

/**
 * The points as drawn: one per day up to `dailyMost`, else one per week.
 * `draw` draws a day; `sum` a flow's week from its days (exactly: never
 * from the chart's floats). A week's bucket is drawn at its first day.
 */
export function weekly<Point extends { day: string; partial: boolean }>(
  points: readonly Point[],
  kind: "flow" | "level",
  draw: (point: Point) => DrawnPoint,
  sum: (week: readonly Point[]) => { value: number; text: string },
): DrawnPoint[] {
  if (points.length <= dailyMost) return points.map(draw)
  const first = points[0]?.day ?? ""
  const last = points.at(-1)?.day ?? ""
  const weeks = new Map<string, Point[]>()
  for (const point of points) {
    const week = weekOf(point.day)
    const days = weeks.get(week)
    if (days === undefined) weeks.set(week, [point])
    else days.push(point)
  }
  return [...weeks.entries()].flatMap(([monday, days], index) => {
    const tail = days.at(-1)
    const head = days[0]
    if (tail === undefined || head === undefined) return []
    if (kind === "level") {
      // The line starts where the series does, then each week's close.
      return index === 0 && head !== tail
        ? [draw(head), draw(tail)]
        : [draw(tail)]
    }
    const sunday = dayOf(daySeconds(monday) + 6 * 86_400)
    const filling = days.some((day) => day.partial)
    // Day strings, not numbers: Math.min and Math.max do not apply.
    const start = [monday, first].sort()[1] ?? monday
    const end = [sunday, last].sort()[0] ?? sunday
    // A week the chart holds only part of (its first or last) is drawn
    // dashed like the week still filling, so its short bar never reads
    // as a drop; only the filling week says "so far".
    const short = start !== monday || end !== sunday
    return [
      {
        day: head.day,
        ...sum(days),
        partial: filling || short,
        label: weekLabel(start, end, filling),
      },
    ]
  })
}

/** Decimal strings ("1.25", "-3") added exactly, as a decimal string. */
export function sumDecimals(decimals: readonly string[]): string {
  const places = Math.max(
    0,
    ...decimals.map((decimal) => parseDecimal(decimal).fraction.length),
  )
  let total = 0n
  for (const decimal of decimals) {
    const { negative, int, fraction } = parseDecimal(decimal)
    const kept = fraction.padEnd(places, "0")
    const value =
      int * 10n ** BigInt(places) + (kept === "" ? 0n : BigInt(kept))
    total += negative ? -value : value
  }
  return unitsToDecimal(total.toString(), places)
}
