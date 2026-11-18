import { Glyph, type GlyphShape, shapes } from "@matchbox/ui/icons"
import type { ReactNode } from "react"
import type { EpochNav, ValidatorSort } from "../../data/validators"

/**
 * Pieces the Validators list and the lower sections share: stat cards
 * (radius 24, icon and label, one figure, one line under it), the "Not
 * available yet" states for what has no source. What a validator page
 * paints first is in ./status.
 */

/** A stat card. Fixed height, so a missing figure takes the same room. */
export function StatCard({
  icon,
  label,
  children,
}: {
  icon: GlyphShape
  label: string
  children: ReactNode
}): ReactNode {
  return (
    <section
      aria-label={label}
      className="flex min-h-[150px] min-w-0 flex-col rounded-[24px] bg-soft px-6 py-5 max-md:min-h-0 max-md:px-5"
    >
      <h2 className="flex items-center gap-2.5 text-[15px] text-ink2">
        <span className="grid size-7 flex-none place-items-center rounded-full bg-raised text-ink2">
          <Glyph shape={icon} size={15} strokeWidth={1.9} />
        </span>
        {label}
      </h2>
      {children}
    </section>
  )
}

export function CardFigure({
  value,
  note,
}: {
  value: string
  note?: ReactNode
}): ReactNode {
  return (
    <>
      <p className="mt-3 text-[30px] leading-tight font-[650] tracking-[-0.02em] tabular-nums [overflow-wrap:anywhere] max-md:text-[26px]">
        {value}
      </p>
      {note === undefined || note === null ? null : (
        <p className="mt-1 text-[14.5px] text-sec">{note}</p>
      )}
    </>
  )
}

/** A figure the design has and no source serves yet, with the reason. */
export function NotYet({ reason }: { reason: string }): ReactNode {
  return (
    <div role="status" className="mt-3">
      <p className="text-[20px] leading-tight font-[650] text-ink2">
        Not available yet
      </p>
      <p className="mt-1 text-[14.5px] text-sec">{reason}</p>
    </div>
  )
}

/** A panel-sized "Not available yet", the panel's height reserved. */
export function NotYetPanel({
  label,
  reason,
}: {
  label: string
  reason: string
}): ReactNode {
  return (
    <section
      aria-label={label}
      className="flex min-h-[200px] min-w-0 flex-col rounded-[24px] bg-soft p-6 max-md:p-5"
    >
      <h2 className="text-[15px] text-ink2">{label}</h2>
      <div
        role="status"
        className="flex flex-1 flex-col items-center justify-center gap-2 py-6 text-center"
      >
        <Glyph shape={shapes.info} size={20} strokeWidth={1.8} />
        <p className="text-[16px] font-semibold">Not available yet</p>
        <p className="max-w-[420px] text-[14.5px] text-sec">{reason}</p>
      </div>
    </section>
  )
}

/** The latest epoch and the default order stay out of the URL. */
export function searchFor(
  epoch: EpochNav,
  number: number,
  sort: ValidatorSort,
): { epoch?: number; sort?: Exclude<ValidatorSort, "share"> } {
  return {
    ...(number === epoch.latest ? {} : { epoch: number }),
    ...(sort === "share" ? {} : { sort }),
  }
}
