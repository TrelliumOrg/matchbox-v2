import { Link } from "@tanstack/react-router"
import { type ReactNode, Suspense } from "react"
import type { ChartSeries } from "../../data/borrow"
import type { Section } from "../../data/explorer"
import { deferred } from "../../shell/deferred"
import { SectionState } from "../parts"
import type { PeriodView } from "../voting/range"
import { rangeNames } from "./search"

/**
 * Captioned panels' period toggle and one daily series as a chart. The
 * drawing loads after first paint (it is never the LCP element): the
 * server renders it, and the browser fetches its code lazily.
 */

/** The custom span's button and box (see voting/parts), off first paint. */
const CustomPeriod = deferred(() =>
  import("../voting/custom-period").then((module) => module.CustomPeriod),
)

const SeriesDrawing = deferred(() =>
  import("./series-drawing").then((module) => module.default),
)

/** The period toggle (30d first), then a custom span's calendar. */
export function RangeLinks({
  period,
  to,
  params,
  search,
}: {
  period: PeriodView
  to: string
  params?: Record<string, string>
  search?: Record<string, string>
}): ReactNode {
  return (
    <nav aria-label="Period" className="flex items-center gap-1">
      {rangeNames.map((name) => (
        <Link
          key={name}
          to={to}
          params={params ?? {}}
          search={{
            ...(search ?? {}),
            ...(name === "30d" ? {} : { range: name }),
          }}
          resetScroll={false}
          aria-current={name === period.range ? "true" : undefined}
          className={`rounded-full px-2.5 py-1 text-[14px] outline-none focus-visible:outline-2 focus-visible:outline-ink ${name === period.range ? "font-semibold text-ink" : "text-sec hover:text-ink"}`}
        >
          {name}
        </Link>
      ))}
      <span className="px-2.5 py-1 text-[14px]">
        <Suspense fallback={null}>
          <CustomPeriod period={period} search={search ?? {}} />
        </Suspense>
      </span>
    </nav>
  )
}

/**
 * The chart's space while its series or code loads: the drawing's height,
 * so the panel does not move when it arrives.
 */
export function ChartSpace({ busy = false }: { busy?: boolean }): ReactNode {
  return (
    <div aria-busy={busy ? "true" : undefined} className="mt-5 min-h-[180px]" />
  )
}

/** One series as a chart, or its section state. */
export function SeriesFigure({
  series,
  label,
  unit = null,
  retry,
}: {
  series: Section<ChartSeries>
  label: string
  /** The series' unit, read out after each day's value. */
  unit?: string | null
  /** Reads the series again; without it, "Try again" reloads the page's data. */
  retry?: (() => void) | null
}): ReactNode {
  if (series.status !== "ok") {
    return (
      <div className="mt-5">
        <SectionState section={series} {...(retry == null ? {} : { retry })} />
      </div>
    )
  }
  const view = series.data
  if (view.points.length === 0) {
    return (
      <p className="mt-5 flex min-h-[180px] items-center justify-center text-[15px] text-sec">
        No data
      </p>
    )
  }
  const latest =
    view.latest === null
      ? ""
      : `, ${view.latest.partial ? "today so far" : "latest"} ${view.latest.text}`
  return (
    <Suspense fallback={<ChartSpace />}>
      <SeriesDrawing view={view} label={`${label}${latest}`} unit={unit} />
    </Suspense>
  )
}
