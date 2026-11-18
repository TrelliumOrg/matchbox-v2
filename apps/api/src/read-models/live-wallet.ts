import {
  BOOST_VOTER_ABI,
  BRIBE_ABI,
  CONTRACTS,
  POOLS_VOTER_ABI,
  THIRD_PARTY_VOTER_ABI,
  VALIDATORS_VOTER_ABI,
  VOTING_ESCROW_ABI,
} from "@matchbox/chain"
import type { VoterKind } from "@matchbox/contracts/market"
import {
  type Escrow,
  type GaugeRef,
  gaugeKindFor,
  type Prices,
  type TokenAmount,
  type WalletActivity,
  type WalletLock,
  type WalletOverview,
  type WalletRewards,
} from "@matchbox/contracts/read-models"
import { EPOCH_SECONDS, epochStartOf } from "@matchbox/domain"
import { getAddress, type PublicClient, zeroAddress } from "viem"
import { epochRef } from "./gauges"
import {
  btcToken,
  currentPrice,
  fromRaw,
  knownTokens,
  mergeTokenAmounts,
  mezoToken,
  priceBreakdown,
  usdValue,
} from "./money"
import {
  type GaugeCards,
  projectLockRewards,
  suggestFor,
  totalProjected,
  votesByVoter,
} from "./wallet-extras"

// A wallet overview straight from Mezo RPC, for addresses the warehouse
// sweep has not reached yet: the locks the wallet owns in veBTC and veMEZO,
// their current votes, and what each can claim (`earned` on the bribe and
// fee contracts of the gauges it votes for). No history: activity is empty
// until the next warehouse snapshot picks the wallet up.

/** Locks read per escrow; wallets with more show the first ones. */
export const maxLiveLocksPerEscrow = 50

export type LiveVote = { gauge: string; voter: VoterKind; weight: bigint }

export type LiveLock = {
  escrow: Escrow
  tokenId: string
  amount: bigint
  /** Unlock time, unix seconds; 0 for permanent locks. */
  end: number
  isPermanent: boolean
  votingPower: bigint
  votes: LiveVote[]
  lastVotedAt: number
  /** `lastVoted` on each voter the lock has weight on. */
  lastVoted?: { voter: VoterKind; at: number }[]
  /** Claimable per gauge and token, base units. */
  earned: { gauge: string; token: string; amount: bigint }[]
}

export type LiveWalletSnapshot = { block: number; locks: LiveLock[] }

export type LiveWalletReader = (
  address: string,
  cards: GaugeCards,
) => Promise<LiveWalletSnapshot>

const escrowAddress: Record<Escrow, `0x${string}`> = {
  vebtc: CONTRACTS.mainnet.veBTC,
  vemezo: CONTRACTS.mainnet.veMEZO,
}

const lockToken: Record<Escrow, string> = {
  vebtc: btcToken,
  vemezo: mezoToken,
}

/** veMEZO votes on boost and third-party gauges; veBTC on the rest. */
const votersOf: Record<Escrow, readonly VoterKind[]> = {
  vemezo: ["boost", "third-party"],
  vebtc: ["pools", "validators"],
}

const voterContracts = {
  boost: { address: CONTRACTS.mainnet.boostVoter, abi: BOOST_VOTER_ABI },
  pools: { address: CONTRACTS.mainnet.poolsVoter, abi: POOLS_VOTER_ABI },
  validators: {
    address: CONTRACTS.mainnet.validatorsVoter,
    abi: VALIDATORS_VOTER_ABI,
  },
  "third-party": {
    address: CONTRACTS.mainnet.thirdPartyVoter,
    abi: THIRD_PARTY_VOTER_ABI,
  },
} as const

type CallResult = { status: "success"; result: unknown } | { status: "failure" }

function bigintOf(result: CallResult | undefined): bigint | null {
  return result?.status === "success" && typeof result.result === "bigint"
    ? result.result
    : null
}

function addressOf(result: CallResult | undefined): string | null {
  if (result?.status !== "success" || typeof result.result !== "string") {
    return null
  }
  const value = result.result.toLowerCase()
  return value === zeroAddress ? null : value
}

/** The `locked()` tuple: amount, end, isPermanent (boost ignored). */
function lockedOf(
  result: CallResult | undefined,
): { amount: bigint; end: bigint; isPermanent: boolean } | null {
  return result?.status === "success" ? lockedTuple(result.result) : null
}

/** `locked()` as decoded by viem; null for anything else. */
export function lockedTuple(
  value: unknown,
): { amount: bigint; end: bigint; isPermanent: boolean } | null {
  if (typeof value !== "object" || value === null) return null
  const amount = Reflect.get(value, "amount")
  const end = Reflect.get(value, "end")
  const isPermanent = Reflect.get(value, "isPermanent")
  if (
    typeof amount !== "bigint" ||
    typeof end !== "bigint" ||
    typeof isPermanent !== "boolean"
  ) {
    return null
  }
  return { amount: amount < 0n ? 0n : amount, end, isPermanent }
}

