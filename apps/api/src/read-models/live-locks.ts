import { CONTRACTS, VOTING_ESCROW_ABI } from "@matchbox/chain"
import type { VoterKind } from "@matchbox/contracts/market"
import type {
  Escrow,
  Prices,
  WalletLock,
  WalletOverview,
  WalletRewards,
} from "@matchbox/contracts/read-models"
import { type Abi, getAddress, type PublicClient, parseAbi } from "viem"
import {
  askChain,
  type Call,
  type ChainAnswer,
  type ChainRequest,
  type ChainRequestOptions,
  type ClaimableTiming,
  ClaimableUnread,
  createChainRequest,
  lockKey,
  lost,
} from "./live-claimable"
import {
  buildLiveWalletDocuments,
  type LiveLock,
  type LiveVote,
  lockedTuple,
  maxLiveLocksPerEscrow,
} from "./live-wallet"
import { mergeTokenAmounts, priceBreakdown } from "./money"
import { type GaugeCards, suggestFor, totalProjected } from "./wallet-extras"

// A wallet's locks as the chain has them now, laid over its stored
// documents.
//
// The stored documents come from the warehouse sweep, which follows the
// indexer and runs four times an hour. On 13 Nov 2026 a wallet created a
// veBTC lock in Pro and saw it on mezo.org minutes before Pro listed it:
// Pro refetched as soon as the transaction was mined and got the stored
// document back, written before the lock existed. Which locks a wallet
// holds, how much is in each, when it unlocks, its voting power and where
// it votes are chain state. This reads them for the one wallet in view
// (three requests for most wallets) and keeps from the stored document
// only what the chain cannot say: history, and when a lock was created.
//
// It does not read claimable: live-claimable.ts does, over the locks this
// read settles on.

/** A wallet's locks read from the chain, without what they can claim. */
export type LiveLocks = {
  /** The earliest block any figure was read at. */
  block: number
  locks: LiveLock[]
  /**
   * Escrows where the wallet holds more locks than one read lists
   * (`maxLiveLocksPerEscrow`): a stored lock missing from `locks` there
   * may only be past the cut, so it is kept.
   */
  capped: Escrow[]
}

export type LiveLocksReader = (
  address: string,
  /** Unix ms: no request starts after it. */
  deadline: number,
  /** Locks the stored document names per escrow: how many ids to ask for. */
  expected: Readonly<Record<Escrow, number>>,
) => Promise<LiveLocks>

const escrows: readonly Escrow[] = ["vebtc", "vemezo"]

const escrowAddress: Record<Escrow, `0x${string}`> = {
  vebtc: CONTRACTS.mainnet.veBTC,
  vemezo: CONTRACTS.mainnet.veMEZO,
}

const voterAddress: Record<VoterKind, `0x${string}`> = {
  boost: CONTRACTS.mainnet.boostVoter,
  pools: CONTRACTS.mainnet.poolsVoter,
  validators: CONTRACTS.mainnet.validatorsVoter,
  "third-party": CONTRACTS.mainnet.thirdPartyVoter,
}

/** veMEZO votes on boost and third-party gauges; veBTC on the rest. */
const votersOf: Record<Escrow, readonly VoterKind[]> = {
  vemezo: ["boost", "third-party"],
  vebtc: ["validators", "pools"],
}

const voterAbi = parseAbi([
  "function usedWeights(uint256 tokenId) view returns (uint256)",
  "function lastVoted(uint256 tokenId) view returns (uint256)",
  "function votes(uint256 tokenId, address target) view returns (uint256)",
  "function gaugeVote(uint256 tokenId, uint256 index) view returns (address)",
  "function poolVote(uint256 tokenId, uint256 index) view returns (address)",
  "function gauges(address pool) view returns (address)",
])

const escrowAbi: Abi = VOTING_ESCROW_ABI

