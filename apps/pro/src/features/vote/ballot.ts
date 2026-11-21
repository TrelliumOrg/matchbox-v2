import type {
  GaugeKind,
  GaugeSummary,
  Lock,
  VoterKind,
} from "../../data/view-models"

/**
 * The local ballot on Vote: gauge address to share in basis points, one
 * ballot per gauge type. Each type has its own voter contract (BoostVoter,
 * ThirdPartyVoter, ValidatorsVoter, PoolsVoter) and each voter gives a lock
 * its full voting power: lock #224 had 1,702,812 veMEZO on BoostVoter and
 * 1,451,855 on ThirdPartyVoter at once (`usedWeights`, read 12 Nov 2026).
 * So 100% is per type, never shared between two. Projection follows the
 * optimizer's pro-rata rule (see `@matchbox/domain` `projectAllocation`, and
 * the test that pins them together), in bigint micro-USD.
 */

export const totalBps = 10_000
const stepBps = 500

export type Ballot = ReadonlyMap<string, number>

const key = (address: string): string => address.toLowerCase()

/** The voter contract behind each gauge type. */
export const voterOf: Record<GaugeKind, VoterKind> = {
  vebtc: "boost",
  mezo: "third-party",
  validator: "validators",
  pool: "pools",
}

/**
 * The first lock's current split within one gauge type, the starting
 * ballot. The read model's `shareBps` is a share of all the lock's votes,
 * both of its voters together, so the shares here come from the weights
 * within the type. The rounding remainder goes to the largest share.
 */
export function ballotFromLock(locks: Locks, kind: GaugeKind): Ballot {
  const lock = asList(locks)[0] ?? null
  const votes = (lock?.votes ?? []).filter(
    (vote) => vote.gauge.voter === voterOf[kind],
  )
  let total = 0n
  for (const vote of votes) total += BigInt(vote.weight)
  const ballot = new Map<string, number>()
  if (total === 0n) return ballot
  let largest: string | null = null
  let largestWeight = -1n
  let given = 0
  for (const vote of votes) {
    const weight = BigInt(vote.weight)
    const bps = Number((weight * BigInt(totalBps)) / total)
    const id = key(vote.gauge.address)
    ballot.set(id, bps)
    given += bps
    if (weight > largestWeight) {
      largest = id
      largestWeight = weight
    }
  }
  if (largest !== null) {
    ballot.set(largest, (ballot.get(largest) ?? 0) + totalBps - given)
  }
  return ballot
}

export function allocated(ballot: Ballot): number {
  let sum = 0
  for (const share of ballot.values()) sum += share
  return sum
}

/** Picking takes what is left; with nothing left the picks share evenly. */
export function pick(ballot: Ballot, address: string): Ballot {
  const next = new Map(ballot)
  const left = totalBps - allocated(ballot)
  if (left > 0) {
    next.set(key(address), left)
    return next
  }
  next.set(key(address), 0)
  return splitEvenly(next)
}

export function unpick(ballot: Ballot, address: string): Ballot {
  const next = new Map(ballot)
  next.delete(key(address))
  return next
}

/**
 * Sets one share, 0 to 100% on its own. The total may go past 100% while
 * someone types; the band shows how far over and Review waits until it fits.
 */
export function setShare(ballot: Ballot, address: string, bps: number): Ballot {
  const next = new Map(ballot)
  next.set(key(address), Math.max(0, Math.min(Math.round(bps), totalBps)))
  return next
}

/** A ballot can be signed when it has picks and adds up to 100% or less. */
export function signable(ballot: Ballot): boolean {
  return ballot.size > 0 && allocated(ballot) <= totalBps
}

/** Equal shares in 5% steps, the remainder on the first picks. */
export function splitEvenly(ballot: Ballot): Ballot {
  const ids = [...ballot.keys()]
  if (ids.length === 0) return ballot
  const steps = totalBps / stepBps
  const base = Math.floor(steps / ids.length)
  let extra = steps - base * ids.length
  const next = new Map<string, number>()
  for (const id of ids) {
    next.set(id, (base + (extra > 0 ? 1 : 0)) * stepBps)
    if (extra > 0) extra -= 1
  }
  return next
}

export function sameBallot(left: Ballot, right: Ballot): boolean {
  if (left.size !== right.size) return false
  for (const [id, share] of left) if (right.get(id) !== share) return false
  return true
}

/** "1180.00" to 1180000000 micro-USD, exactly. */
export function usdToMicro(value: string): bigint {
  const [int = "0", fraction = ""] = value.split(".")
  return (
    BigInt(int) * 1_000_000n +
    BigInt(fraction.padEnd(6, "0").slice(0, 6) || "0")
  )
}

/** 8750000 micro-USD to "8.75" (cents, rounded half up). */
export function microToUsd(micro: bigint): string {
  const cents = (micro + 5_000n) / 10_000n
  return `${cents / 100n}.${(cents % 100n).toString().padStart(2, "0")}`
}

export type BallotGauge = {
  id: string
  /** Votes on the gauge from everyone but this lock. */
  competing: bigint
  incentivesMicro: bigint
  /** The server's funded flag (`GaugeSummary.funded`): dust is not. */
  funded: boolean
}

/** One lock, several (summed), or none. */
export type Locks = Lock | null | readonly Lock[]

function asList(locks: Locks): readonly Lock[] {
  if (locks === null) return []
  return Array.isArray(locks) ? locks : [locks as Lock]
}

