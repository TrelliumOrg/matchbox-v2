import { Glyph, shapes } from "@matchbox/ui/icons"
import type { ReactNode } from "react"
import type { ValidatorStatus } from "../../data/validators"

/**
 * The few pieces both Validators pages paint first: link style, the
 * reasons a figure is not available yet, the day's approximate edges and
 * the set status. A module of its own, so a validator's first paint loads
 * none of the list's cards.
 */

export const textLink =
  "rounded-sm outline-none hover:underline hover:underline-offset-4 focus-visible:outline-2 focus-visible:outline-ink"

/** Why each missing figure is missing, said the same way on both pages. */
export const reasons = {
  unclaimed: "Validator reward claims are not indexed yet",
  concentration: "Voters across every validator gauge need one read per gauge",
  votesFilling: "This epoch's votes are still being counted",
} as const

/** Why a day's count is "about" that day. */
export const dayEdges =
  "A day runs from one daily read of the counters to the next, made between 00:00 and 03:00 UTC, so its edges are approximate."

const statusWords: Record<ValidatorStatus, string> = {
  active: "In the set",
  left: "Left the set",
}

/** The PoA set status from ValidatorPool, not liveness. */
export function SetStatus({
  status,
  variant = "inline",
}: {
  status: ValidatorStatus | null
  variant?: "inline" | "chip"
}): ReactNode {
  if (status === null) return null
  const active = status === "active"
  return (
    <span
      className={`inline-flex items-center gap-1.5 font-semibold tracking-normal whitespace-nowrap ${variant === "chip" ? `h-7 rounded-[14px] px-2.5 text-[13.5px] ${active ? "bg-pos-soft text-ink" : "bg-soft text-ink2"}` : `text-[15px] ${active ? "text-pos" : "text-ink2"}`}`}
    >
      {active ? (
        <Glyph
          shape={shapes.check}
          size={14}
          strokeWidth={2.4}
          className="text-pos"
        />
      ) : null}
      {statusWords[status]}
    </span>
  )
}
