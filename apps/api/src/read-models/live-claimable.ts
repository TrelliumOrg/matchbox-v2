import { BRIBE_ABI, CONTRACTS } from "@matchbox/chain"
import type { VoterKind } from "@matchbox/contracts/market"
import type {
  Escrow,
  Prices,
  WalletOverview,
  WalletRewards,
} from "@matchbox/contracts/read-models"
import { type Abi, getAddress, type PublicClient, parseAbi } from "viem"
import {
  buildLiveWalletDocuments,
  type LiveLock,
  type LiveVote,
} from "./live-wallet"
import { knownTokens, mergeTokenAmounts, priceBreakdown } from "./money"
import type { GaugeCards } from "./wallet-extras"

// Claimable, read from the chain for the one wallet being looked at.
//
// A wallet's stored documents are built by the jobs worker's sweep, which
// takes hours to come round and reads from a rate-limited public RPC: on
// 12 Nov 2026 a wallet showed $34 on a lock that had 1,124 MUSD of pool
// fees to claim, and stayed that way through several runs. Claimable is a
// live figure. A page view needs it for one wallet, which is a handful of
// requests, not a sweep of 4,645.
//
// So the two wallet routes lay a live read over the stored document:
// each lock's current votes (`gaugeVote` / `poolVote`), those gauges'
// reward contracts (`gaugeToBribe`, and `gaugeToFees` for a pool), and
// `earned` for every token the read models know. Everything else in the
// document stays as stored.
//
// A read that fails, or runs past its deadline, changes nothing: the
// stored figure is served and the response says it is the stored one,
// with its block. It never becomes zero.

/**
 * A page view waits this long for the chain on a cache miss, then serves
 * the stored figures. Measured on 13 Nov 2026 (5 runs each, Mezo's three
 * public RPCs): a wallet's live lock read takes 0.2 to 0.3 s for one lock
 * and 0.6 to 0.9 s for 41 locks (five requests in turn), 1.26 s at worst
 * on a fallback; one request, 0.25 s at worst on the primary and 0.7 s on
 * a fallback. Four seconds is three times the worst whole read, and holds
 * a page for at most four seconds when the RPC hangs.
 */
export const claimableDeadlineMs = 4_000

/**
 * `earned` calls one view may cost. Past it the largest locks (by voting
 * power) are read live and the rest keep their stored figure; the response
 * says so (`claimableAsOf.partial`). Six requests at most.
 */
export const maxEarnedCallsPerView = 240
const earnedCallsPerRequest = 40

/** Vote slots asked for per lock and voter in the first request. */
const firstSlots = 4
/** A voter takes at most this many gauges per lock (`maxVotingNum`). */
const maxSlots = 30
/** Locks whose votes one view reads. */
const maxLocksPerView = 60

const voters: Record<VoterKind, `0x${string}`> = {
  boost: CONTRACTS.mainnet.boostVoter,
  pools: CONTRACTS.mainnet.poolsVoter,
  validators: CONTRACTS.mainnet.validatorsVoter,
  "third-party": CONTRACTS.mainnet.thirdPartyVoter,
}

const votersOf: Record<Escrow, readonly VoterKind[]> = {
  vemezo: ["boost", "third-party"],
  vebtc: ["validators", "pools"],
}

const voterAbi = parseAbi([
  "function gaugeVote(uint256 tokenId, uint256 index) view returns (address)",
  "function poolVote(uint256 tokenId, uint256 index) view returns (address)",
  "function gauges(address pool) view returns (address)",
  "function gaugeToBribe(address gauge) view returns (address)",
  "function gaugeToFees(address gauge) view returns (address)",
])

const multicallAbi = parseAbi([
  "function getBlockNumber() view returns (uint256)",
])
const multicall3 = "0xcA11bde05977b3631167028862bE2a173976CA11"
const zero = "0x0000000000000000000000000000000000000000"

