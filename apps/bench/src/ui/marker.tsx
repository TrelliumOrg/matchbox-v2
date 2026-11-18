import type { ReactNode } from "react"
import type { MarkerShape } from "../view/model"

/**
 * An entry's mark: its model's colour and its effort level's shape, drawn
 * around (0, 0) at radius r. Shapes keep effort readable without colour.
 */
export function MarkerPath({
  shape,
  colour,
  r,
}: {
  shape: MarkerShape
  colour: string
  r: number
}): ReactNode {
  const fill = { fill: colour, stroke: "var(--bg)", strokeWidth: 2 }
  if (shape === "ring") {
    return (
      <circle
        r={r - 1.5}
        style={{ fill: "var(--bg)", stroke: colour, strokeWidth: 3 }}
      />
    )
  }
  if (shape === "circle") return <circle r={r} style={fill} />
  if (shape === "square") {
    const side = r * 1.7
    return (
      <rect
        x={-side / 2}
        y={-side / 2}
        width={side}
        height={side}
        rx={2}
        style={fill}
      />
    )
  }
  if (shape === "diamond") {
    const d = r * 1.3
    return <path d={`M0 ${-d}L${d} 0L0 ${d}L${-d} 0Z`} style={fill} />
  }
  const d = r * 1.25
  return (
    <path
      d={`M0 ${-d}L${d * 1.05} ${d * 0.75}L${-d * 1.05} ${d * 0.75}Z`}
      style={fill}
    />
  )
}

/** A marker on its own, for legends, labels and table rows. */
export function Marker({
  shape,
  colour,
  size = 14,
}: {
  shape: MarkerShape
  colour: string
  size?: number
}): ReactNode {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox={`${-size / 2} ${-size / 2} ${size} ${size}`}
      className="flex-none overflow-visible"
    >
      <MarkerPath shape={shape} colour={colour} r={size / 2 - 1} />
    </svg>
  )
}

/** A model's colour on its own. */
export function Swatch({ colour }: { colour: string }): ReactNode {
  return (
    <span
      aria-hidden="true"
      className="inline-block size-3 flex-none rounded-full"
      style={{ background: colour }}
    />
  )
}
