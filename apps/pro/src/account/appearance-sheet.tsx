import * as Sheet from "@matchbox/ui/sheet"
import * as Theme from "@matchbox/ui/theme"
import * as Tooltip from "@matchbox/ui/tooltip"
import type { ReactNode } from "react"

/**
 * The Appearance sheet: mode, presets and Haptics. Rendered inside the page's
 * one ThemeProvider (see shell/theme-sync), opened from the Account panel.
 */
export default function AppearanceSheet({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}): ReactNode {
  return (
    <Tooltip.Provider>
      <Sheet.Root open={open} onOpenChange={onOpenChange}>
        <Sheet.Content>
          <Sheet.Header accessory={<Theme.SyncIcon />}>Appearance</Sheet.Header>
          <Sheet.Body>
            <Theme.Picker className="flex flex-col gap-7" />
          </Sheet.Body>
        </Sheet.Content>
      </Sheet.Root>
    </Tooltip.Provider>
  )
}