export type Call = {
  address: `0x${string}`
  abi: Abi
  functionName: string
  args?: readonly unknown[]
}

/** The lock, as `${escrow}:${tokenId}`. */
export function lockKey(lock: { escrow: Escrow; tokenId: string }): string {
  return `${lock.escrow}:${lock.tokenId}`
}

export type LiveClaimable = {
  block: number
  /** The locks read, with what each can claim per gauge and token. */
  locks: LiveLock[]
  /** Locks left on their stored figure by `maxEarnedCallsPerView`. */
  partial: boolean
}

export type LiveClaimableReader = (
  overview: WalletOverview,
  deadline: number,
) => Promise<LiveClaimable>

export type ClaimableTiming = {
  wait: (ms: number) => Promise<void>
  now: () => number
}

const realTiming: ClaimableTiming = {
  wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now: () => Date.now(),
}

/** Thrown when the chain did not answer in time: the caller serves stored. */
export class ClaimableUnread extends Error {}

/** One RPC request's answer: the block it ran at, and each call's result. */
export type ChainAnswer = { block: bigint; results: unknown[] }

/** Sends calls as one RPC request, inside a deadline (unix ms). */
export type ChainRequest = (
  calls: readonly Call[],
  deadline: number,
) => Promise<ChainAnswer>

/** A call in an answered request that reverted or could not be decoded. */
export const lost: unique symbol = Symbol("lost")

/**
 * `work`, or ClaimableUnread once `ms` pass first. The work is not
 * stopped (viem takes no signal per call; the client's own timeout ends
 * it), only no longer waited for, and its late failure is swallowed.
 */
export function withinDeadline<T>(work: Promise<T>, ms: number): Promise<T> {
  if (ms <= 0) {
    work.catch(() => undefined)
    return Promise.reject(new ClaimableUnread("Past the deadline"))
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new ClaimableUnread("The chain did not answer in time")),
      ms,
    )
  })
  return Promise.race([work, late]).finally(() => {
    clearTimeout(timer)
    work.catch(() => undefined)
  })
}

export type ChainRequestOptions = {
  /** Requests sent before the read is given up (2: one retry). */
  attempts?: number
}

/**
 * One RPC request. Every request carries Multicall3's `getBlockNumber`
 * first: a call that cannot revert. If it failed, the request did (a
 * throttled RPC, or a fallback endpoint that refuses the batch), which a
 * request full of legitimately reverting calls (a vote slot past the end
 * of the list) cannot otherwise be told from. A failed request is asked
 * once more after a short pause, inside the deadline; then the read is
 * given up, never taken as an answer.
 *
 * Each request is raced against the deadline: an RPC that never answers
 * (the client allows 15 s per endpoint, a retry and fallbacks) gives the
 * read up at the deadline instead of holding the page.
 */
export function createChainRequest(
  client: PublicClient,
  timing: ClaimableTiming = realTiming,
  options: ChainRequestOptions = {},
): ChainRequest {
  const attempts = options.attempts ?? 2
  return async function request(calls, deadline) {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (timing.now() >= deadline) break
      if (attempt > 0) await timing.wait(150)
      const results = await withinDeadline(
        client.multicall({
          allowFailure: true,
          batchSize: 0,
          contracts: [
            {
              address: multicall3,
              abi: multicallAbi,
              functionName: "getBlockNumber",
            },
            ...calls,
          ],
        }),
        deadline - timing.now(),
      ).catch(() => null)
      const [probe, ...rest] = results ?? []
      if (probe?.status === "success" && typeof probe.result === "bigint") {
        return {
          block: probe.result,
          results: rest.map((result): unknown =>
            result.status === "success" ? result.result : lost,
          ),
        }
      }
    }
    throw new ClaimableUnread("The chain did not answer in time")
  }
}

/**
 * Sends `calls` as few requests as fit `perRequest`, together. The block is
 * the earliest any of them ran at.
 */
