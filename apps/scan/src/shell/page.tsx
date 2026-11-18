import { EmptyState } from "@matchbox/app-kit/states"
import type { ReactNode } from "react"
import { type SectionId, sectionFor } from "../data/sections"

/**
 * Section placeholders: each nav section's title (topic 40/650) over a
 * designed empty state, until the phase that builds the page. The title is
 * the LCP element, rendered from the route's own data, never deferred.
 */

export function PageTitle({ children }: { children: ReactNode }): ReactNode {
  return (
    <h1 className="mt-10 text-[40px] leading-tight font-[650] tracking-[-0.02em] max-xl:mt-6 max-xl:text-[32px]">
      {children}
    </h1>
  )
}

export function SectionPage({ id }: { id: SectionId }): ReactNode {
  const section = sectionFor(id)
  return (
    <>
      <PageTitle>{section.label}</PageTitle>
      <EmptyState icon={section.icon} title="No data yet" />
    </>
  )
}
