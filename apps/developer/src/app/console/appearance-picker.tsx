import * as Theme from "@matchbox/ui/theme"
import type { ReactNode } from "react"

/** The frame's one row of four palettes (two on phones). */
const presetRow =
  "[&_[role=radiogroup]]:grid-cols-4 max-sm:[&_[role=radiogroup]]:grid-cols-2"

/**
 * Account appearance (`KXelB7l7UL`): mode, the palettes that mode shows,
 * and haptics. Its own chunk, so the Radix controls load with this section
 * and not with every console page.
 */
export default function AppearancePicker(): ReactNode {
  const { appearance } = Theme.useTheme()
  return (
    <Theme.Picker>
      <Theme.Mode className="max-w-[420px] [&>:first-child]:sr-only" />
      {appearance.mode !== "dark" ? (
        <Theme.Presets mode="light" className={presetRow} />
      ) : null}
      {appearance.mode !== "light" ? (
        <Theme.Presets mode="dark" className={presetRow} />
      ) : null}
      <Theme.Haptics className="mt-8" />
    </Theme.Picker>
  )
}
