import { Link } from "@tanstack/react-router"
import type { ComponentProps, ReactNode } from "react"

/**
 * A link to any docs path ("/pro/vote#optimize"): a router Link, so it
 * preloads on intent and navigates without a full load; other origins and
 * files (llms.txt, .md copies) are plain anchors.
 */

export type DocLinkProps = Pick<
  ComponentProps<"a">,
  "className" | "onClick" | "aria-current" | "title" | "children"
> & { href: string }

const fileLink = /\.(txt|xml|json|md)$/

export function DocLink({ href, children, ...props }: DocLinkProps): ReactNode {
  if (!href.startsWith("/") || href.startsWith("//")) {
    return (
      <a href={href} {...props}>
        {children}
      </a>
    )
  }
  const [path = "/", hash] = href.split("#")
  if (fileLink.test(path)) {
    return (
      <a href={href} {...props}>
        {children}
      </a>
    )
  }
  if (path === "/") {
    return (
      <Link to="/" {...(hash === undefined ? {} : { hash })} {...props}>
        {children}
      </Link>
    )
  }
  return (
    <Link
      to="/$"
      params={{ _splat: path.slice(1) }}
      {...(hash === undefined ? {} : { hash })}
      {...props}
    >
      {children}
    </Link>
  )
}
