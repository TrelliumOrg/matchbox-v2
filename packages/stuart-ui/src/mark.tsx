import type { ReactNode } from "react"

/*
 * Stuart is a dog (matchbox-v3, Decided 9 Nov 2026): Lucide `dog`, inlined.
 * Lucide is ISC licensed: Copyright (c) for portions of Lucide are held by
 * Cole Bemis 2013-2022 as part of Feather (MIT). All other copyright (c) for
 * Lucide are held by Lucide Contributors 2022.
 */

const face = [
  "M11.25 16.25h1.5L12 17z",
  "M16 14v.5",
  "M4.42 11.247A13.2 13.2 0 0 0 4 14.556C4 18.728 7.582 21 12 21s8-2.272 8-6.444a11.7 11.7 0 0 0-.493-3.309",
  "M8 14v.5",
]

const ears =
  "M8.5 8.5c-.384 1.05-1.083 2.028-2.344 2.5c-1.931.722-3.576-.297-3.656-1c-.113-.994 1.177-6.53 4-7c1.923-.321 3.651.845 3.651 2.235A7.5 7.5 0 0 1 14 5.277c0-1.39 1.844-2.598 3.767-2.277c2.823.47 4.113 6.006 4 7c-.08.703-1.725 1.722-3.656 1c-1.261-.472-1.855-1.45-2.239-2.5"

export type StuartMarkProps = {
  /** 22 in the bar, 18 in the panel header, 16 in rows. */
  size?: number
  /** Colour of the face strokes. The ears are always the accent. */
  stick?: string
  className?: string
}

/** The dog alone: face in `stick` (default currentColor), ears orange. */
export function StuartMark({
  size = 24,
  stick = "currentColor",
  className,
}: StuartMarkProps): ReactNode {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <g stroke={stick}>
        {face.map((d) => (
          <path key={d} d={d} />
        ))}
      </g>
      <path d={ears} stroke="var(--acc)" />
    </svg>
  )
}

/**
 * The mark on its ink disc (bar, panel header, empty state): the disc is
 * `--ink`, the face the page colour, the ears orange, in every theme.
 */
export function StuartBadge({
  size = 36,
  className,
}: {
  size?: number
  className?: string
}): ReactNode {
  return (
    <span
      aria-hidden="true"
      className={className}
      style={{
        display: "inline-grid",
        placeItems: "center",
        flex: "none",
        width: size,
        height: size,
        borderRadius: "50%",
        background: "var(--ink)",
      }}
    >
      <StuartMark size={Math.round(size * 0.61)} stick="var(--bg)" />
    </span>
  )
}