export async function askChain(
  request: ChainRequest,
  calls: readonly Call[],
  deadline: number,
  perRequest: number,
): Promise<ChainAnswer> {
  const slices: Call[][] = []
  for (let start = 0; start < calls.length; start += perRequest) {
    slices.push(calls.slice(start, start + perRequest))
  }
  const answers = await Promise.all(
    slices.map((slice) => request(slice, deadline)),
  )
  let block: bigint | null = null
  for (const answer of answers) {
    if (block === null || answer.block < block) block = answer.block
  }
  if (block === null) throw new ClaimableUnread("Nothing was asked")
  return { block, results: answers.flatMap((answer) => answer.results) }
}

export function createLiveClaimableReader(
  client: PublicClient,
  timing: ClaimableTiming = realTiming,
): LiveClaimableReader {
  const request = createChainRequest(client, timing)

  return async function readLiveClaimable(overview, deadline) {
    // The largest locks first: they are what the bound keeps.
    const locks = [...overview.locks]
      .sort(
        (left, right) => Number(right.votingPower) - Number(left.votingPower),
      )
      .slice(0, maxLocksPerView)
    const pairs = locks.flatMap((lock) =>
      votersOf[lock.escrow].map((voter) => ({ lock, voter })),
    )
    const slotCall = (pair: (typeof pairs)[number], index: number): Call => ({
      address: voters[pair.voter],
      abi: voterAbi,
      functionName: pair.voter === "pools" ? "poolVote" : "gaugeVote",
      args: [BigInt(pair.lock.tokenId), BigInt(index)],
    })

    // 1. What each lock votes now: the first slots of every lock and voter.
    const first = await request(
      pairs.flatMap((pair) =>
        Array.from({ length: firstSlots }, (_, index) => slotCall(pair, index)),
      ),
      deadline,
    )
    const targets = new Map<(typeof pairs)[number], string[]>()
    pairs.forEach((pair, position) => {
      const found: string[] = []
      for (let index = 0; index < firstSlots; index += 1) {
        const result = first.results[position * firstSlots + index]
        if (typeof result !== "string") break
        found.push(result.toLowerCase())
      }
      targets.set(pair, found)
    })
    // A lock that filled every first slot may vote more gauges.
    const more = pairs.filter(
      (pair) => targets.get(pair)?.length === firstSlots,
    )
    if (more.length > 0) {
      const span = maxSlots - firstSlots
      const rest = await request(
        more.flatMap((pair) =>
          Array.from({ length: span }, (_, index) =>
            slotCall(pair, firstSlots + index),
          ),
        ),
        deadline,
      )
      more.forEach((pair, position) => {
        const found = targets.get(pair) ?? []
        for (let index = 0; index < span; index += 1) {
          const result = rest.results[position * span + index]
          if (typeof result !== "string") break
          found.push(result.toLowerCase())
        }
      })
    }

    // 2. PoolsVoter votes name the pool: its gauge.
    const pools = [
      ...new Set(
        pairs.flatMap((pair) =>
          pair.voter === "pools" ? (targets.get(pair) ?? []) : [],
        ),
      ),
    ]
    const gaugeOfPool = new Map<string, string>()
    if (pools.length > 0) {
      const read = await request(
        pools.map((pool) => ({
          address: voters.pools,
          abi: voterAbi,
          functionName: "gauges",
          args: [getAddress(pool)],
        })),
        deadline,
      )
      pools.forEach((pool, index) => {
        const result = read.results[index]
        if (result === lost) throw new ClaimableUnread("A pool's gauge")
        if (typeof result === "string" && result !== zero) {
          gaugeOfPool.set(pool, result.toLowerCase())
        }
      })
    }
    const votesOf = new Map<string, LiveVote[]>()
    for (const pair of pairs) {
      const key = lockKey(pair.lock)
      const votes = votesOf.get(key) ?? []
      for (const target of targets.get(pair) ?? []) {
        const gauge = pair.voter === "pools" ? gaugeOfPool.get(target) : target
        // The weight is not shown from here: only where the lock votes.
        if (gauge !== undefined)
          votes.push({ gauge, voter: pair.voter, weight: 1n })
      }
      votesOf.set(key, votes)
    }

    // 3. Each voted gauge's reward contracts.
    const voted = new Map<string, VoterKind>()
    for (const votes of votesOf.values()) {
      for (const vote of votes) voted.set(vote.gauge, vote.voter)
    }
    const lookups = [...voted].flatMap(([gauge, voter]) =>
      (voter === "pools"
        ? ["gaugeToBribe", "gaugeToFees"]
        : ["gaugeToBribe"]
      ).map((functionName) => ({ gauge, voter, functionName })),
    )
    const contractsOf = new Map<string, string[]>()
    let block = first.block
    if (lookups.length > 0) {
      const read = await request(
        lookups.map((lookup) => ({
          address: voters[lookup.voter],
          abi: voterAbi,
          functionName: lookup.functionName,
          args: [getAddress(lookup.gauge)],
        })),
        deadline,
      )
      block = read.block
      lookups.forEach((lookup, index) => {
        const result = read.results[index]
        if (result === lost) throw new ClaimableUnread("A reward contract")
        if (typeof result === "string" && result !== zero) {
          contractsOf.set(lookup.gauge, [
            ...(contractsOf.get(lookup.gauge) ?? []),
            result.toLowerCase(),
          ])
        }
      })
    }

    // 4. earned(), within the bound: whole locks, the largest first.
    const tokens = Object.keys(knownTokens)
    type Ask = {
      key: string
      gauge: string
      contract: string
      token: string
      tokenId: string
    }
    const asks: Ask[] = []
    const read: typeof locks = []
    let partial = overview.locks.length > locks.length
    for (const lock of locks) {
      const key = lockKey(lock)
      const own = (votesOf.get(key) ?? []).flatMap((vote) =>
        (contractsOf.get(vote.gauge) ?? []).flatMap((contract) =>
          tokens.map((token) => ({
            key,
            gauge: vote.gauge,
            contract,
            token,
            tokenId: lock.tokenId,
          })),
        ),
      )
      if (asks.length + own.length > maxEarnedCallsPerView && read.length > 0) {
        partial = true
        continue
      }
      if (own.length > maxEarnedCallsPerView) {
        partial = true
        continue
      }
      asks.push(...own)
      read.push(lock)
    }
    const slices: Ask[][] = []
    for (let start = 0; start < asks.length; start += earnedCallsPerRequest) {
      slices.push(asks.slice(start, start + earnedCallsPerRequest))
    }
    const answers = await Promise.all(
      slices.map((slice) =>
        request(
          slice.map((ask) => ({
            address: getAddress(ask.contract),
            abi: BRIBE_ABI,
            functionName: "earned",
            args: [getAddress(ask.token), BigInt(ask.tokenId)],
          })),
          deadline,
        ),
      ),
    )
    const earnedOf = new Map<string, LiveLock["earned"]>()
    slices.forEach((slice, sliceIndex) => {
      slice.forEach((ask, index) => {
        const amount = answers[sliceIndex]?.results[index]
        // A token the contract does not pay answers zero; anything else
        // that fails is a read that did not come back.
        if (typeof amount !== "bigint") {
          throw new ClaimableUnread("An earned amount")
        }
        if (amount === 0n) return
        earnedOf.set(ask.key, [
          ...(earnedOf.get(ask.key) ?? []),
          { gauge: ask.gauge, token: ask.token, amount },
        ])
      })
    })

    return {
      block: Number(block),
      partial,
      locks: read.map((lock) => ({
        escrow: lock.escrow,
        tokenId: lock.tokenId,
        // Not taken from this read: the overlay only uses claimable.
        amount: 0n,
        end: 0,
        isPermanent: lock.isPermanent,
        votingPower: 0n,
        votes: votesOf.get(lockKey(lock)) ?? [],
        lastVotedAt: 0,
        earned: earnedOf.get(lockKey(lock)) ?? [],
      })),
    }
  }
}

