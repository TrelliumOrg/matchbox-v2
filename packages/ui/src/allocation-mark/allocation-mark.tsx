import type { CSSProperties, ReactNode } from "react"
import { Tip } from "../floating/floating"
import * as SplitBar from "../split-bar"

/**
 * Allocation mark (replaces "Kiln Labs 70%, veBTC #604 30%"): an 18px stack
 * of gauge pictures (5px overlap, 2px ring in the page colour) plus a 56 by 4
 * split bar in the gauges' colours. The tooltip lists each gauge and percent.
 * Past `max` marks the stack shows the largest shares and a "+N" for the
 * rest: a lock that voted for 30 gauges drew 30 pictures, which ran past its
 * card and pushed an activity row's title out (19 Nov 2026).
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
  /**
   * Most marks in the stack, the "+N" included. Up to this many gauges are
   * all drawn; more show the largest `max - 1` and "+N". 4 by default.
   */
  max?: number
  /** Classes for the split bar, to drop it where space is short. */
  barClassName?: string
}

/** The largest shares first, in their order; the rest are counted. */
export function stackOf<T extends { share: number }>(
  allocations: readonly T[],
  max: number,
): { shown: readonly T[]; more: number } {
  if (allocations.length <= max) return { shown: allocations, more: 0 }
  const keep = Math.max(1, max - 1)
  const largest = new Set(
    [...allocations]
      .sort((left, right) => right.share - left.share)
      .slice(0, keep),
  )
  return {
    shown: allocations.filter((allocation) => largest.has(allocation)),
    more: allocations.length - keep,
  }
}

export function Root({
  allocations,
  surface = "var(--bg)",
  className,
  max = 4,
  barClassName,
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
  const { shown, more } = stackOf(allocations, max)

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
            {shown.map((allocation, index) => (
              <span
                key={allocation.id}
                className="relative grid size-[18px] flex-none place-items-center overflow-hidden rounded-full shadow-[0_0_0_2px_var(--ring-surface)] [&+&]:-ml-[5px]"
                style={{ zIndex: shown.length - index + 1 }}
              >
                {allocation.picture}
              </span>
            ))}
            {more === 0 ? null : (
              <span
                data-allocation-more=""
                className="relative -ml-[5px] grid h-[18px] min-w-[23px] flex-none place-items-center rounded-full bg-soft2 pr-1 pl-[9px] text-[10px] leading-none font-semibold text-ink2 tabular-nums shadow-[0_0_0_2px_var(--ring-surface)]"
              >
                +{more}
              </span>
            )}
          </span>
          <SplitBar.Root
            segments={segments}
            width={56}
            height={4}
            decorative
            {...(barClassName === undefined ? {} : { className: barClassName })}
          />
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
