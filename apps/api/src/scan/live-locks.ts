import { CONTRACTS } from "@matchbox/chain"
import type { BlockscoutCaller } from "@matchbox/contracts/blockscout"
import type { VoterKind } from "@matchbox/contracts/market"
import type { RateLimitPolicy } from "@matchbox/contracts/rate-limits"
import type { Escrow } from "@matchbox/contracts/read-models"
import type { ScanLiveLock, ScanLockItem } from "@matchbox/contracts/scan"
import type { Logger } from "@matchbox/logger"
import type { RateLimitClient } from "@matchbox/server"
import { z } from "zod"
import { ClaimableUnread, withinDeadline } from "../read-models/live-claimable"
import type {
  LatestLockIds,
  LatestLockIdsReader,
  LiveLockRead,
  LiveLockReader,
  OwnerLock,
  OwnerLocks,
  OwnerLocksReader,
} from "../read-models/live-locks"
import type { LiveLock } from "../read-models/live-wallet"
import type { Page, ScanContext } from "./context"
import { lockItem, servedLock } from "./items"
import {
  type LiveTxRead,
  type LiveTxReader,
  liveTxCodec,
  liveTxSeconds,
  minedTxSeconds,
  settled as settledTx,
} from "./live-tx"
import { scanQueries } from "./queries"

// Matchscan's locks as the chain has them.
//
// Scan's store follows the indexer through the jobs Worker's copy, up to
// about 17 minutes behind the chain: a lock created or changed on mezo.org
// was not on its page, or on its owner's address page, until the copy
// caught up. The lock page and the address document lay the chain's lock
// over the stored row: which locks a wallet owns, each one's owner,
// amount, unlock, voting power and votes. What only the indexer knows
// stays the store's: creation time, history, boost. Nothing is written.
//
// Cost. Pages are public and anyone may ask for any id or address, on the
// RPC Pro uses too, so every chain read here is:
// - remembered for its minute at the edge (the Cache API of the data
//   centre), whatever it answered: figures, "no such lock", or a failure.
//   Requests that arrive together in an isolate share one read;
// - bounded in time: its own client (1.2 s, no retry, the primary RPC
//   only), one request per step, and one deadline for the whole route
//   (`scanLiveDeadlineMs`), inside Matchscan's 3 s wait for the API;
// - paid for first from the caller's allowance, then from a budget shared
//   by every isolate (`scanChainBudget`), both in the rate-limit Durable
//   Object; past either, that request serves the stored rows;
// - for an id the store does not have, asked only when the id is at most
//   `newIdsAhead` past the newest id the escrow has minted (`tokenId()`,
//   itself read once a minute): any other id is not found without a read.

/** Seconds a chain read is reused for. */
export const liveLockSeconds = 60

/** The minute slot every live answer is keyed on. */
export function liveSlot(nowMs: number): string {
  return `m${Math.floor(nowMs / (liveLockSeconds * 1000))}`
}

/**
 * Chain reads Matchscan may start per minute and per day, across every
 * isolate (one read is one to three requests). Past it pages serve the
 * stored rows. A lock or address costs at most one read a minute per data
 * centre, so this caps what many data centres, or many distinct ids and
 * addresses, can cost together.
 */
export const scanChainBudget: RateLimitPolicy = {
  perMinute: 120,
  perDay: 60_000,
}

export const scanChainBudgetKey = "scan:chain-reads"

/**
 * Live transaction reads (live-tx.ts), across every isolate: a budget of
 * their own, so hashes, which anyone can make up, never spend what the
 * lock and address pages read with, nor those pages what a transaction
 * page needs.
 *
 * What a real visitor needs: a transaction on its way in is read about
 * five times in its first minute (the page re-reads after 2, 3, 4 and 5 s
 * and an answer is kept for a block), then hardly at all once two blocks
 * deep (kept a day). Mezo sees a few hundred transactions with our activity a day,
 * one every few minutes, so 60 a minute is about twelve visitors opening
 * fresh transactions in the same minute, and 20,000 a day several
 * thousand of them, with each visitor's own allowance
 * (`scanCallerLiveAllowance`) still bounding what one of them costs.
 *
 * A unit is one read, not one RPC request: a read makes one request for
 * an unknown or pending hash and up to six for a mined one, so the
 * ceiling on the RPC is 360 requests a minute and 120,000 a day.
 */
