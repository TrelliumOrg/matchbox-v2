import { Glyph, shapes } from "@matchbox/ui/icons"
import type { ReactNode } from "react"

/** Stuart's dog in a soft disc (Doop `cA_kCfY56H`): ink face, orange ears. */
export function DogDisc({
  size = 36,
  className,
}: {
  size?: number
  className?: string
}): ReactNode {
  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size }}
      className={`grid flex-none place-items-center rounded-full bg-soft text-ink dark:bg-ink dark:text-bg ${className ?? ""}`}
    >
      <Glyph
        shape={shapes.dog}
        size={Math.round(size * 0.6)}
        strokeWidth={1.9}
      />
    </span>
  )
}
