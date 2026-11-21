import * as Breadcrumbs from "@matchbox/ui/breadcrumbs"
import * as HashChip from "@matchbox/ui/hash-chip"
import { Glyph, type GlyphShape, shapes } from "@matchbox/ui/icons"
import { Link } from "@tanstack/react-router"
import type { ReactNode } from "react"

/**
 * Entity placeholders (transaction, block, address, epoch, lock): the
 * identity header the real page will have, then the "Not indexed yet" card
 * from Not found (`vF29nhdD8n`) with the checks the browser can already
 * make. Data arrives with the Scan API.
 */

export type Crumb = {
  label: string
  to:
    | "/network/transactions"
    | "/network/blocks"
    | "/epochs"
    | "/locks"
    | "/gauges"
    | "/borrow"
}

export type Check = {
  label: string
  value: string
  detail: string
  passed: boolean
}

export type EntityPageProps = {
  icon: GlyphShape
  title: string
  /** "Transaction hash", "Address". */
  kind: string
  crumbs: readonly Crumb[]
  current: string
  /** The full hash or address, shown as a chip under the title. */
  value?: { text: string; kind: "address" | "hash" }
  checks: readonly Check[]
  /** The card's heading: "Not indexed yet" unless the miss is elsewhere. */
  heading?: string
  /** Previous and next, for blocks, epochs and locks. */
  steps?: ReactNode
}

function CheckRow({ check }: { check: Check }): ReactNode {
  return (
    <li className="flex min-h-[52px] items-center gap-4 border-b border-line py-2 last:border-b-0 max-md:flex-wrap max-md:gap-x-3 max-md:gap-y-0.5">
      <span
        className={`grid size-6 flex-none place-items-center rounded-full ${check.passed ? "bg-pos-soft text-pos" : "bg-soft text-sec"}`}
      >
        <Glyph
          shape={check.passed ? shapes.check : shapes.x}
          size={13}
          strokeWidth={2.6}
        />
      </span>
      <span className="w-40 text-[15px] text-sec max-md:w-auto">
        {check.label}
      </span>
      <span className="flex-1 text-[15px] font-semibold max-md:basis-full max-md:pl-9">
        {check.value}
      </span>
      <span className="text-[14px] text-sec tabular-nums max-md:pl-9">
        {check.detail}
      </span>
    </li>
  )
}

export function EntityPage({
  icon,
  title,
  kind,
  crumbs,
  current,
  value,
  checks,
  heading = "Not indexed yet",
  steps,
}: EntityPageProps): ReactNode {
  return (
    <>
      <Breadcrumbs.Root className="mt-8 max-xl:mt-5">
        {crumbs.map((crumb) => (
          <Breadcrumbs.Item key={crumb.label} asChild>
            <Link to={crumb.to}>{crumb.label}</Link>
          </Breadcrumbs.Item>
        ))}
        <Breadcrumbs.Current mono={value !== undefined}>
          {current}
        </Breadcrumbs.Current>
      </Breadcrumbs.Root>
      <header className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-4">
        <span className="grid size-16 flex-none place-items-center rounded-full bg-soft text-ink max-md:size-12">
          <Glyph shape={icon} size={24} strokeWidth={1.8} />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="text-[34px] leading-tight font-[650] tracking-[-0.02em] max-md:text-[28px]">
            {title}
          </h1>
          {value === undefined ? null : (
            <HashChip.Root
              value={value.text}
              kind={value.kind}
              className="mt-1 text-sec"
            />
          )}
        </div>
        {steps}
      </header>
      <section
        aria-labelledby="not-indexed"
        className="mt-8 max-w-[760px] rounded-[24px] bg-soft p-8 max-md:p-5"
      >
        <span className="grid size-14 place-items-center rounded-full bg-raised text-ink">
          <Glyph shape={shapes.clock} size={22} strokeWidth={1.8} />
        </span>
        <h2
          id="not-indexed"
          aria-live="polite"
          className="mt-5 text-[30px] font-[650] tracking-[-0.02em] max-md:text-[24px]"
        >
          {heading}
        </h2>
        <p className="mt-1 text-[15px] text-sec">{kind}</p>
        <ul className="mt-6 rounded-[18px] bg-raised px-5">
          {checks.map((check) => (
            <CheckRow key={check.label} check={check} />
          ))}
        </ul>
      </section>
    </>
  )
}

/** Previous and next block, epoch or lock (block detail, `IRUlSH8UWm`). */
export const stepClass =
  "flex h-11 items-center gap-2 rounded-[22px] bg-soft px-4 font-mono text-[15px] text-ink outline-none hover:bg-soft2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"

export function Steps({ children }: { children: ReactNode }): ReactNode {
  return (
    <nav aria-label="Previous and next" className="flex gap-2.5">
      {children}
    </nav>
  )
}

export function StepIcon({
  direction,
}: {
  direction: "previous" | "next"
}): ReactNode {
  return (
    <Glyph
      shape={
        direction === "previous" ? shapes.chevronLeft : shapes.chevronRight
      }
      size={16}
      strokeWidth={2}
    />
  )
}
