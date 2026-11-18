import type { CSSProperties, ReactNode } from "react"
import { Tip } from "../floating/floating"
import * as SplitBar from "../split-bar"

/**
 * Allocation mark (replaces "Kiln Labs 70%, veBTC #604 30%"): an 18px stack
 * of gauge pictures (5px overlap, 2px ring in the page colour) plus a 56 by 4
 * split bar in the gauges' colours. The tooltip lists each gauge and percent.
 */

export type Allocation = {
  id: string
  name: string
  /** Relative share; shown as a rounded percentage. */
  share: number
  color: SplitBar.SegmentColor
  /** The gauge picture, drawn to fill an 18px circle. */
  picture: ReactNode
}

export type RootProps = {
  allocations: readonly Allocation[]
  /** CSS colour under the stack, for the ring. */
  surface?: string
  className?: string
}

export function Root({
  allocations,
  surface = "var(--bg)",
  className,
}: RootProps): ReactNode {
  const segments = allocations.map((allocation) => ({
    id: allocation.id,
    value: allocation.share,
    color: allocation.color,
    label: allocation.name,
  }))
  const percent = SplitBar.percentages(segments)
  const summary = allocations
    .map((allocation, index) => `${allocation.name} ${percent[index]}%`)
    .join(", ")

  return (
    <Tip
      side="top"
      align="end"
      trigger={(tip) => (
        <span
          role="img"
          aria-label={summary}
          // biome-ignore lint/a11y/noNoninteractiveTabindex: keyboard users need the tooltip
          tabIndex={0}
          className={`inline-flex items-center gap-2 rounded-sm outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink ${className ?? ""}`}
          style={{ "--ring-surface": surface } as CSSProperties}
          {...tip}
        >
          <span className="inline-flex items-center" aria-hidden="true">
            {allocations.map((allocation, index) => (
              <span
                key={allocation.id}
                className="grid size-[18px] flex-none place-items-center overflow-hidden rounded-full shadow-[0_0_0_2px_var(--ring-surface)] [&+&]:-ml-[5px]"
                style={{ zIndex: allocations.length - index }}
              >
                {allocation.picture}
              </span>
            ))}
          </span>
          <SplitBar.Root segments={segments} width={56} height={4} decorative />
        </span>
      )}
      content={
        <ul>
          {allocations.map((allocation, index) => (
            <li
              key={allocation.id}
              className="flex justify-between gap-4 tabular-nums"
            >
              <span>{allocation.name}</span>
              <span>{percent[index]}%</span>
            </li>
          ))}
        </ul>
      }
    />
  )
}

Root.displayName = "AllocationMark"
