import * as Pagination from "@matchbox/ui/pagination"
import { Link } from "@tanstack/react-router"
import type { ReactElement, ReactNode } from "react"
import { gaugePageSize } from "./page-size"

/**
 * Vote's gauge pages: "25 to 48 of 131", previous and next, and the page
 * numbers when the column has room. Each step is a router link to the same
 * list with `?page=` (page 1 stays out of the URL), so back, forward,
 * reload, a new tab and a shared link all land on the same page.
 */

export type PagerPosition = "top" | "bottom"

type Search = Record<string, unknown>

function pageSearch(page: number) {
  return (previous: Search): Search => ({
    ...previous,
    page: page === 1 ? undefined : page,
  })
}

export function GaugePager({
  page,
  pageCount,
  total,
  position,
  onStep,
}: {
  page: number
  pageCount: number
  total: number
  position: PagerPosition
  /** Called as a step is followed, before the new page renders. */
  onStep: (position: PagerPosition) => void
}): ReactNode {
  const step = (to: number): ReactElement => (
    <Link
      to="."
      search={pageSearch(to)}
      resetScroll={false}
      viewTransition={false}
      onClick={() => onStep(position)}
    />
  )
  return (
    <Pagination.Root
      aria-label={position === "top" ? "Gauge pages" : "Pages, end of list"}
    >
      <Pagination.Summary
        className="mr-1"
        aria-live={position === "top" ? "polite" : undefined}
      >
        {Pagination.rangeText(page, gaugePageSize, total)}
      </Pagination.Summary>
      {pageCount <= 1 ? null : (
        <>
          <Pagination.Previous disabled={page <= 1} asChild>
            {step(page - 1)}
          </Pagination.Previous>
          <Pagination.List className="@max-[34rem]:hidden">
            {Pagination.pageItems(page, pageCount).map((item, index) =>
              item === "gap" ? (
                <Pagination.Gap key={index < 3 ? "gap-start" : "gap-end"} />
              ) : (
                <Pagination.Page
                  key={item}
                  page={item}
                  current={item === page}
                  asChild
                >
                  {step(item)}
                </Pagination.Page>
              ),
            )}
          </Pagination.List>
          <Pagination.Next disabled={page >= pageCount} asChild>
            {step(page + 1)}
          </Pagination.Next>
        </>
      )}
    </Pagination.Root>
  )
}
