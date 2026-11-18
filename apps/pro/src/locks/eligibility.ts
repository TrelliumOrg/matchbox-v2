import type { Lock, LockKind } from "../data/view-models"
import { formatDate, formatDay } from "../lib/format"
import { epochNext, epochStart, voteWindow } from "../tx/vote-window"

/**
 * What a lock may do right now, from its on-chain state (Decided 9 Nov,
 * "Lock edge cases"). Pure: the sheets read the facts on chain and ask here,
 * the cards ask with what the read model knows.
 *
 * - Vesting grant locks are read-only until vesting ends.
 * - Managed locks (and locks deposited into one) are read-only.
 * - Expired locks only withdraw, and nothing merges into them.
 * - Auto max locks cannot extend or withdraw. To merge one away, auto max
 *   turns off first (merge reverts PermanentLock on the source).
 * - A lock with live votes (`voted`, set until a reset, whichever epoch it
 *   voted in) needs a reset before merge, withdraw or turning off auto max.
 *   Transfer moves it with its votes. Reset reverts in the epoch the lock
 *   voted and from Thu 00:00 to 01:00 UTC, so a lock voted this epoch waits
 *   for next Thursday 01:00.
 * - veBTC and veMEZO never merge.
 */

export type LockFacts = {
  kind: LockKind
  tokenId: string
  /** Unlock time, unix seconds; null with auto max. */
  end: number | null
  /** A grant lock's vesting end, unix seconds; 0 for a normal lock. */
  vestingEnd: number
  /** A managed lock, or one deposited into a managed lock. */
  managed: boolean
  /** `lastVoted` on each voter the lock has live votes on (unix seconds). */
  votedAt: readonly number[]
}

export type LockAction =
  | "add"
  | "extend"
  | "merge"
  | "transfer"
  | "withdraw"
  | "auto-max-off"

export type LockBlock =
  | { kind: "vesting"; until: number }
  | { kind: "managed" }
  | { kind: "expired" }
  | { kind: "auto-max" }
  | { kind: "not-expired"; until: number }
  | { kind: "voted"; clearsAt: number; now: number }
  | { kind: "other-escrow" }
  | { kind: "same-lock" }

export type Eligibility =
  | {
      ok: true
      /** Votes to reset first, one step per voter. */
      reset: boolean
      /** Auto max to turn off first (merging an auto max lock away). */
      autoMaxOff: boolean
    }
  | { ok: false; block: LockBlock }

const hourSeconds = 3_600
const daySeconds = 86_400

function blocked(block: LockBlock): Eligibility {
  return { ok: false, block }
}

export function isExpired(facts: LockFacts, now: number): boolean {
  return facts.end !== null && facts.end <= now
}

export function isVesting(facts: LockFacts, now: number): boolean {
  return facts.vestingEnd > now
}

/**
 * When a vote cast at `lastVoted` can be reset: never in the epoch it was
 * cast, never in an epoch's first hour (the voters' window runs to 01:00
 * inclusive, so the first second after it). Returns `now` when it can.
 */
export function resetClearsAt(lastVoted: number, now: number): number {
  const start = epochStart(now)
  if (lastVoted >= start) return epochNext(now) + hourSeconds + 1
  if (voteWindow(now).kind === "distribute") return start + hourSeconds + 1
  return now
}

const needsReset: ReadonlySet<LockAction> = new Set([
  "merge",
  "withdraw",
  "auto-max-off",
])

