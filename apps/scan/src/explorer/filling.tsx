import { formatDay, formatTime } from "@matchbox/domain/format"
import type { ReactNode } from "react"

/**
 * An aggregate the jobs Worker is still computing (`complete: false`, or
 * an epoch with `computed: false`): one quiet line with when the figures
 * are as of, never a zero or a guess (copy rules: labels, no sentences).
 */
export function Filling({
  asOf,
  className,
}: {
  /** Unix seconds of the last copy run; null before the first. */
  asOf: number | null
  className?: string
}): ReactNode {
  return (
    <p role="status" className={`text-[14.5px] text-sec ${className ?? ""}`}>
      Still filling
      {asOf === null
        ? null
        : `, as of ${formatDay(asOf)} ${formatTime(asOf)} UTC`}
    </p>
  )
}
