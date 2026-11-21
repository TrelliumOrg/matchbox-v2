import type { Address } from "viem"
import type { ChainTransfer } from "./providers/chainActivity"

// Where claimed rewards went. Fungible tokens cannot be followed exactly
// once they mix with other balances, so the method is fixed and stated in
// every answer: each liquid claim is a lot; an outflow of the same token
// from the same address within the window spends the oldest open lots
// first (first in, first out), up to the claimed amount, before any other
// balance (claimed first). By default the window runs to the end of the
// period. A lot sent to another of the entity's own addresses moves there
// and its window starts again on arrival; a lot swapped in one
// transaction (token out, another token in from the pool or router it
// paid, or a vault redeeming its burned shares) continues as the token
// received, still counted in the claimed token. A burn with no such
// payment (a loan repaid) is a burn. A lot no outflow spends before its
// window ends is "kept past N days", later moves not attributed; a lot
// whose window is still open at the end is "still held" only up to the
// address's balance now, and any excess left by a route the token
// transfers do not show.
//
// Rebases and chain fees for a live lock never reach the owner: the
// distributor deposits them into the lock. Those claims arrive here
// already settled as compounded into their lock.

export const FLOW_METHOD_VERSION = "flows.claimed-fifo.v3"

export type ClaimKind =
  | "incentives"
  | "fees"
  | "rebase"
  | "chainFees"
  | "rewards"

export type ClaimInfo = {
  kind: ClaimKind
  /** The reward contract's label ("Fees vAMM BTC/MUSD"), if known. */
  source: string | null
  /** The lock the claim was for, when the data says ("veBTC #6033"). */
  lock: string | null
}

export type FlowClaim = ClaimInfo & {
  index: number
  tx: string
  at: number
  member: Address
  token: Address
  symbol: string
  decimals: number
  amount: bigint
  from: Address
}

/** A rebase or chain fee the distributor deposited into a member's lock. */
export type CompoundedClaim = {
  tx: string
  at: number
  /** The lock's owner when it was claimed. */
  member: Address
  asset: "veBTC" | "veMEZO"
  tokenId: string
  token: Address
  symbol: string
  decimals: number
  amount: bigint
  kind: "rebase" | "chainFees"
  from: Address
}

/** A swap on the way: "swapped to " and the token's own symbol. */
const SWAPPED = "swapped to "

export type Destination =
  | {
      kind: "locked"
      asset: "veBTC" | "veMEZO"
      /** The lock deposited into; null when it could not be read. */
      tokenId: string | null
      owner: Address | null
      /** True: the entity's own lock. False: it funded someone else's. */
      own: boolean | null
    }
  | { kind: "compounded"; asset: "veBTC" | "veMEZO"; tokenId: string }
  | { kind: "bridged"; via: string }
  /** Native BTC paid to a bridge with a transfer: its fee, not the asset. */
  | { kind: "fee"; via: string }
  /**
   * `into` as printed; `name` the contract's own name in it, if any (chain
   * text), and `to` its address, if any.
   */
  | { kind: "deposited"; into: string; name: string | null; to: Address | null }
  | { kind: "burned" }
  | {
      kind: "sent"
      to: Address
      label: string | null
      relation: "related" | "contract" | "wallet"
    }
  /** The window ended with no outflow; whether it is still there is unknown. */
  | {
      kind: "unmoved"
      at: Address
      /** The token the lot is in now (after any swap). */
      token: Address
      days: number
      open: boolean
    }
  /** Checked against the address's balance now. */
  | { kind: "held"; at: Address }
  /** More than the balance now: it left by a route not in the transfers. */
  | { kind: "untracked"; at: Address }

/** The outflow a lot first left in, as the claimed token. */
export type Batch = { tx: string; total: bigint }

export type FlowOutcome = {
  claim: number
  /** In the claimed token's base units. */
  amount: bigint
  /** Swaps on the way ("swapped to BTC"), in order. */
  via: string[]
  /** The entity's own addresses the lot passed through after the claim. */
  hops: Address[]
  destination: Destination
  /** The transaction that settled it; null for held lots. */
  tx: string | null
  at: number | null
  /** All the entity sent of the claimed token in that transaction. */
  batch: Batch | null
}

