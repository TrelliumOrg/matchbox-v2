import { AnimatedNumber } from "@matchbox/motion"
import { type KeyboardEvent, type ReactNode, useRef, useState } from "react"
import { Glyph, shapes } from "../icons"
import { tv } from "../tv"

/**
 * Stepper (Components frame): soft track, two 36px white round buttons and a
 * 58px tabular value. The value is a typeable spinbutton: focus selects it,
 * digits with one decimal place are accepted (clamped to the range) and
 * apply as you type, Enter or blur commits, Escape reverts, arrows step by
 * 1 (Shift by 10). The buttons step by `step`. Digits roll at rest.
 */

const stepper = tv({
  slots: {
    root: "inline-flex h-11 flex-none items-center rounded-[22px] px-1",
    button:
      "grid size-9 flex-none cursor-pointer place-items-center rounded-full text-ink outline-none focus-visible:outline-2 focus-visible:outline-ink disabled:cursor-not-allowed disabled:text-mut",
    value:
      "w-[58px] text-center text-base font-[650] tabular-nums outline-none focus-visible:rounded-md focus-visible:outline-2 focus-visible:outline-ink",
  },
  variants: {
    surface: {
      soft: { root: "bg-soft", button: "bg-raised" },
      raised: {
        root: "bg-raised shadow-[inset_0_0_0_1px_var(--line)]",
        button: "bg-soft",
      },
    },
  },
  defaultVariants: { surface: "soft" },
})

export type RootProps = {
  /** Accessible name, for example "Share for Kiln Labs". */
  label: string
  value?: number
  defaultValue?: number
  onValueChange?: (value: number) => void
  min?: number
  max?: number
  /** What the minus and plus buttons move by. */
  step?: number
  /** Shown after the number and read as part of the value. */
  suffix?: string
  /** "raised" on a soft card (the ballot rail). */
  surface?: "soft" | "raised"
  className?: string
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** One decimal place at most, without float drift (12.5, never 12.499999). */
function tenth(value: number): number {
  return Math.round(value * 10) / 10
}

/**
 * What a person typed, as a number in range: digits with one optional
 * decimal place ("12", "12.5", ".5", "12."), clamped to `min`..`max`. Null
 * for anything else, and for an empty field.
 */
export function parsePercent(text: string, min = 0, max = 100): number | null {
  const trimmed = text.trim().replace(/%$/, "").replace(",", ".")
  if (!/^(\d+\.?\d?|\.\d)$/.test(trimmed)) return null
  return clamp(tenth(Number(trimmed)), min, max)
}

export function formatPercentValue(value: number): string {
  return Number.isInteger(value) ? `${value}` : value.toFixed(1)
}

export function Root({
  label,
  value: valueProp,
  defaultValue = 0,
  onValueChange,
  min = 0,
  max = 100,
  step = 5,
  suffix = "%",
  surface,
  className,
}: RootProps): ReactNode {
  const [inner, setInner] = useState(defaultValue)
  const value = valueProp ?? inner
  const s = stepper({ surface })
  // While typing: the text as typed, and the value to go back to on Escape.
  const [draft, setDraft] = useState<string | null>(null)
  const [before, setBefore] = useState(value)
  const selecting = useRef(false)

  function set(next: number): void {
    const clamped = clamp(tenth(next), min, max)
    if (clamped === value) return
    setInner(clamped)
    onValueChange?.(clamped)
  }

  /** Enter or blur: the typed value stays and becomes what Escape returns to. */
  function commit(): void {
    setDraft(null)
    setBefore(value)
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    const by = event.shiftKey ? 10 : 1
    switch (event.key) {
      case "ArrowUp":
        event.preventDefault()
        setDraft(null)
        set(value + by)
        return
      case "ArrowDown":
        event.preventDefault()
        setDraft(null)
        set(value - by)
        return
      case "PageUp":
        event.preventDefault()
        set(value + 10)
        return
      case "PageDown":
        event.preventDefault()
        set(value - 10)
        return
      case "Enter":
        event.preventDefault()
        commit()
        return
      case "Escape":
        event.preventDefault()
        setDraft(null)
        set(before)
        return
      default:
    }
  }

  return (
    // biome-ignore lint/a11y/useSemanticElements: a fieldset would add a legend; this is one control
    <div role="group" aria-label={label} className={s.root({ className })}>
      <button
        type="button"
        tabIndex={-1}
        aria-label={`Decrease ${label}`}
        disabled={value <= min}
        onClick={() => set(value - step)}
        className={s.button()}
      >
        <Glyph shape={shapes.minus} size={14} strokeWidth={2.2} />
      </button>
      <span className={`${s.value()} relative grid place-items-center`}>
        {/* The figure rolls at rest; typing shows the field itself. */}
        {draft === null ? (
          <AnimatedNumber
            value={value}
            suffix={suffix}
            aria-hidden="true"
            className="pointer-events-none [grid-area:1/1]"
          />
        ) : null}
        <input
          type="text"
          inputMode="decimal"
          role="spinbutton"
          aria-label={label}
          aria-valuenow={value}
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuetext={`${formatPercentValue(value)}${suffix}`}
          value={draft ?? `${formatPercentValue(value)}${suffix}`}
          onFocus={(event) => {
            setBefore(value)
            setDraft(formatPercentValue(value))
            event.currentTarget.select()
            selecting.current = true
          }}
          // The click that focused the field would clear the selection.
          onMouseUp={(event) => {
            if (!selecting.current) return
            selecting.current = false
            event.preventDefault()
          }}
          onChange={(event) => {
            const text = event.target.value
            if (!/^[\d.,]*%?$/.test(text)) return
            setDraft(text)
            const parsed = parsePercent(text, min, max)
            if (parsed !== null) set(parsed)
          }}
          onBlur={commit}
          onKeyDown={onKeyDown}
          className={`w-full bg-transparent text-center outline-none [grid-area:1/1] ${draft === null ? "text-transparent caret-transparent" : ""}`}
        />
      </span>
      <button
        type="button"
        tabIndex={-1}
        aria-label={`Increase ${label}`}
        disabled={value >= max}
        onClick={() => set(value + step)}
        className={s.button()}
      >
        <Glyph shape={shapes.plus} size={14} strokeWidth={2.2} />
      </button>
    </div>
  )
}

Root.displayName = "Stepper"
