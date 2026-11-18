import type { VoterKind } from "@matchbox/contracts/market"
import type {
  EpochRef,
  GaugeCard,
  GaugeDirectory,
  GaugeRef,
  Prices,
  Suggestion,
  TokenAmount,
  ValueBreakdown,
  VoterVote,
  WalletLock,
} from "@matchbox/contracts/read-models"
import {
  decimalToScaledBigInt,
  type IncentiveToken,
  nativeShares,
} from "@matchbox/domain"
import {
  fromRaw,
  mergeTokenAmounts,
  priceBreakdown,
  subtractUsd,
  toCents,
} from "./money"

// Pure helpers both wallet builders share (the jobs warehouse snapshot and
// the API's live path for wallets the sweep has not reached): projected
// rewards for the current epoch and the Overview suggestion.

/** Gauge cards by lower-case address. */
export type GaugeCards = ReadonlyMap<string, GaugeCard>

export function gaugeCardsFrom(directory: GaugeDirectory | null): GaugeCards {
  return new Map(
    (directory?.gauges ?? []).map((card) => [card.gauge.address, card]),
  )
}

/** One of a lock's current votes, in base units (18 decimals). */
export type LockVoteWeight = { gauge: string; weight: bigint }

function asAddress(value: string): `0x${string}` {
  if (!value.startsWith("0x")) throw new Error(`Not an address: ${value}`)
  return `0x${value.slice(2)}`
}

/**
 * What a lock's votes earn when the epoch ends at today's incentives and
 * votes: each incentive token times the lock's share of the gauge's votes
 * (`nativeShares` with the rest of the gauge's votes as competition).
 * Null when the lock has not voted.
 */
export function projectLockRewards(
  votes: readonly LockVoteWeight[],
  cards: GaugeCards,
  prices: Prices,
): ValueBreakdown | null {
  const voted = votes.filter((vote) => vote.weight > 0n)
  if (voted.length === 0) return null
  const groups: TokenAmount[][] = []
  for (const vote of voted) {
    const card = cards.get(vote.gauge.toLowerCase())
    if (card === undefined) continue
    const gaugeVotes = decimalToScaledBigInt(card.votes, 18)
    const competing = gaugeVotes > vote.weight ? gaugeVotes - vote.weight : 0n
    const incentives: IncentiveToken[] = card.incentives.tokens.map(
      (entry) => ({
        contract: asAddress(card.gauge.address),
        token: asAddress(entry.token.address),
        symbol: entry.token.symbol,
        decimals: entry.token.decimals,
        amount: decimalToScaledBigInt(entry.amount, entry.token.decimals),
      }),
    )
    const shares = nativeShares({
      incentives,
      voteWeight: vote.weight,
      competing,
    })
    groups.push(
      shares.flatMap((share) => {
        const token = card.incentives.tokens.find(
          (entry) => entry.token.address === share.token.toLowerCase(),
        )?.token
        if (token === undefined || share.amount === 0n) return []
        return [
          {
            token,
            amount: fromRaw(share.amount, token.decimals),
            usd: null,
          },
        ]
      }),
    )
  }
  return priceBreakdown(mergeTokenAmounts(groups), prices)
}

/** Sums the locks' projections; null when no lock has one. */
export function totalProjected(
  locks: readonly { projected: ValueBreakdown | null }[],
  prices: Prices,
): ValueBreakdown | null {
  const projected = locks.flatMap((lock) =>
    lock.projected === null ? [] : [lock.projected.tokens],
  )
  if (projected.length === 0) return null
  return priceBreakdown(mergeTokenAmounts(projected), prices)
}

/** Boosts at or above this, and below 5, count as close to 5x. */
const nearMaxBoost = "4"

function isNearMax(boost: string): boolean {
  return toCents(boost) >= toCents(nearMaxBoost) && toCents(boost) < 500n
}

/** Claims under a dollar are not worth a banner. */
const minimumClaimUsd = "1.00"

/**
 * The one Overview suggestion, most urgent first: withdraw an expired lock,
 * vote with unused power, top up a near-5x boost gauge the wallet votes
 * for, or claim. Null when nothing applies.
 */