/** Ids asked for beyond the stored count, so a new lock needs no second request. */
const spareIds = 2
/** Vote slots asked for per lock and voter with the lock itself. */
const firstSlots = 4
/** A voter takes at most this many gauges per lock (`maxVotingNum`). */
const maxSlots = 30
/** Calls per request: fourteen per lock, so about 28 locks. */
const callsPerRequest = 400
const zero = "0x0000000000000000000000000000000000000000"

type Token = { escrow: Escrow; id: bigint }
type Pair = { token: Token; voter: VoterKind }

function ask(
  request: ChainRequest,
  calls: readonly Call[],
  deadline: number,
): Promise<ChainAnswer> {
  return askChain(request, calls, deadline, callsPerRequest)
}

/** A read that must have answered: anything else gives the whole read up. */
function bigintOf(value: unknown, what: string): bigint {
  if (typeof value !== "bigint") throw new ClaimableUnread(what)
  return value
}

/**
 * Step 1 of a wallet read: how many locks it holds in each escrow, and
 * their ids. The ids are asked for with the count: as many as the stored
 * document names and a couple more, so most wallets need one request; the
 * rest of the ids (up to `maxLiveLocksPerEscrow`) take a second.
 */
async function readLockIds(
  request: ChainRequest,
  address: string,
  deadline: number,
  expected: Readonly<Record<Escrow, number>>,
): Promise<{ block: bigint; tokens: Token[]; capped: Escrow[] }> {
  const owner = getAddress(address)
  const idCall = (escrow: Escrow, index: number): Call => ({
    address: escrowAddress[escrow],
    abi: escrowAbi,
    functionName: "ownerToNFTokenIdList",
    args: [owner, BigInt(index)],
  })
  const guess = (escrow: Escrow): number =>
    Math.min(maxLiveLocksPerEscrow, expected[escrow] + spareIds)
  const head = await ask(
    request,
    [
      ...escrows.map(
        (escrow): Call => ({
          address: escrowAddress[escrow],
          abi: escrowAbi,
          functionName: "balanceOf",
          args: [owner],
        }),
      ),
      ...escrows.flatMap((escrow) =>
        Array.from({ length: guess(escrow) }, (_, index) =>
          idCall(escrow, index),
        ),
      ),
    ],
    deadline,
  )
  let block = head.block
  const capped: Escrow[] = []
  const tokens: Token[] = []
  const missing: { escrow: Escrow; index: number }[] = []
  let offset = escrows.length
  escrows.forEach((escrow, position) => {
    const held = Number(bigintOf(head.results[position], "A lock count"))
    if (held > maxLiveLocksPerEscrow) capped.push(escrow)
    const count = Math.min(held, maxLiveLocksPerEscrow)
    for (let index = 0; index < count; index += 1) {
      if (index >= guess(escrow)) {
        missing.push({ escrow, index })
        continue
      }
      const id = bigintOf(head.results[offset + index], "A lock id")
      if (id > 0n) tokens.push({ escrow, id })
    }
    offset += guess(escrow)
  })
  if (missing.length > 0) {
    const more = await ask(
      request,
      missing.map((entry) => idCall(entry.escrow, entry.index)),
      deadline,
    )
    if (more.block < block) block = more.block
    missing.forEach((entry, position) => {
      const id = bigintOf(more.results[position], "A lock id")
      if (id > 0n) tokens.push({ escrow: entry.escrow, id })
    })
  }
  return { block, tokens, capped }
}

export function createLiveLocksReader(
  client: PublicClient,
  timing?: ClaimableTiming,
  options?: ChainRequestOptions,
): LiveLocksReader {
  const request = createChainRequest(client, timing, options)

  return async function readLiveLocks(address, deadline, expected) {
    const { block, tokens, capped } = await readLockIds(
      request,
      address,
      deadline,
      expected,
    )
    if (tokens.length === 0) return { block: Number(block), locks: [], capped }
    const states = await readLockStates(request, tokens, deadline)
    return {
      block: Math.min(Number(block), states.block),
      locks: states.locks,
      capped,
    }
  }
}

