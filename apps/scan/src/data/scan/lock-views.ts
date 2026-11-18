import type { ScanLockItem, ScanLockVoteItem } from "@matchbox/contracts/scan"
import { type Escrow, escrowOf } from "@matchbox/domain/activity"
import { epochIndexFor } from "@matchbox/domain/epoch"
import {
  formatBtc,
  formatDate,
  formatTokenWithSymbol,
  formatVoteAmount,
  fromWei,
} from "@matchbox/domain/format"
import type { LabelMap } from "./activity-view"

/**
 * Locks and their votes as Scan draws them (`@matchbox/contracts/scan`
 * ScanLockItem, ScanLockVoteItem): amounts formatted (veBTC locks hold BTC,
 * veMEZO locks hold MEZO, votes in the lock's unit), dates as unix seconds
 * with a formatted unlock date, the lock's state as a word.
 */

export type LockState =
  | "active"
  | "auto-max"
  | "expired"
  | "withdrawn"
  | "merged"

export type LockView = {
  escrow: Escrow | null
  /** The escrow contract, lower case. */
  escrowAddress: string
  id: string
  owner: string | null
  /** "1.2400 BTC", "18,402.55 MEZO". */
  amount: string
  state: LockState
  /** Unix seconds; null for auto max and for unknown. */
  unlockAt: number | null
  unlockText: string | null
  createdAt: number | null
  withdrawnAt: number | null
  mergedInto: string | null
  /** "4.4×" when the lock carries a boost. */
  boost: string | null
  /** Null for a lock the store does not have yet (made from the chain). */
  activityCount: number | null
}

function lockAmount(escrow: Escrow | null, amount: string): string {
  const decimal = fromWei(amount)
  if (escrow === "vebtc") return formatBtc(decimal).text
  return formatTokenWithSymbol(decimal, escrow === "vemezo" ? "MEZO" : "tokens")
}

/**
 * The lock's unlock time when it has one. The escrows keep `locked.end` at
 * 0 for a permanent (auto max) lock, so 0 is never a date: a live lock
 * with an end of 0 is auto max, whatever its flag says (a warehouse that
 * missed its LockPermanent), and the Unix epoch is never shown.
 */
function unlockOf(lock: ScanLockItem): number | null {
  if (lock.is_permanent) return null
  if (lock.unlock_at === null || lock.unlock_at <= 0) return null
  return lock.unlock_at
}

function lockState(lock: ScanLockItem, now: number): LockState {
  if (lock.is_merged) return "merged"
  if (lock.is_withdrawn) return "withdrawn"
  if (lock.is_permanent || lock.unlock_at === 0) return "auto-max"
  const unlock = unlockOf(lock)
  if (unlock !== null && unlock <= now) return "expired"
  return "active"
}

function boostText(boost: string | null): string | null {
  if (boost === null) return null
  const decimal = fromWei(boost)
  const [whole = "0", fraction = ""] = decimal.split(".")
  const trimmed = fraction.slice(0, 2).replace(/0+$/, "")
  return `${whole}${trimmed === "" ? "" : `.${trimmed}`}×`
}

function unlockText(lock: ScanLockItem): string | null {
  const unlock = unlockOf(lock)
  return unlock === null ? null : formatDate(unlock)
}

export function lockView(lock: ScanLockItem, now: number): LockView {
  const escrow = escrowOf(lock.escrow)
  return {
    escrow,
    escrowAddress: lock.escrow.toLowerCase(),
    id: lock.token_id,
    owner: lock.owner,
    amount: lockAmount(escrow, lock.amount),
    state: lockState(lock, now),
    unlockAt: unlockOf(lock),
    unlockText: unlockText(lock),
    createdAt: lock.created_at,
    withdrawnAt: lock.withdrawn_at,
    mergedInto: lock.merged_into_token_id,
    boost: boostText(lock.boost),
    activityCount: lock.activity_count,
  }
}

export type LockVoteView = {
  epoch: number
  epochStart: number
  gauge: string
  gaugeName: string | null
  escrow: Escrow | null
  id: string
  /** "12,000 veMEZO". */
  weight: string
  votedAt: number
  /** Carried from an earlier epoch, not cast in this one. */
  carried: boolean
}

export function lockVoteView(
  vote: ScanLockVoteItem,
  labels: LabelMap,
): LockVoteView {
  const escrow = escrowOf(vote.escrow)
  return {
    epoch: epochIndexFor(vote.epoch_start),
    epochStart: vote.epoch_start,
    gauge: vote.gauge,
    gaugeName: labels[vote.gauge.toLowerCase()]?.name ?? null,
    escrow,
    id: vote.token_id,
    weight: formatVoteAmount(
      vote.weight,
      escrow === "vebtc" ? "veBTC" : "veMEZO",
    ),
    votedAt: vote.voted_at,
    carried: vote.carried,
  }
}

/** The sum of vote weights (base units) as "18,402 veMEZO". */
export function totalVotes(
  votes: readonly ScanLockVoteItem[],
  unit: "veMEZO" | "veBTC",
): string {
  const sum = votes.reduce((total, vote) => total + BigInt(vote.weight), 0n)
  return formatVoteAmount(sum, unit)
}
