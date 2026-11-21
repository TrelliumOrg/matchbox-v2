import { MUSD_CONTRACTS } from "@matchbox/chain"
import type { Evidence } from "@matchbox/stuart-ui/contract"
import type { Address } from "viem"
import type {
  ClaimInfo,
  CompoundedClaim,
  Destination,
  FlowResult,
} from "../flows"
import { byAmountDesc } from "../flows"
import { shortAddress } from "../format"
import { type IdScope, makeEvidence } from "../outcome"
import {
  ACTIVITY_LIMITS,
  type AddressLabel,
  BTC_TOKEN,
  type ChainActivitySource,
  type ChainTransfer,
  type ClaimLog,
  DISTRIBUTOR_OF,
  DISTRIBUTORS,
  ESCROW_ASSET,
  ESCROWS,
  lower,
  MEZO_TOKEN,
  type NativeRead,
  type NftMove,
  type OwnedLock,
  type RewardPayer,
  type TransferRead,
} from "../providers/chainActivity"
import { KNOWN_ENTITIES, type Subject } from "../subjects"

// What the chain activity tools share: reading an entity's transfers within
// the per-question caps, naming counterparties, and deciding which inflows
// are reward claims and where an outflow went.

export const MATCHSCAN = "https://scan.matchbox.markets"
export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000"
const SAVINGS_RATE = lower(MUSD_CONTRACTS.mainnet.savingsRate)
const DAY = 86_400

/** At most this many of an entity's addresses are read per question. */
export const MAX_MEMBERS = 3

export function addressUrl(address: string): string {
  return `${MATCHSCAN}/address/${address.toLowerCase()}`
}

export function txUrl(hash: string): string {
  return `${MATCHSCAN}/tx/${hash.toLowerCase()}`
}

export function lockUrl(asset: "veBTC" | "veMEZO", tokenId: string): string {
  return `${MATCHSCAN}/locks/${asset.toLowerCase()}/${tokenId}`
}

