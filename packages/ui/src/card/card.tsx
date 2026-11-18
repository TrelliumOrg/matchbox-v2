import type { ComponentProps, ReactNode } from "react"
import * as Slot from "../slot"
import { tv } from "../tv"

/**
 * Soft card, radius 24, no border or shadow. The edge outline only shows in
 * Onyx and Porcelain, where the card sits too close to the ground.
 */

const card = tv({
  slots: {
    root: "rounded-[24px] bg-soft text-ink shadow-[inset_0_0_0_1px_var(--edge)]",
    header: "flex items-baseline justify-between gap-4",
    title: "text-base font-semibold",
    body: "",
  },
  variants: {
    padding: {
      none: { root: "" },
      md: { root: "px-6 py-[22px]" },
      lg: { root: "p-7" },
    },
  },
  defaultVariants: { padding: "md" },
})

export type RootProps = ComponentProps<"div"> & {
  asChild?: boolean
  padding?: "none" | "md" | "lg"
}

export function Root({
  asChild = false,
  padding,
  className,
  ...props
}: RootProps): ReactNode {
  const Component = asChild ? Slot.Root : "div"
  return (
    <Component className={card({ padding }).root({ className })} {...props} />
  )
}

Root.displayName = "Card"

export function Header({
  className,
  ...props
}: ComponentProps<"header">): ReactNode {
  return <header className={card().header({ className })} {...props} />
}

Header.displayName = "Card.Header"

export function Title({
  className,
  ...props
}: ComponentProps<"h3">): ReactNode {
  return <h3 className={card().title({ className })} {...props} />
}

Title.displayName = "Card.Title"