/** A wallet's locks with their amount and unlock only: no voting state. */
export type OwnerLock = {
  escrow: Escrow
  tokenId: string
  amount: bigint
  /** Unlock time, unix seconds; 0 for permanent locks. */
  end: number
  isPermanent: boolean
}

export type OwnerLocks = {
  /** The earliest block any figure was read at. */
  block: number
  locks: OwnerLock[]
  /** Escrows where the wallet holds more than `maxLiveLocksPerEscrow`. */
  capped: Escrow[]
}

export type OwnerLocksReader = (
  address: string,
  /** Unix ms: no request starts after it, none is waited for past it. */
  deadline: number,
  /** Locks a stored page names per escrow: how many ids to ask for. */
  expected: Readonly<Record<Escrow, number>>,
) => Promise<OwnerLocks>

/**
 * Which locks a wallet holds, each one's amount and unlock: what a list of
 * a wallet's locks shows, without the voting power, votes and vote slots
 * the full read (`createLiveLocksReader`) asks for. One request for a
 * wallet with no locks, two for one with locks, three when it holds more
 * than its stored page names plus two (ids past the first guess).
 */
export function createOwnerLocksReader(
  client: PublicClient,
  timing?: ClaimableTiming,
  options?: ChainRequestOptions,
): OwnerLocksReader {
  const request = createChainRequest(client, timing, options)
  return async function readOwnerLocks(address, deadline, expected) {
    const ids = await readLockIds(request, address, deadline, expected)
    if (ids.tokens.length === 0) {
      return { block: Number(ids.block), locks: [], capped: ids.capped }
    }
    const answer = await ask(
      request,
      ids.tokens.map(
        (token): Call => ({
          address: escrowAddress[token.escrow],
          abi: escrowAbi,
          functionName: "locked",
          args: [token.id],
        }),
      ),
      deadline,
    )
    const locks = ids.tokens.map((token, position): OwnerLock => {
      const locked = lockedTuple(answer.results[position])
      if (locked === null) throw new ClaimableUnread("A lock")
      return {
        escrow: token.escrow,
        tokenId: token.id.toString(),
        amount: locked.amount,
        end: Number(locked.end),
        isPermanent: locked.isPermanent,
      }
    })
    return {
      block: Math.min(Number(ids.block), Number(answer.block)),
      locks,
      capped: ids.capped,
    }
  }
}

/** The newest lock id each escrow has minted. */
export type LatestLockIds = { block: number; ids: Record<Escrow, bigint> }

export type LatestLockIdsReader = (deadline: number) => Promise<LatestLockIds>

/**
 * Each escrow's `tokenId()`: Velodrome's counter, the id of the newest lock
 * it minted (ids count up from 1 and are never reused). An id above it
 * names no lock yet. One request for both escrows.
 */
export function createLatestLockIdsReader(
  client: PublicClient,
  timing?: ClaimableTiming,
  options?: ChainRequestOptions,
): LatestLockIdsReader {
  const request = createChainRequest(client, timing, options)
  return async function readLatestLockIds(deadline) {
    const answer = await ask(
      request,
      escrows.map(
        (escrow): Call => ({
          address: escrowAddress[escrow],
          abi: escrowAbi,
          functionName: "tokenId",
        }),
      ),
      deadline,
    )
    return {
      block: Number(answer.block),
      ids: {
        vebtc: bigintOf(answer.results[0], "veBTC's newest id"),
        vemezo: bigintOf(answer.results[1], "veMEZO's newest id"),
      },
    }
  }
}

/** One lock read from the chain: who owns it and its figures. */
export type LiveLockRead = {
  /** The earliest block any figure was read at. */
  block: number
  /**
   * The owner, lower case; null when the escrow has no such lock (never
   * minted, or burned by a withdrawal or a merge).
   */
  owner: string | null
  /** Null exactly when `owner` is. */
  lock: LiveLock | null
}

