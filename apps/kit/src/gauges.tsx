import type { ReactNode } from "react"

/** Gauge pictures are fixed per gauge across products (matchbox-v3). */

export function KilnPicture({ size = 18 }: { size?: number }): ReactNode {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <rect width="24" height="24" fill="#2B2A6B" />
      <path d="M7 18v-6a5 5 0 0 1 10 0v6h-3v-5a2 2 0 0 0-4 0v5Z" fill="#fff" />
    </svg>
  )
}

export function NorthfieldPicture({ size = 18 }: { size?: number }): ReactNode {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <rect width="24" height="24" fill="#2F5D46" />
      <rect
        x="5"
        y="5"
        width="14"
        height="14"
        rx="4"
        fill="none"
        stroke="#fff"
        strokeWidth="1.6"
      />
      <path
        d="M9 10l3 4 3-4"
        fill="none"
        stroke="#fff"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <circle cx="9" cy="10" r="1.6" fill="#fff" />
      <circle cx="15" cy="10" r="1.6" fill="#fff" />
      <circle cx="12" cy="14" r="1.6" fill="#fff" />
    </svg>
  )
}

/** Initials on a pastel from the address byte, for gauges without a profile. */
export function InitialsPicture({
  initials,
  hue,
  size = 18,
}: {
  initials: string
  hue: number
  size?: number
}): ReactNode {
  return (
    <span
      aria-hidden="true"
      className="grid size-full place-items-center font-bold"
      style={{
        background: `hsl(${hue} 40% 90%)`,
        color: `hsl(${hue} 40% 30%)`,
        fontSize: Math.round(size * 0.42),
      }}
    >
      {initials}
    </span>
  )
}

export const gaugeColors = {
  kiln: { light: "#2B2A6B", dark: "#6E7896" },
  vebtc604: { light: "#44652B", dark: "#7DA756" },
  northfield: { light: "#2F5D46", dark: "#5E9C7E" },
} as const
