import * as Sheet from "@matchbox/ui/sheet"
import * as Theme from "@matchbox/ui/theme"
import type { ReactNode } from "react"

/** Appearance (`tkY66XD4wx`): mode and the theme presets. */
export default function AppearanceSheet({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}): ReactNode {
  return (
    <Sheet.Root open={open} onOpenChange={onOpenChange}>
      <Sheet.Content>
        <Sheet.Header>Appearance</Sheet.Header>
        <Sheet.Body>
          <Theme.Picker />
        </Sheet.Body>
      </Sheet.Content>
    </Sheet.Root>
  )
}