export type FlowInput = {
  members: ReadonlySet<string>
  transfers: readonly ChainTransfer[]
  /** Claim details when `transfer` (into a member) is a reward claim. */
  claimOf: (transfer: ChainTransfer) => ClaimInfo | null
  /** Where an outflow to a non-member went (no swap in the transaction). */
  destinationOf: (transfer: ChainTransfer) => Destination
  /**
   * Whether an outflow can be one leg of a swap or redemption: sent to a
   * pool, router or vault, or burned. Never a transfer to a wallet or a
   * Safe, even when the same transaction also receives another token.
   */
  swapLeg: (transfer: ChainTransfer) => boolean
  /**
   * Whether `inflow` pays for `out` in a swap: it came from the pool or
   * router `out` went to (or one like it), or, for a burn, from the
   * burned token's own contract (a vault redeeming shares). Default: from
   * the address `out` went to.
   */
  swapPair?: (out: ChainTransfer, inflow: ChainTransfer) => boolean
  windowSeconds: number
  /** Claims before this are left out (unix seconds). */
  since: number
  /** The end of the data read (unix seconds), usually now. */
  until: number
  /**
   * Claims after this are left out (the period's end); what was claimed
   * before it is still followed to `until`. Default: `until`.
   */
  claimsUntil?: number
  /** Liquid claims of a member before this are left out (partial reads). */
  memberSince?: ReadonlyMap<string, number>
  /** Rewards compounded into the members' locks. */
  compounded?: readonly CompoundedClaim[]
  /** Balances now, keyed `member:token`, to check what is still held. */
  balances?: ReadonlyMap<string, bigint>
}

export type FlowResult = {
  claims: FlowClaim[]
  outcomes: FlowOutcome[]
}

type Lot = {
  claim: number
  token: string
  claimToken: string
  member: string
  /** Current units of `token`. */
  amount: bigint
  /** The same lot in the claimed token's units. */
  origin: bigint
  expires: number
  via: string[]
  hops: Address[]
  batch: Batch | null
}

function key(member: string, token: string): string {
  return `${member}:${token}`
}

/** Unique transfers, oldest first (block, then log index). */
export function orderTransfers(
  transfers: readonly ChainTransfer[],
): ChainTransfer[] {
  const seen = new Set<string>()
  const unique: ChainTransfer[] = []
  for (const transfer of transfers) {
    const id = `${transfer.tx}:${transfer.logIndex}`
    if (seen.has(id)) continue
    seen.add(id)
    unique.push(transfer)
  }
  return unique.sort((a, b) => a.block - b.block || a.logIndex - b.logIndex)
}

function share(amount: bigint, part: bigint, whole: bigint): bigint {
  return whole === 0n ? 0n : (amount * part) / whole
}

/** Larger first; ties keep their order. */
export function byAmountDesc(a: bigint, b: bigint): number {
  return b > a ? 1 : b < a ? -1 : 0
}

