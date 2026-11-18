import { type ReactNode, useEffect, useRef } from "react"
import {
  point as inspectPoint,
  root as inspectRoot,
  LinePoints,
  type Readout,
  useInspect,
} from "../inspect"

/**
 * A daily series as Matchscan draws it (`@matchbox/contracts/scan` /series):
 * a flow (the day's movement) as bars, a level (the closing value) as one
 * line. The current day is still filling (`partial`): its bar is drawn
 * outlined and dashed, the line's last step dashed to a hollow dot, so an
 * in-progress value never reads as a closed day. Signed flows grow both
 * ways from a zero line. Values are display numbers only (scaled from
 * base units by the caller); labels carry the exact formatted text.
 *
 * Like the line and bar charts, the stylesheet holds the entry at its
 * first frame while scripting is on until `data-play` is set: it plays
 * the first time the chart is 40% in view, or shows at once without
 * IntersectionObserver (`data-shown`).
 *
 * Points that carry their `label` and `text` make the chart inspectable
 * (`@matchbox/ui/inspect`): hover, touch or focus and the arrow keys show
 * a day's value, a level's with its change from the day before.
 */

function usePlayWhenSeen(): (element: HTMLElement | null) => void {
  const node = useRef<HTMLElement | null>(null)
  useEffect(() => {
    const element = node.current
    if (element === null) return
    if (typeof IntersectionObserver === "undefined") {
      element.setAttribute("data-shown", "")
      return
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return
        observer.disconnect()
        element.setAttribute("data-play", "")
      },
      { threshold: 0.4 },
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  return (element) => {
    node.current = element
  }
}

export type SeriesPoint = {
  /** "2026-11-09". */
  day: string
  /** Display value in whole units (never used for money arithmetic). */
  value: number
  /** Today so far, or a day still to be recomputed. */
  partial: boolean
  /** "9 Nov", "Today so far": with `text`, the point is inspectable. */
  label?: string
  /** The exact formatted value: "1,204,330 MUSD". */
  text?: string
}

export type RootProps = {
  points: readonly SeriesPoint[]
  kind: "flow" | "level"
  /** Accessible summary: "MUSD debt change over 30 days, today so far +1,200". */
  label: string
  /** Shown under the first and last points. */
  startLabel?: string
  endLabel?: string
  height?: number
  className?: string
  /** Where an inspected day reads out. Defaults to a tooltip. */
  readout?: Readout
}

function inspectable(points: readonly SeriesPoint[]): boolean {
  return (
    points.length > 0 &&
    points.every(
      (point) => point.label !== undefined && point.text !== undefined,
    )
  )
}

function pointAttributes(point: SeriesPoint, live: boolean) {
  return live
    ? inspectPoint(
        { label: point.label ?? "", value: point.text ?? "" },
        point.value,
      )
    : {}
}

/**
 * The gap between `count` bars: 3px, but never more than a third of the
 * box in all (a percentage of its width), so bars keep most of the width
 * however many there are and never draw 0 px wide.
 */
export function barGap(count: number): string {
  return count > 1 ? `min(3px,${33 / (count - 1)}%)` : "3px"
}

function Bars({
  points,
  height,
}: {
  points: readonly SeriesPoint[]
  height: number
}): ReactNode {
  const live = inspectable(points)
  const max = Math.max(...points.map((point) => Math.abs(point.value)), 0) || 1
  const signed = points.some((point) => point.value < 0)
  return (
    <div
      className="relative flex items-stretch"
      style={{ height, columnGap: barGap(points.length) }}
      aria-hidden="true"
    >
      {signed ? (
        <span className="absolute inset-x-0 top-1/2 h-px bg-line" />
      ) : null}
      {points.map((point) => {
        const share = Math.max(
          2,
          (Math.abs(point.value) / max) * (signed ? 50 : 100),
        )
        const below = point.value < 0
        return (
          <span
            key={point.day}
            data-partial={point.partial ? "" : undefined}
            className={`relative flex min-w-0 flex-1 ${signed ? "" : "items-end"}`}
            {...pointAttributes(point, live)}
          >
            <span
              data-inspect-anchor=""
              data-mbx-motion=""
              data-draw=""
              className={`absolute inset-x-0 animate-[mbx-grow_420ms_var(--ease-roll)_backwards] ${below ? "origin-top rounded-b-[4px]" : "origin-bottom rounded-t-[4px]"} ${point.partial ? "border border-dashed border-acc bg-transparent" : "bg-acc"}`}
              style={
                signed
                  ? below
                    ? { top: "50%", height: `${share}%` }
                    : { bottom: "50%", height: `${share}%` }
                  : { bottom: 0, height: `${share}%` }
              }
            />
          </span>
        )
      })}
    </div>
  )
}

/** The line's viewBox width: it is drawn at the box's width, height to scale. */
const lineWidth = 680

function Line({
  points,
  height,
}: {
  points: readonly SeriesPoint[]
  height: number
}): ReactNode {
  const width = lineWidth
  const pad = 8
  const values = points.map((point) => point.value)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const step = points.length > 1 ? (width - pad * 2) / (points.length - 1) : 0
  const coords = points.map((point, index): [number, number] => [
    Math.round((pad + index * step) * 10) / 10,
    Math.round(
      (pad + (height - pad * 2) * (1 - (point.value - min) / span)) * 10,
    ) / 10,
  ])
  const last = points.at(-1)
  const closed = last?.partial === true ? coords.slice(0, -1) : coords
  const tail = last?.partial === true ? coords.slice(-2) : []
  const end = coords.at(-1)
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden="true"
      className="block h-auto w-full overflow-visible"
    >
      {closed.length > 1 ? (
        <polyline
          points={closed.map(([x, y]) => `${x},${y}`).join(" ")}
          fill="none"
          stroke="var(--acc)"
          strokeWidth="2.5"
          strokeLinejoin="round"
          strokeLinecap="round"
          pathLength={1}
          strokeDasharray="1"
          data-mbx-motion=""
          data-draw=""
          className="animate-[mbx-draw_600ms_var(--ease-roll)_backwards]"
        />
      ) : null}
      {tail.length === 2 ? (
        <polyline
          points={tail.map(([x, y]) => `${x},${y}`).join(" ")}
          fill="none"
          stroke="var(--acc)"
          strokeWidth="2.5"
          strokeDasharray="4 5"
          strokeLinecap="round"
        />
      ) : null}
      {inspectable(points) ? (
        <LinePoints
          coords={coords}
          points={points.map((point) => ({
            label: point.label ?? "",
            value: point.text ?? "",
          }))}
          values={points.map((point) => point.value)}
          top={pad}
          bottom={height - pad}
        />
      ) : null}
      {end === undefined ? null : last?.partial === true ? (
        <circle
          data-inspect-latest=""
          cx={end[0]}
          cy={end[1]}
          r="5"
          fill="var(--bg)"
          stroke="var(--acc)"
          strokeWidth="2"
        />
      ) : (
        <g data-inspect-latest="">
          <circle cx={end[0]} cy={end[1]} r="7" fill="var(--bg)" />
          <circle cx={end[0]} cy={end[1]} r="5" fill="var(--acc)" />
        </g>
      )}
    </svg>
  )
}

export function Root({
  points,
  kind,
  label,
  startLabel,
  endLabel,
  height = 160,
  className,
  readout = "tip",
}: RootProps): ReactNode {
  const play = usePlayWhenSeen()
  const live = inspectable(points)
  useInspect(live)
  return (
    <figure
      ref={play}
      data-chart=""
      className={`flex flex-col gap-2 ${className ?? ""}`}
    >
      <div
        role="img"
        aria-label={label}
        className={
          live
            ? "rounded-[6px] outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink"
            : undefined
        }
        {...(live
          ? { ...inspectRoot("x", readout, kind === "level"), tabIndex: 0 }
          : {})}
      >
        {points.length === 0 ? (
          // A level's line scales with its width: its box does too, so a
          // chart drawn later keeps its height.
          <div
            style={
              kind === "level"
                ? { aspectRatio: `${lineWidth} / ${height}` }
                : { height }
            }
          />
        ) : kind === "flow" ? (
          <Bars points={points} height={height} />
        ) : (
          <Line points={points} height={height} />
        )}
      </div>
      {startLabel === undefined && endLabel === undefined ? null : (
        <figcaption
          aria-hidden="true"
          className="flex justify-between font-mono text-xs text-sec"
        >
          <span>{startLabel}</span>
          <span>{endLabel}</span>
        </figcaption>
      )}
    </figure>
  )
}

Root.displayName = "SeriesChart"
