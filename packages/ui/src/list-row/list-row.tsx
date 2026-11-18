import type { ComponentProps, ReactNode } from "react"
import { Glyph, shapes } from "../icons"
import * as Slot from "../slot"
import { tv } from "../tv"

/**
 * Plain two-line list rows: 48px round icon, title 16/600, subline 14.5
 * secondary, value on the right with a sub value. 14px vertical padding, no
 * dividers.
 */

const row = tv({
  slots: {
    list: "flex flex-col",
    heading: "mt-[18px] pb-0.5 text-[15px] font-semibold text-sec first:mt-0",
    root: "flex items-center gap-4 py-3.5",
    icon: "grid size-12 flex-none place-items-center overflow-hidden rounded-full bg-soft text-[15px] font-bold text-ink",
    text: "min-w-0 flex-1",
    title: "truncate text-base font-semibold text-ink",
    subline: "mt-0.5 truncate text-[14.5px] text-sec tabular-nums",
    value: "ml-auto flex flex-none flex-col items-end text-right tabular-nums",
    main: "text-base font-semibold text-ink",
    sub: "mt-0.5 text-[14.5px] text-sec",
    chevron: "ml-auto flex-none text-sec",
  },
  variants: {
    tone: {
      default: {},
      pending: { icon: "bg-acc-soft text-acc-ink" },
      attention: { subline: "font-semibold text-acc-ink" },
      positive: { main: "text-pos" },
    },
    interactive: {
      true: {
        root: "-mx-3 cursor-pointer rounded-[20px] px-3 outline-none hover:bg-soft focus-visible:outline-2 focus-visible:outline-ink",
      },
    },
  },
})

export function List({ className, ...props }: ComponentProps<"ul">): ReactNode {
  return <ul className={row().list({ className })} {...props} />
}

List.displayName = "ListRow.List"

/** A plain date heading for date-grouped lists ("Today", "Tuesday 3 Nov"). */
export function Heading({
  className,
  ...props
}: ComponentProps<"h3">): ReactNode {
  return <h3 className={row().heading({ className })} {...props} />
}

Heading.displayName = "ListRow.Heading"

export type RootProps = ComponentProps<"li"> & {
  /** Render the row as its child element (a link to the page it opens). */
  asChild?: boolean
}

export function Root({
  asChild = false,
  className,
  ...props
}: RootProps): ReactNode {
  const Component = asChild ? Slot.Root : "li"
  return (
    <Component
      className={row({ interactive: asChild }).root({ className })}
      {...props}
    />
  )
}

Root.displayName = "ListRow"

export type IconProps = ComponentProps<"span"> & {
  tone?: "default" | "pending"
}

export function Icon({
  tone = "default",
  className,
  ...props
}: IconProps): ReactNode {
  return <span className={row({ tone }).icon({ className })} {...props} />
}

Icon.displayName = "ListRow.Icon"

export function Text({
  className,
  ...props
}: ComponentProps<"div">): ReactNode {
  return <div className={row().text({ className })} {...props} />
}

Text.displayName = "ListRow.Text"

export function Title({ className, ...props }: ComponentProps<"p">): ReactNode {
  return <p className={row().title({ className })} {...props} />
}

Title.displayName = "ListRow.Title"

export type SublineProps = ComponentProps<"p"> & {
  tone?: "default" | "attention"
}

export function Subline({
  tone = "default",
  className,
  ...props
}: SublineProps): ReactNode {
  return <p className={row({ tone }).subline({ className })} {...props} />
}

Subline.displayName = "ListRow.Subline"

export function Value({
  className,
  ...props
}: ComponentProps<"div">): ReactNode {
  return <div className={row().value({ className })} {...props} />
}

Value.displayName = "ListRow.Value"

export type MainProps = ComponentProps<"p"> & {
  /** Green only for money in. */
  tone?: "default" | "positive"
}

export function Main({
  tone = "default",
  className,
  ...props
}: MainProps): ReactNode {
  return <p className={row({ tone }).main({ className })} {...props} />
}

Main.displayName = "ListRow.Main"

export function Sub({ className, ...props }: ComponentProps<"div">): ReactNode {
  return <div className={row().sub({ className })} {...props} />
}

Sub.displayName = "ListRow.Sub"

/** Shown when the row opens a page. */
export function Chevron({ className }: { className?: string }): ReactNode {
  return (
    <Glyph
      shape={shapes.chevronRight}
      size={20}
      className={row().chevron({ className })}
    />
  )
}

Chevron.displayName = "ListRow.Chevron"
