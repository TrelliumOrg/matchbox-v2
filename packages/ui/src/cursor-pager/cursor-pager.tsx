import {
  Children,
  type ComponentProps,
  cloneElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react"
import { Glyph, shapes } from "../icons"

/**
 * Cursor pager for keyset lists: newer and older, never page numbers or
 * offsets, so a page stays the same rows however fast the chain moves. A
 * summary on the left ("Latest 25", "Before block 13,078,612"), two round
 * 40px buttons on the right. Each button is a link to the page with its
 * cursor; `asChild` wraps the app's router link. Without a cursor the step is
 * a disabled button, not a link.
 */

export function Root({
  className,
  children,
  "aria-label": label = "Pages",
  ...props
}: ComponentProps<"nav">): ReactNode {
  return (
    <nav
      aria-label={label}
      className={`flex min-h-16 items-center gap-3 border-t border-line pt-5 ${className ?? ""}`}
      {...props}
    >
      {children}
    </nav>
  )
}

export function Summary({
  className,
  ...props
}: ComponentProps<"p">): ReactNode {
  return (
    <p
      className={`mr-auto text-[15px] text-sec tabular-nums ${className ?? ""}`}
      {...props}
    />
  )
}

const button =
  "grid size-10 flex-none place-items-center rounded-full bg-soft text-ink outline-none transition-colors hover:bg-soft2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"

const disabledButton =
  "grid size-10 flex-none cursor-not-allowed place-items-center rounded-full bg-soft text-mut"

export type StepProps = {
  /** The page's URL; null at the end of the list. Ignored with `asChild`. */
  href?: string | null
  /** No more rows this way. */
  disabled?: boolean
  /** Render the only child (the app's router link) as the button. */
  asChild?: boolean
  children?: ReactElement
  className?: string
}

function Step({
  direction,
  href,
  disabled = false,
  asChild = false,
  children,
  className,
}: StepProps & { direction: "newer" | "older" }): ReactNode {
  const label = direction === "newer" ? "Newer" : "Older"
  const icon = (
    <Glyph
      shape={direction === "newer" ? shapes.chevronLeft : shapes.chevronRight}
      size={18}
      strokeWidth={2}
    />
  )
  if (disabled || (!asChild && (href === undefined || href === null))) {
    return (
      <button
        type="button"
        disabled
        aria-label={label}
        className={`${disabledButton} ${className ?? ""}`}
      >
        {icon}
      </button>
    )
  }
  if (asChild) {
    const child = Children.only(children)
    if (!isValidElement<Record<string, unknown>>(child)) return null
    const own = child.props.className
    return cloneElement(child, {
      "aria-label": label,
      rel: direction === "newer" ? "prev" : "next",
      className: `${button} ${className ?? ""} ${typeof own === "string" ? own : ""}`,
      children: icon,
    })
  }
  return (
    <a
      href={href ?? undefined}
      aria-label={label}
      rel={direction === "newer" ? "prev" : "next"}
      className={`${button} ${className ?? ""}`}
    >
      {icon}
    </a>
  )
}

/** Toward the head of the chain (the previous page). */
export function Newer(props: StepProps): ReactNode {
  return <Step direction="newer" {...props} />
}

/** Away from the head (the next page). */
export function Older(props: StepProps): ReactNode {
  return <Step direction="older" {...props} />
}

Root.displayName = "CursorPager.Root"
Summary.displayName = "CursorPager.Summary"
Newer.displayName = "CursorPager.Newer"
Older.displayName = "CursorPager.Older"
