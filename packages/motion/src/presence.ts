import { createContext, useContext, useEffect, useState } from "react"
import { sheetExitMs } from "./easing"
import { prefersReducedMotion } from "./reduced-motion"

/**
 * Exits that mirror entries. React unmounts at once, so whatever leaves is
 * kept on screen for its exit and marked as leaving: the element animates
 * out with `pointer-events: none` (nothing blocks a click) and is removed
 * when the exit is over. Under reduced motion it goes at once.
 */

type Present<T> = Exclude<T, null | undefined | false>

function isPresent<T>(value: T): value is Present<T> {
  return value !== null && value !== undefined && value !== false
}

/**
 * Keeps the last present `value` for `ms` after it turns null (or false),
 * so its exit can play. Returns what to render and whether it is leaving.
 */
export function useLeaving<T>(
  value: T,
  ms: number = sheetExitMs,
): readonly [shown: Present<T> | null, leaving: boolean] {
  const [kept, setKept] = useState<Present<T> | null>(
    isPresent(value) ? value : null,
  )
  const present = isPresent(value)
  if (isPresent(value) && kept !== value) setKept(value)

  useEffect(() => {
    if (present || kept === null) return
    if (prefersReducedMotion()) {
      setKept(null)
      return
    }
    const timer = setTimeout(() => setKept(null), ms)
    return () => clearTimeout(timer)
  }, [present, kept, ms])

  if (isPresent(value)) return [value, false]
  return [kept, kept !== null]
}

const LeavingContext = createContext(false)

/**
 * Wrap a sheet that is leaving: `Sheet.Root` and `WalletDrawer.Root` read
 * it and close, so Radix plays the slide out before the host unmounts it.
 */
export const LeavingProvider = LeavingContext.Provider

export function useIsLeaving(): boolean {
  return useContext(LeavingContext)
}
