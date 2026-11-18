import { type RefObject, useEffect } from "react"

/**
 * Keeps the phone bottom sheet above the on-screen keyboard (the pattern
 * Pro's sheets use). On iOS and in wallets' in-app browsers the keyboard
 * does not shrink the layout viewport, so a sheet fixed to the bottom is
 * covered. The visual viewport does shrink: while the sheet is open the
 * gap is set as `--fb-keyboard-inset` on the sheet itself, and its CSS
 * lifts its bottom edge and trims its height by it.
 */

export const keyboardInsetProperty = "--fb-keyboard-inset"

/** How much of the layout viewport's bottom the keyboard covers, in px. */
export function keyboardInset(
  layoutHeight: number,
  visual: { height: number; offsetTop: number },
): number {
  const covered = layoutHeight - visual.height - visual.offsetTop
  // A few pixels are rounding and browser chrome, not a keyboard.
  return covered > 40 ? Math.round(covered) : 0
}

export function useKeyboardInset(
  sheet: RefObject<HTMLElement | null>,
  active: boolean,
): void {
  useEffect(() => {
    const viewport = window.visualViewport
    if (!active || viewport === null || viewport === undefined) return
    function update(): void {
      if (viewport === null || viewport === undefined) return
      sheet.current?.style.setProperty(
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
    }
  }, [sheet, active])
}
