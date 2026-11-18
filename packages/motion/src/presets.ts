import { easing, enterMs, exitMs, sheetExitMs } from "./easing"
import { prefersReducedMotion } from "./reduced-motion"

/**
 * Enter and exit presets shared by Pro, Matchscan, ID and Developer, so a
 * sheet or a popover moves the same everywhere (matchbox-v3 Motion).
 *
 * Each preset has CSS classes for components that animate on Radix's
 * `data-state` or on mount (the keyframes live in @matchbox/ui/styles.css,
 * which also scans this file for Tailwind) and Web Animations steps for code
 * that animates imperatively. Transform and opacity only; 120 to 260ms for
 * small things, at most 400ms for sheets; exits are quicker than entries.
 *
 * Reduced motion: `motionStep` returns a short fade for surfaces and
 * nothing for movement-only presets (list slides, indicators); the global
 * `[data-mbx-motion]` rule in @matchbox/ui does the same for the classes.
 */

export type MotionStep = {
  keyframes: Keyframe[]
  options: KeyframeAnimationOptions
}

export type MotionPreset = {
  enter: MotionStep
  exit: MotionStep
  /** Tailwind classes: Radix data-state driven (or `leaving` driven). */
  className: { enter: string; exit: string }
  /** Under reduced motion: a short fade, or nothing at all. */
  reduced: "fade" | "none"
}

const roll = easing.roll

function step(
  keyframes: Keyframe[],
  ms: number,
  curve: string = roll,
): MotionStep {
  return { keyframes, options: { duration: ms, easing: curve } }
}

const indicatorMs = 300

const fadeIn = [{ opacity: 0 }, { opacity: 1 }]
const fadeOut = [{ opacity: 1 }, { opacity: 0 }]

export const presets = {
  /** Right sheets: slide in from the right edge, back out to it. */
  sheet: {
    enter: step(
      [{ transform: "translateX(100%)" }, { transform: "none" }],
      340,
    ),
    exit: step(
      [{ transform: "none" }, { transform: "translateX(100%)" }],
      sheetExitMs,
    ),
    className: {
      enter: "data-[state=open]:animate-[mbx-sheet-in_340ms_var(--ease-roll)]",
      exit: "data-[state=closed]:animate-[mbx-sheet-out_280ms_var(--ease-roll)]",
    },
    reduced: "fade",
  },
  /** The floating drawer (wallet, Account): the sheet's slide, inset. */
  drawer: {
    enter: step(
      [{ transform: "translateX(100%)" }, { transform: "none" }],
      340,
    ),
    exit: step(
      [{ transform: "none" }, { transform: "translateX(100%)" }],
      sheetExitMs,
    ),
    className: {
      enter: "data-[state=open]:animate-[mbx-sheet-in_340ms_var(--ease-roll)]",
      exit: "data-[state=closed]:animate-[mbx-sheet-out_280ms_var(--ease-roll)]",
    },
    reduced: "fade",
  },
  /** Phone bottom sheets: up from the bottom edge, back down. */
  bottomSheet: {
    enter: step(
      [{ transform: "translateY(100%)" }, { transform: "none" }],
      340,
    ),
    exit: step(
      [{ transform: "none" }, { transform: "translateY(100%)" }],
      sheetExitMs,
    ),
    className: {
      enter: "data-[state=open]:animate-[mbx-sheet-up_340ms_var(--ease-roll)]",
      exit: "data-[state=closed]:animate-[mbx-sheet-down_280ms_var(--ease-roll)]",
    },
    reduced: "fade",
  },
  /** The scrim behind a sheet fades with it. */
  scrim: {
    enter: step(fadeIn, 240, "ease-out"),
    exit: step(fadeOut, 240, "ease-out"),
    className: {
      enter: "data-[state=open]:animate-[mbx-fade-in_240ms_ease-out]",
      exit: "data-[state=closed]:animate-[mbx-fade-out_240ms_ease-out]",
    },
    reduced: "fade",
  },
  /**
   * Popovers, menus and tooltips: scale and fade from the trigger (set
   * transform-origin to the trigger's side).
   */
  popover: {
    enter: step(
      [
        { opacity: 0, transform: "scale(.97)" },
        { opacity: 1, transform: "none" },
      ],
      150,
    ),
    exit: step(
      [
        { opacity: 1, transform: "none" },
        { opacity: 0, transform: "scale(.97)" },
      ],
      120,
      "ease-out",
    ),
    className: {
      enter: "data-[state=open]:animate-[mbx-pop-in_150ms_var(--ease-roll)]",
      exit: "data-[state=closed]:animate-[mbx-pop-out_120ms_ease-out_forwards]",
    },
    reduced: "fade",
  },
  /** Toasts: slide up in from below, back down out. */
  toast: {
    enter: step(
      [
        { opacity: 0, transform: "translateY(100%)" },
        { opacity: 1, transform: "none" },
      ],
      300,
    ),
    exit: step(
      [
        { opacity: 1, transform: "none" },
        { opacity: 0, transform: "translateY(100%)" },
      ],
      200,
    ),
    className: {
      enter: "animate-[mbx-slot-in_300ms_var(--ease-roll)]",
      exit: "pointer-events-none animate-[mbx-toast-out_200ms_var(--ease-roll)_forwards]",
    },
    reduced: "fade",
  },
  /** List items: fade and settle in, fade and shrink out (see flip-run). */
  list: {
    enter: step(
      [
        { opacity: 0, transform: "scale(.96)" },
        { opacity: 1, transform: "none" },
      ],
      enterMs,
    ),
    exit: step(
      [
        { opacity: 1, transform: "none" },
        { opacity: 0, transform: "scale(.96)" },
      ],
      exitMs,
    ),
    className: {
      enter: "animate-[mbx-pop-in_240ms_var(--ease-roll)]",
      exit: "pointer-events-none animate-[mbx-leave_160ms_var(--ease-roll)_forwards]",
    },
    reduced: "none",
  },
  /**
   * Tab and segmented indicators: slide between items. `enter` is the
   * shape; use `indicatorStep` for the actual move.
   */
  indicator: {
    enter: step([{ transform: "none" }, { transform: "none" }], indicatorMs),
    exit: step([{ transform: "none" }, { transform: "none" }], indicatorMs),
    className: {
      enter: "transition-transform duration-300 ease-roll",
      exit: "transition-transform duration-300 ease-roll",
    },
    reduced: "none",
  },
} as const satisfies Record<string, MotionPreset>

export type PresetName = keyof typeof presets

/**
 * The step to play for `name` entering or exiting, honouring reduced
 * motion: a 120ms fade for surfaces, null (do not animate) for movement.
 */
export function motionStep(
  name: PresetName,
  phase: "enter" | "exit",
  reduced: boolean = prefersReducedMotion(),
): MotionStep | null {
  const preset: MotionPreset = presets[name]
  if (!reduced) return preset[phase]
  if (preset.reduced === "none") return null
  return step(phase === "enter" ? fadeIn : fadeOut, 120, "ease-out")
}

/**
 * An indicator sliding from `from` to `to` (the item rects), transform only;
 * null under reduced motion (it jumps).
 */
export function indicatorStep(
  from: { left: number; width: number },
  to: { left: number; width: number },
  reduced: boolean = prefersReducedMotion(),
): MotionStep | null {
  if (reduced || to.width === 0) return null
  return step(
    [
      {
        transform: `translateX(${from.left - to.left}px) scaleX(${from.width / to.width})`,
      },
      { transform: "none" },
    ],
    indicatorMs,
  )
}
