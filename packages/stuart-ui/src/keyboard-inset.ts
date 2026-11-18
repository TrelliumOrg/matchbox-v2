import { useEffect } from "react"

/**
 * Keeps bottom sheets above the on-screen keyboard.
 *
 * A sheet fixed to the bottom of the page sits on the layout viewport. On
 * iOS the keyboard does not shrink that viewport (and `dvh` does not move
 * with it), so the keyboard covers the lower half of the sheet: the results
 * under a search field, or Stuart's composer. The visual viewport does
 * shrink. While a sheet that takes typing is open, the gap between the two
 * is published as `--keyboard-inset` on <html>, and the sheets' CSS lifts
 * their bottom edge and trims their height by it. It is 0 with no keyboard,
 * and absent where the browser has no visualViewport, so the CSS falls back
 * to 0.
 */

export const keyboardInsetProperty = "--keyboard-inset"

/** How much of the layout viewport's bottom the keyboard covers, in px. */
export function keyboardInset(
  layoutHeight: number,
  visual: { height: number; offsetTop: number },
): number {
  const covered = layoutHeight - visual.height - visual.offsetTop
  // A few pixels of difference are rounding and browser chrome, not a
  // keyboard.
  return covered > 40 ? Math.round(covered) : 0
}

let users = 0
let stop: (() => void) | null = null

function start(): () => void {
  const viewport = window.visualViewport
  if (viewport === null || viewport === undefined) return () => {}
  const root = document.documentElement
  const update = (): void => {
    root.style.setProperty(
      keyboardInsetProperty,
      `${keyboardInset(window.innerHeight, viewport)}px`,
    )
  }
  update()
  viewport.addEventListener("resize", update)
  viewport.addEventListener("scroll", update)
  return () => {
    viewport.removeEventListener("resize", update)
    viewport.removeEventListener("scroll", update)
    root.style.removeProperty(keyboardInsetProperty)
  }
}

/** Publishes `--keyboard-inset` while the calling sheet is mounted. */
export function useKeyboardInset(active = true): void {
  useEffect(() => {
    if (!active) return
    users += 1
    if (users === 1) stop = start()
    return () => {
      users -= 1
      if (users === 0) {
        stop?.()
        stop = null
      }
    }
  }, [active])
}
