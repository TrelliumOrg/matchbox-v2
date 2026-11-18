import type { ReactNode } from "react"

/** The pending spinner from the Components frame (track plus arc). */
export function Spinner({
  size = 18,
  className,
}: {
  size?: number
  className?: string
}): ReactNode {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      strokeLinecap="round"
      aria-hidden="true"
      focusable="false"
      data-mbx-motion=""
      className={`animate-[mbx-spin_1s_linear_infinite] ${className ?? ""}`}
    >
      <circle
        cx="12"
        cy="12"
        r="8"
        stroke="currentColor"
        strokeOpacity="0.3"
        strokeWidth="2.4"
      />
      <path d="M12 4a8 8 0 0 1 8 8" stroke="currentColor" strokeWidth="2.4" />
    </svg>
  )
}

Spinner.displayName = "Spinner"