/** Reads a wallet's locks, votes and claimable from Mezo RPC at one block. */
export function createLiveWalletReader(client: PublicClient): LiveWalletReader {
  return async function readLiveWallet(address, cards) {
    const owner = getAddress(address)
    const blockNumber = await client.getBlockNumber()
    const at = { blockNumber, allowFailure: true } as const
    const escrows: Escrow[] = ["vebtc", "vemezo"]

    const counts = await client.multicall({
      ...at,
      contracts: escrows.map((escrow) => ({
        address: escrowAddress[escrow],
        abi: VOTING_ESCROW_ABI,
        functionName: "balanceOf" as const,
        args: [owner] as const,
      })),
    })
    const indexCalls = escrows.flatMap((escrow, position) => {
      const count = bigintOf(counts[position]) ?? 0n
      const limit = Math.min(Number(count), maxLiveLocksPerEscrow)
      return Array.from({ length: limit }, (_, index) => ({
        escrow,
        index: BigInt(index),
      }))
    })
    if (indexCalls.length === 0) {
      return { block: Number(blockNumber), locks: [] }
    }
    const ids = await client.multicall({
      ...at,
      contracts: indexCalls.map((call) => ({
        address: escrowAddress[call.escrow],
        abi: VOTING_ESCROW_ABI,
        functionName: "ownerToNFTokenIdList" as const,
        args: [owner, call.index] as const,
      })),
    })
    const tokens = indexCalls.flatMap((call, position) => {
      const id = bigintOf(ids[position])
      return id === null || id === 0n ? [] : [{ escrow: call.escrow, id }]
    })
    const details = await client.multicall({
      ...at,
      contracts: tokens.flatMap((token) => [
        {
          address: escrowAddress[token.escrow],
          abi: VOTING_ESCROW_ABI,
          functionName: "locked" as const,
          args: [token.id] as const,
        },
        {
          address: escrowAddress[token.escrow],
          abi: VOTING_ESCROW_ABI,
          functionName: "votingPowerOfNFT" as const,
          args: [token.id] as const,
        },
      ]),
    })

    // Which voters each lock has weight on (usedWeights > 0), and when.
    const usage = tokens.flatMap((token) =>
      votersOf[token.escrow].map((voter) => ({ token, voter })),
    )
    const usageResults = await Promise.all(
      usage.map((entry) =>
        client.multicall({
          ...at,
          contracts: [
            {
              ...voterContracts[entry.voter],
              functionName: "usedWeights",
              args: [entry.token.id],
            },
            {
              ...voterContracts[entry.voter],
              functionName: "lastVoted",
              args: [entry.token.id],
            },
          ],
        }),
      ),
    )
    const active = usage.flatMap((entry, position) => {
      const [used, last] = usageResults[position] ?? []
      const weight = bigintOf(used) ?? 0n
      return weight > 0n
        ? [{ ...entry, lastVotedAt: Number(bigintOf(last) ?? 0n) }]
        : []
    })

    // Pool votes are keyed by pool, the rest by gauge.
    const poolGauges = [...cards.values()]
      .filter((card) => card.gauge.voter === "pools")
      .map((card) => card.gauge.address)
    const poolOf = new Map<string, string>()
    if (active.some((entry) => entry.voter === "pools")) {
      const pools = await client.multicall({
        ...at,
        contracts: poolGauges.map((gauge) => ({
          ...voterContracts.pools,
          functionName: "poolForGauge" as const,
          args: [getAddress(gauge)] as const,
        })),
      })
      poolGauges.forEach((gauge, position) => {
        const pool = addressOf(pools[position])
        if (pool !== null) poolOf.set(gauge, pool)
      })
    }
    const voteChecks = active.flatMap((entry) =>
      [...cards.values()]
        .filter((card) => card.gauge.voter === entry.voter)
        .flatMap((card) => {
          const target =
            entry.voter === "pools"
              ? poolOf.get(card.gauge.address)
              : card.gauge.address
          return target === undefined
            ? []
            : [{ ...entry, gauge: card.gauge.address, target }]
        }),
    )
    const voteResults = await Promise.all(
      (["boost", "pools", "validators", "third-party"] as const).map(
        (voter) => {
          const checks = voteChecks.filter((check) => check.voter === voter)
          if (checks.length === 0) return Promise.resolve([])
          return client.multicall({
            ...at,
            contracts: checks.map((check) => ({
              ...voterContracts[voter],
              functionName: "votes" as const,
              args: [check.token.id, getAddress(check.target)] as const,
            })),
          })
        },
      ),
    )
    const votes = (["boost", "pools", "validators", "third-party"] as const)
      .flatMap((voter, voterIndex) =>
        voteChecks
          .filter((check) => check.voter === voter)
          .map((check, position) => ({
            check,
            weight: bigintOf(voteResults[voterIndex]?.[position]) ?? 0n,
          })),
      )
      .filter((vote) => vote.weight > 0n)

    // Claimable: earned() on the bribe (and fee) contract of every voted
    // gauge, for every token the read models know.
    const votedGauges = [
      ...new Map(
        votes.map((vote) => [vote.check.gauge, vote.check.voter]),
      ).entries(),
    ]
    const rewardContracts = await Promise.all(
      votedGauges.map(([gauge, voter]) =>
        client.multicall({
          ...at,
          contracts:
            voter === "pools"
              ? [
                  {
                    ...voterContracts.pools,
                    functionName: "gaugeToBribe" as const,
                    args: [getAddress(gauge)] as const,
                  },
                  {
                    ...voterContracts.pools,
                    functionName: "gaugeToFees" as const,
                    args: [getAddress(gauge)] as const,
                  },
                ]
              : [
                  {
                    ...voterContracts[voter],
                    functionName: "gaugeToBribe" as const,
                    args: [getAddress(gauge)] as const,
                  },
                ],
        }),
      ),
    )
    const sources = votedGauges.flatMap(([gauge], position) =>
      (rewardContracts[position] ?? []).flatMap((result) => {
        const contract = addressOf(result)
        return contract === null ? [] : [{ gauge, contract }]
      }),
    )
    const earnedChecks = votes.flatMap((vote) =>
      sources
        .filter((source) => source.gauge === vote.check.gauge)
        .flatMap((source) =>
          Object.keys(knownTokens).map((token) => ({
            tokenId: vote.check.token.id,
            gauge: source.gauge,
            contract: source.contract,
            token,
          })),
        ),
    )
    const earned =
      earnedChecks.length === 0
        ? []
        : await client.multicall({
            ...at,
            contracts: earnedChecks.map((check) => ({
              address: getAddress(check.contract),
              abi: BRIBE_ABI,
              functionName: "earned" as const,
              args: [getAddress(check.token), check.tokenId] as const,
            })),
          })

    const locks = tokens.flatMap((token, position): LiveLock[] => {
      const locked = lockedOf(details[position * 2])
      if (locked === null) return []
      const lockVotes = votes.filter((vote) => vote.check.token.id === token.id)
      return [
        {
          escrow: token.escrow,
          tokenId: token.id.toString(),
          amount: locked.amount,
          end: Number(locked.end),
          isPermanent: locked.isPermanent,
          votingPower: bigintOf(details[position * 2 + 1]) ?? 0n,
          votes: lockVotes.map((vote) => ({
            gauge: vote.check.gauge,
            voter: vote.check.voter,
            weight: vote.weight,
          })),
          lastVotedAt: Math.max(
            0,
            ...active
              .filter((entry) => entry.token.id === token.id)
              .map((entry) => entry.lastVotedAt),
          ),
          lastVoted: active
            .filter((entry) => entry.token.id === token.id)
            .map((entry) => ({ voter: entry.voter, at: entry.lastVotedAt })),
          earned: earnedChecks.flatMap((check, index) => {
            const amount = bigintOf(earned[index])
            return check.tokenId === token.id && amount !== null && amount > 0n
              ? [{ gauge: check.gauge, token: check.token, amount }]
              : []
          }),
        },
      ]
    })
    return { block: Number(blockNumber), locks }
  }
}

