import {
  Children,
  type ComponentProps,
  cloneElement,
  isValidElement,
  type ReactNode,
} from "react"
import { Glyph, shapes } from "../icons"

/**
 * Breadcrumbs above an entity title (block detail: Network, Blocks,
 * 13,078,795). Links in ink 15/500, a 14px chevron between, the current
 * page in secondary and marked `aria-current`. `mono` sets heights, hashes
 * and addresses in DM Mono.
 *
 *   <Breadcrumbs.Root>
 *     <Breadcrumbs.Item asChild><Link to="/network">Network</Link></Breadcrumbs.Item>
 *     <Breadcrumbs.Current mono>13,078,795</Breadcrumbs.Current>
 *   </Breadcrumbs.Root>
 */

export function Root({
  className,
  children,
  "aria-label": label = "Breadcrumb",
  ...props
}: ComponentProps<"nav">): ReactNode {
  return (
    <nav aria-label={label} className={className} {...props}>
      <ol className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[15px]">
        {children}
      </ol>
    </nav>
  )
}

const link =
  "rounded-sm font-medium text-ink outline-none hover:underline hover:underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"

function Separator(): ReactNode {
  return (
    <Glyph
      shape={shapes.chevronRight}
      size={14}
      strokeWidth={2}
      className="flex-none text-mut"
    />
  )
}

export type ItemProps = {
  href?: string
  /** Render the only child (the app's router link) as the link. */
  asChild?: boolean
  children: ReactNode
  className?: string
}

export function Item({
  href,
  asChild = false,
  children,
  className,
}: ItemProps): ReactNode {
  let content: ReactNode = (
    <a href={href} className={`${link} ${className ?? ""}`}>
      {children}
    </a>
  )
  if (asChild) {
    const child = Children.only(children)
    if (isValidElement<Record<string, unknown>>(child)) {
      const own = child.props.className
      content = cloneElement(child, {
        className: `${link} ${className ?? ""} ${typeof own === "string" ? own : ""}`,
      })
    }
  }
  return (
    <li className="flex items-center gap-2">
      {content}
      <Separator />
    </li>
  )
}

export function Current({
  mono = false,
  children,
  className,
}: {
  mono?: boolean
  children: ReactNode
  className?: string
}): ReactNode {
  return (
    <li
      aria-current="page"
      className={`min-w-0 truncate text-sec ${mono ? "font-mono text-[14.5px]" : ""} ${className ?? ""}`}
    >
      {children}
    </li>
  )
}

Root.displayName = "Breadcrumbs.Root"
Item.displayName = "Breadcrumbs.Item"
Current.displayName = "Breadcrumbs.Current"
