import * as Theme from "@matchbox/ui/theme"
import type { ReactNode } from "react"

/**
 * The account's Appearance tab. Its own chunk: the Radix controls load when
 * the tab is opened, not with every account page.
 */
export default function AppearancePicker(): ReactNode {
  return <Theme.Picker className="flex flex-col gap-8" />
}