export type LiveWalletDocuments = {
  overview: WalletOverview
  rewards: WalletRewards
  activity: WalletActivity
}

function unknownGauge(address: string, voter: VoterKind): GaugeRef {
  return {
    address,
    voter,
    kind: gaugeKindFor(voter),
    name: `${address.slice(0, 6)}…${address.slice(-4)}`,
    vebtcTokenId: null,
    picture: { type: "initials", text: address.slice(2, 4).toUpperCase() },
    poolType: null,
    color: null,
    tickSpacing: null,
    coin: null,
  }
}

/** Allocations in basis points, the remainder on the largest share. */
function allocations(votes: readonly LiveVote[], cards: GaugeCards) {
  const total = votes.reduce((sum, vote) => sum + vote.weight, 0n)
  if (total === 0n) return []
  const entries = votes.map((vote) => ({
    gauge: cards.get(vote.gauge)?.gauge ?? unknownGauge(vote.gauge, vote.voter),
    basisPoints: Number((vote.weight * 10_000n) / total),
  }))
  entries.sort((a, b) => b.basisPoints - a.basisPoints)
  const assigned = entries.reduce((sum, entry) => sum + entry.basisPoints, 0)
  const [top] = entries
  if (top !== undefined) top.basisPoints += 10_000 - assigned
  return entries
}