export const scanTxBudget: RateLimitPolicy = {
  perMinute: 60,
  perDay: 20_000,
}

export const scanTxBudgetKey = "scan:chain-reads:tx"

/**
 * Ids past an escrow's newest (as last read, up to a minute ago) still
 * read from the chain: locks minted since. Any id further on is not found
 * without a read.
 */
export const newIdsAhead = 20n

/** The readers Matchscan's live reads use, on their own client. */
export type ScanChainReaders = {
  lock: LiveLockReader
  owner: OwnerLocksReader
  latest: LatestLockIdsReader
  /** A transaction the explorer and the store lack (live-tx.ts). */
  tx?: LiveTxReader
}

const escrowAddress: Record<Escrow, string> = {
  vebtc: CONTRACTS.mainnet.veBTC.toLowerCase(),
  vemezo: CONTRACTS.mainnet.veMEZO.toLowerCase(),
}

export function escrowNamed(address: string): Escrow | null {
  if (address === escrowAddress.vebtc) return "vebtc"
  if (address === escrowAddress.vemezo) return "vemezo"
  return null
}

/** Voter contracts as lock_votes rows name them (`source`). */
const sourceOf: Record<VoterKind, string> = {
  boost: "BOOST_VOTER",
  "third-party": "THIRD_PARTY_VOTER",
  validators: "VALIDATORS_VOTER",
  pools: "POOLS_VOTER",
}

/** A lock that has left the escrow: no read can change its row. */
function settled(lock: ScanLockItem): boolean {
  return lock.is_withdrawn || lock.is_merged
}

/**
 * The chain's owner, amount and unlock over a stored row; a row made from
 * the chain for a lock the store does not have (what only the store knows
 * is null, never made up).
 */
export function chainLockItem(input: {
  stored: ScanLockItem | null
  escrow: Escrow
  owner: string
  lock: Pick<OwnerLock, "tokenId" | "amount" | "end" | "isPermanent">
}): ScanLockItem {
  const { stored, lock } = input
  const figures = {
    owner: input.owner,
    amount: lock.amount.toString(),
    // The escrows keep `end` at 0 for a permanent lock, as the store does.
    unlock_at: lock.isPermanent ? 0 : lock.end,
    is_permanent: lock.isPermanent,
  }
  if (stored !== null) return { ...stored, ...figures }
  return {
    escrow: escrowAddress[input.escrow],
    token_id: lock.tokenId,
    ...figures,
    created_at: null,
    last_extended_at: null,
    withdrawn_at: null,
    is_withdrawn: false,
    is_merged: false,
    merged_into_token_id: null,
    merged_at: null,
    boost: null,
    activity_count: null,
    updated_at: null,
  }
}

/**
 * The lock route's `live`: voting power and votes, each vote with when the
 * lock last voted on that vote's voter (each voter keeps its own).
 */
export function liveLockOf(read: LiveLockRead): ScanLiveLock | null {
  const lock = read.lock
  if (lock === null) return null
  const votedOn = new Map(
    (lock.lastVoted ?? []).map((entry) => [entry.voter, entry.at]),
  )
  return {
    block: read.block,
    voting_power: lock.votingPower.toString(),
    votes: lock.votes.map((vote) => {
      const at = votedOn.get(vote.voter) ?? 0
      return {
        gauge: vote.gauge,
        source: sourceOf[vote.voter],
        weight: vote.weight.toString(),
        voted_at: at > 0 ? at : null,
      }
    }),
    last_voted_at: lock.lastVotedAt > 0 ? lock.lastVotedAt : null,
  }
}

// -- remembering chain reads ----------------------------------------------

/** How a remembered value is kept at the edge (JSON), and read back. */
type Codec<T> = {
  encode: (value: T) => unknown
  /** Null for anything that is not a well-formed value. */
  decode: (raw: unknown) => T | null
}

const bigintText = z.string().regex(/^(0|[1-9][0-9]*)$/)
const escrowName = z.enum(["vebtc", "vemezo"])
const voterKind = z.enum(["boost", "third-party", "validators", "pools"])

