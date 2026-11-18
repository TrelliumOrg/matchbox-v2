import type { ReactNode, SVGProps } from "react"
import { MATCH, SCAN } from "../lockup/glyphs"

/**
 * The Matchscan lockup alone: the same drawing as `Lockup.Root` with
 * `product="scan"`, but it only references the MATCH and SCAN glyphs, so
 * the other products' outlines (about 7 kB of path data) stay out of
 * Matchscan's first paint, as `Lockup.Pro` does for Pro. Geometry from the
 * Doop snippet (`z2EJi529-k`), drawn at c = 100 as in lockup.tsx.
 */

export type RootProps = Omit<SVGProps<SVGSVGElement>, "ref"> & {
  /** full: MATCH ink, SCAN grey; short: both ink; icon: the icon alone. */
  form?: "full" | "short" | "icon"
  /** Rendered height in px. */
  height?: number
}

const unitHeight = 151
const iconWidth = 365.7
const textStart = iconWidth + 66
const iconScale = iconWidth / 637
const matchCentres = [51.5, 91, 130, 170, 209.5]

export function Root({
  form = "full",
  height = 22,
  style,
  ...props
}: RootProps): ReactNode {
  const width =
    form === "icon" ? iconWidth : textStart + MATCH.width + SCAN.width
  return (
    <svg
      role="img"
      aria-label="Matchscan"
      viewBox={`0 0 ${width} ${unitHeight}`}
      height={height}
      width={(width / unitHeight) * height}
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
      {form === "icon" ? null : (
        <>
          <path d={MATCH.d} transform={`translate(${textStart} 0)`} />
          <path
            d={SCAN.d}
            transform={`translate(${textStart + MATCH.width} 0)`}
            fill={form === "full" ? "var(--sec)" : undefined}
          />
        </>
      )}
    </svg>
  )
}

Root.displayName = "ScanLockup"
