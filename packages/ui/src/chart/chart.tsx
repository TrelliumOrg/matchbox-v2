import { duration, easing, prefersReducedMotion } from "@matchbox/motion"
import {
  type ReactNode,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
} from "react"
import {
  type InspectPoint,
  root as inspectRoot,
  LinePoints,
  point,
  type Readout,
  useInspect,
} from "../inspect"

/**
 * Static-first SVG charts, no chart library. Line: one orange series, a
 * dashed reference, few labels, a dot on the current point, no grid. Bars:
 * epoch bars in grey with the selected one orange.
 *
 * They come alive the first time they are in view: the line draws in left
 * to right (stroke-dashoffset), the reference fades and the current dot pops
 * in; bars grow from the axis, staggered. The server renders the final
 * chart and the stylesheet holds the animations at their first frame until
 * `data-play` is set (only when scripting is on, so without JS the chart
 * simply shows). With an `id` a chart plays once per page session; a
 * remount with the same id (another epoch) morphs from what it last showed.
 * Changing values (another series) morph the bars, the orange cross-fades
 * to the new selection. Transform, opacity and stroke-dashoffset only;
 * reduced motion shows the final chart.
 *
 * Given what each point is (`inspect` on a line, `text` on every bar), a
 * chart is inspectable (`@matchbox/ui/inspect`): hover, touch or focus and
 * the arrow keys show a point's label, value and change from the one
 * before, in the panel's figure or a tooltip (`readout`).
 */

const focusRing =
  "rounded-[6px] outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink"

/** Chart ids that have played this session. */
const played = new Set<string>()

