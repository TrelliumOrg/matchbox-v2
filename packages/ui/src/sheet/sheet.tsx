import { useIsLeaving } from "@matchbox/motion"
import { Dialog } from "radix-ui"
import type { ComponentProps, ReactNode } from "react"
import { Icon } from "../icons"
import { tv } from "../tv"

/**
 * Every desktop dialog slides in from the right: 480 wide, radius 24 on the
 * left, padding 28/32/32, over a scrim. Phones get a bottom sheet with a grab
 * handle. 44px header with a 26/650 title and a 40px round close X, so there
 * is no Cancel or Back. One 54px primary is pinned at the bottom.
 */

const sheet = tv({
  slots: {
    overlay:
      "fixed inset-0 z-40 bg-scrim data-[state=closed]:animate-[mbx-fade-out_240ms_ease-out] data-[state=open]:animate-[mbx-fade-in_240ms_ease-out]",
    content:
      "fixed inset-y-0 right-0 z-50 flex w-[480px] max-w-full flex-col rounded-l-[24px] bg-sheet px-8 pt-7 pb-8 text-ink shadow-sheet outline-none data-[state=closed]:animate-[mbx-sheet-out_280ms_var(--ease-roll)] data-[state=open]:animate-[mbx-sheet-in_340ms_var(--ease-roll)] max-sm:inset-x-0 max-sm:top-auto max-sm:max-h-[92dvh] max-sm:w-full max-sm:rounded-t-[24px] max-sm:rounded-bl-none max-sm:px-5 max-sm:pt-2.5 max-sm:pb-[max(2.5rem,calc(1rem+env(safe-area-inset-bottom)))] max-sm:shadow-[inset_0_1px_0_var(--line)] max-sm:data-[state=closed]:animate-[mbx-sheet-down_280ms_var(--ease-roll)] max-sm:data-[state=open]:animate-[mbx-sheet-up_340ms_var(--ease-roll)]",
    grab: "mx-auto mb-3.5 hidden h-1 w-9 flex-none rounded-sm bg-ring max-sm:block",
    header: "flex h-11 flex-none items-center gap-2.5",
    title: "text-[26px] font-[650] tracking-[-0.02em] max-sm:text-[22px]",
    close:
      "ml-auto grid size-10 flex-none cursor-pointer place-items-center rounded-full bg-soft text-ink outline-none hover:bg-soft2 focus-visible:outline-2 focus-visible:outline-ink dark:bg-soft2 max-sm:size-9",
    body: "-mx-1 mt-6 min-h-0 flex-1 overflow-y-auto px-1",
    footer: "mt-6 flex flex-none flex-col items-center gap-4",
  },
})

export type RootProps = ComponentProps<typeof Dialog.Root>

/**
 * Closes while its host keeps it mounted for the exit (`LeavingProvider`),
 * so the slide out mirrors the slide in.
 */
export function Root({ open, ...props }: RootProps): ReactNode {
  const leaving = useIsLeaving()
  const shown = leaving ? false : open
  return (
    <Dialog.Root {...props} {...(shown === undefined ? {} : { open: shown })} />
  )
}

Root.displayName = "Sheet.Root"

export const Trigger = Dialog.Trigger

export const Close = Dialog.Close

export type ContentProps = ComponentProps<typeof Dialog.Content>

export function Content({
  className,
  children,
  ...props
}: ContentProps): ReactNode {
  const s = sheet()
  return (
    <Dialog.Portal>
      <Dialog.Overlay
        data-mbx-motion=""
        data-mbx-layer=""
        className={s.overlay()}
      />
      <Dialog.Content
        data-mbx-motion=""
        data-mbx-layer=""
        aria-describedby={undefined}
        className={s.content({ className })}
        {...props}
      >
        <span aria-hidden="true" className={s.grab()} />
        {children}
      </Dialog.Content>
    </Dialog.Portal>
  )
}

Content.displayName = "Sheet.Content"

export type HeaderProps = {
  children: ReactNode
  /** Beside the title, for example the appearance sync icon. */
  accessory?: ReactNode
  closeLabel?: string
}

export function Header({
  children,
  accessory,
  closeLabel = "Close",
}: HeaderProps): ReactNode {
  const s = sheet()
  return (
    <header className={s.header()}>
      <Dialog.Title className={s.title()}>{children}</Dialog.Title>
      {accessory}
      <Dialog.Close aria-label={closeLabel} className={s.close()}>
        <Icon name="x" size={20} strokeWidth={1.8} />
      </Dialog.Close>
    </header>
  )
}

Header.displayName = "Sheet.Header"

export function Body({
  className,
  ...props
}: ComponentProps<"div">): ReactNode {
  return <div className={sheet().body({ className })} {...props} />
}

Body.displayName = "Sheet.Body"

/** Holds the one pinned primary and, at most, a red text link under it. */
export function Footer({
  className,
  ...props
}: ComponentProps<"footer">): ReactNode {
  return <footer className={sheet().footer({ className })} {...props} />
}

Footer.displayName = "Sheet.Footer"

/** The secondary destructive choice under the primary. */
export function DestructiveLink({
  className,
  type,
  ...props
}: ComponentProps<"button">): ReactNode {
  return (
    <button
      type={type ?? "button"}
      className={`cursor-pointer text-[15px] font-semibold text-neg underline underline-offset-[3px] outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink ${className ?? ""}`}
      {...props}
    />
  )
}

DestructiveLink.displayName = "Sheet.DestructiveLink"
