import { useSyncExternalStore } from "react"
import type {
  GaugeKind,
  GaugeList,
  GaugeSummary,
  Lock,
  VoteUnit,
} from "../../data/view-models"
import { usdToMicro, voterOf, voteWeight } from "./ballot"

/**
 * A vote this browser signed, kept on the gauges until the directory has
 * it.
 *
 * The gauge directory follows the chain about a minute behind. After a
 * vote confirmed, Vote went back to the directory and showed the gauge
 * with its old total and its old, higher APY, as if nothing had been
 * signed. So what the vote changed is noted here as a change in votes per
 * gauge, with the block it was mined in, and laid over the directory
 * until the directory is from that block or later. Then the chain's own
 * figure takes over, which also counts everyone else's votes.
 *
 * Kept for the tab (sessionStorage, every access in try/catch), so a
 * reload within that minute shows the same, and dropped by age so a
 * directory without a block (fixtures) cannot carry it forever.
 */

export type SignedVote = {
  /** Lower-case address that signed it. */
  wallet: string
  /** The block of the last signed step. */
  block: number
  /** Unix seconds when it confirmed. */
  at: number
  /** Gauge address (lower case) to the change in its votes, signed wei. */
  deltas: Record<string, string>
}

export const signedVotesStorageKey = "mbx-signed-votes"

/** Well past the directory's refresh: after this the note is dropped. */
const maxAgeSeconds = 20 * 60
const limit = 12

const key = (address: string): string => address.toLowerCase()

/**
 * What signing changes on each gauge: every lock's votes on this type's
 * voter go, and its new split (`picks`, in basis points of its power)
 * comes. Gauges left where they were are not listed.
 */
export function voteDeltas(
  locks: readonly Lock[],
  kind: GaugeKind,
  picks: readonly { address: string; bps: number }[],
): Map<string, bigint> {
  const deltas = new Map<string, bigint>()
  const add = (id: string, amount: bigint): void => {
    deltas.set(id, (deltas.get(id) ?? 0n) + amount)
  }
  for (const lock of locks) {
    for (const vote of lock.votes) {
      if (vote.gauge.voter !== voterOf[kind]) continue
      add(key(vote.gauge.address), -BigInt(vote.weight))
    }
    const power = BigInt(lock.votingPowerWei)
    for (const pick of picks) {
      add(key(pick.address), voteWeight(power, pick.bps))
    }
  }
  for (const [id, delta] of deltas) if (delta === 0n) deltas.delete(id)
  return deltas
}

/** USD prices of what votes are counted in; null when unknown. */
export type VotePrices = Record<VoteUnit, string | null>

/**
 * The APY at `votes`: the same incentives among more or fewer votes. A
 * gauge that had no votes had no APY to scale, so it is worked out from
 * its incentives and the price of a vote (incentives a week, 52 weeks).
 */
function apyBpsAt(
  gauge: GaugeSummary,
  votes: bigint,
  prices: VotePrices,
): number | null {
  if (votes <= 0n) return null
  const before = BigInt(gauge.votes)
  if (gauge.apyBps !== null && before > 0n) {
    return Number((BigInt(gauge.apyBps) * before) / votes)
  }
  const price = prices[gauge.votesUnit]
  const incentives = usdToMicro(gauge.incentivesUsd)
  if (price === null || incentives === 0n) return gauge.apyBps
  const priceMicro = usdToMicro(price)
  if (priceMicro === 0n) return gauge.apyBps
  return Number(
    (incentives * 52n * 10_000n * 10n ** 18n) / (votes * priceMicro),
  )
}

/** Whose locks are on screen, and the block they were read at. */
export type Viewing = { address: string; block?: number | undefined } | null

/**
 * The directory with the signed votes it does not have yet: each changed
 * gauge at its new total, with the APY that total gives. The same list
 * when there is nothing to add.
 *
 * A vote is added once the signer's locks on screen are from its block or
 * later. Vote draws a gauge as the directory's total, less the locks' own
 * votes, plus the ballot: with locks from before the vote that sum is
 * already right, and adding the vote would count it twice.
 */
