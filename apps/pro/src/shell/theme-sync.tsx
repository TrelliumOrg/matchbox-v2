import { startPageMotion } from "@matchbox/motion/page"
import * as Theme from "@matchbox/ui/theme"
import { lazy, type ReactNode, Suspense, useEffect, useState } from "react"
import {
  setAppearanceOpen,
  useAppearanceOpen,
} from "../account/appearance-store"

/**
 * The page's theme after first paint. The inline script from
 * `@matchbox/tokens` has already painted the right preset, so this
 * ThemeProvider loads when the page is idle and from then on follows the
 * device's scheme in System mode and changes made in other tabs. It also
 * holds the Appearance sheet, which the Account panel opens with
 * `openAppearance` (the sheet's code loads on the first open).
 */

const AppearanceSheet = lazy(() => import("../account/appearance-sheet"))

/**
 * The browser's bars follow the theme on screen. The two theme-color metas
 * in the document follow the device's scheme, which is wrong for someone
 * who picked Dark on a light phone (or a preset whose ground is not the
 * default): both are set to the painted background whenever it changes.
 */
function ThemeColorSync(): null {
  const { preset } = Theme.useTheme()
  // biome-ignore lint/correctness/useExhaustiveDependencies: reads the page once the preset is painted
  useEffect(() => {
    const paint = (): void => {
      const ground = getComputedStyle(document.documentElement)
        .getPropertyValue("--bg")
        .trim()
      if (ground === "") return
      for (const meta of document.querySelectorAll(
        'meta[name="theme-color"]',
      )) {
        meta.setAttribute("content", ground)
      }
    }
    // The provider paints in an effect of its own, or inside a view
    // transition: read the ground a frame later.
    const frame = requestAnimationFrame(() => requestAnimationFrame(paint))
    return () => cancelAnimationFrame(frame)
  }, [preset])
  return null
}

export default function ThemeSync(): ReactNode {
  // Also the page's idle motion: data-flip-list lists, count-up headlines.
  useEffect(startPageMotion, [])
  const open = useAppearanceOpen()
  const [requested, setRequested] = useState(false)
  if (open && !requested) setRequested(true)
  return (
    <Theme.Provider>
      <ThemeColorSync />
      {requested ? (
        <Suspense fallback={null}>
          <AppearanceSheet open={open} onOpenChange={setAppearanceOpen} />
        </Suspense>
      ) : null}
    </Theme.Provider>
  )
}
