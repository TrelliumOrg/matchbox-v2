import { type ReactNode, useEffect } from "react"
import { arm, release } from "./arm"
import { change, widest } from "./logic"

/**
 * Inspectable charts: the markup side. A chart says what each point is in
 * data attributes (`root`, `point`), the panel's figure leaves an empty
 * live half beside its own text (`Value`, `Note`), and `useInspect` arms
 * the shared controller, which loads after first paint. The server HTML is
 * the whole chart; nothing here changes what first paint draws.
 */

/** What a point shows when inspected. */
export type InspectPoint = {
  /** The set: "Epoch 31", "9 Nov", a gauge's name. */
  label: string
  /** The exact formatted value with its unit: "4,703,651 MEZO". */
  value: string
}

/**
 * Where a hovered point reads out: the panel's big number and its note
 * (`figure`, with `Value` and `Note` in a `scope`), or a small tooltip.
 */
export type Readout = "figure" | "tip"

/**
 * Arms inspection for the page once an inspectable chart has hydrated
 * (`enabled`: a chart with nothing to read loads nothing), and lets go of
 * what the chart showed when it unmounts.
 */
export function useInspect(enabled = true): void {
  useEffect(() => {
    if (!enabled) return
    arm()
    return release
  }, [enabled])
}

type RootAttributes = {
  "data-inspect": "x" | "items"
  "data-inspect-readout": Readout
  "data-inspect-change"?: "relative"
}

/**
 * The chart's own attributes: `x` finds the point nearest the pointer
 * across the chart, `items` the one under it. `change` adds the change
 * from the point before, in percent.
 */
export function root(
  mode: "x" | "items",
  readout: Readout,
  withChange: boolean,
): RootAttributes {
  return {
    "data-inspect": mode,
    "data-inspect-readout": readout,
    ...(withChange ? { "data-inspect-change": "relative" as const } : {}),
  }
}

type PointAttributes = {
  "data-inspect-point": ""
  "data-inspect-label": string
  "data-inspect-value": string
  "data-inspect-n"?: number
  "data-inspect-before"?: number
  "data-inspect-partial"?: ""
}

/**
 * A point's attributes. `n` is its number, for the change; `before` the
 * number of the point before it when that one is not drawn (the first bar
 * of a page); `partial` a point still filling (the current epoch), whose
 * change would compare a part with a whole, so it shows none.
 */
export function point(
  inspect: InspectPoint,
  n?: number,
  options: { before?: number | undefined; partial?: boolean } = {},
): PointAttributes {
  const { before, partial = false } = options
  return {
    "data-inspect-point": "",
    "data-inspect-label": inspect.label,
    "data-inspect-value": inspect.value,
    ...(n === undefined || !Number.isFinite(n) ? {} : { "data-inspect-n": n }),
    ...(before === undefined || !Number.isFinite(before)
      ? {}
      : { "data-inspect-before": before }),
    ...(partial ? { "data-inspect-partial": "" as const } : {}),
  }
}

/** The panel whose figure a chart reads into. */
export const scope = { "data-inspect-scope": "" } as const

/**
 * The figure's number: its own text, and an empty half the controller fills
 * while a point is inspected. Both sit in one grid cell with `reserve` (the
 * widest value the chart can show, drawn by the stylesheet so it is never
 * found or read as text) under them, so the width never changes.
 */
export function Value({
  children,
  reserve,
}: {
  children: ReactNode
  reserve?: string | undefined
}): ReactNode {
  return (
    <span data-inspect-slot="value">
      <span data-inspect-rest="">{children}</span>
      <span data-inspect-live="" aria-hidden="true" />
      {reserve === undefined ? null : (
        // Drawn by the stylesheet (`::before`), so it is no text on the page.
        <span data-inspect-reserve={reserve} aria-hidden="true" />
      )}
    </span>
  )
}

Value.displayName = "Inspect.Value"

/**
 * The figure's note ("Epoch 48"): the inspected point's label and change.
 * `reserve` (the widest label and change, see `noteReserve`) keeps a note
 * that sits beside the number from wrapping onto a new line on hover.
 */
export function Note({
  children,
  reserve,
}: {
  children: ReactNode
  reserve?: string | undefined
}): ReactNode {
  return (
    <span data-inspect-slot="note">
      <span data-inspect-rest="">{children}</span>
      <span data-inspect-live="" aria-hidden="true" />
      {reserve === undefined ? null : (
        <span data-inspect-reserve={reserve} aria-hidden="true" />
      )}
    </span>
  )
}

/**
 * The widest note a chart can write: each point's label with its change
 * from the point before (`withChange`), plus a digit for the gap.
 */
export function noteReserve(
  points: readonly {
    label: string
    n?: number | undefined
    partial?: boolean
  }[],
  withChange: boolean,
): string {
  return widest(
    points.map((each, index) => {
      const before = points[index - 1]?.n
      const delta =
        withChange &&
        each.partial !== true &&
        before !== undefined &&
        each.n !== undefined
          ? change(before, each.n)
          : null
      return delta === null ? each.label : `${each.label} ${delta.text}0`
    }),
  )
}

Note.displayName = "Inspect.Note"

/**
 * A line chart's points (zero-size circles at each point, for the
 * controller), its vertical guide from `top` to `bottom` and its dot.
 */
export function LinePoints({
  coords,
  points,
  values,
  top,
  bottom,
  dot = true,
}: {
  coords: readonly (readonly [number, number])[]
  points: readonly InspectPoint[]
  values: readonly number[]
  top: number
  bottom: number
  /** False where the drawing stretches (a sparkline): the dot would too. */
  dot?: boolean
}): ReactNode {
  return (
    <>
      <g data-inspect-guide="">
        <path
          d={`M0 ${top}V${bottom}`}
          stroke="var(--ring)"
          strokeWidth="1.5"
          vectorEffect="non-scaling-stroke"
        />
      </g>
      {dot ? (
        <g data-inspect-dot="">
          <circle r="7" fill="var(--bg)" />
          <circle r="5" fill="var(--acc)" />
        </g>
      ) : null}
      <g>
        {coords.map(([x, y], index) => {
          const each = points[index]
          return each === undefined ? null : (
            <circle
              // biome-ignore lint/suspicious/noArrayIndexKey: one point per value, in order
              key={index}
              cx={x}
              cy={y}
              r="0"
              {...point(each, values[index])}
            />
          )
        })}
      </g>
    </>
  )
}

LinePoints.displayName = "Inspect.LinePoints"