export function withSignedVotes(
  list: GaugeList,
  signed: readonly SignedVote[],
  prices: VotePrices,
  viewing: Viewing,
): GaugeList {
  const pending = signed.filter(
    (vote) =>
      (list.block === undefined || vote.block > list.block) &&
      (viewing === null ||
        viewing.address.toLowerCase() !== vote.wallet ||
        (viewing.block !== undefined && viewing.block >= vote.block)),
  )
  if (pending.length === 0) return list
  const deltas = new Map<string, bigint>()
  for (const vote of pending) {
    for (const [id, delta] of Object.entries(vote.deltas)) {
      deltas.set(id, (deltas.get(id) ?? 0n) + BigInt(delta))
    }
  }
  let changed = false
  const gauges = list.gauges.map((gauge) => {
    const delta = deltas.get(key(gauge.address)) ?? 0n
    if (delta === 0n) return gauge
    const total = BigInt(gauge.votes) + delta
    const votes = total > 0n ? total : 0n
    changed = true
    return {
      ...gauge,
      votes: votes.toString(),
      apyBps: apyBpsAt(gauge, votes, prices),
    }
  })
  return changed ? { ...list, gauges } : list
}

const addressPattern = /^0x[0-9a-f]{40}$/
const deltaPattern = /^-?[0-9]{1,60}$/

function isSignedVote(value: unknown): value is SignedVote {
  if (typeof value !== "object" || value === null) return false
  const wallet: unknown = Reflect.get(value, "wallet")
  const block: unknown = Reflect.get(value, "block")
  const at: unknown = Reflect.get(value, "at")
  const deltas: unknown = Reflect.get(value, "deltas")
  return (
    typeof wallet === "string" &&
    addressPattern.test(wallet) &&
    typeof block === "number" &&
    Number.isSafeInteger(block) &&
    block > 0 &&
    typeof at === "number" &&
    Number.isFinite(at) &&
    typeof deltas === "object" &&
    deltas !== null &&
    Object.entries(deltas).every(
      ([id, delta]) =>
        addressPattern.test(id) &&
        typeof delta === "string" &&
        deltaPattern.test(delta),
    )
  )
}

/** Reads a stored list without trusting it. */
export function parseSignedVotes(raw: string | null): SignedVote[] {
  if (raw === null) return []
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return []
  }
  return Array.isArray(value) ? value.filter(isSignedVote).slice(0, limit) : []
}

/** Drops what is too old to still be ahead of the directory. */
export function prunedVotes(
  list: readonly SignedVote[],
  now: number,
): SignedVote[] {
  return list.filter((vote) => now - vote.at <= maxAgeSeconds)
}

const none: readonly SignedVote[] = []
let current: readonly SignedVote[] | null = null
const listeners = new Set<() => void>()

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage
  } catch {
    return null
  }
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000)
}

export function getSignedVotes(): readonly SignedVote[] {
  if (current !== null) return current
  try {
    current = prunedVotes(
      parseSignedVotes(storage()?.getItem(signedVotesStorageKey) ?? null),
      nowSeconds(),
    )
  } catch {
    current = none
  }
  return current
}

/** A vote was signed and mined in `block`. */
export function noteSignedVote(vote: {
  wallet: string
  block: bigint | number
  deltas: ReadonlyMap<string, bigint>
}): void {
  const block = Number(vote.block)
  const wallet = vote.wallet.toLowerCase()
  if (
    !Number.isSafeInteger(block) ||
    block <= 0 ||
    vote.deltas.size === 0 ||
    !addressPattern.test(wallet)
  ) {
    return
  }
  const now = nowSeconds()
  current = prunedVotes(
    [
      {
        wallet,
        block,
        at: now,
        deltas: Object.fromEntries(
          [...vote.deltas].map(([id, delta]) => [id, delta.toString()]),
        ),
      },
      ...getSignedVotes(),
    ],
    now,
  ).slice(0, limit)
  try {
    storage()?.setItem(signedVotesStorageKey, JSON.stringify(current))
  } catch {
    // Kept for this page only.
  }
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Empty on the server and during hydration. */
export function useSignedVotes(): readonly SignedVote[] {
  return useSyncExternalStore(subscribe, getSignedVotes, () => none)
}

/** For tests: read storage again. */
export function resetSignedVotes(): void {
  current = null
  for (const listener of listeners) listener()
}
