import { startPageMotion } from "@matchbox/motion/page"
import * as Theme from "@matchbox/ui/theme"
import { type ReactNode, useEffect } from "react"

/**
 * The page's theme after first paint. The inline script from
 * `@matchbox/tokens` has already painted the right preset, so this
 * ThemeProvider loads when the page is idle and from then on follows the
 * device's scheme in System mode and changes made in other tabs. `children`
 * render inside the provider: an app's Appearance sheet, loaded on its first
 * open.
 */
export default function ThemeSync({
  children,
}: {
  children?: ReactNode
}): ReactNode {
  // Also the page's idle motion: data-flip-list lists, count-up headlines.
  useEffect(startPageMotion, [])
  return <Theme.Provider>{children}</Theme.Provider>
}