/** Pure: the RPC snapshot into the three wallet documents. */
export function buildLiveWalletDocuments(input: {
  address: string
  snapshot: LiveWalletSnapshot
  cards: GaugeCards
  prices: Prices
  nowSeconds: number
}): LiveWalletDocuments {
  const { cards, prices, nowSeconds } = input
  const epoch = epochRef(epochStartOf(nowSeconds))
  const claimEpoch = epochRef(epochStartOf(nowSeconds) - EPOCH_SECONDS)
  const details = input.snapshot.locks.map((lock) => {
    const tokenAddress = lockToken[lock.escrow]
    const token = knownTokens[tokenAddress]
    if (token === undefined)
      throw new Error(`Unknown lock token ${tokenAddress}`)
    const amount = fromRaw(lock.amount, token.decimals)
    const price = currentPrice(tokenAddress, prices)
    const unlocksAt = lock.isPermanent || lock.end === 0 ? null : lock.end
    const expired = unlocksAt !== null && unlocksAt <= nowSeconds
    const totalVotes = lock.votes.reduce((sum, vote) => sum + vote.weight, 0n)
    const byGauge = new Map<string, TokenAmount[]>()
    for (const entry of lock.earned) {
      const rewardToken = knownTokens[entry.token]
      if (rewardToken === undefined) continue
      byGauge.set(entry.gauge, [
        ...(byGauge.get(entry.gauge) ?? []),
        {
          token: rewardToken,
          amount: fromRaw(entry.amount, rewardToken.decimals),
          usd: null,
        },
      ])
    }
    const gauges = [...byGauge.entries()].map(([gauge, amounts]) => {
      const voter =
        lock.votes.find((vote) => vote.gauge === gauge)?.voter ?? "boost"
      const priced = priceBreakdown(mergeTokenAmounts([amounts]), prices)
      return {
        gauge: cards.get(gauge)?.gauge ?? unknownGauge(gauge, voter),
        usd: priced.usd,
        tokens: priced.tokens,
      }
    })
    const claimable = priceBreakdown(
      mergeTokenAmounts(gauges.map((gauge) => gauge.tokens)),
      prices,
    )
    const walletLock: WalletLock = {
      escrow: lock.escrow,
      tokenId: lock.tokenId,
      tab: expired ? "expired" : lock.escrow,
      locked: {
        token,
        amount,
        usd: price === null ? null : usdValue(amount, price),
      },
      votingPower: fromRaw(lock.votingPower, 18),
      unlocksAt,
      isPermanent: lock.isPermanent,
      isWithdrawable: expired,
      vote:
        totalVotes > 0n
          ? {
              status: "voted",
              epoch,
              votes: fromRaw(totalVotes, 18),
              allocations: allocations(lock.votes, cards),
              votedAt: lock.lastVotedAt,
              byVoter: votesByVoter(
                lock.votes.map((vote) => ({
                  gauge:
                    cards.get(vote.gauge)?.gauge ??
                    unknownGauge(vote.gauge, vote.voter),
                  weight: vote.weight,
                })),
                (voter) =>
                  lock.lastVoted?.find((entry) => entry.voter === voter)?.at ??
                  lock.lastVotedAt,
              ),
            }
          : { status: "not-voted", epoch },
      claimable,
      projected: projectLockRewards(
        lock.votes.map((vote) => ({ gauge: vote.gauge, weight: vote.weight })),
        cards,
        prices,
      ),
      boost:
        lock.escrow === "vebtc"
          ? ([...cards.values()].find(
              (card) => card.gauge.vebtcTokenId === lock.tokenId,
            )?.boost ?? null)
          : null,
      createdAt: null,
    }
    return { lock: walletLock, gauges }
  })
  const locks = details.map((detail) => detail.lock)
  const claimable = priceBreakdown(
    mergeTokenAmounts(locks.map((lock) => lock.claimable.tokens)),
    prices,
  )
  const hasClaimable = claimable.tokens.length > 0
  const claimableEpoch = hasClaimable ? claimEpoch : null
  return {
    overview: {
      address: input.address,
      claimableEpoch,
      claimable,
      locks,
      projected: totalProjected(locks, prices),
      suggestion: suggestFor({ locks, cards, claimableEpoch, claimable }),
      recentActivity: [],
    },
    rewards: {
      address: input.address,
      epoch: claimableEpoch,
      readyToClaim: claimable,
      byLock: details
        .filter((detail) => detail.lock.claimable.tokens.length > 0)
        .map((detail) => ({
          lock: { escrow: detail.lock.escrow, tokenId: detail.lock.tokenId },
          rewards: detail.lock.claimable,
          gauges: detail.gauges,
        })),
      earned: { usd: "0.00", fromEpoch: null, toEpoch: null },
      history: [],
    },
    activity: { address: input.address, rows: [], nextCursor: null },
  }
}