const lockReadShape = z.object({
  block: z.number().int().nonnegative(),
  owner: z.string().nullable(),
  lock: z
    .object({
      escrow: escrowName,
      tokenId: bigintText,
      amount: bigintText,
      end: z.number().int().nonnegative(),
      isPermanent: z.boolean(),
      votingPower: bigintText,
      votes: z.array(
        z.object({ gauge: z.string(), voter: voterKind, weight: bigintText }),
      ),
      lastVotedAt: z.number().int().nonnegative(),
      lastVoted: z.array(
        z.object({ voter: voterKind, at: z.number().int().nonnegative() }),
      ),
    })
    .nullable(),
})

export const lockReadCodec: Codec<LiveLockRead> = {
  encode: (read) => ({
    block: read.block,
    owner: read.owner,
    lock:
      read.lock === null
        ? null
        : {
            escrow: read.lock.escrow,
            tokenId: read.lock.tokenId,
            amount: read.lock.amount.toString(),
            end: read.lock.end,
            isPermanent: read.lock.isPermanent,
            votingPower: read.lock.votingPower.toString(),
            votes: read.lock.votes.map((vote) => ({
              gauge: vote.gauge,
              voter: vote.voter,
              weight: vote.weight.toString(),
            })),
            lastVotedAt: read.lock.lastVotedAt,
            lastVoted: read.lock.lastVoted ?? [],
          },
  }),
  decode: (raw) => {
    const parsed = lockReadShape.safeParse(raw)
    if (!parsed.success) return null
    const lock = parsed.data.lock
    return {
      block: parsed.data.block,
      owner: parsed.data.owner,
      lock:
        lock === null
          ? null
          : ({
              ...lock,
              amount: BigInt(lock.amount),
              votingPower: BigInt(lock.votingPower),
              votes: lock.votes.map((vote) => ({
                ...vote,
                weight: BigInt(vote.weight),
              })),
              earned: [],
            } satisfies LiveLock),
    }
  },
}

const ownerLocksShape = z.object({
  block: z.number().int().nonnegative(),
  capped: z.array(escrowName),
  locks: z.array(
    z.object({
      escrow: escrowName,
      tokenId: bigintText,
      amount: bigintText,
      end: z.number().int().nonnegative(),
      isPermanent: z.boolean(),
    }),
  ),
})

export const ownerLocksCodec: Codec<OwnerLocks> = {
  encode: (value) => ({
    block: value.block,
    capped: value.capped,
    locks: value.locks.map((lock) => ({
      ...lock,
      amount: lock.amount.toString(),
    })),
  }),
  decode: (raw) => {
    const parsed = ownerLocksShape.safeParse(raw)
    if (!parsed.success) return null
    return {
      block: parsed.data.block,
      capped: parsed.data.capped,
      locks: parsed.data.locks.map((lock) => ({
        ...lock,
        amount: BigInt(lock.amount),
      })),
    }
  },
}

const latestShape = z.object({
  block: z.number().int().nonnegative(),
  ids: z.object({ vebtc: bigintText, vemezo: bigintText }),
})

const latestCodec: Codec<LatestLockIds> = {
  encode: (value) => ({
    block: value.block,
    ids: {
      vebtc: value.ids.vebtc.toString(),
      vemezo: value.ids.vemezo.toString(),
    },
  }),
  decode: (raw) => {
    const parsed = latestShape.safeParse(raw)
    if (!parsed.success) return null
    return {
      block: parsed.data.block,
      ids: {
        vebtc: BigInt(parsed.data.ids.vebtc),
        vemezo: BigInt(parsed.data.ids.vemezo),
      },
    }
  },
}

/** What the edge keeps for a read: its answer, or that it failed. */
const rememberedSchema = z.union([
  z.object({ ok: z.literal(true), value: z.unknown() }),
  z.object({ ok: z.literal(false) }),
])

/** Isolate entries kept at most, oldest dropped first. */
const memoEntries = 500

type WaitUntil = (task: Promise<unknown>) => void

/**
 * Who asks, and until when: one deadline for a whole route (its newest-id
 * read and its lock read share it), inside Matchscan's 3 s wait for the
 * API (`scanLiveDeadlineMs`).
 */