export function traceRewardFlows(input: FlowInput): FlowResult {
  const ordered = orderTransfers(input.transfers)
  const byTx = new Map<string, ChainTransfer[]>()
  for (const transfer of ordered) {
    const list = byTx.get(transfer.tx) ?? []
    list.push(transfer)
    byTx.set(transfer.tx, list)
  }
  const isMember = (address: string) => input.members.has(address.toLowerCase())
  const windowDays = Math.round(input.windowSeconds / 86_400)
  const claimsUntil = Math.min(input.claimsUntil ?? input.until, input.until)
  const claims: FlowClaim[] = []
  const outcomes: FlowOutcome[] = []
  const open = new Map<string, Lot[]>()

  // Compounded rewards: claimed and settled in one step.
  for (const each of input.compounded ?? []) {
    if (each.at < input.since || each.at > claimsUntil) continue
    const index = claims.length
    claims.push({
      kind: each.kind,
      source:
        each.kind === "chainFees"
          ? "Chain fee distributor"
          : "Rebase distributor",
      lock: `${each.asset} #${each.tokenId}`,
      index,
      tx: each.tx,
      at: each.at,
      member: each.member,
      token: each.token,
      symbol: each.symbol,
      decimals: each.decimals,
      amount: each.amount,
      from: each.from,
    })
    outcomes.push({
      claim: index,
      amount: each.amount,
      via: [],
      hops: [],
      destination: {
        kind: "compounded",
        asset: each.asset,
        tokenId: each.tokenId,
      },
      tx: each.tx,
      at: each.at,
      batch: null,
    })
  }

  /** What members sent of `token` to non-members in one transaction. */
  function batchOf(tx: string, token: string): Batch {
    const total = (byTx.get(tx) ?? [])
      .filter(
        (each) =>
          each.token === token && isMember(each.from) && !isMember(each.to),
      )
      .reduce((sum, each) => sum + each.amount, 0n)
    return { tx, total }
  }

  function push(lot: Lot): void {
    if (lot.amount <= 0n) return
    const id = key(lot.member, lot.token)
    const list = open.get(id) ?? []
    list.push(lot)
    open.set(id, list)
  }

  function expire(id: string, at: number): void {
    const list = open.get(id)
    if (!list) return
    const kept: Lot[] = []
    for (const lot of list) {
      if (lot.expires < at) {
        outcomes.push({
          claim: lot.claim,
          amount: lot.origin,
          via: lot.via,
          hops: lot.hops,
          destination: {
            kind: "unmoved",
            at: lot.member as Address,
            token: lot.token as Address,
            days: windowDays,
            open: false,
          },
          tx: null,
          at: null,
          batch: lot.batch,
        })
      } else {
        kept.push(lot)
      }
    }
    open.set(id, kept)
  }

  /** Spends open lots FIFO, up to `amount`; returns the spent slices. */
  function spend(id: string, amount: bigint): Lot[] {
    const list = open.get(id) ?? []
    const spent: Lot[] = []
    let left = amount
    while (left > 0n && list.length > 0) {
      const lot = list[0]
      if (lot === undefined) break
      if (lot.amount <= left) {
        spent.push(lot)
        left -= lot.amount
        list.shift()
      } else {
        const origin = share(lot.origin, left, lot.amount)
        spent.push({ ...lot, amount: left, origin })
        lot.amount -= left
        lot.origin -= origin
        left = 0n
      }
    }
    open.set(id, list)
    return spent
  }

  for (const transfer of ordered) {
    const fromMember = isMember(transfer.from)
    const toMember = isMember(transfer.to)
    // A claim: reward tokens arriving at a member from a reward contract.
    const memberSince = input.memberSince?.get(transfer.to) ?? input.since
    if (
      toMember &&
      !fromMember &&
      transfer.at >= Math.max(input.since, memberSince) &&
      transfer.at <= claimsUntil
    ) {
      const info = input.claimOf(transfer)
      if (info !== null) {
        const index = claims.length
        claims.push({
          ...info,
          index,
          tx: transfer.tx,
          at: transfer.at,
          member: transfer.to,
          token: transfer.token,
          symbol: transfer.symbol,
          decimals: transfer.decimals,
          amount: transfer.amount,
          from: transfer.from,
        })
        push({
          claim: index,
          token: transfer.token,
          claimToken: transfer.token,
          member: transfer.to,
          amount: transfer.amount,
          origin: transfer.amount,
          expires: transfer.at + input.windowSeconds,
          via: [],
          hops: [],
          batch: null,
        })
        continue
      }
    }
    if (!fromMember) continue
    const id = key(transfer.from, transfer.token)
    expire(id, transfer.at)
    const spent = spend(id, transfer.amount)
    if (spent.length === 0) continue
    if (toMember) {
      // Moved to another of the entity's addresses: the lot follows, and
      // its window starts again there.
      for (const lot of spent) {
        push({
          ...lot,
          member: transfer.to,
          hops: [...lot.hops, transfer.to],
          expires: transfer.at + input.windowSeconds,
        })
      }
      continue
    }
    const batched = (lot: Lot): Batch | null =>
      lot.batch ??
      (lot.token === lot.claimToken
        ? batchOf(transfer.tx, transfer.token)
        : null)
    const sameTx = input.swapLeg(transfer) ? (byTx.get(transfer.tx) ?? []) : []
    const paired = input.swapPair ?? ((out, inflow) => inflow.from === out.to)
    const received = sameTx.filter(
      (other) =>
        other.to === transfer.from &&
        !isMember(other.from) &&
        other.token !== transfer.token &&
        input.claimOf(other) === null &&
        paired(transfer, other),
    )
    // The counterparty's own payment first (a pool paying out the swap).
    const receivedToken =
      received.find((other) => other.from === transfer.to) ?? received[0]
    if (receivedToken !== undefined) {
      // A swap or redemption: token out, another token in, one transaction.
      const total = received
        .filter((each) => each.token === receivedToken.token)
        .reduce((sum, each) => sum + each.amount, 0n)
      for (const lot of spent) {
        push({
          claim: lot.claim,
          token: receivedToken.token,
          claimToken: lot.claimToken,
          member: transfer.from,
          amount: share(total, lot.amount, transfer.amount),
          origin: lot.origin,
          expires: lot.expires,
          via: [...lot.via, `${SWAPPED}${receivedToken.symbol}`],
          hops: lot.hops,
          batch: batched(lot),
        })
      }
      continue
    }
    const destination = input.destinationOf(transfer)
    for (const lot of spent) {
      outcomes.push({
        claim: lot.claim,
        amount: lot.origin,
        via: lot.via,
        hops: lot.hops,
        destination,
        tx: transfer.tx,
        at: transfer.at,
        batch: batched(lot),
      })
    }
  }

  // Lots still open at the end: held, up to the balance now.
  for (const [id, list] of open) {
    const lots = list.filter((lot) => lot.origin > 0n)
    if (lots.length === 0) continue
    const balance = input.balances?.get(id)
    const total = lots
      .filter((lot) => lot.expires >= input.until)
      .reduce((sum, lot) => sum + lot.amount, 0n)
    for (const lot of lots) {
      const at = lot.member as Address
      const settle = (amount: bigint, destination: Destination) => {
        if (amount <= 0n) return
        outcomes.push({
          claim: lot.claim,
          amount,
          via: lot.via,
          hops: lot.hops,
          destination,
          tx: null,
          at: null,
          batch: lot.batch,
        })
      }
      if (lot.expires < input.until) {
        settle(lot.origin, {
          kind: "unmoved",
          at,
          token: lot.token as Address,
          days: windowDays,
          open: false,
        })
      } else if (balance === undefined) {
        settle(lot.origin, {
          kind: "unmoved",
          at,
          token: lot.token as Address,
          days: windowDays,
          open: true,
        })
      } else {
        // Each lot keeps its share of what the address still has.
        const kept =
          balance >= total ? lot.origin : share(lot.origin, balance, total)
        settle(kept, { kind: "held", at })
        settle(lot.origin - kept, { kind: "untracked", at })
      }
    }
  }
  return { claims, outcomes }
}

