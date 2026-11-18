import type { GaugeKind, Lock, LockKind } from "../../data/view-models"

/**
 * Which locks vote, on Vote: the type decides the escrow (veMEZO votes
 * veBTC and MEZO gauges, veBTC votes validator and pool gauges); every lock
 * of that escrow shows as a card, and the ones that cannot vote stay
 * visible, dimmed, with the reason. A lock that voted this epoch can still
 * be picked: its changes are saved for the next epoch (see saved-ballots).
 * The selection is remembered per wallet and type, in this browser only.
 */

/** Why a lock cannot be picked, or null when it can. */
export function lockBlock(lock: Lock): string | null {
  if (lock.expired) return "Expired"
  if (BigInt(lock.votingPowerWei) === 0n) return "No voting power"
  return null
}

export function locksOf(locks: readonly Lock[], escrow: LockKind): Lock[] {
  return locks.filter((lock) => lock.kind === escrow)
}

export function votingLocks(locks: readonly Lock[]): Lock[] {
  return locks.filter((lock) => lockBlock(lock) === null)
}

/**
 * The remembered selection, kept to locks that can still be picked;
 * without one (or when none of it is left), every lock that can vote now,
 * else (every lock voted this epoch) the voted ones, to save changes.
 */
export function initialSelection(
  locks: readonly Lock[],
  remembered: readonly string[] | null,
): string[] {
  const eligible = votingLocks(locks)
  const ids = eligible.map((lock) => lock.tokenId)
  const fresh = eligible.filter((lock) => !lock.votedThisEpoch)
  const fallback = (fresh.length > 0 ? fresh : eligible).map(
    (lock) => lock.tokenId,
  )
  if (remembered === null) return fallback
  const kept = remembered.filter((id) => ids.includes(id))
  return kept.length === 0 && remembered.length > 0 ? fallback : kept
}

const storageKey = (wallet: string, kind: GaugeKind): string =>
  `mbx-vote-locks:${wallet.toLowerCase()}:${kind}`

export function loadSelection(
  wallet: string,
  kind: GaugeKind,
): string[] | null {
  try {
    const raw = window.localStorage.getItem(storageKey(wallet, kind))
    if (raw === null) return null
    const value: unknown = JSON.parse(raw)
    return Array.isArray(value) &&
      value.every((id) => typeof id === "string" && /^\d+$/.test(id))
      ? value
      : null
  } catch {
    return null
  }
}

export function saveSelection(
  wallet: string,
  kind: GaugeKind,
  ids: readonly string[],
): void {
  try {
    window.localStorage.setItem(storageKey(wallet, kind), JSON.stringify(ids))
  } catch {
    // Remembered for this visit only.
  }
}
