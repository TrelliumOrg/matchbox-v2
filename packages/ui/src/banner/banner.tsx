import type { ComponentProps, ReactNode } from "react"
import { Glyph, shapes } from "../icons"
import * as Slot from "../slot"
import { tv } from "../tv"

/**
 * Banner: soft, radius 20, a 44px round icon (or the gauge picture), one line
 * plus an underlined action, and a close X.
 */

const banner = tv({
  slots: {
    root: "flex items-center gap-4 rounded-[20px] bg-soft px-5 py-[18px] text-ink shadow-[inset_0_0_0_1px_var(--edge)]",
    icon: "grid size-11 flex-none place-items-center overflow-hidden rounded-full bg-raised",
    content: "min-w-0 flex-1 text-[15.5px]",
    action:
      "mt-1 inline-block cursor-pointer font-[650] underline underline-offset-[3px] outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink",
    close:
      "ml-auto grid size-8 flex-none cursor-pointer place-items-center rounded-full text-sec outline-none hover:bg-soft2 focus-visible:outline-2 focus-visible:outline-ink",
  },
})

export function Root({
  className,
  ...props
}: ComponentProps<"section">): ReactNode {
  return <section className={banner().root({ className })} {...props} />
}

Root.displayName = "Banner"

export function Icon({
  className,
  ...props
}: ComponentProps<"span">): ReactNode {
  return (
    <span
      aria-hidden="true"
      className={banner().icon({ className })}
      {...props}
    />
  )
}

Icon.displayName = "Banner.Icon"

export function Content({
  className,
  ...props
}: ComponentProps<"div">): ReactNode {
  return <div className={banner().content({ className })} {...props} />
}

Content.displayName = "Banner.Content"

export type ActionProps = ComponentProps<"button"> & { asChild?: boolean }

export function Action({
  asChild = false,
  className,
  type,
  ...props
}: ActionProps): ReactNode {
  if (asChild)
    return <Slot.Root className={banner().action({ className })} {...props} />
  return (
    <button
      type={type ?? "button"}
      className={banner().action({ className })}
      {...props}
    />
  )
}

Action.displayName = "Banner.Action"

export function Close({
  className,
  type,
  "aria-label": label = "Close",
  ...props
}: ComponentProps<"button">): ReactNode {
  return (
    <button
      type={type ?? "button"}
      aria-label={label}
      data-tap=""
      className={banner().close({ className })}
      {...props}
    >
      <Glyph shape={shapes.x} size={18} />
    </button>
  )
}

Close.displayName = "Banner.Close"