/** One line of the summary: a destination and its share of a token. */
export type FlowBucket = {
  label: string
  /**
   * The label without any name read from chain (a contract's or label's
   * name, a bridge, a swapped-to symbol): Stuart's words, addresses and
   * lock ids only. Model rows source from it; the names go in `names`.
   */
  plain: string
  /** The names `label` holds that `plain` leaves out. */
  names: string[]
  /** The destination alone, without the swaps on the way. */
  where: string
  /** The swaps on the way ("swapped to MUSD"), oldest first. */
  via: string[]
  kind: Destination["kind"]
  amount: bigint
  /** The newest transaction behind it (for a link). */
  tx: string | null
  to: Address | null
  /** All the entity sent of the token in the batches behind it. */
  batchTotal: bigint
  /** Locks behind a compounded line, most first. */
  locks: string[]
}

export type TokenFlow = {
  token: Address
  symbol: string
  decimals: number
  claimed: bigint
  /** Of `claimed`, compounded into locks. */
  compounded: bigint
  /** Claim transactions (one transaction may claim for many locks). */
  claims: number
  buckets: FlowBucket[]
}

/** The name a destination's label holds, read from chain, if any. */
export function destinationName(destination: Destination): string | null {
  switch (destination.kind) {
    case "bridged":
    case "fee":
      return destination.via
    case "deposited":
      return destination.to === null ? null : destination.name
    case "sent":
      return destination.label
    default:
      return null
  }
}

/**
 * How a destination reads. Without `named`, no name read from chain: "sent
 * to 0x…", "bridged out", "deposited into 0x…".
 */
export function destinationLabel(
  destination: Destination,
  named = true,
): string {
  switch (destination.kind) {
    case "locked":
      if (destination.tokenId === null) {
        return `deposited into the ${destination.asset} escrow`
      }
      if (destination.own === false && destination.owner !== null) {
        return `funded ${destination.asset} #${destination.tokenId} for ${destination.owner}`
      }
      return `locked into ${destination.asset} #${destination.tokenId}`
    case "compounded":
      return `compounded into ${destination.asset} #${destination.tokenId}`
    case "bridged":
      return named ? `bridged out (${destination.via})` : "bridged out"
    case "fee":
      return named
        ? `paid as a bridge fee (${destination.via})`
        : "paid as a bridge fee"
    case "deposited":
      return named || destination.to === null
        ? `deposited into ${destination.into}`
        : `deposited into ${destination.to}`
    case "burned":
      return "burned"
    case "sent":
      return destination.label === null || !named
        ? `sent to ${destination.to}`
        : `sent to ${destination.to} (${destination.label})`
    case "unmoved":
      return destination.open
        ? "not moved yet"
        : `kept past ${destination.days} days, later moves not attributed`
    case "held":
      return "still held"
    case "untracked":
      return "no longer held, route not in token transfers"
  }
}