/** Starts the chart's entry when it is first 40% in view (`now`: at once). */
function usePlayWhenSeen(
  target: RefObject<Element | null>,
  id: string | undefined,
  now: boolean,
): void {
  useEffect(() => {
    const element = target.current
    if (
      element === null ||
      element.hasAttribute("data-play") ||
      element.hasAttribute("data-shown")
    ) {
      return
    }
    if (now) {
      if (id !== undefined) played.add(id)
      element.setAttribute("data-play", "")
      return
    }
    if (
      (id !== undefined && played.has(id)) ||
      typeof IntersectionObserver === "undefined"
    ) {
      element.setAttribute("data-shown", "")
      return
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return
        observer.disconnect()
        if (id !== undefined) played.add(id)
        element.setAttribute("data-play", "")
      },
      { threshold: 0.4 },
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [target, id, now])
}

type Box = {
  width: number
  height: number
  padX: number
  top: number
  bottom: number
}

function scale(values: readonly number[], box: Box): (value: number) => number {
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const plot = box.height - box.top - box.bottom
  return (value) => box.top + plot - ((value - min) / span) * plot
}

const round = (value: number): number => Math.round(value * 10) / 10

export type LineChartProps = {
  /** Series values, oldest first. At least two. */
  points: readonly number[]
  /** Dashed reference line, for example the median. */
  reference?: { value: number; label: string }
  startLabel?: string
  endLabel?: string
  /** Accessible summary, for example "APY over 9 epochs, now 3.05%". */
  label: string
  width?: number
  height?: number
  className?: string
  /** Draws in once per page session per id. */
  id?: string
  /** Each point's label and formatted value, oldest first: inspectable. */
  inspect?: readonly InspectPoint[]
  /** Where an inspected point reads out. Defaults to a tooltip. */
  readout?: Readout
  /** Shows the change from the point before. Defaults to true. */
  change?: boolean
}

export function LineChart({
  points,
  reference,
  startLabel,
  endLabel,
  label,
  width = 680,
  height = 270,
  className,
  id,
  inspect,
  readout = "tip",
  change = true,
}: LineChartProps): ReactNode {
  const root = useRef<SVGSVGElement | null>(null)
  usePlayWhenSeen(root, id, false)
  const inspectable = inspect !== undefined && inspect.length === points.length
  useInspect(inspectable)
  const box: Box = { width, height, padX: 16, top: 24, bottom: 48 }
  const domain = reference === undefined ? points : [...points, reference.value]
  const y = scale(domain, box)
  const step =
    points.length > 1 ? (width - box.padX * 2) / (points.length - 1) : 0
  const coords = points.map(
    (value, index) =>
      [round(box.padX + index * step), round(y(value))] as const,
  )
  const last = coords[coords.length - 1]
  const axisY = height - 15

  return (
    <svg
      ref={root}
      data-chart=""
      role="img"
      aria-label={label}
      viewBox={`0 0 ${width} ${height}`}
      className={`block h-auto w-full overflow-visible ${inspectable ? focusRing : ""} ${className ?? ""}`}
      {...(inspectable
        ? { ...inspectRoot("x", readout, change), tabIndex: 0 }
        : {})}
    >
      {reference === undefined ? null : (
        <g
          data-mbx-motion=""
          data-draw=""
          className="animate-[mbx-fade-in_240ms_ease-out_240ms_backwards]"
        >
          <path
            d={`M${box.padX} ${round(y(reference.value))}H${width - box.padX}`}
            stroke="var(--ring)"
            strokeWidth="1.5"
            strokeDasharray="5 6"
          />
          <text
            x={width - box.padX}
            y={round(y(reference.value)) - 10}
            textAnchor="end"
            className="fill-sec font-sans text-[13.5px]"
          >
            {reference.label}
          </text>
        </g>
      )}
      <polyline
        points={coords.map(([px, py]) => `${px},${py}`).join(" ")}
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
      {inspectable ? (
        <LinePoints
          coords={coords}
          points={inspect}
          values={points}
          top={box.top}
          bottom={height - box.bottom}
        />
      ) : null}
      {last === undefined ? null : (
        <g
          data-mbx-motion=""
          data-draw=""
          data-inspect-latest=""
          className="origin-center animate-[mbx-check-pop_260ms_var(--ease-roll)_480ms_backwards] [transform-box:fill-box]"
        >
          <circle cx={last[0]} cy={last[1]} r="7" fill="var(--bg)" />
          <circle cx={last[0]} cy={last[1]} r="5" fill="var(--acc)" />
        </g>
      )}
      {startLabel === undefined ? null : (
        <text
          x={box.padX}
          y={axisY}
          className="fill-sec font-sans text-[13.5px]"
        >
          {startLabel}
        </text>
      )}
      {endLabel === undefined ? null : (
        <text
          x={width - box.padX}
          y={axisY}
          textAnchor="end"
          className="fill-sec font-sans text-[13.5px]"
        >
          {endLabel}
        </text>
      )}
    </svg>
  )
}

LineChart.displayName = "LineChart"

export type Bar = {
  label: string
  value: number
  /** The exact formatted value: given on every bar, the chart is inspectable. */
  text?: string
}

export type BarChartProps = {
  bars: readonly Bar[]
  /** Index of the orange bar. Defaults to the last; -1 shows none. */
  selected?: number
  /** Makes each bar a button. Arrow keys move between them. */
  onSelect?: (index: number) => void
  /** An arrow key past the first (-1) or last (1) bar, to page. */
  onEdge?: (direction: -1 | 1) => void
  /** Bars grow from the axis as they mount (a new page of bars). */
  growIn?: boolean
  /**
   * Grows once per page session per id, the first time it is in view; a
   * remount with the same id and labels morphs from the heights it showed.
   */
  id?: string
  /** Accessible summary of the chart. */
  label: string
  /** Shown under the first and last bars and the selected one. */
  showLabels?: boolean
  height?: number
  className?: string
  /** Where an inspected bar reads out. Defaults to a tooltip. */
  readout?: Readout
  /** Shows the change from the bar before. Defaults to true. */
  change?: boolean
  /**
   * The value of the bar before the first (a page of bars), so the first
   * one shows its change too.
   */
  before?: number | undefined
}

/** Bar heights (percent of the plot) last shown, per chart id. */
const shownBars = new Map<string, Map<string, number>>()

/**
 * Bars whose value changed scale from their old height to the new one
 * (transform only), before the browser paints the new heights.
 */
function useMorphBars(
  id: string | undefined,
  plot: RefObject<HTMLElement | null>,
  heights: Map<string, number>,
): void {
  const local = useRef<Map<string, number> | null>(null)
  useLayoutEffect(() => {
    const before =
      local.current ?? (id === undefined ? undefined : shownBars.get(id))
    local.current = heights
    if (id !== undefined) shownBars.set(id, heights)
    const root = plot.current
    if (root === null || before === undefined || prefersReducedMotion()) return
    for (const element of root.querySelectorAll<HTMLElement>("[data-bar]")) {
      const key = element.dataset.bar ?? ""
      const from = before.get(key)
      const to = heights.get(key)
      if (from === undefined || to === undefined || Math.abs(from - to) < 0.5)
        continue
      element.animate(
        [{ transform: `scaleY(${from / to})` }, { transform: "none" }],
        { duration: duration.roll, easing: easing.roll },
      )
    }
  })
}

export function BarChart({
  bars,
  selected = bars.length - 1,
  onSelect,
  onEdge,
  growIn = false,
  id,
  label,
  showLabels = true,
  height = 160,
  className,
  readout = "tip",
  change = true,
  before,
}: BarChartProps): ReactNode {
  const inspectable =
    bars.length > 0 && bars.every((bar) => bar.text !== undefined)
  useInspect(inspectable)
  const pointOf = (bar: Bar, index: number) =>
    inspectable
      ? point({ label: bar.label, value: bar.text ?? "" }, bar.value, {
          before: index === 0 ? before : undefined,
        })
      : {}
  const max = Math.max(...bars.map((bar) => bar.value), 0) || 1
  const labelled = new Set([0, bars.length - 1, selected])
  const figure = useRef<HTMLElement | null>(null)
  const plot = useRef<HTMLDivElement | null>(null)
  const heights = new Map(
    bars.map((bar) => [bar.label, Math.max(2, (bar.value / max) * 100)]),
  )
  usePlayWhenSeen(figure, id, growIn)
  useMorphBars(id, plot, heights)
  // The whole grow stays within 600ms: 420ms per bar plus the stagger.
  const stagger = Math.min(18, 180 / Math.max(bars.length, 1))
  // One bar is in the tab order: the selected one, else the last.
  const tabbable =
    selected >= 0 && selected < bars.length ? selected : bars.length - 1
  const columns = bars.map((bar, index) => {
    const isSelected = index === selected
    const fill = (
      <span
        data-bar={bar.label}
        data-inspect-anchor=""
        data-mbx-motion=""
        data-draw=""
        className="relative block w-full origin-bottom animate-[mbx-grow_420ms_var(--ease-roll)_backwards] rounded-t-[6px] rounded-b-[2px] bg-soft2"
        style={{
          height: `${heights.get(bar.label) ?? 2}%`,
          animationDelay: `${Math.round(index * stagger)}ms`,
        }}
      >
        <span
          data-mbx-motion=""
          className={`absolute inset-0 rounded-[inherit] bg-acc transition-opacity duration-200 ease-out ${isSelected ? "opacity-100" : "opacity-0"}`}
        />
      </span>
    )
    if (onSelect === undefined) {
      return (
        <span
          key={bar.label}
          aria-hidden="true"
          className="flex h-full min-w-0 flex-1 items-end"
          {...pointOf(bar, index)}
        >
          {fill}
        </span>
      )
    }
    return (
      <button
        key={bar.label}
        type="button"
        aria-label={bar.label}
        aria-pressed={isSelected}
        {...pointOf(bar, index)}
        onClick={() => onSelect(index)}
        onKeyDown={(event) => {
          const next =
            event.key === "ArrowRight"
              ? index + 1
              : event.key === "ArrowLeft"
                ? index - 1
                : event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? bars.length - 1
                    : null
          if (next === null) return
          if (next < 0 || next >= bars.length) {
            if (onEdge === undefined) return
            event.preventDefault()
            onEdge(next < 0 ? -1 : 1)
            return
          }
          event.preventDefault()
          onSelect(next)
          const sibling = event.currentTarget.parentElement?.children.item(next)
          if (sibling instanceof HTMLElement) sibling.focus()
        }}
        tabIndex={index === tabbable ? 0 : -1}
        className="flex h-full min-w-0 flex-1 cursor-pointer items-end rounded-t-[6px] outline-none transition-opacity duration-150 hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
      >
        {fill}
      </button>
    )
  })

  return (
    <figure
      ref={figure}
      data-chart=""
      className={`flex flex-col gap-2 ${className ?? ""}`}
    >
      {onSelect === undefined ? (
        <div
          ref={plot}
          role="img"
          aria-label={label}
          className={`flex items-end gap-1.5 ${inspectable ? focusRing : ""}`}
          style={{ height }}
          {...(inspectable
            ? { ...inspectRoot("x", readout, change), tabIndex: 0 }
            : {})}
        >
          {columns}
        </div>
      ) : (
        <fieldset className="min-w-0 border-0">
          <legend className="sr-only">{label}</legend>
          <div
            ref={plot}
            className="flex items-end gap-1.5"
            style={{ height }}
            {...(inspectable ? inspectRoot("x", readout, change) : {})}
          >
            {columns}
          </div>
        </fieldset>
      )}
      {showLabels ? (
        <figcaption
          aria-hidden="true"
          className="relative flex gap-1.5 font-mono text-xs text-sec"
        >
          {bars.map((bar, index) => (
            <span
              key={bar.label}
              className="min-w-0 flex-1 truncate text-center"
            >
              {labelled.has(index) ? bar.label : ""}
            </span>
          ))}
        </figcaption>
      ) : null}
    </figure>
  )
}

BarChart.displayName = "BarChart"
