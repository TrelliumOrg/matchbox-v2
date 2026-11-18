import type { Proposal } from "@matchbox/stuart-ui/contract"
import type { ClaimVoter } from "./providers/claimsChain"
import type { LockChainState } from "./providers/locks"

// What a lock may do right now (matchbox-v3, Decided 9 Nov, "Lock edge
// cases"), the same rules as Pro's `locks/eligibility`:
// - vesting grant locks are read-only until vesting ends;
// - managed locks (and locks deposited into one) are read-only;
// - expired locks only withdraw, and nothing merges into them;
// - auto max locks cannot extend, withdraw or be merged away;
// - a lock with live votes needs a reset before merge, transfer or
//   withdraw, and a reset reverts in the epoch the lock voted and from
//   Thu 00:00 to 01:00 UTC;
// - veBTC and veMEZO never merge.

export type LockActionKind =
  | "add"
  | "extend"
  | "auto_max"
  | "withdraw"
  | "merge"
  | "transfer"

export type BlockedReason = NonNullable<Proposal["blockedReason"]>

export type LockVerdict =
  | { ok: true; resets: ClaimVoter[] }
  | { ok: false; reason: BlockedReason; until: bigint | null }

const WEEK = 604_800n
const HOUR = 3_600n

export function epochStartOf(now: bigint): bigint {
  return (now / WEEK) * WEEK
}

/** Thu 00:00 to 01:00 UTC: votes and resets revert while rewards distribute. */
export function inDistributeWindow(now: bigint): boolean {
  return now - epochStartOf(now) <= HOUR
}

export function isExpired(lock: LockChainState, now: bigint): boolean {
  return !lock.isPermanent && lock.end !== 0n && lock.end <= now
}

/** The first second a vote cast at `lastVoted` can be reset. */
export function resetClearsAt(lastVoted: bigint, now: bigint): bigint {
  const start = epochStartOf(now)
  if (lastVoted >= start) return start + WEEK + HOUR + 1n
  if (inDistributeWindow(now)) return start + HOUR + 1n
  return now
}

/**
 * A transfer is not here: the chain moves a voted lock, and its votes and
 * unclaimed rewards go with it.
 */
const NEEDS_RESET: ReadonlySet<LockActionKind> = new Set(["merge", "withdraw"])

export function lockVerdict(
  lock: LockChainState,
  action: LockActionKind,
  now: bigint,
  owner: string,
): LockVerdict {
  if (lock.owner === null || lock.owner.toLowerCase() !== owner.toLowerCase()) {
    return { ok: false, reason: "lock_not_owned", until: null }
  }
  if (lock.escrowType !== 0) {
    return { ok: false, reason: "lock_managed", until: null }
  }
  if (lock.vestingEnd > now) {
    return { ok: false, reason: "lock_vesting", until: lock.vestingEnd }
  }
  if (action === "withdraw") {
    if (lock.isPermanent) {
      return { ok: false, reason: "lock_auto_max", until: null }
    }
    if (!isExpired(lock, now)) {
      return { ok: false, reason: "lock_not_expired", until: lock.end }
    }
  } else if (isExpired(lock, now)) {
    return { ok: false, reason: "lock_expired", until: null }
  }
  if (
    lock.isPermanent &&
    (action === "extend" || action === "auto_max" || action === "merge")
  ) {
    return { ok: false, reason: "lock_auto_max", until: null }
  }
  if (!NEEDS_RESET.has(action) || lock.votedVoters.length === 0) {
    return { ok: true, resets: [] }
  }
  let clears = now
  for (const voter of lock.votedVoters) {
    const at = resetClearsAt(lock.lastVoted[voter] ?? 0n, now)
    if (at > clears) clears = at
  }
  if (clears > now) {
    return {
      ok: false,
      reason: inDistributeWindow(now)
        ? "distribute_window"
        : "lock_voted_this_epoch",
      until: clears,
    }
  }
  return { ok: true, resets: [...lock.votedVoters] }
}

/** Why nothing can merge `from` into `into`, beyond `from`'s own rules. */
export function mergeTargetVerdict(
  from: LockChainState,
  into: LockChainState,
  now: bigint,
  owner: string,
): LockVerdict {
  if (from.asset !== into.asset) {
    return { ok: false, reason: "different_escrows", until: null }
  }
  if (from.tokenId === into.tokenId) {
    return { ok: false, reason: "lock_not_owned", until: null }
  }
  if (into.owner === null || into.owner.toLowerCase() !== owner.toLowerCase()) {
    return { ok: false, reason: "lock_not_owned", until: null }
  }
  if (into.escrowType !== 0) {
    return { ok: false, reason: "lock_managed", until: null }
  }
  if (into.vestingEnd > now) {
    return { ok: false, reason: "lock_vesting", until: into.vestingEnd }
  }
  if (isExpired(into, now)) {
    return { ok: false, reason: "lock_expired", until: null }
  }
  return { ok: true, resets: [] }
}

/** Plain words for a blocked lock action, for answers. */
export const BLOCKED_TEXT: Record<BlockedReason, string> = {
  connect_this_wallet: "Connect this wallet to sign.",
  insufficient_balance: "The wallet does not hold enough.",
  simulation_reverted: "The simulation reverted.",
  price_impact_too_high: "Price impact is too high.",
  oracle_stale: "The price feed is stale.",
  exceeds_max_repay: "That is above the maximum repayment.",
  trove_not_active: "The loan is not active.",
  voting_window_closed: "Voting is closed for this epoch.",
  already_voted_this_epoch: "This lock already voted this epoch.",
  nothing_to_claim: "Nothing to claim.",
  lock_vesting: "This lock is still vesting.",
  lock_managed: "Managed locks are read only.",
  lock_expired: "This lock has expired, so it can only be withdrawn.",
  lock_not_expired: "This lock has not expired yet.",
  lock_auto_max: "Auto max locks cannot do that.",
  lock_voted_this_epoch:
    "This lock voted this epoch, so its votes can be reset from next Thursday.",
  different_escrows: "veBTC and veMEZO locks never merge.",
  distribute_window: "Resets pause for the first hour of Thursday UTC.",
  lock_not_owned: "That lock is not in this wallet.",
}