export type LiveAsk = {
  caller: BlockscoutCaller
  /** Unix ms, on the context's clock. */
  deadline: number
  waitUntil: WaitUntil
}

/**
 * How long a route may spend on the chain, from its start: Matchscan gives
 * the API 3 s, and a route still reads D1 and renders around the chain. A
 * lock not stored makes two reads in turn (the newest ids, then the lock:
 * four requests, about 0.35 s together on the primary and 0.6 s at worst on
 * a fallback, measured 13 Nov 2026).
 */
export const scanLiveDeadlineMs = 2_200

/** The longest the rate-limit Durable Object may take to say yes or no. */
export const budgetCallMs = 300

/** A read is not started with less time than this left. */
const leastReadMs = 200

/**
 * Chain reads one caller (a visitor's salted key, `X-Matchbox-End-User`)
 * may start per minute and day, taken before the shared budget, so one
 * visitor cannot spend it: past it, that caller gets the stored rows.
 * Callers without a key share one larger allowance.
 */
export const scanCallerLiveAllowance: RateLimitPolicy = {
  perMinute: 15,
  perDay: 1_500,
}
export const scanAnonymousLiveAllowance: RateLimitPolicy = {
  perMinute: 30,
  perDay: 10_000,
}

export function scanLiveCallerKey(caller: BlockscoutCaller): string {
  return `scan:live:${caller.client ?? "unknown"}:${caller.endUser ?? "anonymous"}`
}

/**
 * What a read pays before it starts, and what happens when the
 * rate-limit Durable Object cannot be asked in time.
 */
type Payment = {
  /** Take the caller's allowance first. */
  perCaller: boolean
  /** Unreachable: serve stored rows (true) or read anyway (false). */
  failClosed: boolean
  /** The budget shared across isolates the read is paid from. */
  budget: SharedBudget
  /**
   * No limiter bound (local runs and tests): read anyway, or refuse.
   * Transactions refuse: a deploy missing the binding must not turn every
   * random hash into an RPC request.
   */
  unlimited: "read" | "refuse"
}

type SharedBudget = { key: string; policy: RateLimitPolicy }

const chainBudget: SharedBudget = {
  key: scanChainBudgetKey,
  policy: scanChainBudget,
}
const txBudget: SharedBudget = { key: scanTxBudgetKey, policy: scanTxBudget }

/** An answer, and whether to keep it for the minute. */
type Outcome<T> = { value: T | null; keep: boolean }

/**
 * Matchscan's chain reads, each remembered for its minute: in this
 * isolate (requests that arrive together share one read) and at the edge
 * (every isolate in the data centre), a failed or timed-out read as well
 * as an answer, so a failing or hung RPC is asked once a minute, not per
 * view. A read resolves to null when it failed, ran out of time, or was
 * not paid for (the caller's allowance or the shared budget spent); one
 * not paid for is not remembered, so other callers are not refused with
 * it. Null: the caller serves the stored rows.
 */
export class ScanLive {
  private readonly memo = new Map<string, Promise<unknown>>()
  private readonly txMemo = new Map<
    string,
    { until: number; value: Promise<LiveTxRead | null> }
  >()

  constructor(
    private readonly deps: {
      readers: ScanChainReaders | null
      cache: Cache | null
      rateLimits: RateLimitClient | null
      now: () => number
      logger: Logger
    },
  ) {}

  get enabled(): boolean {
    return this.deps.readers !== null
  }

  /**
   * The newest id each escrow has minted, as of this minute: one read a
   * minute for every id, paid from the shared budget only, and read anyway
   * when the budget cannot be asked (it bounds which ids are read at all).
   */
  latestIds(ask: LiveAsk): Promise<LatestLockIds | null> {
    const readers = this.deps.readers
    if (readers === null) return Promise.resolve(null)
    return this.remember(
      "escrows/latest",
      latestCodec,
      (deadline) => readers.latest(deadline),
      ask,
      {
        perCaller: false,
        failClosed: false,
        budget: chainBudget,
        unlimited: "read",
      },
    )
  }

