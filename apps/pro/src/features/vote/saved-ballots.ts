import type { GaugeKind, Lock, LockKind } from "../../data/view-models"
import type { Ballot } from "./ballot"
import type { SavedBallot } from "./saved-rules"

export {
  primaryLabel,
  type SavedBallot,
  type SavedStatus,
  savedStatus,
  splitByVote,
  startingBallot,
} from "./saved-rules"

/**
 * Changes for a lock that already voted this epoch. All three voters
 * (BoostVoter, ValidatorsVoter, PoolsVoter) revert vote() and reset() with
 * AlreadyVotedOrDeposited() until the next epoch, and nothing can sign for
 * the owner later. So Vote saves the split in this browser, per wallet and
 * lock, says from when it can be signed, and offers it again once the next
 * epoch opens. It never signs on its own.
 *
 * A split is kept per gauge type, because each type's voter has its own
 * 100% (see `ballot.ts`). Splits saved before 12 Nov 2026 had one key per
 * lock and could mix two types; they are still read, and Vote keeps only
 * the picks of the type on screen.
 */

/** Fired on this page when a split is saved or cleared. */
const savedEvent = "mbx-vote-saved"

export function subscribeSaved(onChange: () => void): () => void {
  window.addEventListener(savedEvent, onChange)
  return () => window.removeEventListener(savedEvent, onChange)
}

function announce(): void {
  try {
    window.dispatchEvent(new Event(savedEvent))
  } catch {
    // No window (tests without a DOM): nothing listens.
  }
}

const legacyKey = (wallet: string, escrow: LockKind, tokenId: string) =>
  `mbx-vote-saved:${wallet.toLowerCase()}:${escrow}:${tokenId}`

const storageKey = (
  wallet: string,
  escrow: LockKind,
  tokenId: string,
  kind: GaugeKind,
) => `${legacyKey(wallet, escrow, tokenId)}:${kind}`

/** The gauge types a lock votes, by escrow. */
const kindsOf: Record<LockKind, readonly GaugeKind[]> = {
  vemezo: ["vebtc", "mezo"],
  vebtc: ["validator", "pool"],
}

export function parseSaved(raw: string | null): SavedBallot | null {
  if (raw === null) return null
  try {
    const value: unknown = JSON.parse(raw)
    if (typeof value !== "object" || value === null) return null
    const forEpoch = Reflect.get(value, "forEpoch")
    const picks = Reflect.get(value, "picks")
    const savedAt = Reflect.get(value, "savedAt")
    if (
      !Number.isInteger(forEpoch) ||
      typeof savedAt !== "number" ||
      !Array.isArray(picks) ||
      !picks.every(
        (pick) =>
          Array.isArray(pick) &&
          typeof pick[0] === "string" &&
          /^0x[0-9a-f]{40}$/.test(pick[0]) &&
          Number.isInteger(pick[1]) &&
          pick[1] >= 0 &&
          pick[1] <= 10_000,
      )
    ) {
      return null
    }
    return { forEpoch, picks, savedAt }
  } catch {
    return null
  }
}

/** The split saved for a lock and gauge type, else one from the old key. */
export function loadSaved(
  wallet: string,
  lock: Lock,
  kind: GaugeKind,
): SavedBallot | null {
  try {
    return (
      parseSaved(
        window.localStorage.getItem(
          storageKey(wallet, lock.kind, lock.tokenId, kind),
        ),
      ) ??
      parseSaved(
        window.localStorage.getItem(legacyKey(wallet, lock.kind, lock.tokenId)),
      )
    )
  } catch {
    return null
  }
}

/** Any split saved for the lock, whatever the gauge type (lock cards). */
export function loadSavedAny(wallet: string, lock: Lock): SavedBallot | null {
  for (const kind of kindsOf[lock.kind]) {
    const saved = loadSaved(wallet, lock, kind)
    if (saved !== null) return saved
  }
  return null
}

export function storeSaved(
  wallet: string,
  lock: Lock,
  kind: GaugeKind,
  saved: SavedBallot,
): void {
  try {
    window.localStorage.setItem(
      storageKey(wallet, lock.kind, lock.tokenId, kind),
      JSON.stringify(saved),
    )
  } catch {
    // Without storage nothing is kept: the lock card shows no saved split.
  }
  announce()
}

export function clearSaved(wallet: string, lock: Lock, kind: GaugeKind): void {
  try {
    window.localStorage.removeItem(
      storageKey(wallet, lock.kind, lock.tokenId, kind),
    )
    window.localStorage.removeItem(legacyKey(wallet, lock.kind, lock.tokenId))
  } catch {
    // Nothing to clear.
  }
  announce()
}

/** A ballot's live picks, saved for the epoch after `epoch`. */
export function savedFrom(
  ballot: Ballot,
  epoch: number,
  now: number,
): SavedBallot {
  return {
    forEpoch: epoch + 1,
    picks: [...ballot]
      .filter(([, bps]) => bps > 0)
      .map(([id, bps]) => [id.toLowerCase(), bps]),
    savedAt: now,
  }
}

/**
 * When a lock that voted this epoch can vote again: the next epoch's
 * first hour (distribution, whitelisted voters only) over.
 */
export function changeOpensAt(epochEndsAt: number): number {
  return epochEndsAt + 3_600
}

const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
const months = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
]

/** "Thu 12 Nov 01:00 UTC" */
export function formatUtc(seconds: number): string {
  const date = new Date(seconds * 1_000)
  const time = `${String(date.getUTCHours()).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(2, "0")}`
  return `${weekdays[date.getUTCDay()]} ${date.getUTCDate()} ${months[date.getUTCMonth()]} ${time} UTC`
}

/** "Votes can change from Thu 12 Nov 01:00 UTC" */
export function changeLine(epochEndsAt: number): string {
  return `Votes can change from ${formatUtc(changeOpensAt(epochEndsAt))}`
}