export type LiveLockReader = (
  escrow: Escrow,
  tokenId: string,
  /** Unix ms: no request starts after it. */
  deadline: number,
) => Promise<LiveLockRead>

/**
 * One lock as the chain has it: its owner with its amount, unlock, voting
 * power and votes. One request for a lock that does not vote (or does not
 * exist), two for one that votes up to four gauges per voter.
 */
export function createLiveLockReader(
  client: PublicClient,
  timing?: ClaimableTiming,
  options?: ChainRequestOptions,
): LiveLockReader {
  const request = createChainRequest(client, timing, options)
  return async function readLiveLock(escrow, tokenId, deadline) {
    const token: Token = { escrow, id: BigInt(tokenId) }
    // A lock that does not exist has no owner: ownerOf answers the zero
    // address (Velodrome's escrow) or reverts. The request itself answered
    // (its block probe did), so either is the chain's answer, and the
    // lock's figures, zeros or reverts too, are not read.
    const states = await readLockStates(
      request,
      [token],
      deadline,
      [
        {
          address: escrowAddress[escrow],
          abi: escrowAbi,
          functionName: "ownerOf",
          args: [token.id],
        },
      ],
      (extra) => !ownerIn(extra[0]),
    )
    const owner = states.extra[0]
    if (!ownerIn(owner)) return { block: states.block, owner: null, lock: null }
    return {
      block: states.block,
      owner: owner.toLowerCase(),
      lock: states.locks[0] ?? null,
    }
  }
}

/** An ownerOf answer that names an owner. */
function ownerIn(value: unknown): value is string {
  return typeof value === "string" && value.toLowerCase() !== zero
}

/**
 * Each lock's amount, unlock, voting power and votes, with `extra` calls
 * sent in the first request (their results as they came, `lost` for one
 * that reverted). Two requests when any lock votes, one when none does;
 * one more when a lock fills its first vote slots on a voter.
 */
