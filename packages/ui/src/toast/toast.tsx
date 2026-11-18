import { presets } from "@matchbox/motion"
import type { ComponentProps, ReactNode } from "react"
import { Glyph, shapes } from "../icons"

/**
 * The toast after a confirmed transaction (`djpvmOKrvM`): a dark ink surface
 * at the lower left, a green check, one line, a subline with the block and
 * "View on Matchscan", a close X and a thin orange countdown line. A failed
 * transaction mirrors it with a red x and a red line. The app owns the
 * timer (6s, paused while hovered); the line only shows it.
 */

export type RootProps = Omit<ComponentProps<"output">, "title"> & {
  title: string
  /** "Block 13,078,812" and the link. */
  children?: ReactNode
  /** Countdown length in ms; 0 hides the line. */
  duration: number
  /** Pauses the line with the timer. */
  paused?: boolean
  onClose: () => void
  tone?: "positive" | "negative"
  /** Kept on screen for its exit (usePresenceList). */
  leaving?: boolean
}

export function Root({
  title,
  children,
  duration,
  paused = false,
  onClose,
  tone = "positive",
  leaving = false,
  className,
  ...props
}: RootProps): ReactNode {
  return (
    <output
      aria-live="polite"
      data-mbx-motion=""
      data-leaving={leaving ? "" : undefined}
      className={`relative flex w-[400px] max-w-[calc(100vw-24px)] items-center gap-3.5 overflow-hidden rounded-[18px] bg-ink py-3.5 pr-3 pl-4 text-bg shadow-pop ${leaving ? presets.toast.className.exit : `pointer-events-auto ${presets.toast.className.enter}`} ${className ?? ""}`}
      {...props}
    >
      <span
        aria-hidden="true"
        className={`grid size-9 flex-none place-items-center rounded-full ${tone === "positive" ? "bg-pos text-bg" : "bg-neg text-on-neg"}`}
      >
        <Glyph
          shape={tone === "positive" ? shapes.check : shapes.x}
          size={18}
          strokeWidth={2.6}
          className={tone === "positive" ? "mbx-draw" : undefined}
        />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15.5px] font-semibold">
          {title}
        </span>
        {children === undefined ? null : (
          <span className="mt-0.5 flex flex-wrap items-center gap-x-3 text-[14px] opacity-75 [&_a]:font-semibold [&_a]:underline [&_a]:underline-offset-[3px] [&_a]:opacity-100">
            {children}
          </span>
        )}
      </span>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={onClose}
        className="grid size-8 flex-none cursor-pointer place-items-center rounded-full opacity-70 outline-none hover:opacity-100 focus-visible:outline-2 focus-visible:outline-acc"
      >
        <Glyph shape={shapes.x} size={16} strokeWidth={2} />
      </button>
      {duration > 0 ? (
        <span
          aria-hidden="true"
          data-mbx-motion=""
          className={`absolute inset-x-3 bottom-0 h-[3px] origin-left rounded-full ${tone === "positive" ? "bg-acc" : "bg-neg"}`}
          style={{
            animation: `mbx-toast-countdown ${duration}ms linear forwards`,
            animationPlayState: paused ? "paused" : "running",
          }}
        />
      ) : null}
    </output>
  )
}

Root.displayName = "Toast"

/**
 * The fixed stack at the lower left, above the tab bar on phones: at
 * `--toast-bottom` when the app sets it, else 88px over the bottom inset.
 */
export function Viewport({
  className,
  ...props
}: ComponentProps<"div">): ReactNode {
  return (
    <div
      className={`pointer-events-none fixed bottom-6 left-6 z-[60] flex flex-col gap-2.5 max-md:inset-x-3 max-md:bottom-[var(--toast-bottom,calc(88px+env(safe-area-inset-bottom)))] max-md:items-center ${className ?? ""}`}
      {...props}
    />
  )
}

Viewport.displayName = "Toast.Viewport"
