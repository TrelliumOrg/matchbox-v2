import * as PillButton from "@matchbox/ui/pill-button"
import { Link } from "@tanstack/react-router"
import type { ReactNode } from "react"

function State({ title, code }: { title: string; code: string }): ReactNode {
  return (
    <section className="mx-auto flex w-full max-w-[480px] flex-col items-start px-5 pt-32">
      <h1 className="text-[32px] font-[650] tracking-[-0.02em] text-ink">
        {title}
      </h1>
      <p className="mt-2.5 font-mono text-[13px] text-sec">{code}</p>
      <PillButton.Root asChild className="mt-7">
        <Link to="/">Overview</Link>
      </PillButton.Root>
    </section>
  )
}

export function NotFoundView(): ReactNode {
  return <State title="Not found" code="not_found" />
}

export function PageError(): ReactNode {
  return <State title="Something went wrong" code="internal_error" />
}

/** A dashed empty box with one line (Apps, keys, reviews). */
export function Empty({
  title,
  children,
}: {
  title: string
  children?: ReactNode
}): ReactNode {
  return (
    <div className="flex flex-col items-center gap-4 rounded-[24px] border border-dashed border-dash px-6 py-14 text-center">
      <p className="text-[16px] font-medium text-ink">{title}</p>
      {children}
    </div>
  )
}