async function readLockStates(
  request: ChainRequest,
  tokens: readonly Token[],
  deadline: number,
  extra: readonly Call[] = [],
  /** Asked of `extra`'s results first: true ends the read there. */
  stopIf?: (extra: readonly unknown[]) => boolean,
): Promise<{ block: number; locks: LiveLock[]; extra: unknown[] }> {
  // 2. Each lock, and what it has on each of its voters.
  const pairs: Pair[] = tokens.flatMap((token) =>
    votersOf[token.escrow].map((voter) => ({ token, voter })),
  )
  const slotCall = (pair: Pair, index: number): Call => ({
    address: voterAddress[pair.voter],
    abi: voterAbi,
    functionName: pair.voter === "pools" ? "poolVote" : "gaugeVote",
    args: [pair.token.id, BigInt(index)],
  })
  const perToken = 2
  const perPair = 2 + firstSlots
  const state = await ask(
    request,
    [
      ...tokens.flatMap((token): Call[] => [
        {
          address: escrowAddress[token.escrow],
          abi: escrowAbi,
          functionName: "locked",
          args: [token.id],
        },
        {
          address: escrowAddress[token.escrow],
          abi: escrowAbi,
          functionName: "votingPowerOfNFT",
          args: [token.id],
        },
      ]),
      ...pairs.flatMap((pair): Call[] => [
        {
          address: voterAddress[pair.voter],
          abi: voterAbi,
          functionName: "usedWeights",
          args: [pair.token.id],
        },
        {
          address: voterAddress[pair.voter],
          abi: voterAbi,
          functionName: "lastVoted",
          args: [pair.token.id],
        },
        ...Array.from({ length: firstSlots }, (_, index) =>
          slotCall(pair, index),
        ),
      ]),
      ...extra,
    ],
    deadline,
  )
  let block = state.block
  const pairBase = tokens.length * perToken
  const extraBase = pairBase + pairs.length * perPair
  const extraResults = state.results.slice(extraBase)
  if (stopIf?.(extraResults) === true) {
    return { block: Number(block), locks: [], extra: extraResults }
  }
  const used = new Map<Pair, { weight: bigint; at: number }>()
  const targets = new Map<Pair, string[]>()
  pairs.forEach((pair, position) => {
    const at = pairBase + position * perPair
    const weight = bigintOf(state.results[at], "A lock's used votes")
    if (weight === 0n) return
    used.set(pair, {
      weight,
      at: Number(bigintOf(state.results[at + 1], "A lock's last vote")),
    })
    const found: string[] = []
    for (let index = 0; index < firstSlots; index += 1) {
      const result = state.results[at + 2 + index]
      // A slot past the end of the list reverts: the list ends here.
      if (typeof result !== "string") break
      found.push(result.toLowerCase())
    }
    targets.set(pair, found)
  })
  // A lock that filled every first slot may vote more gauges.
  const full = [...targets]
    .filter(([, found]) => found.length === firstSlots)
    .map(([pair]) => pair)
  if (full.length > 0) {
    const span = maxSlots - firstSlots
    const rest = await ask(
      request,
      full.flatMap((pair) =>
        Array.from({ length: span }, (_, index) =>
          slotCall(pair, firstSlots + index),
        ),
      ),
      deadline,
    )
    if (rest.block < block) block = rest.block
    full.forEach((pair, position) => {
      const found = targets.get(pair) ?? []
      for (let index = 0; index < span; index += 1) {
        const result = rest.results[position * span + index]
        if (typeof result !== "string") break
        found.push(result.toLowerCase())
      }
    })
  }

  // 3. The weight on each target. PoolsVoter names the pool: its gauge.
  const asked = [...targets].flatMap(([pair, found]) =>
    found.map((target) => ({ pair, target })),
  )
  const pools = [
    ...new Set(
      asked.flatMap((entry) =>
        entry.pair.voter === "pools" ? [entry.target] : [],
      ),
    ),
  ]
  const weights =
    asked.length === 0
      ? null
      : await ask(
          request,
          [
            ...asked.map(
              (entry): Call => ({
                address: voterAddress[entry.pair.voter],
                abi: voterAbi,
                functionName: "votes",
                args: [entry.pair.token.id, getAddress(entry.target)],
              }),
            ),
            ...pools.map(
              (pool): Call => ({
                address: voterAddress.pools,
                abi: voterAbi,
                functionName: "gauges",
                args: [getAddress(pool)],
              }),
            ),
          ],
          deadline,
        )
  if (weights !== null && weights.block < block) block = weights.block
  const gaugeOfPool = new Map<string, string>()
  pools.forEach((pool, position) => {
    const result = weights?.results[asked.length + position]
    if (result === lost) throw new ClaimableUnread("A pool's gauge")
    if (typeof result === "string" && result !== zero) {
      gaugeOfPool.set(pool, result.toLowerCase())
    }
  })
  const votesOf = new Map<string, LiveVote[]>()
  asked.forEach((entry, position) => {
    const weight = bigintOf(weights?.results[position], "A vote's weight")
    const gauge =
      entry.pair.voter === "pools"
        ? gaugeOfPool.get(entry.target)
        : entry.target
    if (gauge === undefined || weight === 0n) return
    const key = `${entry.pair.token.escrow}:${entry.pair.token.id}`
    votesOf.set(key, [
      ...(votesOf.get(key) ?? []),
      { gauge, voter: entry.pair.voter, weight },
    ])
  })

  const locks = tokens.map((token, position): LiveLock => {
    const locked = lockedTuple(state.results[position * perToken])
    if (locked === null) throw new ClaimableUnread("A lock")
    const lastVoted = pairs.flatMap((pair) => {
      const entry = pair.token === token ? used.get(pair) : undefined
      return entry === undefined ? [] : [{ voter: pair.voter, at: entry.at }]
    })
    return {
      escrow: token.escrow,
      tokenId: token.id.toString(),
      amount: locked.amount,
      end: Number(locked.end),
      isPermanent: locked.isPermanent,
      votingPower: bigintOf(
        state.results[position * perToken + 1],
        "A lock's voting power",
      ),
      votes: votesOf.get(`${token.escrow}:${token.id}`) ?? [],
      lastVotedAt: Math.max(0, ...lastVoted.map((entry) => entry.at)),
      lastVoted,
      earned: [],
    }
  })
  return {
    block: Number(block),
    locks,
    extra: state.results.slice(extraBase),
  }
}