  /**
   * One lock as the chain has it this minute. Read anyway when the budget
   * cannot be asked: a stored lock is one key, and an id the store lacks
   * is bounded by `latestIds`.
   */
  lock(
    escrow: Escrow,
    tokenId: string,
    ask: LiveAsk,
  ): Promise<LiveLockRead | null> {
    const readers = this.deps.readers
    if (readers === null) return Promise.resolve(null)
    return this.remember(
      `locks/${escrow}/${tokenId}`,
      lockReadCodec,
      (deadline) => readers.lock(escrow, tokenId, deadline),
      ask,
      {
        perCaller: true,
        failClosed: false,
        budget: chainBudget,
        unlimited: "read",
      },
    )
  }

  /**
   * A wallet's locks (amount and unlock only) this minute. Addresses are
   * unbounded keys: when the budget cannot be asked, the stored rows.
   */
  ownerLocks(
    address: string,
    expected: Readonly<Record<Escrow, number>>,
    ask: LiveAsk,
  ): Promise<OwnerLocks | null> {
    const readers = this.deps.readers
    if (readers === null) return Promise.resolve(null)
    return this.remember(
      `owners/${address}/locks`,
      ownerLocksCodec,
      (deadline) => readers.owner(address, deadline, expected),
      ask,
      {
        perCaller: true,
        failClosed: true,
        budget: chainBudget,
        unlimited: "read",
      },
    )
  }

  /**
   * One transaction as the RPC has it (live-tx.ts). A mined one at least
   * `settledDepth` blocks deep is kept a day, in the isolate and at the
   * edge; a newer one, an unknown or pending answer, or a failed read, for
   * one block. Paid from the caller's allowance, then
   * the transaction budget (`scanTxBudget`), and not read when they cannot
   * be asked or no limiter is bound: hashes are unbounded keys.
   */
  transaction(hash: string, ask: LiveAsk): Promise<LiveTxRead | null> {
    const reader = this.deps.readers?.tx
    if (reader === undefined) return Promise.resolve(null)
    const now = this.deps.now()
    const held = this.txMemo.get(hash)
    if (held !== undefined && held.until > now) return held.value
    const slot = Math.floor(now / (liveTxSeconds * 1000))
    const minedKey = new Request(`https://scan.internal/live/v2/tx/${hash}`)
    const slotKey = new Request(
      `https://scan.internal/live/v2/tx/${hash}/s${slot}`,
    )
    const entry: { until: number; value: Promise<LiveTxRead | null> } = {
      until: now + liveTxSeconds * 1000,
      value: Promise.resolve(null),
    }
    entry.value = (async (): Promise<LiveTxRead | null> => {
      for (const key of [minedKey, slotKey]) {
        const found = await this.edge(key)
        if (found === undefined) continue
        if (!found.ok) return null
        const decoded = liveTxCodec.decode(found.value)
        if (decoded !== null) {
          if (settledTx(decoded)) entry.until = Number.POSITIVE_INFINITY
          return decoded
        }
      }
      const result = await this.chainRead(
        `tx/${hash}`,
        (deadline) => reader(hash, deadline),
        ask,
        {
          perCaller: true,
          failClosed: true,
          budget: txBudget,
          unlimited: "refuse",
        },
      )
      if (!result.keep) {
        // Not paid for, or no time: the next request may be.
        entry.until = 0
        return null
      }
      const mined = result.value !== null && settledTx(result.value)
      if (mined) entry.until = Number.POSITIVE_INFINITY
      if (this.deps.cache !== null) {
        const body = JSON.stringify(
          result.value === null
            ? { ok: false }
            : { ok: true, value: liveTxCodec.encode(result.value) },
        )
        const seconds = mined ? minedTxSeconds : liveTxSeconds
        const put = this.deps.cache.put(
          mined ? minedKey : slotKey,
          new Response(body, {
            headers: {
              "Content-Type": "application/json; charset=utf-8",
              "Cache-Control": `public, max-age=${seconds}`,
            },
          }),
        )
        ask.waitUntil(put.catch(() => undefined))
      }
      return result.value
    })()
    this.txMemo.delete(hash)
    this.txMemo.set(hash, entry)
    while (this.txMemo.size > memoEntries) {
      const oldest = this.txMemo.keys().next().value
      if (oldest === undefined) break
      this.txMemo.delete(oldest)
    }
    return entry.value
  }