const MONTHS = [
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

/** Unix seconds to "16 Jul 2026" (UTC). */
export function displayDate(seconds: number): string {
  const date = new Date(seconds * 1000)
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`
}

export type Period = {
  /** The start (unix seconds). */
  since: number
  /** The end: claims and activity after it are left out. */
  until: number
  days: number
  /** When it was read: what was claimed is followed past `until`, to now. */
  now: number
  /** The user named an end before today ("in March", "last month"). */
  ended: boolean
}

const MONTH_NAMES = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
]

/** "march", "mar" or "sept" to 2; anything else (even "decade") -1. */
function monthNumber(name: string): number {
  return MONTH_NAMES.findIndex(
    (full) =>
      full === name ||
      full.slice(0, 3) === name ||
      (name === "sept" && full === "september"),
  )
}

/**
 * The first second of tomorrow (UTC). A date up to tomorrow is this
 * year's and reads as today: a user east of UTC (at most +14h) can
 * already be on the next day, never the one after.
 */
function tomorrowStart(now: Date): number {
  return utcSeconds(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
  )
}

/** A named span: its first second and its last (unix seconds). */
export type DateSpan = { start: number; end: number }

function utcSeconds(year: number, month: number, day: number): number {
  return Math.floor(Date.UTC(year, month, day) / 1000)
}

/** A real calendar day, or null (31 February, 30 April). */
function dayOf(year: number, month: number, day: number): DateSpan | null {
  const at = new Date(Date.UTC(year, month, day))
  if (day < 1 || at.getUTCMonth() !== month || at.getUTCFullYear() !== year) {
    return null
  }
  const start = utcSeconds(year, month, day)
  return { start, end: start + DAY - 1 }
}

/** A whole month; month -1 is last year's December. */
function monthOf(year: number, month: number): DateSpan {
  return {
    start: utcSeconds(year, month, 1),
    end: utcSeconds(year, month + 1, 1) - 1,
  }
}

/** This year, or last year when it would start too far ahead of now. */
function yearFor(now: Date, month: number, day: number): number {
  const year = now.getUTCFullYear()
  return utcSeconds(year, month, day) > tomorrowStart(now) ? year - 1 : year
}

/** "this month" from its start to now; "last month" the whole one before. */
function relativeSpan(unit: string, back: boolean, now: Date): DateSpan {
  const nowSeconds = Math.floor(now.getTime() / 1000)
  const year = now.getUTCFullYear()
  const month = now.getUTCMonth()
  if (unit === "year") {
    return back
      ? { start: utcSeconds(year - 1, 0, 1), end: utcSeconds(year, 0, 1) - 1 }
      : { start: utcSeconds(year, 0, 1), end: nowSeconds }
  }
  if (unit === "month") {
    return back
      ? monthOf(year, month - 1)
      : { start: utcSeconds(year, month, 1), end: nowSeconds }
  }
  // Weeks start on Monday.
  const monday =
    utcSeconds(year, month, now.getUTCDate()) -
    ((now.getUTCDay() + 6) % 7) * DAY
  return back
    ? { start: monday - 7 * DAY, end: monday - 1 }
    : { start: monday, end: nowSeconds }
}

/**
 * The span a user named: "2026-03-01" or "23 April (2026)" (that day),
 * "today" (to now),
 * "March (2026)" or "2026-03" (that month), "2026" (that year), "this
 * week, month or year" (from its start to now), "last week, month or
 * year" (the whole calendar week from Monday, month or year before this
 * one). Without a year, this year's unless that is still ahead by more
 * than two days, then last year's. Null when unreadable or not a real date.
 */
export function dateSpan(text: string | null, now: Date): DateSpan | null {
  if (text === null) return null
  const value = text
    .trim()
    .toLowerCase()
    .replace(/^the\s+/, "")
    .replace(/,/g, "")
    .replace(/\s+/g, " ")
  if (value === "today" || value === "now") {
    const nowSeconds = Math.floor(now.getTime() / 1000)
    return {
      start: utcSeconds(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate(),
      ),
      end: nowSeconds,
    }
  }
  const iso = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(value)
  if (iso !== null) {
    const year = Number.parseInt(iso[1] ?? "", 10)
    const month = Number.parseInt(iso[2] ?? "", 10) - 1
    if (month < 0 || month > 11) return null
    return iso[3] === undefined
      ? monthOf(year, month)
      : dayOf(year, month, Number.parseInt(iso[3], 10))
  }
  if (/^20\d\d$/.test(value)) {
    const year = Number.parseInt(value, 10)
    return {
      start: utcSeconds(year, 0, 1),
      end: utcSeconds(year + 1, 0, 1) - 1,
    }
  }
  const relative = /^(this|current|last|previous) (week|month|year)$/.exec(
    value,
  )
  if (relative !== null) {
    const back = relative[1] === "last" || relative[1] === "previous"
    return relativeSpan(relative[2] ?? "", back, now)
  }
  const dayFirst =
    /^(\d{1,2})(?:st|nd|rd|th)?(?: of)? ([a-z]+)(?: (\d{4}))?$/.exec(value)
  const monthFirst =
    dayFirst === null
      ? /^([a-z]+) (\d{1,2})(?:st|nd|rd|th)?(?: (\d{4}))?$/.exec(value)
      : null
  if (dayFirst !== null || monthFirst !== null) {
    const day = Number.parseInt(dayFirst?.[1] ?? monthFirst?.[2] ?? "", 10)
    const name = dayFirst?.[2] ?? monthFirst?.[1] ?? ""
    const month = monthNumber(name)
    if (month < 0) return null
    const year = dayFirst?.[3] ?? monthFirst?.[3]
    return dayOf(
      year === undefined ? yearFor(now, month, day) : Number.parseInt(year, 10),
      month,
      day,
    )
  }
  const monthName = /^([a-z]+)(?: (\d{4}))?$/.exec(value)
  if (monthName !== null) {
    const name = monthName[1] ?? ""
    const month = monthNumber(name)
    if (month < 0) return null
    const year =
      monthName[2] === undefined
        ? yearFor(now, month, 1)
        : Number.parseInt(monthName[2], 10)
    return monthOf(year, month)
  }
  return null
}

/** The start a user named, unix seconds; null when unreadable. */
export function sinceSeconds(text: string | null, now: Date): number | null {
  return dateSpan(text, now)?.start ?? null
}

/** A start that names a whole past unit, and so ends with it too. */
const CLOSED_START = /^(?:the )?(?:last|previous) (?:week|month|year)$/i

/**
 * The period a tool reads: from `since` (else `days` back from the end,
 * else `fallback` days) to the end of `until` (else now). "Last month" as
 * a start ends with that month. At most 365 days. Null when a start or end
 * was given but cannot be read, starts in the future (past two days of
 * grace for time zones) or ends before it starts: the tool says so rather
 * than read a period nobody asked for.
 */
export function periodOf(
  now: Date,
  days: number | null,
  fallback: number,
  since: string | null = null,
  until: string | null = null,
): Period | null {
  const nowSeconds = Math.floor(now.getTime() / 1000)
  const from = since === null ? null : dateSpan(since, now)
  const to = until === null ? null : dateSpan(until, now)
  if ((since !== null && from === null) || (until !== null && to === null)) {
    return null
  }
  const closed = since !== null && CLOSED_START.test(since.trim())
  const endAt = to?.end ?? (closed ? (from?.end ?? null) : null)
  const end = Math.min(endAt ?? nowSeconds, nowSeconds)
  // An end is a day's last second: count whole days back from the next
  // day's first ("until March" starts on 1 Dec, not at 23:59:59 on 30 Nov).
  const span = Math.min(Math.max(days ?? fallback, 1), 365) * DAY
  let start = from?.start ?? (endAt === null ? end - span : end + 1 - span)
  if (start > nowSeconds) {
    // Tomorrow is a time zone east of UTC: today, in UTC.
    if (start > tomorrowStart(now)) return null
    start = utcSeconds(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
    )
  }
  if (end <= start) return null
  start = Math.max(start, end - 365 * DAY)
  return {
    since: start,
    until: end,
    days: Math.min(Math.ceil((end - start) / DAY), 365),
    now: nowSeconds,
    ended: end < nowSeconds,
  }
}

/** The last `days` days, to now. */
export function lastDays(now: Date, days: number): Period {
  const nowSeconds = Math.floor(now.getTime() / 1000)
  return {
    since: nowSeconds - days * DAY,
    until: nowSeconds,
    days,
    now: nowSeconds,
    ended: false,
  }
}

/**
 * "16 Aug 2026", or "1 Oct to 31 Oct 2026" for a period that ended, or
 * "30 Apr 2026" for one day.
 */
export function periodSpanText(period: Period): string {
  const from = displayDate(period.since)
  if (!period.ended) return from
  const to = displayDate(period.until)
  if (from === to) return from
  return from.slice(-4) === to.slice(-4)
    ? `${from.slice(0, -5)} to ${to}`
    : `${from} to ${to}`
}

/** "Since", "From" (a period that ended) or "On" (one day that ended). */
export function periodWord(period: Period): "Since" | "From" | "On" {
  if (!period.ended) return "Since"
  return displayDate(period.since) === displayDate(period.until) ? "On" : "From"
}

/** Where one member's history stops short of the period (or failed). */
export type ReadGap = {
  address: Address
  /** The oldest time actually read; null when failed or undated. */
  from: number | null
  what: "transfers" | "native BTC"
  /**
   * `failed`: nothing read. `short`: read back to `from` only. `undated`:
   * read, but without block times, so it could not be placed or counted.
   * `module`, `notL2`: a Safe's native sends this cannot decode (module
   * calls, or a Safe without SafeMultiSigTransaction events).
   */
  reason: "failed" | "short" | "undated" | "module" | "notL2"
}

export type EntityTransfers = {
  transfers: ChainTransfer[]
  reads: Array<{
    address: Address
    read: TransferRead | null
    native: NativeRead | null
  }>
  /** Some member's history stopped at the page cap or failed. */
  partial: boolean
  /** Each member whose history is short, and from when it was read. */
  gaps: ReadGap[]
  /** Liquid claims are counted from here per member (its read coverage). */
  memberSince: Map<string, number>
  /** No member could be read at all. */
  unavailable: boolean
  /** Member Safes, whose native BTC sends were decoded. */
  safes: Address[]
}

/** The same native BTC move already logged as an ERC-20 transfer. */
function duplicateOf(
  native: ChainTransfer,
  tokens: readonly ChainTransfer[],
): boolean {
  return tokens.some(
    (each) =>
      each.tx === native.tx &&
      each.token === BTC_TOKEN &&
      each.from === native.from &&
      each.to === native.to &&
      each.amount === native.amount,
  )
}

/**
 * Members' ERC-20 transfers, plus the native BTC each member Safe sent or
 * received (its own events; token transfers do not show native BTC).
 */
export async function readEntityTransfers(
  chain: ChainActivitySource,
  members: readonly Address[],
  since: number,
  pages: number,
  options: { native?: boolean } = {},
): Promise<EntityTransfers> {
  const wanted = members.slice(0, MAX_MEMBERS)
  const [reads, signers] = await Promise.all([
    Promise.all(
      wanted.map(async (address) => ({
        address,
        read: await chain.transfers(address, since, pages),
      })),
    ),
    options.native === false
      ? Promise.resolve(new Map<string, Address[]>())
      : chain.safeOwners(wanted),
  ])
  const safes = wanted.filter((address) => signers.has(address.toLowerCase()))
  const natives = new Map<string, NativeRead | null>(
    await Promise.all(
      safes.map(
        async (safe) =>
          [
            safe.toLowerCase(),
            await chain.safeNative(safe, since, ACTIVITY_LIMITS.safeLogPages),
          ] as const,
      ),
    ),
  )
  // A transfer between two members is in both histories: keep one.
  const seen = new Set<string>()
  const tokens = reads
    .flatMap((each) => each.read?.transfers ?? [])
    .filter((transfer) => {
      const id = `${transfer.tx}:${transfer.logIndex}`
      if (seen.has(id)) return false
      seen.add(id)
      return true
    })
  // Names and contract flags for native moves, from the token transfers.
  const refs = new Map<string, { name: string | null; contract: boolean }>()
  for (const transfer of tokens) {
    refs.set(transfer.from, {
      name: transfer.fromName,
      contract: transfer.fromContract,
    })
    refs.set(transfer.to, {
      name: transfer.toName,
      contract: transfer.toContract,
    })
  }
  const native = [...natives.values()]
    .flatMap((read) => read?.transfers ?? [])
    .filter((transfer) => {
      const id = `${transfer.tx}:${transfer.logIndex}`
      if (seen.has(id) || duplicateOf(transfer, tokens)) return false
      seen.add(id)
      return true
    })
    .map((transfer) => ({
      ...transfer,
      fromName: refs.get(transfer.from)?.name ?? null,
      fromContract: refs.get(transfer.from)?.contract ?? false,
      toName: refs.get(transfer.to)?.name ?? null,
      toContract: refs.get(transfer.to)?.contract ?? false,
    }))
  const gaps: ReadGap[] = []
  const memberSince = new Map<string, number>()
  const anyRead = reads.some((each) => each.read !== null)
  for (const { address, read } of reads) {
    const key = address.toLowerCase()
    if (read === null) {
      if (anyRead) {
        gaps.push({ address, from: null, what: "transfers", reason: "failed" })
      }
      memberSince.set(key, Number.POSITIVE_INFINITY)
    } else if (!read.complete) {
      // Cut at the page cap: from the oldest transfer read. With none
      // dated, nothing of the period can be placed.
      if (read.oldest === null) {
        gaps.push({
          address,
          from: null,
          what: "transfers",
          reason: "undated",
        })
        memberSince.set(key, Number.POSITIVE_INFINITY)
      } else {
        const from = Math.max(since, read.oldest)
        gaps.push({ address, from, what: "transfers", reason: "short" })
        memberSince.set(key, from)
      }
    }
  }
  for (const safe of safes) {
    const read = natives.get(safe.toLowerCase())
    if (read === undefined) continue
    if (read === null) {
      gaps.push({
        address: safe,
        from: null,
        what: "native BTC",
        reason: "failed",
      })
    } else if (read.undecoded !== undefined) {
      gaps.push({
        address: safe,
        from: null,
        what: "native BTC",
        reason: read.undecoded,
      })
    } else if (
      read.undated === true ||
      (!read.complete && read.oldest === null)
    ) {
      // Events without block times were skipped: not "read back to" the
      // period start, whatever the page cap says.
      gaps.push({
        address: safe,
        from: null,
        what: "native BTC",
        reason: "undated",
      })
    } else if (!read.complete) {
      gaps.push({
        address: safe,
        from: Math.max(since, read.oldest ?? since),
        what: "native BTC",
        reason: "short",
      })
    }
  }
  return {
    transfers: [...tokens, ...native],
    reads: reads.map((each) => ({
      ...each,
      native: natives.get(each.address.toLowerCase()) ?? null,
    })),
    partial: gaps.length > 0,
    gaps,
    memberSince,
    unavailable: !anyRead,
    safes,
  }
}

/**
 * No member's transfer history reaches into the period: each stops after
 * it ends (a busy holder's page cap, a period before the history read) or
 * could not be read or dated. Nothing of the period was read.
 */
export function periodUnread(read: EntityTransfers, until: number): boolean {
  return (
    read.reads.length > 0 &&
    read.reads.every(
      ({ address }) =>
        (read.memberSince.get(address.toLowerCase()) ??
          Number.NEGATIVE_INFINITY) > until,
    )
  )
}

/** The latest date any member's history actually starts, when partial. */
export function coverageStart(read: EntityTransfers): number | null {
  const dates = read.gaps
    .map((gap) => gap.from)
    .filter((from): from is number => from !== null)
  return dates.length ? Math.max(...dates) : null
}

// ---------------------------------------------------------------------------
// Rewards compounded into locks

/** Unix seconds for a block, interpolated between known blocks. */
export function blockClock(
  anchors: ReadonlyArray<{ block: number; at: number }>,
): (block: number) => number | null {
  const points = [...new Map(anchors.map((each) => [each.block, each.at]))]
    .map(([block, at]) => ({ block, at }))
    .sort((a, b) => a.block - b.block)
  const first = points[0]
  const last = points.at(-1)
  if (first === undefined || last === undefined) return () => null
  // Mezo's average block time when there is only one anchor.
  const slope =
    last.block > first.block
      ? (last.at - first.at) / (last.block - first.block)
      : 3.9
  return (block) => {
    let low = 0
    let high = points.length - 1
    while (low < high) {
      const middle = Math.floor((low + high + 1) / 2)
      if ((points[middle]?.block ?? 0) <= block) low = middle
      else high = middle - 1
    }
    const below = points[low] ?? first
    const above = points[low + 1]
    if (below.block <= block && above !== undefined) {
      const step = (above.at - below.at) / (above.block - below.block)
      return Math.round(below.at + (block - below.block) * step)
    }
    return Math.round(below.at + (block - below.block) * slope)
  }
}

/**
 * Who of the members owned a lock at a log (block, then log index), from
 * their NFT moves. Without a log index, at the start of the block.
 */
export type OwnerAt = (
  asset: "veBTC" | "veMEZO",
  tokenId: string,
  block: number,
  logIndex?: number,
) => Address | null

/** Whether log (a, ai) comes at or before log (b, bi). */
function atOrBefore(a: number, ai: number, b: number, bi: number): boolean {
  return a < b || (a === b && ai <= bi)
}

/**
 * Ownership from the members' lock NFT moves over the period: the last
 * move at or before the block says who has it; with none before, the
 * first move after (it left a member, so a member had it); with none at
 * all, whoever owns it now. Null when no member owned it then.
 */
export function ownerAtFrom(
  members: ReadonlySet<string>,
  moves: readonly NftMove[],
  current: readonly OwnedLock[],
): OwnerAt {
  const byLock = new Map<string, NftMove[]>()
  const ordered = [...moves].sort(
    (a, b) => a.block - b.block || a.logIndex - b.logIndex,
  )
  for (const move of ordered) {
    const key = `${move.asset}:${move.tokenId}`
    const list = byLock.get(key) ?? []
    list.push(move)
    byLock.set(key, list)
  }
  return (asset, tokenId, block, logIndex = -1) => {
    const list = byLock.get(`${asset}:${tokenId}`) ?? []
    const before = list
      .filter((move) => atOrBefore(move.block, move.logIndex, block, logIndex))
      .at(-1)
    if (before !== undefined) {
      return members.has(before.to) ? before.to : null
    }
    const after = list.find(
      (move) => !atOrBefore(move.block, move.logIndex, block, logIndex),
    )
    if (after !== undefined) {
      return members.has(after.from) ? after.from : null
    }
    const now = current.find(
      (lock) => lock.asset === asset && lock.tokenId === tokenId,
    )
    return now?.owner && members.has(now.owner) ? now.owner : null
  }
}

export type Compounding = {
  claims: CompoundedClaim[]
  /** Which member owned a lock at a block (for lock deposits). */
  ownerAt: OwnerAt
  /** Locks read, and those over the cap left out. */
  locksRead: number
  locksSkipped: number
  /** A lock's claims or a member's NFT history could not be fully read. */
  partial: boolean
}

const COMPOUND_TOKEN = {
  veMEZO: { token: MEZO_TOKEN, symbol: "MEZO", kind: "rebase" },
  veBTC: { token: BTC_TOKEN, symbol: "BTC", kind: "chainFees" },
} as const

/** Rewards distributors by address: the known two, plus labelled ones. */
function distributorsOf(
  labels: ReadonlyMap<string, AddressLabel>,
): Map<string, "veBTC" | "veMEZO"> {
  const found = new Map(DISTRIBUTORS)
  for (const [address, label] of labels) {
    if (DISTRIBUTOR_KINDS.has(label.kind) && !found.has(address)) {
      found.set(address, label.tags.includes("vebtc") ? "veBTC" : "veMEZO")
    }
  }
  return found
}

/**
 * Rebases and chain fees the distributors deposited into the members'
 * locks over the period, including locks a member owned then but has
 * since withdrawn or transferred: every lock a member owns now or moved
 * in the period, each lock's distributor claims, kept while a member
 * owned it. A claim the distributor paid out to the owner (an expired
 * lock) is a liquid claim in the token transfers, not compounded.
 */
export async function readCompounding(input: {
  chain: ChainActivitySource
  subject: Subject
  period: Period
  /** The members' token transfers: liquid distributor payouts, dates. */
  transfers: readonly ChainTransfer[]
  maxLocks: number
  /** Also read each member's NFT moves (locks no longer owned). */
  history: boolean
  /** Pages of NFT moves per member (default the cap). */
  nftPages?: number
}): Promise<Compounding> {
  const { chain, subject, period } = input
  const members = new Set(
    subject.members
      .slice(0, MAX_MEMBERS)
      .map((member) => member.address.toLowerCase()),
  )
  let partial = false
  const nftReads = input.history
    ? await Promise.all(
        [...members].map((member) =>
          chain.nftMoves(
            lower(member),
            period.since,
            input.nftPages ?? ACTIVITY_LIMITS.nftPages,
          ),
        ),
      )
    : []
  const moves = nftReads.flatMap((read) => {
    if (read === null || !read.complete) partial = true
    return read?.moves ?? []
  })
  // The largest locks first, whatever order Matchscan listed them in, so
  // a cap leaves out the smallest.
  const current = (subject.locks ?? [])
    .filter((lock) => lock.owner !== null && members.has(lock.owner))
    .sort((a, b) => byAmountDesc(a.amount, b.amount))
  const candidates: Array<{ asset: "veBTC" | "veMEZO"; tokenId: string }> = []
  const add = (asset: "veBTC" | "veMEZO", tokenId: string) => {
    if (
      !candidates.some(
        (each) => each.asset === asset && each.tokenId === tokenId,
      )
    ) {
      candidates.push({ asset, tokenId })
    }
  }
  for (const lock of current) add(lock.asset, lock.tokenId)
  for (const move of [...moves].sort((a, b) => b.at - a.at)) {
    add(move.asset, move.tokenId)
  }
  const wanted = candidates.slice(0, input.maxLocks)
  const logs: Array<ClaimLog | null> = []
  // Four at a time: the proxy shares one Blockscout budget.
  for (let start = 0; start < wanted.length; start += 4) {
    logs.push(
      ...(await Promise.all(
        wanted
          .slice(start, start + 4)
          .map((each) =>
            chain.distributorClaims(
              each.asset,
              each.tokenId,
              ACTIVITY_LIMITS.claimPages,
            ),
          ),
      )),
    )
  }
  const clock = blockClock([
    ...input.transfers.map((each) => ({ block: each.block, at: each.at })),
    ...moves.map((move) => ({ block: move.block, at: move.at })),
    ...logs.flatMap((log) =>
      (log?.claims ?? []).flatMap((claim) =>
        claim.at === null ? [] : [{ block: claim.block, at: claim.at }],
      ),
    ),
  ])
  const ownerAt = ownerAtFrom(members, moves, current)
  // Payouts the distributors made straight to a member: liquid claims.
  const paidOut = new Set(
    input.transfers
      .filter((each) => DISTRIBUTORS.has(each.from) && members.has(each.to))
      .map((each) => `${each.tx}:${each.amount}`),
  )
  const claims: CompoundedClaim[] = []
  for (const [index, log] of logs.entries()) {
    const lock = wanted[index]
    if (lock === undefined) continue
    if (log === null) {
      partial = true
      continue
    }
    // Claims cut by the page cap matter only when they fall in the period.
    if (!log.complete) {
      const oldest = log.claims[0]
      const at = oldest ? (oldest.at ?? clock(oldest.block)) : null
      if (at === null || at > period.since) partial = true
    }
    for (const claim of log.claims) {
      const at = claim.at ?? clock(claim.block)
      if (at === null || at < period.since || at > period.until) continue
      if (claim.amount === 0n || paidOut.has(`${claim.tx}:${claim.amount}`)) {
        continue
      }
      const owner = ownerAt(
        lock.asset,
        lock.tokenId,
        claim.block,
        claim.logIndex,
      )
      if (owner === null) continue
      const reward = COMPOUND_TOKEN[lock.asset]
      claims.push({
        tx: claim.tx,
        at,
        member: lower(owner),
        asset: lock.asset,
        tokenId: lock.tokenId,
        token: reward.token,
        symbol: reward.symbol,
        decimals: 18,
        amount: claim.amount,
        kind: reward.kind,
        from: lower(DISTRIBUTOR_OF[lock.asset]),
      })
    }
  }
  const locksSkipped = Math.max(0, candidates.length - wanted.length)
  return {
    claims: claims.sort((a, b) => a.at - b.at),
    ownerAt,
    locksRead: wanted.length,
    locksSkipped,
    // Locks over the cap were not read: their rewards are missing.
    partial: partial || locksSkipped > 0,
  }
}

/** Which lock an outflow to an escrow paid into, and whose it is. */
export type LockTarget = {
  asset: "veBTC" | "veMEZO"
  tokenId: string
  owner: Address | null
  own: boolean
}

/** At most this many transactions are read to place lock deposits. */
const MAX_DEPOSIT_TXS = 6

/**
 * Each member outflow into an escrow, matched to the lock it paid into
 * from the transaction's escrow events: a lock minted in it belongs to
 * whoever it was minted to; an existing lock to the member that owned it
 * then, or else to its owner now.
 */
export async function resolveLockTargets(input: {
  chain: ChainActivitySource
  members: ReadonlySet<string>
  transfers: readonly ChainTransfer[]
  ownerAt: OwnerAt
}): Promise<Map<string, LockTarget>> {
  const targets = new Map<string, LockTarget>()
  const outflows = input.transfers
    .filter(
      (transfer) =>
        ESCROW_ASSET.has(transfer.to) && input.members.has(transfer.from),
    )
    .sort((a, b) => b.block - a.block)
    .slice(0, MAX_DEPOSIT_TXS)
  const events = await Promise.all(
    outflows.map((transfer) => input.chain.txLockEvents(transfer.tx)),
  )
  const unknownOwner: Array<{
    key: string
    asset: "veBTC" | "veMEZO"
    tokenId: string
  }> = []
  outflows.forEach((transfer, index) => {
    const asset = ESCROW_ASSET.get(transfer.to)
    if (asset === undefined) return
    const list = (events[index] ?? []).filter((each) => each.asset === asset)
    const deposits = list.filter((each) => each.event.kind === "deposit")
    const deposit =
      deposits.find(
        (each) =>
          each.event.kind === "deposit" && each.event.value === transfer.amount,
      ) ?? (deposits.length === 1 ? deposits[0] : undefined)
    if (deposit === undefined) return
    const tokenId = deposit.event.tokenId
    const key = `${transfer.tx}:${transfer.logIndex}`
    const mint = list.find(
      (each) =>
        each.event.kind === "transfer" &&
        each.event.tokenId === tokenId &&
        each.event.from === ZERO_ADDRESS,
    )
    if (mint?.event.kind === "transfer") {
      const owner = mint.event.to
      targets.set(key, { asset, tokenId, owner, own: input.members.has(owner) })
      return
    }
    const owner = input.ownerAt(
      asset,
      tokenId,
      transfer.block,
      transfer.logIndex,
    )
    if (owner !== null) {
      targets.set(key, { asset, tokenId, owner, own: true })
      return
    }
    unknownOwner.push({ key, asset, tokenId })
  })
  for (const asset of ["veBTC", "veMEZO"] as const) {
    const ids = unknownOwner.filter((each) => each.asset === asset)
    if (ids.length === 0) continue
    const owners = await input.chain.lockOwners(
      asset,
      ids.map((each) => each.tokenId),
    )
    for (const each of ids) {
      const owner = owners.get(each.tokenId) ?? null
      targets.set(each.key, {
        asset,
        tokenId: each.tokenId,
        owner,
        own: owner !== null && input.members.has(owner),
      })
    }
  }
  return targets
}

/**
 * Current balances of every member and token whose lots are still open
 * at the end of a first pass, so "still held" never says more than the
 * address has.
 */
export async function readHeldBalances(
  chain: ChainActivitySource,
  firstPass: FlowResult,
): Promise<Map<string, bigint>> {
  const pairs = new Map<string, { holder: Address; token: Address }>()
  for (const outcome of firstPass.outcomes) {
    const destination = outcome.destination
    if (destination.kind !== "unmoved" || !destination.open) continue
    const holder = lower(destination.at)
    const token = lower(destination.token)
    pairs.set(`${holder}:${token}`, { holder, token })
  }
  if (pairs.size === 0) return new Map()
  return chain.balances([...pairs.values()])
}

const REWARD_KINDS: Record<string, ClaimInfo["kind"]> = {
  bribeVotingReward: "incentives",
  voterBribeReward: "incentives",
  feeVotingReward: "fees",
}

/** Matchscan label kinds of the distributors that pay rebases and fees. */
const DISTRIBUTOR_KINDS = new Set(["rewardsDistributor", "rebaseDistributor"])

/** Matchscan label kinds of gauges: staking principal and emissions. */
const GAUGE_KINDS = new Set(["gauge", "poolGauge", "clGauge", "vaultGauge"])

/** Pools, routers and vaults: who pays out the other side of a swap. */
const POOL_KINDS = /^(?:pool|vault|morphoVault|router)$/
const POOL_NAME = /(?:Pool|Pair|Router|Vault|Swap|Morpho)/

/** How the tools name and classify counterparties for one question. */
export type Lens = {
  members: ReadonlySet<string>
  labels: Map<string, AddressLabel>
  /** Voting reward contracts (bribes, fees) Matchscan has not labelled. */
  rewardEscrows: Map<string, "veBTC" | "veMEZO">
  /**
   * Gauges that paid a member: staked principal coming back or gauge
   * emissions. Neither is a voting reward, so neither is a claim.
   */
  gauges: Map<string, Extract<RewardPayer, { kind: "gauge" }>>
  /** Counterparty Safes that share signers with a member Safe. */
  related: Map<string, string>
  nameOf: (address: string) => string | null
  claimOf: (transfer: ChainTransfer) => ClaimInfo | null
  destinationOf: (transfer: ChainTransfer) => Destination
  swapLeg: (transfer: ChainTransfer) => boolean
  swapPair: (out: ChainTransfer, inflow: ChainTransfer) => boolean
}

/** "SNF voting Safe": addresses Matchbox names by hand. */
const KNOWN_NAMES = new Map(
  KNOWN_ENTITIES.flatMap((entity) =>
    entity.addresses.map(
      (member) =>
        [
          member.address.toLowerCase(),
          `${entity.short} ${member.role}`,
        ] as const,
    ),
  ),
)

function isSafeName(name: string | null): boolean {
  return name !== null && /^(?:Gnosis)?Safe(?:L2)?$/.test(name)
}

/** A label kind that already says what pays: rewards or a gauge. */
function payerKind(label: AddressLabel | undefined): boolean {
  return (
    label !== undefined &&
    (REWARD_KINDS[label.kind] !== undefined ||
      DISTRIBUTOR_KINDS.has(label.kind) ||
      GAUGE_KINDS.has(label.kind))
  )
}

/** Labels, reward contracts and related Safes for an entity's transfers. */
export async function buildLens(
  chain: ChainActivitySource,
  subject: Subject,
  transfers: readonly ChainTransfer[],
  lockTargets: ReadonlyMap<string, LockTarget> = new Map(),
): Promise<Lens> {
  const members = new Set(
    subject.members.map((member) => member.address.toLowerCase()),
  )
  // Counterparties by how often they appear, for the label batch.
  const seen = new Map<string, number>()
  const names = new Map<string, string>()
  const contracts = new Set<string>()
  const safes = new Set<string>()
  for (const transfer of transfers) {
    for (const [address, name, contract] of [
      [transfer.from, transfer.fromName, transfer.fromContract],
      [transfer.to, transfer.toName, transfer.toContract],
    ] as const) {
      if (members.has(address)) continue
      seen.set(address, (seen.get(address) ?? 0) + 1)
      if (name !== null) names.set(address, name)
      if (contract) contracts.add(address)
      if (isSafeName(name)) safes.add(address)
    }
    // Native sends carry no names: their recipients may be Safes too.
    if (transfer.native === true && members.has(transfer.from)) {
      safes.add(transfer.to)
    }
  }
  const ranked = [...seen.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([address]) => lower(address))
  const labels = await chain.labels(ranked)
  const distributors = distributorsOf(labels)
  // Every contract paying a member that no label already marks as a
  // reward payer is probed: labelled contracts of other kinds too.
  const inflowContracts = [
    ...new Set(
      transfers
        .filter(
          (transfer) =>
            members.has(transfer.to) &&
            !members.has(transfer.from) &&
            contracts.has(transfer.from) &&
            !DISTRIBUTORS.has(transfer.from) &&
            !payerKind(labels.get(transfer.from)),
        )
        .map((transfer) => transfer.from),
    ),
  ]
  const [payers, owners] = await Promise.all([
    chain.rewardPayers(inflowContracts),
    chain.safeOwners([
      ...subject.members.map((member) => member.address),
      ...[...safes].slice(0, 6).map(lower),
    ]),
  ])
  const rewardEscrows = new Map<string, "veBTC" | "veMEZO">()
  const gauges = new Map<string, Extract<RewardPayer, { kind: "gauge" }>>()
  for (const [address, payer] of payers) {
    if (payer.kind === "gauge") gauges.set(address, payer)
    else rewardEscrows.set(address, payer.asset)
  }
  for (const [address, label] of labels) {
    if (GAUGE_KINDS.has(label.kind) && !gauges.has(address)) {
      gauges.set(address, {
        kind: "gauge",
        stakingToken: null,
        rewardToken: MEZO_TOKEN,
      })
    }
  }
  // Each member Safe's own signers: "same signers" means the same set as
  // one member Safe, not the union of all of them.
  const memberSets = [...members]
    .map((member) => new Set(owners.get(member) ?? []))
    .filter((set) => set.size > 0)
  const related = new Map<string, string>()
  for (const [address, signers] of owners) {
    if (members.has(address) || memberSets.length === 0) continue
    let best = 0
    let same = false
    for (const set of memberSets) {
      const shared = signers.filter((signer) => set.has(signer)).length
      if (shared === signers.length && shared === set.size) same = true
      best = Math.max(best, shared)
    }
    if (best === 0) continue
    related.set(
      address,
      same
        ? "Safe, same signers"
        : `Safe, ${best} of ${signers.length} signers shared`,
    )
  }
  for (const set of memberSets) {
    for (const signer of set) {
      if (!related.has(signer)) related.set(signer, "signer of the Safe")
    }
  }

  function nameOf(address: string): string | null {
    const key = address.toLowerCase()
    return (
      KNOWN_NAMES.get(key) ??
      related.get(key) ??
      labels.get(key)?.name ??
      names.get(key) ??
      null
    )
  }

  function claimOf(transfer: ChainTransfer): ClaimInfo | null {
    if (transfer.from === ZERO_ADDRESS) return null
    // A gauge returns staked principal or pays emissions: never a claim,
    // even though vault and pool gauges answer ve() like reward contracts.
    if (gauges.has(transfer.from)) return null
    const label = labels.get(transfer.from)
    const kind = label ? REWARD_KINDS[label.kind] : undefined
    if (kind !== undefined) {
      return { kind, source: label?.name ?? null, lock: null }
    }
    // A distributor pays the owner directly only for an expired lock.
    const distributor = distributors.get(transfer.from)
    if (distributor !== undefined) {
      return {
        kind: distributor === "veBTC" ? "chainFees" : "rebase",
        source:
          label?.name ??
          (distributor === "veBTC"
            ? "Chain fee distributor"
            : "Rebase distributor"),
        lock: null,
      }
    }
    if (/RewardsDistributor/.test(transfer.fromName ?? "")) {
      return { kind: "rebase", source: "Rewards distributor", lock: null }
    }
    const escrow = rewardEscrows.get(transfer.from)
    if (escrow !== undefined) {
      return {
        kind: "rewards",
        source: `${escrow} reward contract ${shortAddress(transfer.from)}`,
        lock: null,
      }
    }
    return null
  }

  function destinationOf(transfer: ChainTransfer): Destination {
    const to = transfer.to
    const escrow = ESCROW_ASSET.get(to)
    if (escrow !== undefined) {
      const target = lockTargets.get(`${transfer.tx}:${transfer.logIndex}`)
      return target
        ? {
            kind: "locked",
            asset: target.asset,
            tokenId: target.tokenId,
            owner: target.owner,
            own: target.own,
          }
        : {
            kind: "locked",
            asset: escrow,
            tokenId: null,
            owner: null,
            own: null,
          }
    }
    if (to === ZERO_ADDRESS) return { kind: "burned" }
    const label = labels.get(to)
    const name = label?.name ?? transfer.toName
    const tags = label?.tags ?? []
    if (
      tags.includes("bridge") ||
      /\b(?:Ntt|Wormhole|Bridge|Portal|LayerZero|OFT|Hyperlane|CCIP)/i.test(
        name ?? "",
      )
    ) {
      // Native BTC paid alongside a token bridged in the same transaction
      // is the bridge's fee, not BTC leaving Mezo.
      const via = name ?? shortAddress(to)
      return transfer.native === true && bridgesToken(transfer)
        ? { kind: "fee", via }
        : { kind: "bridged", via }
    }
    if (to === SAVINGS_RATE || /SavingsRate/.test(name ?? "")) {
      return { kind: "deposited", into: "MUSD Savings", name: null, to: null }
    }
    if (
      (label !== undefined &&
        /^(?:pool|gauge|morphoVault|vault)$/.test(label.kind)) ||
      /(?:Pool|Gauge|Vault|Pair)$/.test(transfer.toName ?? "")
    ) {
      return {
        kind: "deposited",
        into: `${name ?? "a pool"} ${shortAddress(to)}`.slice(0, 60),
        name: name ?? null,
        to,
      }
    }
    const relation = related.get(to)
    if (relation !== undefined) {
      return { kind: "sent", to, label: relation, relation: "related" }
    }
    return {
      kind: "sent",
      to,
      label: KNOWN_NAMES.get(to) ?? name ?? null,
      relation: transfer.toContract ? "contract" : "wallet",
    }
  }

  /** Another token sent to a bridge in the same transaction. */
  function bridgesToken(native: ChainTransfer): boolean {
    return transfers.some(
      (each) =>
        each.tx === native.tx &&
        each.native !== true &&
        members.has(each.from) &&
        each.token !== BTC_TOKEN,
    )
  }

  function poolLike(address: string, name: string | null): boolean {
    const label = labels.get(address)
    if (label !== undefined && POOL_KINDS.test(label.kind)) return true
    return POOL_NAME.test(label?.name ?? name ?? "")
  }

  function swapPair(out: ChainTransfer, inflow: ChainTransfer): boolean {
    const from = inflow.from
    if (gauges.has(from) || DISTRIBUTORS.has(from)) return false
    if (rewardEscrows.has(from) || ESCROW_ASSET.has(from)) return false
    // A burn pairs only with the burned token's own contract paying out:
    // a vault redeeming its shares. A loan repaid is a burn, not a swap.
    if (out.to === ZERO_ADDRESS) return from === out.token
    if (from === out.to) return true
    return inflow.fromContract && poolLike(from, inflow.fromName)
  }

  function swapLeg(transfer: ChainTransfer): boolean {
    const to = transfer.to
    if (to === ZERO_ADDRESS) return true
    if (to === ESCROWS.veBTC || to === ESCROWS.veMEZO) return false
    if (!transfer.toContract || isSafeName(transfer.toName)) return false
    if (KNOWN_NAMES.has(to) || related.has(to)) return false
    return true
  }

  return {
    members,
    labels,
    rewardEscrows,
    gauges,
    related,
    nameOf,
    claimOf,
    destinationOf,
    swapLeg,
    swapPair,
  }
}

/** Matchscan address links for the entity's members. */
export function memberEvidence(
  scope: IdScope,
  subject: Subject,
  fetchedAt: string,
): Evidence[] {
  return subject.members.slice(0, 4).map((member, index) =>
    makeEvidence({
      scope,
      key: `member.${index}`,
      kind: "chain",
      label: `${shortAddress(member.address)} ${member.role}`.slice(0, 60),
      source: member.source,
      url: addressUrl(member.address),
      fetchedAt,
      status: "live",
    }),
  )
}

export function transfersEvidence(input: {
  scope: IdScope
  fetchedAt: string
  partial: boolean
}): Evidence {
  return makeEvidence({
    scope: input.scope,
    key: "transfers",
    kind: "indexer",
    label: input.partial ? "Token transfers, partial" : "Token transfers",
    source: "Blockscout token transfers via the Matchbox API",
    fetchedAt: input.fetchedAt,
    status: input.partial ? "stale" : "live",
  })
}
