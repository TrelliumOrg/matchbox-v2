import type { ReactNode } from "react"

/**
 * The few drawings the shared icon set lacks, traced from the frames'
 * symbols (docs/design/home-final/desktop.html): a block, a gauge dial and
 * Stuart's dog. Decorative: the text beside each one names it.
 */

const stroke = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const

export function BlockGlyph(): ReactNode {
  return (
    <svg className="ic" viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
      <path d="M12 3 4 7.5v9L12 21l8-4.5v-9z" />
      <path d="M4 7.5 12 12l8-4.5M12 12v9" />
    </svg>
  )
}

export function GaugeGlyph(): ReactNode {
  return (
    <svg className="ic" viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
      <path d="m12 14 4-4M3.34 19a10 10 0 1 1 17.32 0" />
    </svg>
  )
}

export function DiscordGlyph(): ReactNode {
  return (
    <svg className="ic" viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
      <path d="M8 12h.01M16 12h.01M7.5 17c-1.5 0-3.5-.5-4.5-1.5 0-4 1-7.5 3-10 1.2-.6 2.4-.9 3.5-1l.5 1.5c1.3-.2 2.7-.2 4 0l.5-1.5c1.1.1 2.3.4 3.5 1 2 2.5 3 6 3 10-1 1-3 1.5-4.5 1.5l-1-2c-2 .7-4 .7-6 0z" />
    </svg>
  )
}

export function StuartDog(): ReactNode {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...stroke} strokeWidth={1.9}>
      <g>
        <path d="M11.25 16.25h1.5L12 17z" />
        <path d="M16 14v.5" />
        <path d="M4.42 11.247A13.2 13.2 0 0 0 4 14.556C4 18.728 7.582 21 12 21s8-2.272 8-6.444a11.7 11.7 0 0 0-.493-3.309" />
        <path d="M8 14v.5" />
      </g>
      <path
        stroke="#F7931A"
        d="M8.5 8.5c-.384 1.05-1.083 2.028-2.344 2.5c-1.931.722-3.576-.297-3.656-1c-.113-.994 1.177-6.53 4-7c1.923-.321 3.651.845 3.651 2.235A7.5 7.5 0 0 1 14 5.277c0-1.39 1.844-2.598 3.767-2.277c2.823.47 4.113 6.006 4 7c-.08.703-1.725 1.722-3.656 1c-1.261-.472-1.855-1.45-2.239-2.5"
      />
    </svg>
  )
}
