import type { ReactNode } from "react"

/** Page and section headings, and the underlined text link. */

export function PageTitle({
  children,
  sub,
}: {
  children: ReactNode
  sub?: ReactNode
}): ReactNode {
  return (
    <div className="mt-5">
      <h1 className="text-[32px] leading-tight font-[650] tracking-[-0.02em]">
        {children}
      </h1>
      {sub === undefined ? null : (
        <div className="mt-1.5 flex items-center gap-2 text-base text-sec">
          {sub}
        </div>
      )}
    </div>
  )
}

export function SectionHeading({
  children,
  action,
}: {
  children: ReactNode
  action?: ReactNode
}): ReactNode {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <h2 className="text-2xl font-[650] tracking-[-0.015em]">{children}</h2>
      {action}
    </div>
  )
}

export const underlineLink =
  "rounded-sm text-[15px] font-semibold text-ink underline underline-offset-[3px] outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
