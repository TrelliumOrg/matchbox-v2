import type { GaugeKind, Lock, LockKind } from "../data/view-models"

/**
 * What an Overview lock card shows (`sL4e8DNYO0`, direction A refined), as
 * data: the one pill and what it does, the unlock property in the meta row
 * and the icon rows under the hairline. Pure, so every state is tested; the
 * card only draws it.
 */

/** Vote's type list opens on this type for each escrow. */
export const voteTypeFor: Record<LockKind, GaugeKind> = {
  vemezo: "vebtc",
  vebtc: "validator",
}

export type CardPill =
  | { kind: "claim"; usd: string }
  | { kind: "withdraw" }
  | { kind: "vote"; type: GaugeKind }
  | { kind: "manage" }

function positive(usd: string | null): boolean {
  return usd !== null && /[1-9]/.test(usd)
}

/**
 * A lock's votes stay on it from epoch to epoch until it votes again or
 * resets, so a lock that voted in an earlier epoch still has an allocation
 * earning this epoch.
 */
function hasAllocation(lock: Pick<Lock, "votedThisEpoch" | "votes">): boolean {
  return lock.votedThisEpoch || lock.votes.length > 0
}

/**
 * The pill follows the lock's state, most useful first: claim what it
 * earned, withdraw once expired, vote when it carries no votes, else
 * Manage (which flips the card).
 */
export function cardPill(
  lock: Pick<
    Lock,
    "kind" | "expired" | "votedThisEpoch" | "votes" | "claimableUsd"
  >,
): CardPill {
  if (positive(lock.claimableUsd)) {
    return { kind: "claim", usd: lock.claimableUsd }
  }
  if (lock.expired) return { kind: "withdraw" }
  if (!hasAllocation(lock))
    return { kind: "vote", type: voteTypeFor[lock.kind] }
  return { kind: "manage" }
}

export type UnlockMeta =
  | { kind: "auto-max" }
  | { kind: "unlocks"; at: number }
  | { kind: "expired"; at: number | null }

/** The meta row's last property: infinity, a calendar date, or expiry. */
export function unlockMeta(
  lock: Pick<Lock, "expired" | "autoMax" | "unlocksAt">,
): UnlockMeta {
  if (lock.expired) return { kind: "expired", at: lock.unlocksAt }
  if (lock.autoMax || lock.unlocksAt === null) return { kind: "auto-max" }
  return { kind: "unlocks", at: lock.unlocksAt }
}

export type CardRow =
  | { kind: "epoch" }
  | { kind: "not-voted"; endsAt: number }
  | { kind: "projected"; usd: string }
  | { kind: "if-voted"; usd: string }
  | { kind: "claimable"; usd: string; tone: "positive" | "muted" }

/**
 * The rows under the hairline. With votes (cast this epoch or carried from
 * an earlier one): the epoch's allocation, Projected for veMEZO locks,
 * Claimable. Without: an amber row with the time left and,
 * when the read model has it, what a vote would earn. Expired: Claimable.
 */
export function cardRows(
  lock: Pick<
    Lock,
    | "kind"
    | "expired"
    | "votedThisEpoch"
    | "votes"
    | "claimableUsd"
    | "projectedUsd"
    | "ifVotedUsd"
  >,
  epochEndsAt: number,
): CardRow[] {
  const claimable: CardRow = {
    kind: "claimable",
    usd: lock.claimableUsd,
    tone: positive(lock.claimableUsd) ? "positive" : "muted",
  }
  const ifVoted = lock.ifVotedUsd ?? null
  const projected = lock.projectedUsd ?? null
  if (lock.expired) return [claimable]
  if (!hasAllocation(lock)) {
    return [
      { kind: "not-voted", endsAt: epochEndsAt },
      ...(ifVoted === null
        ? []
        : [{ kind: "if-voted", usd: ifVoted } as const]),
      ...(positive(lock.claimableUsd) ? [claimable] : []),
    ]
  }
  return [
    { kind: "epoch" },
    ...(lock.kind === "vemezo" && projected !== null
      ? [{ kind: "projected", usd: projected } as const]
      : []),
    claimable,
  ]
}