  private remember<T>(
    id: string,
    codec: Codec<T>,
    read: (deadline: number) => Promise<T>,
    ask: LiveAsk,
    payment: Payment,
  ): Promise<T | null> {
    const key = `${liveSlot(this.deps.now())}/${id}`
    const held = this.memo.get(key)
    if (held !== undefined) return held as Promise<T | null>
    const outcome = (async (): Promise<Outcome<T>> => {
      const request = new Request(`https://scan.internal/live/v2/${key}`)
      const found = await this.edge(request)
      if (found !== undefined) {
        if (!found.ok) return { value: null, keep: true }
        const value = codec.decode(found.value)
        if (value !== null) return { value, keep: true }
      }
      const result = await this.chainRead(id, read, ask, payment)
      if (result.keep && this.deps.cache !== null) {
        const body = JSON.stringify(
          result.value === null
            ? { ok: false }
            : { ok: true, value: codec.encode(result.value) },
        )
        const put = this.deps.cache.put(
          request,
          new Response(body, {
            headers: {
              "Content-Type": "application/json; charset=utf-8",
              "Cache-Control": `public, max-age=${liveLockSeconds}`,
            },
          }),
        )
        ask.waitUntil(put.catch(() => undefined))
      }
      return result
    })()
    const pending = outcome.then((result) => result.value)
    this.memo.set(key, pending)
    // Not paid for, or no time to start: the next request may be.
    outcome.then((result) => {
      if (!result.keep && this.memo.get(key) === pending) this.memo.delete(key)
    })
    while (this.memo.size > memoEntries) {
      const oldest = this.memo.keys().next().value
      if (oldest === undefined) break
      this.memo.delete(oldest)
    }
    return pending
  }

  private async edge(
    request: Request,
  ): Promise<z.infer<typeof rememberedSchema> | undefined> {
    if (this.deps.cache === null) return undefined
    try {
      const hit = await this.deps.cache.match(request)
      if (hit === undefined) return undefined
      const parsed = rememberedSchema.safeParse(await hit.json())
      return parsed.success ? parsed.data : undefined
    } catch {
      return undefined
    }
  }

  /** One read, paid for and inside the route's deadline. */
  private async chainRead<T>(
    id: string,
    read: (deadline: number) => Promise<T>,
    ask: LiveAsk,
    payment: Payment,
  ): Promise<Outcome<T>> {
    const left = () => ask.deadline - this.deps.now()
    if (left() < leastReadMs) return { value: null, keep: false }
    if (!(await this.pay(id, ask, payment))) {
      return { value: null, keep: false }
    }
    const ms = left()
    if (ms < leastReadMs) return { value: null, keep: false }
    try {
      // The readers stop starting requests at their deadline; this stops
      // waiting for one that never answers.
      const value = await withinDeadline(read(Date.now() + ms), ms)
      return { value, keep: true }
    } catch (error) {
      this.deps.logger.warn({
        message:
          error instanceof ClaimableUnread
            ? "Scan chain read unanswered"
            : "Scan chain read failed",
        read: id,
        error,
      })
      // Remembered for the minute: a failing RPC is not asked per view.
      return { value: null, keep: true }
    }
  }

  /**
   * The caller's allowance, then the payment's shared budget, both asked
   * within `budgetCallMs` together. True when the read may go ahead. With
   * no limiter bound, as the payment says (`unlimited`).
   */
  private async pay(
    id: string,
    ask: LiveAsk,
    payment: Payment,
  ): Promise<boolean> {
    const limits = this.deps.rateLimits
    if (limits === null) return payment.unlimited === "read"
    const start = this.deps.now()
    const until = start + Math.min(budgetCallMs, ask.deadline - start)
    const consume = (key: string, policy: RateLimitPolicy) =>
      withinDeadline(limits.consume(key, policy), until - this.deps.now())
    try {
      if (payment.perCaller) {
        const own = await consume(
          scanLiveCallerKey(ask.caller),
          ask.caller.endUser === null
            ? scanAnonymousLiveAllowance
            : scanCallerLiveAllowance,
        )
        if (!own.allowed) {
          this.deps.logger.info({
            message: "Caller's live reads spent",
            read: id,
          })
          return false
        }
      }
      const shared = await consume(payment.budget.key, payment.budget.policy)
      if (!shared.allowed) {
        this.deps.logger.warn({
          message: "Scan chain budget spent",
          read: id,
          budget: payment.budget.key,
        })
      }
      return shared.allowed
    } catch (error) {
      this.deps.logger.warn({
        message: "Scan chain budget not reachable",
        read: id,
        failClosed: payment.failClosed,
        error,
      })
      return !payment.failClosed
    }
  }
}

