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
 * Numbered pager for offset lists, where page 3 is always the same rows: a
 * range summary ("25 to 48 of 131"), previous and next, and the page
 * numbers when there is room. Every step is a link (pass the app's router
 * link with `asChild`), so a page opens in a new tab and works without
 * script. The current page carries `aria-current="page"`. Put one at the
 * top of the list and, for long pages, the same one at the bottom. Keyset
 * lists use `cursor-pager` instead.
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
      className={`flex flex-wrap items-center gap-x-3 gap-y-2 ${className ?? ""}`}
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
      className={`text-[15px] text-sec tabular-nums ${className ?? ""}`}
      {...props}
    />
  )
}

export function List({ className, ...props }: ComponentProps<"ol">): ReactNode {
  return (
    <ol
      className={`flex items-center gap-0.5 tabular-nums ${className ?? ""}`}
      {...props}
    />
  )
}

const step =
  "grid h-10 min-w-10 flex-none place-items-center rounded-full px-2 text-[15px] font-semibold outline-none transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"

const idle = `${step} text-ink hover:bg-soft2`

const here = `${step} bg-ink text-bg`

const arrow = `${step} bg-soft text-ink hover:bg-soft2`

const off = `${step} cursor-not-allowed bg-soft text-mut`

function asLink(
  asChild: boolean,
  children: ReactNode,
  href: string | undefined,
  props: { className: string } & Record<string, unknown>,
  content: ReactNode,
): ReactNode {
  if (asChild) {
    const child = Children.only(children)
    if (!isValidElement<Record<string, unknown>>(child)) return null
    const own = child.props.className
    return cloneElement(child, {
      ...props,
      className: `${props.className} ${typeof own === "string" ? own : ""}`,
      children: content,
    })
  }
  return (
    <a href={href} {...props}>
      {content}
    </a>
  )
}

export type PageProps = {
  page: number
  current?: boolean
  /** The page's URL. Ignored with `asChild`. */
  href?: string
  /** Render the only child (the app's router link) as the step. */
  asChild?: boolean
  children?: ReactElement
  className?: string
}

/** One page number, always a link; the current page is marked. */
export function Page({
  page,
  current = false,
  href,
  asChild = false,
  children,
  className,
}: PageProps): ReactNode {
  return (
    <li className="flex">
      {asLink(
        asChild,
        children,
        href,
        {
          "aria-label": `Page ${page}`,
          "aria-current": current ? "page" : undefined,
          className: `${current ? here : idle} ${className ?? ""}`,
        },
        page,
      )}
    </li>
  )
}

/** Pages left out between two numbers. */
export function Gap(): ReactNode {
  return (
    <li
      aria-hidden="true"
      className="grid h-10 w-6 place-items-center text-sec"
    >
      …
    </li>
  )
}

export type StepProps = {
  /** The page's URL; ignored with `asChild`. */
  href?: string
  /** First or last page: the step is a disabled button, not a link. */
  disabled?: boolean
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
}: StepProps & { direction: "previous" | "next" }): ReactNode {
  const label = direction === "previous" ? "Previous page" : "Next page"
  const icon = (
    <Glyph
      shape={
        direction === "previous" ? shapes.chevronLeft : shapes.chevronRight
      }
      size={18}
      strokeWidth={2}
    />
  )
  if (disabled || (!asChild && href === undefined)) {
    return (
      <button
        type="button"
        disabled
        aria-label={label}
        className={`${off} ${className ?? ""}`}
      >
        {icon}
      </button>
    )
  }
  return asLink(
    asChild,
    children,
    href,
    {
      "aria-label": label,
      rel: direction === "previous" ? "prev" : "next",
      className: `${arrow} ${className ?? ""}`,
    },
    icon,
  )
}

export function Previous(props: StepProps): ReactNode {
  return <Step direction="previous" {...props} />
}

export function Next(props: StepProps): ReactNode {
  return <Step direction="next" {...props} />
}

Root.displayName = "Pagination.Root"
Summary.displayName = "Pagination.Summary"
List.displayName = "Pagination.List"
Page.displayName = "Pagination.Page"
Gap.displayName = "Pagination.Gap"
Previous.displayName = "Pagination.Previous"
Next.displayName = "Pagination.Next"