/** How many locks a wallet holds now, in both escrows, and at which block. */
export type LockCountReader = (
  address: string,
) => Promise<{ locks: number; block: number }>

const escrowAbi = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
])

/**
 * One request: `balanceOf(owner)` on veBTC and veMEZO, with the same
 * marker call as the claimable read. For a wallet whose stored document
 * names no locks: none on the chain either means there is truly nothing
 * to claim; some means the document is older than the wallet's first lock.
 * Throws when the chain does not answer, or not within
 * `claimableDeadlineMs`, so the caller keeps what it has.
 */
export function createLockCountReader(client: PublicClient): LockCountReader {
  return async function readLockCount(address) {
    const owner = getAddress(address)
    const read = client.multicall({
      allowFailure: true,
      batchSize: 0,
      contracts: [
        {
          address: multicall3,
          abi: multicallAbi,
          functionName: "getBlockNumber",
        },
        {
          address: CONTRACTS.mainnet.veBTC,
          abi: escrowAbi,
          functionName: "balanceOf",
          args: [owner],
        },
        {
          address: CONTRACTS.mainnet.veMEZO,
          abi: escrowAbi,
          functionName: "balanceOf",
          args: [owner],
        },
      ],
    })
    const results = await withinDeadline(read, claimableDeadlineMs)
    const [probe, veBtc, veMezo] = results
    if (
      probe?.status !== "success" ||
      veBtc?.status !== "success" ||
      veMezo?.status !== "success"
    ) {
      throw new ClaimableUnread("The lock count")
    }
    return {
      locks: Number(veBtc.result) + Number(veMezo.result),
      block: Number(probe.result),
    }
  }
}

