import { useEffect, useState } from "react"

/**
 * The header lockup's Fold (option A on `Wo5F_DTsbm`): the full lockup
 * shows on arrival, then about 1.2s after first paint MATCHBOX folds away
 * and the product name slides next to the icon, once per session. Later
 * pages in the session (and reloads, through `lockupFoldScript`) start
 * folded; reduced motion starts folded. Hover or focus on the logo link
 * unfolds it (CSS in styles.css).
 */

export const lockupFoldKey = "mbx-lockup-folded"
export const lockupFoldDelay = 1200

/** For <head>: marks <html> before first paint when this session folded. */
export const lockupFoldScript = `try{if(sessionStorage.getItem("${lockupFoldKey}"))document.documentElement.setAttribute("data-lockup-folded","")}catch(e){}`

function folded(): boolean {
  try {
    return window.sessionStorage.getItem(lockupFoldKey) !== null
  } catch {
    return false
  }
}

function remember(): void {
  try {
    window.sessionStorage.setItem(lockupFoldKey, "1")
  } catch {
    // Folds again next page in this session.
  }
}

function reducedMotion(): boolean {
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  )
}

/** True once the lockup should show the short form. Server: false. */
export function useFold(enabled: boolean): boolean {
  const [isFolded, setFolded] = useState(false)
  useEffect(() => {
    if (!enabled) return
    if (folded() || reducedMotion()) {
      remember()
      setFolded(true)
      return
    }
    const timer = setTimeout(() => {
      remember()
      setFolded(true)
    }, lockupFoldDelay)
    return () => clearTimeout(timer)
  }, [enabled])
  return isFolded
}
