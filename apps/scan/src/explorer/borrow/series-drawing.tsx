import * as SeriesChart from "@matchbox/ui/series-chart"
import type { ReactNode } from "react"
import type { ChartSeries } from "../../data/borrow"

/** A series drawn with the shared SeriesChart (loaded lazily by chart). */

const months = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
]

/** "2026-10-11" to "11 Oct". */
export function dayLabel(day: string | undefined): string | undefined {
  if (day === undefined) return undefined
  const [, month, date] = day.split("-")
  return `${Number(date)} ${months[Number(month) - 1] ?? ""}`
}

function labels(view: ChartSeries): { startLabel?: string; endLabel?: string } {
  const start = dayLabel(view.points[0]?.day)
  const end =
    view.endsOn === null
      ? dayLabel(view.points.at(-1)?.day)
      : `Ends ${dayLabel(view.endsOn) ?? ""}`
  return {
    ...(start === undefined ? {} : { startLabel: start }),
    ...(end === undefined ? {} : { endLabel: end }),
  }
}

export default function SeriesDrawing({
  view,
  label,
  unit,
}: {
  view: ChartSeries
  label: string
  /** Read out after each day's value: "1,204,330 MUSD". */
  unit: string | null
}): ReactNode {
  return (
    <SeriesChart.Root
      className="mt-5"
      points={
        unit === null
          ? view.points
          : view.points.map((point) => ({
              ...point,
              text: `${point.text} ${unit}`,
            }))
      }
      kind={view.kind}
      label={label}
      {...labels(view)}
      height={150}
    />
  )
}
