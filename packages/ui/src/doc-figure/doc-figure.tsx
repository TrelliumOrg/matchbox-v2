import type { CSSProperties, ReactNode } from "react"

/**
 * A figure in a docs page (Doop `cA_kCfY56H`): a picture on a soft card,
 * radius 24, with numbered markers that match the steps above it, and a
 * 14/20 caption. Markers are placed in percent of the card, so they stay
 * on their target at every width; each carries a label for screen readers.
 */

export type RootProps = {
  /** What the picture shows, for assistive technology. */
  label: string
  caption: ReactNode
  children: ReactNode
}

export function Root({ label, caption, children }: RootProps): ReactNode {
  return (
    <figure className="mt-[26px]">
      <div
        role="img"
        aria-label={label}
        className="relative overflow-hidden rounded-[24px] bg-soft"
      >
        {children}
      </div>
      <figcaption className="mt-2.5 text-[14px] leading-5 text-sec">
        {caption}
      </figcaption>
    </figure>
  )
}
Root.displayName = "DocFigure.Root"

export type MarkerProps = {
  number: number
  /** Left and top of the marker's centre, in percent of the card. */
  x: number
  y: number
}

export function Marker({ number, x, y }: MarkerProps): ReactNode {
  const style: CSSProperties = { left: `${x}%`, top: `${y}%` }
  return (
    <span
      aria-hidden="true"
      style={style}
      className="absolute z-10 grid size-5 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-ink text-[12px] font-[650] text-bg tabular-nums"
    >
      {number}
    </span>
  )
}
Marker.displayName = "DocFigure.Marker"
