import type { ReactNode } from "react"

/**
 * A phone bottom sheet (Doop `Ex_NDcO1Cv`, `Foe0-QXB3a`) on the native
 * popover attribute, as Matchscan's More menu is: a button with
 * `popoverTarget={id}` opens it with no script, so the menu and On this
 * page work before hydration and with scripting off. It sits in the top
 * layer over a scrim; Escape and a tap outside close it. Links inside call
 * `hideSheet` so a page change does not leave it open.
 */
export function BottomSheet({
  id,
  label,
  children,
}: {
  id: string
  label: string
  children: ReactNode
}): ReactNode {
  return (
    <div
      id={id}
      popover="auto"
      role="dialog"
      aria-label={label}
      className="fixed inset-x-0 top-auto bottom-0 m-0 max-h-[88dvh] w-full max-w-full overflow-y-auto rounded-t-[24px] border-0 bg-sheet px-3 pt-2.5 pb-[max(20px,env(safe-area-inset-bottom))] text-ink outline-none backdrop:bg-scrim [&:popover-open]:animate-[mbx-sheet-up_340ms_var(--ease-roll)] motion-reduce:[&:popover-open]:animate-none"
    >
      <span
        aria-hidden="true"
        className="mx-auto mb-3 block h-1 w-9 rounded-sm bg-ring"
      />
      {children}
    </div>
  )
}

/** Closes a sheet by its id, if it is open. */
export function hideSheet(id: string): void {
  const sheet = document.getElementById(id)
  if (sheet?.matches(":popover-open")) sheet.hidePopover()
}

export const navSheetId = "docs-nav"
export const tocSheetId = "docs-toc"