export function suggestFor(input: {
  locks: readonly WalletLock[]
  cards: GaugeCards
  claimableEpoch: EpochRef | null
  claimable: ValueBreakdown
}): Suggestion | null {
  const withdrawable = input.locks.find((lock) => lock.isWithdrawable)
  if (withdrawable !== undefined) {
    return {
      type: "withdraw",
      lock: { escrow: withdrawable.escrow, tokenId: withdrawable.tokenId },
      amount: withdrawable.locked,
    }
  }
  const idle = input.locks.find(
    (lock) =>
      lock.tab !== "expired" &&
      lock.vote.status === "not-voted" &&
      toCents(lock.votingPower) > 0n,
  )
  if (idle !== undefined) {
    return {
      type: "vote",
      lock: { escrow: idle.escrow, tokenId: idle.tokenId },
      epoch: idle.vote.epoch,
      votingPower: idle.votingPower,
    }
  }
  let best: Suggestion | null = null
  for (const lock of input.locks) {
    if (lock.escrow !== "vemezo" || lock.vote.status !== "voted") continue
    for (const allocation of lock.vote.allocations) {
      const card = input.cards.get(allocation.gauge.address)
      if (
        card?.boost === null ||
        card?.boost === undefined ||
        card.optimalVotes === null ||
        !isNearMax(card.boost)
      ) {
        continue
      }
      const missing = subtractUsd(card.optimalVotes, card.votes)
      if (toCents(missing) <= 0n) continue
      if (
        best?.type === "boost" &&
        toCents(best.boost) >= toCents(card.boost)
      ) {
        continue
      }
      best = {
        type: "boost",
        gauge: card.gauge,
        lock: { escrow: lock.escrow, tokenId: lock.tokenId },
        boost: card.boost,
        votes: card.votes,
        optimalVotes: card.optimalVotes,
        missingVotes: wholeDifference(card.optimalVotes, card.votes),
      }
    }
  }
  if (best !== null) return best
  if (
    input.claimableEpoch !== null &&
    input.claimable.tokens.length > 0 &&
    toCents(input.claimable.usd) >= toCents(minimumClaimUsd)
  ) {
    return {
      type: "claim",
      epoch: input.claimableEpoch,
      claimable: input.claimable,
    }
  }
  return null
}

/** `left - right` for non-negative whole-unit decimals, exact. */
function wholeDifference(left: string, right: string): string {
  const difference =
    decimalToScaledBigInt(left, 18) - decimalToScaledBigInt(right, 18)
  return fromRaw(difference < 0n ? 0n : difference, 18)
}

const voterOrder: readonly VoterKind[] = [
  "boost",
  "third-party",
  "validators",
  "pools",
]

/**
 * A lock's votes per voter contract. Each voter spends the lock's full
 * voting power, so the shares are of that voter's votes (they add up to
 * 10000 per voter, the rounding remainder on the largest), and each has
 * its own last vote.
 */
export function votesByVoter(
  entries: readonly { gauge: GaugeRef; weight: bigint }[],
  votedAt: (voter: VoterKind) => number,
): VoterVote[] {
  return voterOrder.flatMap((voter) => {
    const own = entries.filter(
      (entry) => entry.gauge.voter === voter && entry.weight > 0n,
    )
    const total = own.reduce((sum, entry) => sum + entry.weight, 0n)
    if (total === 0n) return []
    const allocations = own
      .map((entry) => ({
        gauge: entry.gauge,
        basisPoints: Number((entry.weight * 10_000n) / total),
        weight: entry.weight,
      }))
      .sort((left, right) =>
        left.weight === right.weight ? 0 : left.weight > right.weight ? -1 : 1,
      )
    const assigned = allocations.reduce(
      (sum, entry) => sum + entry.basisPoints,
      0,
    )
    const [top] = allocations
    if (top !== undefined) top.basisPoints += 10_000 - assigned
    return [
      {
        voter,
        votes: fromRaw(total, 18),
        allocations: allocations.map(({ gauge, basisPoints }) => ({
          gauge,
          basisPoints,
        })),
        votedAt: votedAt(voter),
      },
    ]
  })
}
