import * as Sheet from "@matchbox/ui/sheet"
import * as Theme from "@matchbox/ui/theme"
import type { ReactNode } from "react"

/**
 * Appearance (Doop `qGcsfxwWDF`): the same picker as Pro and Matchscan.
 * The ThemeProvider writes the shared `mbx-appearance` cookie on
 * .matchbox.markets, and the pre-paint script reads it first, so a choice
 * made here follows the visitor to the other products.
 */
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
