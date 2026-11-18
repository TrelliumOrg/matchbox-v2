import type { ReactNode } from "react"
import type { ClaimableAsOf } from "../data/view-models"
import { groupThousands } from "../lib/format"

/**
 * "As of block 13,169,097" beside a Claimable figure, only when the API
 * could not read it from the chain just now and served the stored one.
 * A live figure needs no note. The chain decides the amounts at Claim's
 * review either way.
 */

/** The note's text, or null when there is nothing to say. */
export function claimableNote(asOf: ClaimableAsOf | undefined): string | null {
  if (asOf === undefined) return null
  if (asOf.source === "stored") {
    return `As of block ${groupThousands(BigInt(asOf.block))}`
  }
  // Live for the largest locks; the smaller ones are stored figures.
  return asOf.partial ? "Largest locks live, the rest earlier" : null
}

/**
 * The same for the locks: "Locks as of block 13,169,097" when the API could
 * not read them from the chain and served the stored ones, which may not
 * have a lock made or changed since.
 */
export function locksNote(asOf: ClaimableAsOf | undefined): string | null {
  if (asOf === undefined) return null
  if (asOf.source === "stored") {
    return `Locks as of block ${groupThousands(BigInt(asOf.block))}`
  }
  // More locks than one read lists: the rest are the stored ones.
  return asOf.partial ? "First 50 locks live, the rest earlier" : null
}

export function LocksAsOfNote({
  asOf,
  className = "",
}: {
  asOf: ClaimableAsOf | undefined
  className?: string
}): ReactNode {
  const note = locksNote(asOf)
  if (note === null) return null
  return (
    <p
      data-locks-as-of=""
      className={`text-[13.5px] text-sec tabular-nums ${className}`}
    >
      {note}
    </p>
  )
}

export function ClaimableAsOfNote({
  asOf,
  className = "",
}: {
  asOf: ClaimableAsOf | undefined
  className?: string
}): ReactNode {
  const note = claimableNote(asOf)
  if (note === null) return null
  return (
    <p
      data-claimable-as-of=""
      className={`text-[13.5px] text-sec tabular-nums ${className}`}
    >
      {note}
    </p>
  )
}
