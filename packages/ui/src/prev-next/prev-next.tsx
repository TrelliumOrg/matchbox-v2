import type { ComponentProps, ReactNode } from "react"
import { Glyph, shapes } from "../icons"
import * as Slot from "../slot"

/**
 * Previous and next pages (Doop `cA_kCfY56H`): two soft cards, radius 20,
 * a 13.5 grey label over the 16/600 title, chevrons outside. Pass the
 * router's link through `asChild` on each item; one side may be empty.
 */

export function Root({
  className,
  ...props
}: ComponentProps<"nav">): ReactNode {
  return (
    <nav
      aria-label="Previous and next"
      className={`mt-14 grid grid-cols-2 gap-4 max-sm:grid-cols-1 max-sm:gap-3 ${className ?? ""}`}
      {...props}
    />
  )
}
Root.displayName = "PrevNext.Root"

export type ItemProps = {
  direction: "previous" | "next"
  /** The link element, e.g. a router Link, holding a `Content`. */
  children: ReactNode
}

export function Item({ direction, children }: ItemProps): ReactNode {
  const next = direction === "next"
  return (
    <Slot.Root
      rel={next ? "next" : "prev"}
      className={`flex min-h-[72px] items-center gap-3 rounded-[20px] bg-soft px-[18px] py-[15px] outline-none hover:bg-soft2 focus-visible:outline-2 focus-visible:outline-ink ${next ? "col-start-2 justify-end text-right max-sm:col-start-1" : ""}`}
    >
      {children}
    </Slot.Root>
  )
}
Item.displayName = "PrevNext.Item"

/** The inside of an item: label, title and the chevron. */
export function Content({
  direction,
  title,
}: {
  direction: "previous" | "next"
  title: string
}): ReactNode {
  const next = direction === "next"
  const chevron = (
    <Glyph
      shape={next ? shapes.chevronRight : shapes.chevronLeft}
      size={18}
      strokeWidth={1.75}
      className="flex-none text-sec"
    />
  )
  return (
    <>
      {next ? null : chevron}
      <span className="min-w-0">
        <span className="block text-[13.5px] text-sec">
          {next ? "Next" : "Previous"}
        </span>
        <span className="block text-base font-semibold text-ink">{title}</span>
      </span>
      {next ? chevron : null}
    </>
  )
}
Content.displayName = "PrevNext.Content"
