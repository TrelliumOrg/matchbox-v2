import type { ReactNode, SVGProps } from "react"
import { lockupCh, MATCHBOX } from "../lockup/glyphs"
import { DOCS } from "./glyph"

/**
 * The MATCHBOX DOCS lockup (Doop `ITeMluqlkH`): the matchbox icon, MATCHBOX
 * in ink, one cell, DOCS in grey. The short form (phones, the tablet rail
 * header) is the icon and DOCS in ink. Same geometry as `@matchbox/ui/lockup`
 * (c = height / 1.51, drawn at c = 100), so it sits beside the other
 * products' lockups exactly.
 */

export type DocsLockupForm = "full" | "short" | "icon"

export type RootProps = Omit<SVGProps<SVGSVGElement>, "ref"> & {
  form?: DocsLockupForm
  /** Rendered height in px: 22 in the sidebar, never below 18. */
  height?: number
}

const unitHeight = 151
const iconWidth = 365.7
const textStart = iconWidth + 66
const iconScale = iconWidth / 637
const matchCentres = [51.5, 91, 130, 170, 209.5]

export function width(form: DocsLockupForm, height: number): number {
  const units =
    form === "icon"
      ? iconWidth
      : form === "short"
        ? textStart + DOCS.width
        : textStart + MATCHBOX.width + lockupCh + DOCS.width
  return (units / unitHeight) * height
}

export function Root({
  form = "full",
  height = 22,
  style,
  ...props
}: RootProps): ReactNode {
  const units = (width(form, height) / height) * unitHeight
  const docsAt =
    form === "full" ? textStart + MATCHBOX.width + lockupCh : textStart
  return (
    <svg
      role="img"
      aria-label="Matchbox Docs"
      viewBox={`0 0 ${units} ${unitHeight}`}
      height={height}
      width={width(form, height)}
      fill="currentColor"
      style={{ color: "var(--ink)", flex: "none", ...style }}
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
      {form === "full" ? (
        <path d={MATCHBOX.d} transform={`translate(${textStart} 0)`} />
      ) : null}
      {form === "icon" ? null : (
        <path
          d={DOCS.d}
          transform={`translate(${docsAt} 0)`}
          fill={form === "full" ? "var(--sec)" : undefined}
        />
      )}
    </svg>
  )
}

Root.displayName = "DocsLockup"
