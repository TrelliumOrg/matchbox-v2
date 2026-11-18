import { Glyph, shapes } from "@matchbox/ui/icons"
import type { ReactNode } from "react"
import { microToUsd } from "./ballot"
import type { OptimizeState } from "./ballot-panel"

/**
 * Optimize: one click, applies the optimizer's ballot. Shows the gain
 * first. After it was pressed it says what changed, "Was $8.75, +$1.20",
 * and offers Undo, which puts the ballot back as it was. One press moved
 * every share, and without a way back the only undo was to retype them.
 *
 * The rail has room for the line under the button. The bar does not: there
 * the button itself becomes Undo, still showing the gain, while the
 * optimized ballot stands. The bar's Projected figure is the new total.
 */
export function OptimizeButton({
  state,
  onOptimize,
  onUndo,
  compact,
}: {
  state: OptimizeState
  onOptimize: () => void
  onUndo: () => void
  compact: boolean
}): ReactNode {
  const done = state.kind === "optimized"
  const applied = state.kind === "optimized" ? state.applied : null
  const undoInPlace = compact && applied !== null
  // Beside the label: the gain on offer, or in the bar the gain Undo
  // would give back.
  const gainMicro =
    state.kind === "ready"
      ? state.gainMicro
      : undoInPlace
        ? applied.gainMicro
        : 0n
  // In the bar the button keeps one width (188px, room for "Optimize
  // +$99.99") whatever it says. The gain arrives once the optimizer has
  // run, after first paint, and a button that grew by it pushed the bar's
  // right-hand group sideways: a layout shift of 0.0005 with nobody
  // touching the page. A gain of $100 or more still widens it.
  return (
    <>
      <button
        type="button"
        onClick={undoInPlace ? onUndo : onOptimize}
        aria-disabled={(done && !undoInPlace) || undefined}
        className={`flex flex-none cursor-pointer items-center gap-2.5 rounded-full font-[650] text-ink outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink ${
          compact
            ? "h-11 min-w-[188px] px-4 text-[15px]"
            : "h-[50px] w-full px-5 text-base"
        } ${done && !undoInPlace ? "cursor-default shadow-[inset_0_0_0_1.5px_var(--line)]" : done ? "shadow-[inset_0_0_0_1.5px_var(--line)]" : "bg-raised"}`}
      >
        <Glyph shape={shapes.wandSparkles} size={18} className="text-acc-ink" />
        {undoInPlace ? "Undo" : done ? "Optimized" : "Optimize"}
        {gainMicro > 0n ? (
          <span className="ml-auto text-[15px] font-[650] text-pos tabular-nums">
            +${microToUsd(gainMicro)}
          </span>
        ) : null}
      </button>
      {compact || applied === null ? null : (
        <p
          data-optimize-applied=""
          className="mt-2 flex items-baseline justify-between gap-3 px-1 text-[14px] text-sec tabular-nums"
        >
          <span role="status">{appliedLine(applied)}</span>
          <button
            type="button"
            onClick={onUndo}
            className="cursor-pointer rounded-sm font-semibold text-ink underline underline-offset-[3px] outline-none focus-visible:outline-2 focus-visible:outline-ink"
          >
            Undo
          </button>
        </p>
      )}
    </>
  )
}

/** "Was $8.75, +$1.20" */
export function appliedLine(applied: {
  wasMicro: bigint
  gainMicro: bigint
}): string {
  const was = `Was $${microToUsd(applied.wasMicro)}`
  return applied.gainMicro > 0n
    ? `${was}, +$${microToUsd(applied.gainMicro)}`
    : was
}