/** How many locks a document names in each escrow. */
export function lockCounts(overview: WalletOverview): Record<Escrow, number> {
  const counts: Record<Escrow, number> = { vebtc: 0, vemezo: 0 }
  for (const lock of overview.locks) counts[lock.escrow] += 1
  return counts
}

export type ReconciledWallet = {
  overview: WalletOverview
  rewards: WalletRewards
  /** Locks the chain has and the stored document did not. */
  added: WalletLock[]
  /** Locks the stored document had and the wallet no longer owns. */
  removed: number
}

/**
 * The stored documents with their locks as the chain has them.
 *
 * From the chain: which locks the wallet owns, and each one's amount,
 * unlock, voting power, votes and what those votes are projected to earn.
 * From the stored document: each lock's claimable (live-claimable.ts lays
 * the live figure over it next) and creation time, the wallet's recent
 * activity, and everything historical in rewards.
 *
 * A stored lock the chain did not list is dropped, as transferred, merged
 * or withdrawn, unless that escrow's list was cut short (`capped`).
 */
export function reconcileWallet(input: {
  overview: WalletOverview
  rewards: WalletRewards
  live: LiveLocks
  cards: GaugeCards
  prices: Prices
  nowSeconds: number
}): ReconciledWallet {
  const { overview, rewards, live, cards, prices } = input
  const built = buildLiveWalletDocuments({
    address: overview.address,
    snapshot: { block: live.block, locks: live.locks },
    cards,
    prices,
    nowSeconds: input.nowSeconds,
  })
  const fresh = new Map(
    built.overview.locks.map((lock) => [lockKey(lock), lock]),
  )
  const stored = new Set(overview.locks.map(lockKey))
  let removed = 0
  const kept = overview.locks.flatMap((lock): WalletLock[] => {
    const now = fresh.get(lockKey(lock))
    if (now === undefined) {
      if (live.capped.includes(lock.escrow)) return [lock]
      removed += 1
      return []
    }
    return [
      {
        ...now,
        claimable: lock.claimable,
        boost: now.boost ?? lock.boost,
        createdAt: lock.createdAt,
      },
    ]
  })
  const added = built.overview.locks.filter(
    (lock) => !stored.has(lockKey(lock)),
  )
  const locks = [...kept, ...added]
  const owned = new Set(locks.map(lockKey))
  const claimable = priceBreakdown(
    mergeTokenAmounts(locks.map((lock) => lock.claimable.tokens)),
    prices,
  )
  const claimableEpoch =
    claimable.tokens.length > 0 ? overview.claimableEpoch : null
  return {
    overview: {
      ...overview,
      locks,
      claimable,
      claimableEpoch,
      projected: totalProjected(locks, prices),
      suggestion: suggestFor({ locks, cards, claimableEpoch, claimable }),
    },
    rewards: {
      ...rewards,
      epoch: claimable.tokens.length > 0 ? rewards.epoch : null,
      readyToClaim: claimable,
      byLock: rewards.byLock.filter((entry) => owned.has(lockKey(entry.lock))),
    },
    added,
    removed,
  }
}
