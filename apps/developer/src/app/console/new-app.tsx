import { Icon } from "@matchbox/ui/icons"
import * as PillButton from "@matchbox/ui/pill-button"
import { lazy, type ReactNode, Suspense, useState } from "react"

function loadSheet(): Promise<typeof import("./new-app-sheet")> {
  return import("./new-app-sheet")
}

const NewAppSheet = lazy(loadSheet)

/**
 * "New app" as a pill, or as the Apps grid's dashed card (`ZqnXTBKb9u`);
 * its sheet (Radix) loads on intent, never with the page.
 */
export function NewAppButton({
  orgId,
  variant = "pill",
}: {
  orgId: string
  variant?: "pill" | "card"
}): ReactNode {
  const [open, setOpen] = useState(false)
  const intent = {
    onPointerEnter: () => void loadSheet(),
    onFocus: () => void loadSheet(),
    onClick: () => setOpen(true),
  }
  return (
    <>
      {variant === "card" ? (
        <button
          type="button"
          {...intent}
          className="flex min-h-[340px] cursor-pointer flex-col items-center justify-center gap-3.5 rounded-[24px] border-[1.5px] border-dashed border-soft2 bg-bg text-center outline-none hover:bg-soft focus-visible:outline-2 focus-visible:outline-ink max-sm:min-h-48"
        >
          <span className="grid size-[52px] place-items-center rounded-full bg-acc text-[#1A1206]">
            <Icon name="plus" size={22} />
          </span>
          <span className="text-[17px] font-[650] text-ink">New app</span>
          <span className="text-[14.5px] text-sec">Test access on create</span>
        </button>
      ) : (
        <PillButton.Root {...intent}>
          <Icon name="plus" size={18} />
          New app
        </PillButton.Root>
      )}
      {open ? (
        <Suspense fallback={null}>
          <NewAppSheet orgId={orgId} onClose={() => setOpen(false)} />
        </Suspense>
      ) : null}
    </>
  )
}
