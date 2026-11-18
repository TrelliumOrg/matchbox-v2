import { formatDate, formatDay, groupThousands } from "@matchbox/domain/format"
import type { Section } from "../explorer"
import { type SeriesRange, seriesRanges } from "./series"
import type { SeriesView } from "./series.server"
import { sumDecimals, weekly } from "./weekly"

/**
 * A daily series as a captioned panel draws it: the chart's points (one
 * per week past `dailyMost` days, see weekly.ts), the
 * latest value as the panel's one figure (formatted exactly, from the
 * point's decimal, never from the chart's float), whether that value is
 * today's so far, the axis ends, and where a backfill-only series ends.
 */

export type SeriesPanelData = {
  kind: "flow" | "level"
  /** Each with its day ("5 Nov") and exact value as the figure writes it. */
  points: {
    day: string
    value: number
    partial: boolean
    label: string
    text: string
  }[]
  /**
   * The series has rows somewhere (its first day is known). False for one
   * the jobs side has never computed: "Not available yet", never "none".
   */
  computed: boolean
  /** The latest value; null for an empty series. */
  figure: string | null
  /** The latest value is today's so far. */
  partial: boolean
  /** "5 Nov" for the latest point. */
  latestDay: string | null
  startLabel: string
  endLabel: string
  /** "31 Oct 2026" when the series has no live writer. */
  endsOn: string | null
  /** A custom span holds none of the series' days: "None in this period". */
  outside?: boolean
}

const seconds = (day: string): number =>
  Math.floor(Date.parse(`${day}T00:00:00Z`) / 1000)

/** "5 Nov" from "2026-11-05". */
export function dayLabel(day: string): string {
  return formatDay(seconds(day)).slice(4)
}

/** A point's day as a chart reads it out: "5 Nov", "Today so far". */
export function pointLabel(point: { day: string; partial: boolean }): string {
  return point.partial ? "Today so far" : dayLabel(point.day)
}

/** Days for a panel range. */
export function rangeDays(range: SeriesRange): number {
  return seriesRanges[range]
}

/** A count series' decimal ("1906") as "1,906". */
export function countText(decimal: string): string {
  const [whole = "0"] = decimal.split(".")
  return groupThousands(BigInt(whole))
}

export function seriesPanel(
  section: Section<SeriesView>,
  format: (decimal: string) => string,
): Section<SeriesPanelData> {
  if (section.status !== "ok") return section
  const series = section.data
  const first = series.points[0]
  const last = series.points.at(-1)
  return {
    status: "ok",
    data: {
      kind: series.kind,
      points: weekly(
        series.points,
        series.kind,
        (point) => ({
          day: point.day,
          value: point.value,
          partial: point.partial,
          label: pointLabel(point),
          text: format(point.decimal),
        }),
        (days) => {
          const total = sumDecimals(days.map((day) => day.decimal))
          return { value: Number(total), text: format(total) }
        },
      ),
      computed: series.firstDay !== null,
      figure: last === undefined ? null : format(last.decimal),
      partial: last?.partial ?? false,
      latestDay: last === undefined ? null : dayLabel(last.day),
      startLabel: first === undefined ? "" : dayLabel(first.day),
      endLabel: last === undefined ? "" : dayLabel(last.day),
      endsOn:
        series.endsOn === null ? null : formatDate(seconds(series.endsOn)),
      outside: series.outside === true,
    },
  }
}

/** The latest value of a series as text, null when unread or empty. */
export function latestOf(
  section: Section<SeriesView>,
  format: (decimal: string) => string,
): { text: string; partial: boolean } | null {
  if (section.status !== "ok") return null
  const last = section.data.points.at(-1)
  return last === undefined
    ? null
    : { text: format(last.decimal), partial: last.partial }
}