/** Where the claimable figures in a wallet document come from. */
export type ClaimableAsOf = {
  block: number
  source: "live" | "stored"
  partial: boolean
}

/**
 * The stored documents with claimable replaced by the live read, for the
 * locks it covers. Built with the live path's own builder, so a figure is
 * priced and merged exactly as a live wallet's is.
 */
export function overlayClaimable(input: {
  overview: WalletOverview
  rewards: WalletRewards
  live: LiveClaimable
  cards: GaugeCards
  prices: Prices
  nowSeconds: number
}): { overview: WalletOverview; rewards: WalletRewards } {
  const { overview, rewards, live, prices } = input
  const built = buildLiveWalletDocuments({
    address: overview.address,
    snapshot: { block: live.block, locks: live.locks },
    cards: input.cards,
    prices,
    nowSeconds: input.nowSeconds,
  })
  const readKeys = new Set(live.locks.map(lockKey))
  const liveLock = new Map(
    built.overview.locks.map((lock) => [lockKey(lock), lock]),
  )
  const locks = overview.locks.map((lock) => {
    const fresh = liveLock.get(lockKey(lock))
    return fresh === undefined ? lock : { ...lock, claimable: fresh.claimable }
  })
  const total = priceBreakdown(
    mergeTokenAmounts(locks.map((lock) => lock.claimable.tokens)),
    prices,
  )
  const byLock = [
    // Locks the read did not cover keep their stored entry.
    ...rewards.byLock.filter((entry) => !readKeys.has(lockKey(entry.lock))),
    ...built.rewards.byLock,
  ]
  const hasClaimable = total.tokens.length > 0
  const epoch = hasClaimable
    ? (overview.claimableEpoch ?? built.overview.claimableEpoch)
    : null
  return {
    overview: { ...overview, locks, claimable: total, claimableEpoch: epoch },
    rewards: {
      ...rewards,
      epoch: hasClaimable ? (rewards.epoch ?? built.rewards.epoch) : null,
      readyToClaim: total,
      byLock,
    },
  }
}
