import type { CSSProperties, ReactNode } from "react"
import { useFold } from "./fold"
import type { LockupGlyph } from "./glyphs"
import type { LockupProps } from "./lockup"
import { lockupCh } from "./metrics"

/**
 * The lockup's drawing, apart from which glyphs a lockup is made of, so a
 * module that draws one form (`./short`) does not pull in the outlines of
 * the others.
 */

export type Part = {
  glyph: LockupGlyph
  tone: "ink" | "sec"
  gapBefore: boolean
}

export const unitHeight = 151
export const iconWidth = 365.7
export const textStart = iconWidth + 66
export const iconScale = iconWidth / 637
export const matchCentres = [51.5, 91, 130, 170, 209.5]

type DrawProps = Omit<LockupProps, "product" | "form"> & {
  items: Part[]
  label: string
}

export function Draw({
  items,
  label,
  height = 22,
  collapse,
  ref,
  style,
  ...props
}: DrawProps): ReactNode {
  // Fold applies to the two-part lockups: MATCHBOX then the product name.
  const foldable =
    collapse === "fold" && items.length === 2 && items[1]?.gapBefore === true
  const isFolded = useFold(foldable)
  let x = textStart
  const placed = items.map((part) => {
    x += part.gapBefore ? lockupCh : 0
    const at = x
    x += part.glyph.width
    return { ...part, at }
  })
  const width = placed.length === 0 ? iconWidth : x

  return (
    <svg
      ref={ref}
      role="img"
      aria-label={label}
      viewBox={`0 0 ${width} ${unitHeight}`}
      height={height}
      width={(width / unitHeight) * height}
      fill="currentColor"
      style={{ color: "var(--ink)", flex: "none", ...style }}
      data-lockup-fold={foldable ? "" : undefined}
      data-folded={foldable && isFolded ? "" : undefined}
      {...props}
    >
      <g transform={`scale(${iconScale})`} fillRule="evenodd">
        <path d="M1 1H115V23H26V240H115V263H1Z" />
        <path d="M130 1H637V263H130ZM159 29V235H609V29Z" />
        {matchCentres.map((cy) => (
          <g key={cy}>
            <ellipse cx="66.5" cy={cy} rx="24.5" ry="16" />
            <rect x="84" y={cy - 8.5} width="47" height="17" />
          </g>
        ))}
      </g>
      {placed.map((part, index) =>
        foldable ? (
          <g
            key={part.at}
            data-lockup-part={index === 0 ? "lead" : "suffix"}
            style={
              index === 0
                ? undefined
                : ({
                    "--lockup-fold-x": `${textStart - part.at}px`,
                  } as CSSProperties)
            }
          >
            <path d={part.glyph.d} transform={`translate(${part.at} 0)`} />
          </g>
        ) : (
          <path
            key={part.at}
            d={part.glyph.d}
            transform={`translate(${part.at} 0)`}
            fill={part.tone === "sec" ? "var(--sec)" : undefined}
          />
        ),
      )}
    </svg>
  )
}