/** Whether `facts`' lock can run `action` now, and whether it resets first. */
export function lockEligibility(
  facts: LockFacts,
  action: LockAction,
  now: number,
): Eligibility {
  if (facts.managed) return blocked({ kind: "managed" })
  if (isVesting(facts, now)) {
    return blocked({ kind: "vesting", until: facts.vestingEnd })
  }
  if (action === "withdraw") {
    if (facts.end === null) return blocked({ kind: "auto-max" })
    if (!isExpired(facts, now)) {
      return blocked({ kind: "not-expired", until: facts.end })
    }
  } else if (isExpired(facts, now)) {
    return blocked({ kind: "expired" })
  }
  const autoMax = facts.end === null
  if (autoMax && action === "extend") return blocked({ kind: "auto-max" })
  const autoMaxOff = autoMax && action === "merge"
  if (!needsReset.has(action) || facts.votedAt.length === 0) {
    return { ok: true, reset: false, autoMaxOff }
  }
  const clearsAt = Math.max(
    ...facts.votedAt.map((lastVoted) => resetClearsAt(lastVoted, now)),
  )
  return clearsAt > now
    ? blocked({ kind: "voted", clearsAt, now })
    : { ok: true, reset: true, autoMaxOff }
}

/** Why nothing can merge into `into` from `from`, the target's side only. */
export function mergeTargetBlock(
  from: Pick<LockFacts, "kind" | "tokenId">,
  into: LockFacts,
  now: number,
): LockBlock | null {
  if (from.kind !== into.kind) return { kind: "other-escrow" }
  if (from.tokenId === into.tokenId) return { kind: "same-lock" }
  if (into.managed) return { kind: "managed" }
  if (isVesting(into, now)) return { kind: "vesting", until: into.vestingEnd }
  if (isExpired(into, now)) return { kind: "expired" }
  return null
}

/**
 * Whether `from` can merge into `into`: the target's checks, then the
 * source's own. On chain only the source's votes matter.
 */
export function mergeEligibility(
  from: LockFacts,
  into: LockFacts,
  now: number,
): Eligibility {
  const target = mergeTargetBlock(from, into, now)
  return target === null ? lockEligibility(from, "merge", now) : blocked(target)
}

/** "Sun 15 Apr 2029" */
function longDate(unix: number): string {
  return `${formatDay(unix)} ${new Date(unix * 1000).getUTCFullYear()}`
}

/** The reason in the UI: "Vesting until Sun 15 Apr 2029", "Other escrow". */
export function blockLabel(block: LockBlock): string {
  switch (block.kind) {
    case "vesting":
      return `Vesting until ${longDate(block.until)}`
    case "managed":
      return "Managed lock"
    case "expired":
      return "Expired"
    case "auto-max":
      return "Auto max is on"
    case "not-expired":
      return `Unlocks ${formatDate(block.until)}`
    case "voted":
      return block.clearsAt - block.now <= daySeconds
        ? "Voted, clears at 01:00"
        : `Voted, clears ${formatDay(block.clearsAt)} 01:00`
    case "other-escrow":
      return "Other escrow"
    case "same-lock":
      return "Same lock"
  }
}

/**
 * Facts from the read model alone, before (or without) the chain read: it
 * knows expiry and auto max, not vesting, managed or votes.
 */
export function viewFacts(
  lock: Pick<Lock, "kind" | "tokenId" | "unlocksAt" | "expired">,
): LockFacts {
  return {
    kind: lock.kind,
    tokenId: lock.tokenId,
    end: lock.expired ? 0 : lock.unlocksAt,
    vestingEnd: 0,
    managed: false,
    votedAt: [],
  }
}

export type CardAction = {
  action: Exclude<LockAction, "auto-max-off">
  /**
   * A short note beside the action ("Auto max", "Voted this epoch"). Every
   * action stays enabled: its sheet explains a block and offers the fix.
   */
  note: string | null
}

/**
 * The actions on a card's back face. The read model knows expiry, auto max
 * and a vote this epoch; vesting, managed locks and the reset window are
 * checked on chain when a sheet opens.
 */
export function cardActions(
  lock: Pick<Lock, "expired" | "unlocksAt" | "autoMax" | "votedThisEpoch">,
): CardAction[] {
  if (lock.expired) return [{ action: "withdraw", note: null }]
  const autoMax = lock.autoMax || lock.unlocksAt === null
  return [
    { action: "add", note: null },
    { action: "extend", note: autoMax ? "Auto max" : null },
    { action: "merge", note: lock.votedThisEpoch ? "Voted this epoch" : null },
    { action: "transfer", note: null },
  ]
}
