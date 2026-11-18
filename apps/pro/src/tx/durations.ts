import {
  VEBTC_MAX_LOCK_SECONDS,
  VEMEZO_MAX_LOCK_SECONDS,
} from "@matchbox/chain"
import type { LockKind } from "../data/view-models"
import { weekSeconds } from "./vote-window"

/**
 * Lock durations per escrow. veMEZO locks for up to 208 weeks, veBTC for up
 * to 28 days; the escrow rounds every unlock down to a Thursday 00:00 UTC
 * week boundary. Auto max is a permanent lock (`lockPermanent`).
 */

export type DurationChoice = { id: string; label: string; seconds: number }

const day = 86_400

export const durations: Record<LockKind, readonly DurationChoice[]> = {
  vemezo: [
    { id: "1m", label: "1 month", seconds: 30 * day },
    { id: "6m", label: "6 months", seconds: 182 * day },
    { id: "1y", label: "1 year", seconds: 365 * day },
    { id: "4y", label: "4 years", seconds: VEMEZO_MAX_LOCK_SECONDS },
  ],
  vebtc: [
    { id: "1w", label: "1 week", seconds: 7 * day },
    { id: "2w", label: "2 weeks", seconds: 14 * day },
    { id: "3w", label: "3 weeks", seconds: 21 * day },
    { id: "4w", label: "4 weeks", seconds: VEBTC_MAX_LOCK_SECONDS },
  ],
}

export const extendDurations: Record<LockKind, readonly DurationChoice[]> = {
  vemezo: [
    { id: "1y", label: "1 year", seconds: 365 * day },
    { id: "2y", label: "2 years", seconds: 730 * day },
    { id: "3y", label: "3 years", seconds: 1095 * day },
    { id: "4y", label: "4 years", seconds: VEMEZO_MAX_LOCK_SECONDS },
  ],
  vebtc: durations.vebtc,
}

export function maxLockSeconds(kind: LockKind): number {
  return kind === "vemezo" ? VEMEZO_MAX_LOCK_SECONDS : VEBTC_MAX_LOCK_SECONDS
}

/** Where the escrow puts the unlock for a duration from `now`. */
export function unlockAt(now: number, seconds: number): number {
  return Math.floor((now + seconds) / weekSeconds) * weekSeconds
}

/**
 * Voting power of a lock that decays linearly to its unlock, in base units;
 * a permanent lock keeps its full amount. veBTC boosts are not counted, so
 * the figure reads "About".
 */
export function votingPowerAt(input: {
  kind: LockKind
  amount: bigint
  now: number
  end: number | null
}): bigint {
  if (input.end === null) return input.amount
  const left = input.end - input.now
  if (left <= 0) return 0n
  return (input.amount * BigInt(left)) / BigInt(maxLockSeconds(input.kind))
}
