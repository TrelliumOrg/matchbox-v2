import type { ComponentProps, CSSProperties, ReactNode } from "react"
import { tv } from "../tv"

/**
 * A native range input, so keyboard, touch and screen readers work as the
 * platform does: arrows step, Page Up and Down jump, Home and End go to
 * the ends. An 8px track filled up to a 24px ink knob (styles.css,
 * `[data-mbx-slider]`). Marks under the track are buttons that set the
 * value, for the stops people ask about most.
 */

const slider = tv({
  slots: {
    root: "flex w-full flex-col",
    input:
      "h-8 w-full cursor-pointer rounded-full bg-transparent disabled:cursor-default",
    marks: "relative mt-1 h-7",
    mark: "absolute top-0 flex h-7 min-w-6 -translate-x-1/2 cursor-pointer items-center justify-center rounded-full px-1 text-[13px] font-semibold text-sec tabular-nums outline-none hover:text-ink focus-visible:outline-2 focus-visible:outline-ink disabled:cursor-default disabled:hover:text-sec data-[current]:text-ink",
  },
})

export type Mark = { value: number; label: string }

export type RootProps = Omit<
  ComponentProps<"input">,
  "type" | "value" | "defaultValue" | "onChange" | "min" | "max" | "step"
> & {
  value: number
  onValueChange?: (value: number) => void
  min?: number
  max?: number
  step?: number
  /** What is read out for the value, for example "3.25×". */
  valueText?: string
  /** Stops under the track; each is a button that sets its value. */
  marks?: readonly Mark[]
  /** The accessible name of a mark's button; its label by default. */
  markLabel?: (mark: Mark) => string
}

/** 0 to 1: where `value` sits between `min` and `max`. */
function ratio(value: number, min: number, max: number): number {
  if (max <= min) return 0
  return (Math.min(Math.max(value, min), max) - min) / (max - min)
}

/** The centre of the knob at `at` (0 to 1), as a CSS length. */
function position(at: number): string {
  return `calc(12px + (100% - 24px) * ${at})`
}

export function Root({
  value,
  onValueChange,
  min = 0,
  max = 100,
  step = 1,
  valueText,
  marks,
  markLabel,
  disabled,
  className,
  style,
  ...props
}: RootProps): ReactNode {
  const styles = slider()
  const at = ratio(value, min, max)
  const input = (
    <input
      type="range"
      data-mbx-slider=""
      min={min}
      max={max}
      step={step}
      value={value}
      disabled={disabled}
      aria-valuetext={valueText}
      onChange={(event) => onValueChange?.(Number(event.currentTarget.value))}
      className={styles.input({ className: marks ? undefined : className })}
      style={{ "--mbx-slider-at": `${at}`, ...style } as CSSProperties}
      {...props}
    />
  )
  if (marks === undefined || marks.length === 0) return input
  return (
    <div className={styles.root({ className })}>
      {input}
      <div className={styles.marks()}>
        {marks.map((mark) => (
          <button
            key={mark.value}
            type="button"
            disabled={disabled}
            aria-label={markLabel?.(mark)}
            data-current={mark.value === value ? "" : undefined}
            onClick={() => onValueChange?.(mark.value)}
            className={styles.mark()}
            style={{ left: position(ratio(mark.value, min, max)) }}
          >
            {mark.label}
          </button>
        ))}
      </div>
    </div>
  )
}

Root.displayName = "Slider"
