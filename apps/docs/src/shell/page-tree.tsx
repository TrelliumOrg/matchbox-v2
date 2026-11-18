import { manifest } from "@matchbox/docs/manifest"
import { Glyph, shapes } from "@matchbox/ui/icons"
import * as VersionPill from "@matchbox/ui/version-pill"
import type { ReactNode } from "react"
import { DocLink } from "../content/doc-link"
import { outboundLinks } from "./site-footer"

/** The product a section's pages describe, opened from its tree's foot. */
const openLinks: Readonly<Record<string, (typeof outboundLinks)[number]>> = {
  pro: outboundLinks[0],
  scan: outboundLinks[1],
}

/**
 * The section navigation beside an article (layout v2, Doop `rdTgFW46zL`):
 * group labels in 13.5 grey, pages as 34px rows, the current one on a soft
 * pill. API and MCP trees show method labels and the API version
 * (`vFd6_tfSDd`). The Pro and Matchscan trees end with a quiet link to the
 * product.
 */
export function PageTree({
  tree,
  current,
  onNavigate,
  open = true,
}: {
  tree: string | null
  current: string
  onNavigate?: () => void
  /** The link to the product at the foot; the nav sheet has its own. */
  open?: boolean
}): ReactNode {
  const data = tree === null ? undefined : manifest.trees[tree]
  if (data === undefined) return null
  const product = open && tree !== null ? openLinks[tree] : undefined
  return (
    <nav aria-label="Pages in this section">
      {tree === "api" ? (
        <VersionPill.Root
          major="v1"
          version={manifest.apiVersion}
          className="mb-3"
        />
      ) : null}
      {data.groups.map((group) => (
        <div key={group.label === "" ? "top" : group.label}>
          {group.label === "" ? null : (
            <p className="mt-[22px] mb-1 px-3 text-[13.5px] font-medium text-sec first:mt-1.5">
              {group.label}
            </p>
          )}
          <ul>
            {group.pages.map((page) => {
              const isCurrent = page.path === current
              const mono =
                tree === "mcp" && page.path.startsWith("/developer/mcp/tools/")
              return (
                <li key={page.path}>
                  <DocLink
                    href={page.path}
                    onClick={onNavigate}
                    aria-current={isCurrent ? "page" : undefined}
                    className={`flex min-h-[34px] items-center gap-3 rounded-[17px] px-3 py-1 text-[15px] leading-5 outline-none hover:bg-soft focus-visible:outline-2 focus-visible:outline-ink ${isCurrent ? "bg-soft font-semibold text-ink" : "text-ink2"} ${mono ? "font-mono text-[13.5px]" : ""}`}
                  >
                    {page.method === null ? null : (
                      <span className="w-8 flex-none font-mono text-[12px] text-sec">
                        {page.method}
                      </span>
                    )}
                    <span className="min-w-0">{page.nav}</span>
                  </DocLink>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
      {product === undefined ? null : (
        <a
          href={product.href}
          className="mt-6 flex w-fit items-center gap-1.5 rounded-[17px] px-3 py-1.5 text-[15px] text-sec outline-none hover:text-ink focus-visible:outline-2 focus-visible:outline-ink"
        >
          <Glyph shape={shapes.arrowUpRight} size={15} strokeWidth={2} />
          {product.label}
        </a>
      )}
    </nav>
  )
}
