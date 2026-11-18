import { prefersReducedMotion } from "@matchbox/motion"
import {
  type CSSProperties,
  type ReactNode,
  useLayoutEffect,
  useRef,
} from "react"

/**
 * A horizontal bar split into proportional segments with 2px gaps. When the
 * shares change (Optimize), segments reflow to their new widths with a FLIP
 * animation, so only transform is animated.
 */

/** A theme-aware colour: one value, or separate light and dark values. */
export type SegmentColor = string | { light: string; dark: string }

export type Segment = {
  id: string
  /** Relative share. Any non-negative number; shares are normalised. */
  value: number
  color: SegmentColor
  label?: string
}

export type RootProps = {
  segments: readonly Segment[]
  /** Bar height in px. 4 for the allocation mark. */
  height?: number
  /** CSS width. Defaults to 100%. */
  width?: number | string
  gap?: number
  /** Accessible name. Defaults to the labels with their percentages. */
  label?: string
  /** Hide from assistive tech when a tooltip or text carries the same. */
  decorative?: boolean
  className?: string
}

export function colorVars(color: SegmentColor): CSSProperties {
  const value =
    typeof color === "string" ? { light: color, dark: color } : color
  return {
    "--seg-light": value.light,
    "--seg-dark": value.dark,
  } as CSSProperties
}

export function percentages(segments: readonly Segment[]): number[] {
  const total = segments.reduce(
    (sum, segment) => sum + Math.max(0, segment.value),
    0,
  )
  return segments.map((segment) =>
    total === 0 ? 0 : Math.round((Math.max(0, segment.value) / total) * 100),
  )
}

const duration = 380

export function Root({
  segments,
  height = 4,
  width = "100%",
  gap = 2,
  label,
  decorative = false,
  className,
}: RootProps): ReactNode {
  const refs = useRef(new Map<string, HTMLSpanElement>())
  const previous = useRef(new Map<string, DOMRect>())
  const shares = segments.map((segment) => segment.value).join(",")

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measure when the shares change
  useLayoutEffect(() => {
    const next = new Map<string, DOMRect>()
    for (const [id, element] of refs.current) {
      next.set(id, element.getBoundingClientRect())
    }
    if (!prefersReducedMotion()) {
      for (const [id, element] of refs.current) {
        const before = previous.current.get(id)
        const after = next.get(id)
        if (before === undefined || after === undefined || after.width === 0)
          continue
        const dx = before.left - after.left
        const sx = before.width / after.width
        if (Math.abs(dx) < 0.5 && Math.abs(sx - 1) < 0.01) continue
        element.style.transition = "none"
        element.style.transform = `translateX(${dx}px) scaleX(${sx})`
        element.getBoundingClientRect()
        element.style.transition = `transform ${duration}ms cubic-bezier(.2,.8,.2,1)`
        element.style.transform = ""
      }
    }
    previous.current = next
  }, [shares])

  const percent = percentages(segments)
  const name =
    label ??
    segments
      .map(
        (segment, index) => `${segment.label ?? segment.id} ${percent[index]}%`,
      )
      .join(", ")

  return (
    <span
      role="img"
      aria-label={decorative ? undefined : name}
      aria-hidden={decorative || undefined}
      className={`flex flex-none ${className ?? ""}`}
      style={{ width, height, gap }}
    >
      {segments.map((segment) => (
        <span
          key={segment.id}
          ref={(element) => {
            if (element === null) refs.current.delete(segment.id)
            else refs.current.set(segment.id, element)
          }}
          className="block h-full min-w-0 origin-left rounded-full bg-[var(--seg-light)] dark:bg-[var(--seg-dark)]"
          style={{
            flexGrow: Math.max(0, segment.value),
            flexBasis: 0,
            display: segment.value > 0 ? "block" : "none",
            ...colorVars(segment.color),
          }}
        />
      ))}
    </span>
  )
}

Root.displayName = "SplitBar"