/** Hands a task to the request's lifetime. */
export function waitUntilOf(c: {
  executionCtx: { waitUntil(task: Promise<unknown>): void }
}): WaitUntil {
  return (task) => {
    try {
      c.executionCtx.waitUntil(task.catch(() => undefined))
    } catch {
      // Detached in tests.
    }
  }
}

// -- one lock -------------------------------------------------------------

export type LockDocument = {
  data: ScanLockItem
  indexed: boolean
  live: ScanLiveLock | null
}

/**
 * One lock's page: the stored row with the chain's figures over it, or a
 * row made from the chain for a lock the store does not have yet. Null for
 * a lock that does not exist (the route's 404); `unread` when nothing
 * stored says what it is and the chain did not answer (the page says the
 * lock is unavailable, never that it does not exist).
 *
 * - Stored and withdrawn or merged: the stored row; the chain is not read.
 * - Not stored, and past the escrow's newest id by more than `newIdsAhead`:
 *   null without a lock read. When the newest ids could not be read,
 *   `unread` without one.
 * - The read failed, timed out or found the budget spent: the stored row
 *   (`live: null`), or `unread`.
 * - The chain has no such lock: null, or the stored row until the copy
 *   records the withdrawal or merge.
 * - No readers configured: the store's answer, as before the chain was read.
 */
export async function lockDocument(input: {
  stored: ScanLockItem | null
  escrow: Escrow
  tokenId: string
  live: ScanLive
  ask: LiveAsk
}): Promise<LockDocument | null | "unread"> {
  const { stored, live } = input
  const asStored = (): LockDocument | "unread" =>
    stored === null ? "unread" : { data: stored, indexed: true, live: null }
  if (stored !== null && settled(stored)) return asStored()
  if (!live.enabled) return stored === null ? null : asStored()
  if (stored === null) {
    const latest = await live.latestIds(input.ask)
    if (latest === null) return "unread"
    if (BigInt(input.tokenId) > latest.ids[input.escrow] + newIdsAhead) {
      return null
    }
  }
  const read = await live.lock(input.escrow, input.tokenId, input.ask)
  if (read === null) return asStored()
  if (read.owner === null || read.lock === null) {
    return stored === null ? null : asStored()
  }
  return {
    data: chainLockItem({
      stored,
      escrow: input.escrow,
      owner: read.owner,
      lock: read.lock,
    }),
    indexed: stored !== null,
    live: liveLockOf(read),
  }
}

// -- an owner's locks -----------------------------------------------------

/** Live locks per escrow on a stored page: how many ids to ask for. */
export function expectedLocks(
  stored: readonly ScanLockItem[],
): Record<Escrow, number> {
  const counts: Record<Escrow, number> = { vebtc: 0, vemezo: 0 }
  for (const lock of stored) {
    const escrow = escrowNamed(lock.escrow)
    if (escrow !== null && !settled(lock)) counts[escrow] += 1
  }
  return counts
}

/** Scan's order for an owner's locks: escrow address, then id as text. */
function compareLocks(
  left: Pick<ScanLockItem, "escrow" | "token_id">,
  right: Pick<ScanLockItem, "escrow" | "token_id">,
): number {
  if (left.escrow !== right.escrow) return left.escrow < right.escrow ? -1 : 1
  if (left.token_id === right.token_id) return 0
  return left.token_id < right.token_id ? -1 : 1
}

const keyOf = (lock: Pick<ScanLockItem, "escrow" | "token_id">): string =>
  `${lock.escrow}:${lock.token_id}`

