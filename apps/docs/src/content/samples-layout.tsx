import type { ReactNode } from "react"

/**
 * API operation and MCP tool pages (layout v2, Doop `wtvU08Jfqx`): the
 * article beside a sticky samples column, which takes On this page's slot.
 * 520 and 472 at 1440, 464 and 400 at 1280. Below 1280 the body places the
 * samples inline after its description. The page's title and its footer
 * (dates, Previous and Next) stay in the article column, and its text
 * stops at 620 like any article's.
 */

/** What the page puts above and below the body in the article column. */
export type Framing = { head: ReactNode; foot: ReactNode }

export function SamplesLayout({
  head,
  foot,
  samples,
  label,
  children,
}: Framing & {
  samples: ReactNode
  /** The samples column's accessible name. */
  label: string
  children: ReactNode
}): ReactNode {
  return (
    <div className="grid items-start xl:grid-cols-[minmax(0,1fr)_400px] xl:gap-x-12 min-[90rem]:grid-cols-[minmax(0,1fr)_472px] min-[90rem]:gap-x-16">
      <div className="docs-measure min-w-0">
        {head}
        {children}
        <div className="docs-wide">{foot}</div>
      </div>
      <aside
        aria-label={label}
        className="sticky top-32 hidden max-h-[calc(100dvh-152px)] overflow-y-auto xl:block"
      >
        {samples}
      </aside>
    </div>
  )
}

/** Where the samples sit below 1280: inline, after the description. */
export function InlineSamples({
  children,
}: {
  children: ReactNode
}): ReactNode {
  return <div className="docs-wide xl:hidden">{children}</div>
}
