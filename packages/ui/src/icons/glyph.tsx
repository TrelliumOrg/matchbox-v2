import type { ReactNode, SVGProps } from "react"
import type * as shapes from "./shapes"

export type GlyphProps = Omit<SVGProps<SVGSVGElement>, "name"> & {
  shape: shapes.GlyphShape
  size?: number
  strokeWidth?: number
}

/**
 * Draws one shape from `./shapes`. Unlike `Icon`, which looks shapes up by
 * name and so carries all of them, a Glyph bundle holds only what it draws.
 * Decorative by default (aria-hidden).
 */
export function Glyph({
  shape,
  size = 20,
  strokeWidth = 2,
  ...props
}: GlyphProps): ReactNode {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {shape()}
    </svg>
  )
}

Glyph.displayName = "Glyph"
