import * as SeriesChart from "@matchbox/ui/series-chart"
import type { ReactNode } from "react"
import {
  backfillNote,
  type SeriesPanelData,
} from "../../data/scan/series-views"
import { Figure, PanelEmpty, reserveOf, Stats, type StatView } from "./parts"

/**
 * A captioned panel's daily series (its own module, so pages without one
 * do not load the chart).
 */

/**
 * A daily series: its latest value as the figure, then the chart. A day
 * hovered, touched or focused reads out in the figure.
 */
export function SeriesBody({
  name,
  data,
  stats,
  empty,
}: {
  name: string
  data: SeriesPanelData
  stats?: readonly StatView[]
  empty: string
}): ReactNode {
  if (data.figure === null) {
    // Zero rows only once the series exists; never computed is not none;
    // a span before or after the days it has is none, not "yet".
    return (
      <PanelEmpty>
        {data.outside === true
          ? "None in this period"
          : data.computed
            ? empty
            : "Not available yet"}
      </PanelEmpty>
    )
  }
  const note = data.partial ? "today so far" : data.latestDay
  return (
    <>
      <Figure
        value={data.figure}
        note={note}
        reserve={reserveOf(
          data.points.map((point) => ({ ...point, n: point.value })),
          data.kind === "level",
        )}
      />
      <Stats stats={stats ?? []} />
      <SeriesChart.Root
        points={data.points}
        kind={data.kind}
        label={`${name}, ${data.figure}${data.partial ? " today so far" : ""}`}
        startLabel={data.startLabel}
        endLabel={data.endLabel}
        height={140}
        className="mt-6"
        readout="figure"
      />
      {data.endsOn === null ? null : (
        <p className="mt-2 text-[14px] text-sec">
          Ends {data.endsOn}, {backfillNote.toLowerCase()}
        </p>
      )}
    </>
  )
}
