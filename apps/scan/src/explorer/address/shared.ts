import type { LockState, LockView } from "../../data/scan/lock-views"
import type { HealthBand } from "../../data/scan/words"

/** Shared by the address page's parts (`eSwId--0MF`). */

export const escrowName = { vebtc: "veBTC", vemezo: "veMEZO" } as const

export const bandTone: Record<HealthBand, string> = {
  healthy: "text-pos",
  near_liquidation: "text-acc-ink",
  liquidatable: "text-neg",
  no_debt: "text-sec",
  // No price, no health: neutral ink, no colour claim.
  unknown: "text-ink",
}

export const stateWords: Record<LockState, string> = {
  active: "Active",
  "auto-max": "Auto max",
  expired: "Expired",
  withdrawn: "Withdrawn",
  merged: "Merged",
}

export function lockSubline(lock: LockView): string {
  if (lock.state === "auto-max") return "Auto max"
  if (lock.state === "withdrawn") return "Withdrawn"
  if (lock.state === "merged") {
    return lock.mergedInto === null
      ? "Merged"
      : `Merged into #${lock.mergedInto}`
  }
  if (lock.state === "expired") return "Lock expired"
  return lock.unlockText === null ? "Locked" : `Unlocks ${lock.unlockText}`
}

export const actionLink =
  "inline-flex items-center gap-1 rounded-sm font-semibold whitespace-nowrap outline-none hover:underline hover:underline-offset-4 focus-visible:outline-2 focus-visible:outline-ink"
