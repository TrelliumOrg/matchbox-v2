import type { ReactNode } from "react"
import { BENCH, MATCH } from "./wordmark"

/**
 * The MATCHBENCH lockup as one inline SVG, drawn like @matchbox/ui's
 * Matchscan lockup: the matchbox icon, then MATCH in ink and BENCH in the
 * secondary ink, outlined so the font never downloads. Units follow the
 * Doop lockup snippet with c = 100: the lockup is 151 units tall.
 */

const unitHeight = 151
const iconWidth = 365.7
const textStart = iconWidth + 66
const iconScale = iconWidth / 637
const matchCentres = [51.5, 91, 130, 170, 209.5]
const width = textStart + MATCH.width + BENCH.width

export default function BenchLockup({
  height = 22,
}: {
  height?: number
}): ReactNode {
  return (
    <svg
      role="img"
      aria-label="Matchbench"
      viewBox={`0 0 ${width} ${unitHeight}`}
      height={height}
      width={(width / unitHeight) * height}
      fill="currentColor"
      className="flex-none text-ink"
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
      <path d={MATCH.d} transform={`translate(${textStart} 0)`} />
      <path
        d={BENCH.d}
        transform={`translate(${textStart + MATCH.width} 0)`}
        style={{ fill: "var(--sec)" }}
      />
    </svg>
  )
}
