import { MorphText } from "@matchbox/motion"
import type { ComponentProps, ReactNode } from "react"
import { Spinner } from "../icons"
import * as Slot from "../slot"
import { tv, type VariantProps } from "../tv"

/**
 * Pill buttons: 44 tall, radius 22, 16/600. One primary per view. Labels that
 * change in place ("Review and sign" to "Waiting for wallet") morph.
 */

export const pillButton = tv({
  base: "inline-flex flex-none cursor-pointer items-center justify-center gap-2 whitespace-nowrap font-semibold outline-none select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink aria-disabled:cursor-not-allowed disabled:cursor-not-allowed",
  variants: {
    intent: {
      primary: "bg-acc text-on-acc",
      secondary: "bg-acc-soft text-acc-ink",
      neutral: "bg-raised text-ink",
      destructive: "bg-neg text-on-neg",
    },
    size: {
      md: "h-11 rounded-[22px] px-5 text-base",
      sm: "h-[34px] rounded-[17px] px-3.5 text-sm",
      lg: "h-[54px] w-full rounded-[27px] px-6 text-[16.5px]",
    },
    inactive: {
      true: "bg-soft text-mut",
    },
  },
  compoundVariants: [
    { intent: "neutral", size: "sm", class: "bg-raised" },
    {
      inactive: true,
      class: "bg-soft text-mut",
    },
  ],
  defaultVariants: { intent: "primary", size: "md", inactive: false },
})

export type RootProps = Omit<ComponentProps<"button">, "disabled"> &
  Omit<VariantProps<typeof pillButton>, "inactive"> & {
    /** Render the child element (a link) with the button's styling. */
    asChild?: boolean
    disabled?: boolean
    /** Shows the spinner and blocks clicks, for "Waiting for wallet". */
    pending?: boolean
  }

export function Root({
  asChild = false,
  intent,
  size,
  disabled = false,
  pending = false,
  className,
  children,
  type,
  onClick,
  ...props
}: RootProps): ReactNode {
  const inactive = disabled || pending
  const classes = pillButton({ intent, size, inactive, className })

  if (asChild) {
    return (
      <Slot.Root className={classes} {...props}>
        {children}
      </Slot.Root>
    )
  }

  return (
    <button
      type={type ?? "button"}
      className={classes}
      aria-disabled={inactive || undefined}
      aria-busy={pending || undefined}
      onClick={inactive ? (event) => event.preventDefault() : onClick}
      {...props}
    >
      {pending ? <Spinner size={size === "lg" ? 20 : 18} /> : null}
      {typeof children === "string" ? (
        <MorphText as="span">{children}</MorphText>
      ) : (
        children
      )}
    </button>
  )
}

Root.displayName = "PillButton"