/**
 * Whether the lock voted this epoch through this gauge type's voter, which
 * then refuses another vote until the next epoch. The other type's voter
 * is not affected. Without per-voter times, a vote on either counts.
 */
export function votedIn(
  lock: Pick<Lock, "votedThisEpoch" | "votedVoters">,
  kind: GaugeKind,
): boolean {
  return lock.votedVoters === undefined
    ? lock.votedThisEpoch
    : lock.votedVoters.includes(voterOf[kind])
}

/** Whether any of the locks holds votes on gauges of this type. */
export function votesIn(locks: Locks, kind: GaugeKind): boolean {
  return asList(locks).some((lock) =>
    lock.votes.some((vote) => vote.gauge.voter === voterOf[kind]),
  )
}

/**
 * The gauges of this type the locks hold votes on now, largest first: what
 * a new vote of the type replaces. A vote() call clears the lock's earlier
 * votes on that voter, so every one of these goes unless it is picked again.
 */
export function standingVotes(locks: Locks, kind: GaugeKind): string[] {
  const weights = new Map<string, { name: string; weight: bigint }>()
  for (const lock of asList(locks)) {
    for (const vote of lock.votes) {
      if (vote.gauge.voter !== voterOf[kind]) continue
      const id = key(vote.gauge.address)
      const known = weights.get(id)
      weights.set(id, {
        name: vote.gauge.name,
        weight: (known?.weight ?? 0n) + BigInt(vote.weight),
      })
    }
  }
  return [...weights.values()]
    .filter((vote) => vote.weight > 0n)
    .sort((left, right) =>
      left.weight === right.weight ? 0 : left.weight < right.weight ? 1 : -1,
    )
    .map((vote) => vote.name)
}

/** "Kiln Labs", "Kiln Labs, veBTC #604", "Kiln Labs and 2 more"; null for none. */
export function replacesLine(names: readonly string[]): string | null {
  const [first, second] = names
  if (first === undefined) return null
  if (second === undefined) return first
  return names.length === 2
    ? `${first}, ${second}`
    : `${first} and ${names.length - 1} more`
}

/** The locks' current votes per gauge, summed, in wei. */
export function ownVotes(locks: Locks): Map<string, bigint> {
  const own = new Map<string, bigint>()
  for (const lock of asList(locks)) {
    for (const vote of lock.votes) {
      const id = key(vote.gauge.address)
      own.set(id, (own.get(id) ?? 0n) + BigInt(vote.weight))
    }
  }
  return own
}

/** The locks' voting power, summed, in wei. */
export function powerOf(locks: Locks): bigint {
  let power = 0n
  for (const lock of asList(locks)) power += BigInt(lock.votingPowerWei)
  return power
}

/**
 * Splits a summed projection across the locks that vote it, pro rata to
 * their voting power (every lock votes the same split). The rounding
 * remainder goes to the largest lock, so the parts add up exactly.
 */
export function perLock(
  totalMicro: bigint,
  locks: readonly Lock[],
): Map<string, bigint> {
  const power = powerOf(locks)
  const parts = new Map<string, bigint>()
  if (power === 0n) {
    for (const lock of locks) parts.set(lock.tokenId, 0n)
    return parts
  }
  let given = 0n
  let largest: Lock | null = null
  for (const lock of locks) {
    const share = (totalMicro * BigInt(lock.votingPowerWei)) / power
    parts.set(lock.tokenId, share)
    given += share
    if (
      largest === null ||
      BigInt(lock.votingPowerWei) > BigInt(largest.votingPowerWei)
    ) {
      largest = lock
    }
  }
  if (largest !== null) {
    parts.set(
      largest.tokenId,
      (parts.get(largest.tokenId) ?? 0n) + totalMicro - given,
    )
  }
  return parts
}

export function ballotGauges(
  gauges: readonly GaugeSummary[],
  locks: Locks,
): BallotGauge[] {
  const own = ownVotes(locks)
  return gauges.map((gauge) => {
    const mine = own.get(key(gauge.address)) ?? 0n
    const total = BigInt(gauge.votes)
    return {
      id: key(gauge.address),
      competing: total > mine ? total - mine : 0n,
      incentivesMicro: usdToMicro(gauge.incentivesUsd),
      funded: gauge.funded,
    }
  })
}

/** Below one basis point of the voter's power, competing weight is floored. */
function floor(power: bigint): bigint {
  const unit = power / BigInt(totalBps)
  return unit > 0n ? unit : 1n
}

export type Projection = { total: bigint; perGauge: Map<string, bigint> }

export function project(
  gauges: readonly BallotGauge[],
  power: bigint,
  ballot: Ballot,
): Projection {
  const byId = new Map(gauges.map((gauge) => [gauge.id, gauge]))
  const minimum = floor(power)
  const perGauge = new Map<string, bigint>()
  let total = 0n
  for (const [id, bps] of ballot) {
    const gauge = byId.get(id)
    const weight = (power * BigInt(bps)) / BigInt(totalBps)
    if (gauge === undefined || weight <= 0n) {
      perGauge.set(id, 0n)
      continue
    }
    // biome-ignore lint/complexity/useMathMinMax: bigint, Math.max cannot take it
    const competing = gauge.competing > minimum ? gauge.competing : minimum
    const share = (gauge.incentivesMicro * weight) / (competing + weight)
    perGauge.set(id, share)
    total += share
  }
  return { total, perGauge }
}

/** The lock's votes on a gauge under this ballot, in wei. */
export function voteWeight(power: bigint, bps: number): bigint {
  return (power * BigInt(bps)) / BigInt(totalBps)
}