function bucketKey(outcome: FlowOutcome): string {
  const destination = outcome.destination
  const where =
    destination.kind === "sent"
      ? `sent:${destination.to}`
      : destination.kind === "compounded"
        ? `compounded:${destination.asset}`
        : `${destination.kind}:${destinationLabel(destination)}`
  return `${outcome.via.join(">")}|${where}`
}

/** "compounded into veBTC #6033", "compounded into 13 veMEZO locks". */
function compoundedLabel(asset: string, locks: readonly string[]): string {
  return locks.length === 1
    ? `compounded into ${asset} #${locks[0]}`
    : `compounded into ${locks.length} ${asset} locks`
}

/** Outcomes summed per claimed token and destination, largest first. */
export function summarizeFlows(result: FlowResult): TokenFlow[] {
  const tokens = new Map<string, TokenFlow>()
  const bucketMaps = new Map<string, Map<string, FlowBucket>>()
  const claimTxs = new Map<string, Set<string>>()
  const batchTxs = new Map<FlowBucket, Set<string>>()
  const lockAmounts = new Map<FlowBucket, Map<string, bigint>>()
  for (const claim of result.claims) {
    const txs = claimTxs.get(claim.token) ?? new Set<string>()
    txs.add(claim.tx)
    claimTxs.set(claim.token, txs)
    const entry = tokens.get(claim.token) ?? {
      token: claim.token,
      symbol: claim.symbol,
      decimals: claim.decimals,
      claimed: 0n,
      compounded: 0n,
      claims: 0,
      buckets: [],
    }
    entry.claimed += claim.amount
    entry.claims = txs.size
    tokens.set(claim.token, entry)
  }
  for (const outcome of result.outcomes) {
    const claim = result.claims[outcome.claim]
    if (claim === undefined || outcome.amount <= 0n) continue
    const buckets = bucketMaps.get(claim.token) ?? new Map()
    bucketMaps.set(claim.token, buckets)
    const id = bucketKey(outcome)
    const destination = outcome.destination
    const label = [...outcome.via, destinationLabel(destination)].join(", ")
    // "swapped to X": X is a token's own symbol, chain text.
    const swapped = (each: string) => each.startsWith(SWAPPED)
    const name = destinationName(destination)
    const bucket: FlowBucket = buckets.get(id) ?? {
      label,
      plain: [
        ...outcome.via.map((each) => (swapped(each) ? "swapped" : each)),
        destinationLabel(destination, false),
      ].join(", "),
      names: [
        ...outcome.via
          .filter(swapped)
          .map((each) => each.slice(SWAPPED.length)),
        ...(name === null ? [] : [name]),
      ],
      where: destinationLabel(destination),
      via: outcome.via,
      kind: destination.kind,
      amount: 0n,
      tx: null,
      to: destination.kind === "sent" ? destination.to : null,
      batchTotal: 0n,
      locks: [],
    }
    bucket.amount += outcome.amount
    if (outcome.tx !== null) bucket.tx = outcome.tx
    if (outcome.batch !== null) {
      const seen = batchTxs.get(bucket) ?? new Set<string>()
      if (!seen.has(outcome.batch.tx)) {
        seen.add(outcome.batch.tx)
        bucket.batchTotal += outcome.batch.total
      }
      batchTxs.set(bucket, seen)
    }
    if (destination.kind === "compounded") {
      const entry = tokens.get(claim.token)
      if (entry) entry.compounded += outcome.amount
      const amounts = lockAmounts.get(bucket) ?? new Map<string, bigint>()
      amounts.set(
        destination.tokenId,
        (amounts.get(destination.tokenId) ?? 0n) + outcome.amount,
      )
      lockAmounts.set(bucket, amounts)
      bucket.locks = [...amounts.entries()]
        .sort((a, b) => byAmountDesc(a[1], b[1]))
        .map(([tokenId]) => tokenId)
      bucket.label = compoundedLabel(destination.asset, bucket.locks)
      bucket.plain = bucket.label
    }
    buckets.set(id, bucket)
  }
  for (const [token, entry] of tokens) {
    entry.buckets = [...(bucketMaps.get(token)?.values() ?? [])].sort((a, b) =>
      byAmountDesc(a.amount, b.amount),
    )
  }
  return [...tokens.values()]
}