/**
 * An owner's locks: every lock the chain says it holds (up to 50 per
 * escrow), each over its stored row wherever the store has one, with the
 * withdrawn and merged locks of the stored first page, in the page's
 * order (escrow, then id as text).
 *
 * - A lock the chain lists takes the chain's owner, amount and unlock and
 *   keeps the store's creation, boost and counts: from the stored page, or
 *   from `elsewhere` (the store's rows for locks not on that page: ones
 *   past it, or transferred in and still under their old owner there).
 * - A stored live lock the chain does not list is dropped (transferred,
 *   withdrawn or merged since the copy), unless that escrow's chain list
 *   was cut at 50.
 */
export function reconcileOwnerLocks(input: {
  stored: readonly ScanLockItem[]
  elsewhere: readonly ScanLockItem[]
  owner: string
  chain: OwnerLocks
}): ScanLockItem[] {
  const { chain } = input
  const known = new Map(
    [...input.elsewhere, ...input.stored].map((row) => [keyOf(row), row]),
  )
  const listed = new Set<string>()
  const live = chain.locks.map((lock) => {
    const key = `${escrowAddress[lock.escrow]}:${lock.tokenId}`
    listed.add(key)
    return chainLockItem({
      stored: known.get(key) ?? null,
      escrow: lock.escrow,
      owner: input.owner,
      lock,
    })
  })
  const kept = input.stored.filter((row) => {
    if (listed.has(keyOf(row))) return false
    if (settled(row)) return true
    const escrow = escrowNamed(row.escrow)
    return escrow === null || chain.capped.includes(escrow)
  })
  return [...live, ...kept].sort(compareLocks)
}

/** Stored rows looked up at once for chain locks off the stored page. */
const elsewhereMost = 100

/**
 * The address document's locks: the owner's first stored page with the
 * chain's lock set laid over it (`reconcileOwnerLocks`). The stored page
 * when the chain was not read.
 *
 * Its cursor says whether locks are left unlisted, not only whether the
 * store has more rows: every lock the owner holds is listed unless an
 * escrow's chain list was cut at 50, so what can be left is the withdrawn
 * and merged locks past the stored page (one indexed read asks). The
 * cursor, when kept, is the store's and continues the store's list.
 */
export async function liveOwnerPage(
  scan: ScanContext,
  ask: LiveAsk,
  owner: string,
  stored: Page<ScanLockItem>,
): Promise<Page<ScanLockItem>> {
  const chain = await scan.live.ownerLocks(
    owner,
    expectedLocks(stored.data),
    ask,
  )
  if (chain === null) return stored
  const onPage = new Set(stored.data.map(keyOf))
  const off = chain.locks
    .map((lock) => [escrowAddress[lock.escrow], lock.tokenId] as const)
    .filter(([escrow, id]) => !onPage.has(`${escrow}:${id}`))
    .slice(0, elsewhereMost)
  const [elsewhere, more] = await Promise.all([
    off.length === 0
      ? Promise.resolve([])
      : scan
          .firstEach(scanQueries.lock, off)
          .then((rows) =>
            scan
              .mapRows(
                rows.filter((row) => row !== null),
                lockItem,
              )
              .rows.map(servedLock),
          )
          .catch((error: unknown) => {
            // Without them those locks show as not indexed yet, never wrong.
            scan.deps.logger.warn({
              message: "Stored lock lookup failed",
              error,
            })
            return []
          }),
    unlisted(scan, owner, stored, chain),
  ])
  return {
    ...stored,
    data: reconcileOwnerLocks({
      stored: stored.data,
      elsewhere,
      owner,
      chain,
    }),
    nextCursor: more ? stored.nextCursor : null,
  }
}

/** Whether locks of the owner are left off the reconciled page. */
async function unlisted(
  scan: ScanContext,
  owner: string,
  stored: Page<ScanLockItem>,
  chain: OwnerLocks,
): Promise<boolean> {
  if (stored.nextCursor === null) return false
  if (chain.capped.length > 0) return true
  const last = stored.data.at(-1)
  if (last === undefined) return true
  try {
    const found = await scan.first(scanQueries.settledLockAfter, [
      owner,
      last.escrow,
      last.token_id,
    ])
    return found !== null
  } catch {
    // Unknown: say there may be more rather than that there is none.
    return true
  }
}
