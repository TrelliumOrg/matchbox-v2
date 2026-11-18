import type { GaugeKind, Lock } from "../../data/view-models"
import type { Ballot } from "./ballot"
import { ballotFromLock } from "./ballot"

/**
 * The rules about saved splits that Vote needs to paint: what a saved
 * split is, whether it waits or can be signed, and where a ballot starts.
 * Reading and writing them in this browser, and the dates, are in
 * `saved-ballots`, which loads after the page.
 */

export type SavedBallot = {
  /** The epoch the split is for: the one after the lock's vote. */
  forEpoch: number
  /** Gauge address (lower case) and share in basis points. */
  picks: [string, number][]
  savedAt: number
}

export type SavedStatus =
  /** Saved; the lock voted this epoch, so it waits for `forEpoch`. */
  | "pending"
  /** The epoch it was saved for is open and the lock can vote: sign it. */
  | "ready"

export function savedStatus(
  saved: SavedBallot | null,
  lock: Lock,
  epoch: number,
): SavedStatus | null {
  if (saved === null) return null
  if (lock.votedThisEpoch) {
    // Voted again in the epoch it was saved for: the split is spent.
    return saved.forEpoch > epoch ? "pending" : null
  }
  return "ready"
}

/** Which picked locks sign now and which save for the next epoch. */
export function splitByVote(locks: readonly Lock[]): {
  sign: Lock[]
  save: Lock[]
} {
  return {
    sign: locks.filter((lock) => !lock.votedThisEpoch),
    save: locks.filter((lock) => lock.votedThisEpoch),
  }
}

/** The ballot rail's primary: sign, save, or sign some and save the rest. */
export function primaryLabel(locks: readonly Lock[], epoch: number): string {
  const { sign } = splitByVote(locks)
  if (locks.length > 0 && sign.length === 0)
    return `Save for Epoch ${epoch + 1}`
  return sign.length > 1
    ? `Review and sign, ${sign.length} signatures`
    : "Review and sign"
}

/**
 * Where a selection's ballot for one gauge type starts: the first picked
 * lock's saved split (pending or ready), kept to gauges of that type, else
 * the locks' current votes in it.
 */
export function startingBallot(
  locks: readonly Lock[],
  savedOf: (lock: Lock) => SavedBallot | null,
  kind: GaugeKind,
  /** Whether a gauge (lower-case address) is of this type. */
  inKind: (id: string) => boolean,
): Ballot {
  for (const lock of locks) {
    const saved = savedOf(lock)
    if (saved === null) continue
    const picks = saved.picks.filter(([id]) => inKind(id))
    if (picks.length > 0) return new Map(picks)
  }
  return ballotFromLock(locks, kind)
}
