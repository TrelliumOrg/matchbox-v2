import {
  type ClaimPrices,
  estimateClaim,
  type HistoryToken,
  historyTokens,
  latestSettledDay,
  utcDay,
  valueClaim,
  waitingOn,
  withClaimValue,
} from "@matchbox/api/read-models/claim-prices"
import { gaugeColor } from "@matchbox/api/read-models/colors"
import { epochRef } from "@matchbox/api/read-models/gauges"
import {
  btcToken,
  currentPrice,
  fromRaw,
  knownTokens,
  mergeTokenAmounts,
  mezoToken,
  priceBreakdown,
  subtractUsd,
  sumUsd,
  toCents,
  usdValue,
} from "@matchbox/api/read-models/money"
import {
  type GaugeCards,
  projectLockRewards,
  suggestFor,
  totalProjected,
  votesByVoter,
} from "@matchbox/api/read-models/wallet-extras"
import { CONTRACTS } from "@matchbox/chain"
import type { VoterKind } from "@matchbox/contracts/market"
import {
  type ActivityRow,
  type Allocation,
  type Escrow,
  type GaugeDirectory,
  type GaugeRef,
  gaugeKindFor,
  type LockRef,
  type Prices,
  type Protocol,
  type ProtocolActivity,
  type ProtocolEpoch,
  type ProtocolHistory,
  type ProtocolStats,
  type TokenAmount,
  type TokenRef,
  type ValueBreakdown,
  type WalletActivity,
  type WalletLock,
  type WalletOverview,
  type WalletRewards,
} from "@matchbox/contracts/read-models"
import { EPOCH_SECONDS, EPOCH_ZERO_START, epochStartOf } from "@matchbox/domain"
import { earnedKey } from "./chain"
import type {
  ActivityEventRow,
  LockRow,
  ProtocolRows,
  RewardSourceRow,
  VoteRow,
} from "./reader"

// Pure builders: warehouse rows plus chain reads into read models. No I/O.

const escrowByContract: Record<string, Escrow> = {
  [CONTRACTS.mainnet.veBTC.toLowerCase()]: "vebtc",
  [CONTRACTS.mainnet.veMEZO.toLowerCase()]: "vemezo",
}

const voterByContract: Record<string, VoterKind> = {
  [CONTRACTS.mainnet.boostVoter.toLowerCase()]: "boost",
  [CONTRACTS.mainnet.poolsVoter.toLowerCase()]: "pools",
  [CONTRACTS.mainnet.validatorsVoter.toLowerCase()]: "validators",
  [CONTRACTS.mainnet.thirdPartyVoter.toLowerCase()]: "third-party",
}

const voterBySource: Record<string, VoterKind> = {
  BOOST_VOTER: "boost",
  POOLS_VOTER: "pools",
  VALIDATORS_VOTER: "validators",
  THIRD_PARTY_VOTER: "third-party",
}

/** The escrow a voting-escrow contract address belongs to, if any. */
export function escrowForContract(address: string): Escrow | null {
  return escrowByContract[address.toLowerCase()] ?? null
}

/** veMEZO votes on boost and third-party gauges; veBTC on the rest. */
export function escrowForVoter(voter: VoterKind): Escrow {
  return voter === "boost" || voter === "third-party" ? "vemezo" : "vebtc"
}

/** Lower-case addresses of the voters veBTC votes through. */
export const vebtcVoterContracts = [
  CONTRACTS.mainnet.poolsVoter.toLowerCase(),
  CONTRACTS.mainnet.validatorsVoter.toLowerCase(),
]

const lockTokens: Record<Escrow, string> = {
  vebtc: btcToken,
  vemezo: mezoToken,
}

export type BuildContext = {
  nowSeconds: number
  prices: Prices
  /** Gauge refs from the latest gauge directory, by lower-case address. */
  gauges: Map<string, GaugeRef>
  /** Gauge cards (votes, incentives, boost) for projections. */
  cards: GaugeCards
  /** Historic prices for recent timestamps; null when no sample is near. */
  historicPrice: (token: "btc" | "mezo", timestamp: number) => string | null
  /**
   * Daily prices for claims' values when claimed (claim-prices.ts); null
   * when they could not be read this run, so those values are unknown.
   */
  claimPrices: ClaimPrices | null
  /**
   * veBTC and veMEZO `supply()` from the live snapshot (escrow_supply). The
   * protocol's locked totals use these: the warehouse's lock positions miss
   * locks created before its escrow history and some splits.
   */
  escrowSupply?: { vebtc: bigint | null; vemezo: bigint | null }
  /**
   * PoolsVoter's gauge for each pool (lower-case), read from the chain.
   * PoolsVoter events and vote rows name the pool; rows show its gauge.
   */
  poolGauges?: ReadonlyMap<string, string>
}

export function gaugeRefsFrom(directory: GaugeDirectory | null) {
  return new Map(
    (directory?.gauges ?? []).map((card) => [card.gauge.address, card.gauge]),
  )
}

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}

function gaugeRefFor(
  context: BuildContext,
  named: string,
  voter: VoterKind,
): GaugeRef {
  // PoolsVoter names the pool; the row shows the pool's gauge.
  const pooled =
    voter === "pools" ? context.poolGauges?.get(named.toLowerCase()) : undefined
  const address = pooled ?? named
  const known = context.gauges.get(address.toLowerCase())
  if (known !== undefined) return known
  return {
    address: address.toLowerCase(),
    voter,
    kind: gaugeKindFor(voter),
    name: shortAddress(address),
    vebtcTokenId: null,
    picture: { type: "initials", text: address.slice(2, 4).toUpperCase() },
    poolType: null,
    color: gaugeColor(address, voter, null),
    tickSpacing: null,
    coin: null,
  }
}

function tokenRef(address: string): TokenRef | undefined {
  return knownTokens[address.toLowerCase()]
}

/** USD of an amount at `timestamp`: a recent sample, else the current price. */
function priceAt(
  context: BuildContext,
  token: TokenRef,
  amount: string,
  timestamp: number,
): string | null {
  const symbol =
    token.address === btcToken
      ? "btc"
      : token.address === mezoToken
        ? "mezo"
        : null
  const historic =
    symbol === null ? null : context.historicPrice(symbol, timestamp)
  const price = historic ?? currentPrice(token.address, context.prices)
  return price === null ? null : usdValue(amount, price)
}

function amountOf(
  context: BuildContext,
  tokenAddress: string,
  raw: string | null,
  timestamp: number,
): TokenAmount | null {
  const token = tokenRef(tokenAddress)
  if (token === undefined || raw === null) return null
  const amount = fromRaw(BigInt(raw), token.decimals)
  return { token, amount, usd: priceAt(context, token, amount, timestamp) }
}

function breakdownOf(tokens: TokenAmount[]): ValueBreakdown {
  return {
    usd: sumUsd(
      tokens.flatMap((token) => (token.usd === null ? [] : [token.usd])),
    ),
    tokens,
  }
}

/** Basis points from weights, the remainder on the largest share. */
export function allocationsFrom(
  entries: readonly { gauge: GaugeRef; weight: bigint }[],
): Allocation[] {
  const total = entries.reduce((sum, entry) => sum + entry.weight, 0n)
  if (total === 0n) return []
  const allocations = entries.map((entry) => ({
    gauge: entry.gauge,
    basisPoints: Number((entry.weight * 10_000n) / total),
  }))
  const assigned = allocations.reduce(
    (sum, entry) => sum + entry.basisPoints,
    0,
  )
  let largest = 0
  allocations.forEach((entry, index) => {
    if (entry.basisPoints > (allocations[largest]?.basisPoints ?? 0)) {
      largest = index
    }
  })
  const top = allocations[largest]
  if (top !== undefined) top.basisPoints += 10_000 - assigned
  return allocations.sort((a, b) => b.basisPoints - a.basisPoints)
}

function rowBase(events: readonly ActivityEventRow[]) {
  const [first] = events
  if (first === undefined) throw new Error("rowBase needs at least one event")
  const logIndex = events.reduce(
    (min, event) =>
      BigInt(event.log_index) < min ? BigInt(event.log_index) : min,
    BigInt(first.log_index),
  )
  return {
    id: `${first.tx_hash}-${logIndex}`,
    txHash: first.tx_hash,
    block: Number(first.block_number),
    timestamp: Number(first.timestamp),
    status: "confirmed" as const,
    actor: (
      first.actor ??
      first.recipient ??
      first.contract_address
    ).toLowerCase(),
  }
}

function escrowOfEvent(event: ActivityEventRow): Escrow | null {
  return escrowByContract[event.contract_address.toLowerCase()] ?? null
}

function lockEventRow(
  context: BuildContext,
  event: ActivityEventRow,
): ActivityRow | null {
  const escrow = escrowOfEvent(event)
  if (escrow === null || event.token_id === null) return null
  const base = rowBase([event])
  const lock: LockRef = { escrow, tokenId: event.token_id }
  const amount =
    amountOf(
      context,
      lockTokens[escrow],
      event.amount ?? "0",
      base.timestamp,
    ) ?? null
  const unlocksAt =
    event.post_is_permanent === true || event.duration === null
      ? null
      : Number(event.duration)
  switch (event.action_type) {
    case "LOCK_CREATED":
      return amount === null
        ? null
        : { type: "lock-create", ...base, lock, amount, unlocksAt }
    case "LOCK_AMOUNT_INCREASED":
      return amount === null
        ? null
        : { type: "lock-add", ...base, lock, amount, unlocksAt }
    case "LOCK_PERMANENT":
      return {
        type: "lock-extend",
        ...base,
        lock,
        previousUnlocksAt:
          event.prev_is_permanent === true || event.prev_duration === null
            ? null
            : base.timestamp + Number(event.prev_duration),
        unlocksAt: null,
      }
    case "LOCK_PERMANENT_UNLOCKED":
      return {
        type: "lock-extend",
        ...base,
        lock,
        previousUnlocksAt: null,
        unlocksAt:
          event.post_duration === null
            ? null
            : base.timestamp + Number(event.post_duration),
      }
    case "LOCK_EXTENDED":
      return {
        type: "lock-extend",
        ...base,
        lock,
        previousUnlocksAt:
          event.prev_is_permanent === true || event.prev_duration === null
            ? null
            : base.timestamp + Number(event.prev_duration),
        unlocksAt,
      }
    case "LOCK_MERGED": {
      if (
        amount === null ||
        event.merge_source_token_id === null ||
        event.merge_dest_token_id === null
      ) {
        return null
      }
      return {
        type: "lock-merge",
        ...base,
        from: { escrow, tokenId: event.merge_source_token_id },
        into: { escrow, tokenId: event.merge_dest_token_id },
        amount,
      }
    }
    case "LOCK_WITHDRAWN":
      return amount === null
        ? null
        : { type: "lock-withdraw", ...base, lock, amount }
    default:
      return null
  }
}

/** Groups a transaction's events into typed rows, newest first. */
export function activityRows(
  context: BuildContext,
  events: readonly ActivityEventRow[],
): ActivityRow[] {
  const byTx = new Map<string, ActivityEventRow[]>()
  for (const event of events) {
    byTx.set(event.tx_hash, [...(byTx.get(event.tx_hash) ?? []), event])
  }
  const rows: ActivityRow[] = []
  for (const txEvents of byTx.values()) {
    const votes = new Map<string, ActivityEventRow[]>()
    const claims: ActivityEventRow[] = []
    const pokes: ActivityEventRow[] = []
    for (const event of txEvents) {
      switch (event.action_type) {
        case "BOOST_VOTE": {
          const key = `${event.source}:${event.token_id}`
          votes.set(key, [...(votes.get(key) ?? []), event])
          break
        }
        case "VOTE_BRIBE_CLAIMED":
        case "VOTE_FEE_CLAIMED":
          claims.push(event)
          break
        case "BOOST_POKE":
          pokes.push(event)
          break
        case "INCENTIVE_ADDED": {
          const base = rowBase([event])
          const voter = voterBySource[event.source] ?? "boost"
          const amount =
            event.token === null
              ? null
              : amountOf(context, event.token, event.amount, base.timestamp)
          if (amount === null || event.gauge === null) break
          const epochStart =
            event.epoch_start === null
              ? epochStartOf(base.timestamp)
              : Number(event.epoch_start)
          rows.push({
            type: "incentive",
            ...base,
            gauge: gaugeRefFor(context, event.gauge, voter),
            epoch: epochRef(epochStartOf(epochStart)),
            amount,
          })
          break
        }
        default: {
          const row = lockEventRow(context, event)
          if (row !== null) rows.push(row)
        }
      }
    }
    for (const voteEvents of votes.values()) {
      const [first] = voteEvents
      if (first === undefined || first.token_id === null) continue
      const voter = voterBySource[first.source] ?? "boost"
      const base = rowBase(voteEvents)
      const entries = voteEvents.flatMap((event) =>
        event.gauge === null
          ? []
          : [
              {
                gauge: gaugeRefFor(context, event.gauge, voter),
                weight: BigInt(event.weight ?? "0"),
              },
            ],
      )
      const total = entries.reduce((sum, entry) => sum + entry.weight, 0n)
      rows.push({
        type: "vote",
        ...base,
        lock: { escrow: escrowForVoter(voter), tokenId: first.token_id },
        epoch: epochRef(epochStartOf(base.timestamp)),
        votes: fromRaw(total, 18),
        allocations: allocationsFrom(entries),
      })
    }
    if (claims.length > 0) {
      const base = rowBase(claims)
      const amounts = claims.flatMap((event) => {
        const amount =
          event.token === null
            ? null
            : amountOf(context, event.token, event.amount, base.timestamp)
        return amount === null ? [] : [amount]
      })
      const tokens = mergeTokenAmounts([amounts]).map((amount) => ({
        ...amount,
        usd: priceAt(context, amount.token, amount.amount, base.timestamp),
      }))
      const gauges = new Map<string, GaugeRef>()
      const locks = new Map<string, LockRef>()
      for (const event of claims) {
        if (event.gauge === null) continue
        const ref = gaugeRefFor(context, event.gauge, "boost")
        gauges.set(ref.address, ref)
        if (event.token_id !== null) {
          const lock = {
            escrow: escrowForVoter(ref.voter),
            tokenId: event.token_id,
          }
          locks.set(`${lock.escrow}:${lock.tokenId}`, lock)
        }
      }
      const claim: ActivityRow = {
        type: "claim",
        ...base,
        // Claims pay out the last finished epoch.
        epoch: epochRef(epochStartOf(base.timestamp) - EPOCH_SECONDS),
        rewards: breakdownOf(tokens),
        locks: [...locks.values()],
        gauges: [...gauges.values()],
      }
      rows.push(
        withEstimate(
          context,
          context.claimPrices === null
            ? claim
            : withClaimValue(claim, context.claimPrices),
        ),
      )
    }
    if (pokes.length > 0) {
      rows.push({
        type: "boost-refresh",
        ...rowBase(pokes),
        actorName: null,
        positions: pokes.length,
      })
    }
  }
  return rows.sort(
    (a, b) => b.timestamp - a.timestamp || b.id.localeCompare(a.id),
  )
}

export type WalletInputs = {
  wallet: string
  locks: LockRow[]
  votes: VoteRow[]
  events: ActivityEventRow[]
  rewardSources: RewardSourceRow[]
  votingPower: Map<string, bigint>
  earned: Map<string, bigint>
  /**
   * The wallet's claims from its stored history (history.ts), older ones
   * included, so Earned covers every claim and not only those among the
   * events read for the document. Absent: the document's own claims. Their
   * stored USD is not used: Earned is every claim's value when claimed.
   */
  storedClaims?: readonly ActivityRow[]
}

type LockDetail = {
  lock: WalletLock
  gauges: { gauge: GaugeRef; tokens: TokenAmount[] }[]
}

function buildLock(
  context: BuildContext,
  inputs: WalletInputs,
  row: LockRow,
  boosts: Map<string, string>,
): LockDetail | null {
  const escrow = escrowByContract[row.contract_address.toLowerCase()]
  if (escrow === undefined) return null
  const current = epochStartOf(context.nowSeconds)
  const unlocksAt =
    row.is_permanent || row.unlock_at === null ? null : Number(row.unlock_at)
  const expired = unlocksAt !== null && unlocksAt <= context.nowSeconds
  const lockVotes = inputs.votes.filter(
    (vote) =>
      vote.token_id === row.token_id &&
      escrowForVoter(
        voterByContract[vote.voter_contract.toLowerCase()] ?? "boost",
      ) === escrow,
  )
  const entries = lockVotes.map((vote) => ({
    gauge: gaugeRefFor(
      context,
      vote.gauge,
      voterByContract[vote.voter_contract.toLowerCase()] ?? "boost",
    ),
    weight: BigInt(vote.current_weight),
  }))
  const total = entries.reduce((sum, entry) => sum + entry.weight, 0n)
  const votedAt = lockVotes.reduce(
    (latest, vote) => Math.max(latest, Number(vote.last_updated_at)),
    0,
  )
  const epoch = epochRef(current)
  // Claimable per gauge: earned() on every reward contract funded there.
  const gauges = entries.map((entry) => {
    const amounts = inputs.rewardSources
      .filter((source) => source.gauge === entry.gauge.address)
      .flatMap((source) => {
        const raw = inputs.earned.get(
          earnedKey({
            rewardContract: source.reward_contract,
            token: source.token,
            tokenId: row.token_id,
          }),
        )
        const token = tokenRef(source.token)
        if (raw === undefined || token === undefined) return []
        return [{ token, amount: fromRaw(raw, token.decimals), usd: null }]
      })
    return {
      gauge: entry.gauge,
      tokens: priceBreakdown(mergeTokenAmounts([amounts]), context.prices)
        .tokens,
    }
  })
  const claimableTokens = mergeTokenAmounts(gauges.map((gauge) => gauge.tokens))
  const power = inputs.votingPower.get(`${escrow}:${row.token_id}`) ?? 0n
  const locked = amountOf(
    context,
    lockTokens[escrow],
    row.amount,
    context.nowSeconds,
  )
  if (locked === null) return null
  return {
    lock: {
      escrow,
      tokenId: row.token_id,
      tab: expired ? "expired" : escrow,
      locked: {
        ...locked,
        usd: (() => {
          const price = currentPrice(locked.token.address, context.prices)
          return price === null ? null : usdValue(locked.amount, price)
        })(),
      },
      votingPower: fromRaw(power, 18),
      unlocksAt,
      isPermanent: row.is_permanent,
      isWithdrawable: expired,
      vote:
        total > 0n
          ? {
              status: "voted",
              epoch,
              votes: fromRaw(total, 18),
              allocations: allocationsFrom(entries),
              votedAt,
              byVoter: votesByVoter(entries, (voter) =>
                lockVotes.reduce(
                  (latest, vote) =>
                    voterByContract[vote.voter_contract.toLowerCase()] === voter
                      ? Math.max(latest, Number(vote.last_updated_at))
                      : latest,
                  0,
                ),
              ),
            }
          : { status: "not-voted", epoch },
      claimable: priceBreakdown(claimableTokens, context.prices),
      projected: projectLockRewards(
        lockVotes.map((vote) => ({
          gauge: vote.gauge.toLowerCase(),
          weight: BigInt(vote.current_weight),
        })),
        context.cards,
        context.prices,
      ),
      boost: escrow === "vebtc" ? (boosts.get(row.token_id) ?? null) : null,
      createdAt: row.created_at === null ? null : Number(row.created_at),
    },
    gauges: gauges.filter((gauge) => gauge.tokens.length > 0),
  }
}

type ClaimRow = Extract<ActivityRow, { type: "claim" }>

/**
 * A claim not valued yet, inside the settling days, with its estimate:
 * the price sample nearest before it, else the latest price. Earned
 * leaves it out until the day is priced.
 */
function withEstimate(context: BuildContext, row: ActivityRow): ActivityRow {
  if (row.type !== "claim" || row.atClaim !== undefined) return row
  const estimate = estimateClaim(
    row,
    (token, timestamp) =>
      context.historicPrice(token, timestamp) ??
      context.prices[token]?.usd ??
      null,
    context.nowSeconds,
  )
  return estimate === undefined ? row : { ...row, estimate }
}

export type EarnedWhenClaimed = {
  /** Sum of every valued claim's value when claimed. */
  usd: string
  /** Valued claims with a token that had no price that day. */
  unpriced: number
  /** Claims whose day has no settled price yet: not in `usd`. */
  pending: number
  /** Of `pending`, the claims whose day is still settling. */
  settling: number
  /** The daily histories those pending claims wait on. */
  waitingOn: HistoryToken[]
}

/**
 * Earned at the claims' values when claimed: each claim's exact token
 * amounts by registry address at its UTC day's price (claim-prices.ts).
 * An unregistered or unpriced token counts no dollars. Null when the
 * prices could not be read this run.
 */
export function earnedWhenClaimed(
  context: BuildContext,
  claims: readonly ClaimRow[],
): EarnedWhenClaimed | null {
  const prices = context.claimPrices
  if (prices === null) return null
  const usd: string[] = []
  let unpriced = 0
  let pending = 0
  const waiting = new Set<HistoryToken>()
  for (const claim of claims) {
    const value = valueClaim(claim, prices)
    if (value === null) {
      pending += 1
      for (const token of waitingOn(claim, prices)) waiting.add(token)
      continue
    }
    usd.push(value.usd)
    if (value.tokens.some((token) => token.price === null)) unpriced += 1
  }
  return {
    usd: sumUsd(usd),
    unpriced,
    pending,
    settling: settlingClaims(context, claims, prices),
    waitingOn: historyTokens.filter((token) => waiting.has(token)),
  }
}

/** Claims with no value yet whose day is still settling. */
function settlingClaims(
  context: BuildContext,
  claims: readonly ClaimRow[],
  prices: ClaimPrices | null,
): number {
  const latest = latestSettledDay(context.nowSeconds)
  return claims.filter(
    (claim) =>
      utcDay(claim.timestamp) > latest &&
      (prices === null || valueClaim(claim, prices) === null),
  ).length
}

export type WalletDocuments = {
  overview: WalletOverview
  rewards: WalletRewards
  activity: WalletActivity
  /**
   * What `rewards.earned` sums, without prices: how many claims and their
   * token totals. The rewards document's `etagBasis`, so counting more
   * claims (a backfill, a closed gap) rewrites it although only its USD
   * changes.
   */
  earnedBasis: string
  /**
   * The daily histories Earned's pending claims wait on: a history behind
   * leaves those claims out for want of a call (the snapshot carries).
   */
  waitingOn: HistoryToken[]
}

export function buildWalletDocuments(
  context: BuildContext,
  inputs: WalletInputs,
  boosts: Map<string, string>,
): WalletDocuments {
  const details = inputs.locks.flatMap((row) => {
    const detail = buildLock(context, inputs, row, boosts)
    return detail === null ? [] : [detail]
  })
  const locks = details.map((detail) => detail.lock)
  const claimable = priceBreakdown(
    mergeTokenAmounts(locks.map((lock) => lock.claimable.tokens)),
    context.prices,
  )
  const rows = activityRows(context, inputs.events)
  const claimEpoch = epochRef(epochStartOf(context.nowSeconds) - EPOCH_SECONDS)
  const claims = rows.flatMap((row) => (row.type === "claim" ? [row] : []))
  const history = claims.slice(0, 12).map((row) => ({
    epoch: row.epoch ?? epochRef(epochStartOf(row.timestamp) - EPOCH_SECONDS),
    claimedAt: row.timestamp,
    rewards: row.rewards,
    ...(row.atClaim === undefined ? {} : { atClaim: row.atClaim }),
    ...(row.estimate === undefined ? {} : { estimate: row.estimate }),
    txHash: row.txHash,
    block: row.block ?? 0,
  }))
  // Earned: every claim known, the document's and the stored history's.
  const known = new Map(claims.map((row) => [row.id, row]))
  for (const row of inputs.storedClaims ?? []) {
    if (row.type === "claim" && !known.has(row.id)) known.set(row.id, row)
  }
  const allClaims = [...known.values()].flatMap((row) =>
    row.type === "claim" ? [row] : [],
  )
  // Unknown this run (the prices could not be read): Earned reads $0 with
  // every claim pending, and the snapshot carries the previous figure.
  const whenClaimed = earnedWhenClaimed(context, allClaims) ?? {
    usd: "0.00",
    unpriced: 0,
    pending: allClaims.length,
    settling: settlingClaims(context, allClaims, null),
    waitingOn: [],
  }
  const claimedTokens = mergeTokenAmounts(
    allClaims.map((row) => row.rewards.tokens),
  )
    .map((amount) => `${amount.token.address.toLowerCase()}=${amount.amount}`)
    .sort()
  const epochNumbers = allClaims.map(
    (row) =>
      (row.epoch ?? epochRef(epochStartOf(row.timestamp) - EPOCH_SECONDS))
        .number,
  )
  const hasClaimable = claimable.tokens.length > 0
  const claimableEpoch = hasClaimable ? claimEpoch : null
  return {
    overview: {
      address: inputs.wallet,
      claimableEpoch,
      claimable,
      locks,
      projected: totalProjected(locks, context.prices),
      suggestion: suggestFor({
        locks,
        cards: context.cards,
        claimableEpoch,
        claimable,
      }),
      recentActivity: rows.slice(0, 3),
    },
    rewards: {
      address: inputs.wallet,
      epoch: hasClaimable ? claimEpoch : null,
      readyToClaim: claimable,
      byLock: details
        .filter((detail) => detail.lock.claimable.tokens.length > 0)
        .map((detail) => ({
          lock: { escrow: detail.lock.escrow, tokenId: detail.lock.tokenId },
          rewards: detail.lock.claimable,
          gauges: detail.gauges.map((gauge) => {
            const priced = priceBreakdown(gauge.tokens, context.prices)
            return {
              gauge: gauge.gauge,
              usd: priced.usd,
              tokens: priced.tokens,
            }
          }),
        })),
      earned: {
        usd: whenClaimed.usd,
        fromEpoch: epochNumbers.length === 0 ? null : Math.min(...epochNumbers),
        toEpoch: epochNumbers.length === 0 ? null : Math.max(...epochNumbers),
        whenClaimed: {
          unpriced: whenClaimed.unpriced,
          pending: whenClaimed.pending,
          settling: whenClaimed.settling,
        },
      },
      history,
    },
    activity: { address: inputs.wallet, rows, nextCursor: null },
    // The values when claimed are fixed once known, so their sum is part
    // of the basis: a claim priced on a later run rewrites the document.
    earnedBasis: `${allClaims.length}:${claimedTokens.join(",")}:${whenClaimed.usd}:${whenClaimed.unpriced}:${whenClaimed.pending}`,
    waitingOn: whenClaimed.waitingOn,
  }
}

const segmentBySource: Record<
  string,
  "vebtcUsd" | "validatorsUsd" | "poolsUsd"
> = {
  BOOST_VOTER: "vebtcUsd",
  VALIDATORS_VOTER: "validatorsUsd",
  POOLS_VOTER: "poolsUsd",
}

function median(values: readonly string[]): string | null {
  if (values.length === 0) return null
  const scaled = values
    .map((value) => {
      const [whole = "0", fraction = ""] = value.split(".")
      return BigInt(whole) * 100n + BigInt(fraction.slice(0, 2).padEnd(2, "0"))
    })
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  const middle = Math.floor(scaled.length / 2)
  const value =
    scaled.length % 2 === 1
      ? (scaled[middle] ?? 0n)
      : ((scaled[middle - 1] ?? 0n) + (scaled[middle] ?? 0n)) / 2n
  return `${value / 100n}.${(value % 100n).toString().padStart(2, "0")}`
}

type EpochTotals = {
  total: string[]
  vebtcUsd: string[]
  validatorsUsd: string[]
  poolsUsd: string[]
  deposits: number
  funded: Map<
    string,
    { gauge: GaugeRef; amounts: TokenAmount[]; deposits: number }
  >
}

/** Epoch starts from Epoch 0 to the current epoch, oldest first. */
export function epochsSinceLaunch(nowSeconds: number): number[] {
  const current = epochStartOf(nowSeconds)
  const starts: number[] = []
  for (let start = EPOCH_ZERO_START; start <= current; start += EPOCH_SECONDS) {
    starts.push(start)
  }
  return starts.length === 0 ? [current] : starts
}

/** Incentive deposits per epoch, split by voter, with funded gauges. */
function epochTotals(
  context: BuildContext,
  rows: ProtocolRows,
): Map<number, EpochTotals> {
  const totals = new Map<number, EpochTotals>()
  for (const start of epochsSinceLaunch(context.nowSeconds)) {
    totals.set(start, {
      total: [],
      vebtcUsd: [],
      validatorsUsd: [],
      poolsUsd: [],
      deposits: 0,
      funded: new Map(),
    })
  }
  for (const deposit of rows.deposits) {
    const start = epochStartOf(Number(deposit.epoch_start))
    const bar = totals.get(start)
    if (bar === undefined) continue
    const amount = amountOf(context, deposit.token, deposit.amount, start)
    if (amount === null) continue
    const usd = amount.usd ?? "0"
    bar.total.push(usd)
    bar.deposits += deposit.deposits
    const segment = segmentBySource[deposit.voter_source]
    if (segment !== undefined) bar[segment].push(usd)
    const voter = voterBySource[deposit.voter_source] ?? "boost"
    const ref = gaugeRefFor(context, deposit.gauge, voter)
    const entry = bar.funded.get(ref.address) ?? {
      gauge: ref,
      amounts: [],
      deposits: 0,
    }
    entry.amounts.push(amount)
    entry.deposits += deposit.deposits
    bar.funded.set(ref.address, entry)
  }
  return totals
}

function barOf(start: number, bar: EpochTotals) {
  return {
    epoch: epochRef(start),
    totalUsd: sumUsd(bar.total),
    vebtcUsd: sumUsd(bar.vebtcUsd),
    validatorsUsd: sumUsd(bar.validatorsUsd),
    poolsUsd: sumUsd(bar.poolsUsd),
  }
}

function fundedOf(context: BuildContext, bar: EpochTotals) {
  return [...bar.funded.values()]
    .map((entry) => ({
      gauge: entry.gauge,
      incentives: priceBreakdown(
        mergeTokenAmounts([entry.amounts]),
        context.prices,
      ),
      deposits: entry.deposits,
    }))
    .sort((a, b) => {
      const difference = toCents(b.incentives.usd) - toCents(a.incentives.usd)
      return difference > 0n ? 1 : difference < 0n ? -1 : 0
    })
}

function statsOf(
  context: BuildContext,
  rows: ProtocolRows,
  directory: GaugeDirectory | null,
): ProtocolStats {
  const stat = (escrow: Escrow) =>
    rows.lockStats.find(
      (row) => escrowByContract[row.contract_address.toLowerCase()] === escrow,
    )
  const vemezo = stat("vemezo")
  const vebtc = stat("vebtc")
  const supply = context.escrowSupply
  const vebtcLocked = fromRaw(supply?.vebtc ?? BigInt(vebtc?.amount ?? "0"), 18)
  const btcPrice = currentPrice(btcToken, context.prices)
  const fundedApys = (directory?.gauges ?? []).flatMap((card) =>
    card.apy === null ? [] : [card.apy],
  )
  return {
    vemezoLocked: fromRaw(supply?.vemezo ?? BigInt(vemezo?.amount ?? "0"), 18),
    vemezoLockers: vemezo?.lockers ?? 0,
    vebtcLocked,
    vebtcLockedUsd: btcPrice === null ? null : usdValue(vebtcLocked, btcPrice),
    vebtcVoteWeight: fromRaw(BigInt(rows.vebtcVoteWeight), 18),
    vebtcVotes: rows.vebtcVotes,
    medianApy: median(fundedApys),
  }
}

export function buildProtocol(
  context: BuildContext,
  rows: ProtocolRows,
  directory: GaugeDirectory | null,
): Protocol {
  const current = epochStartOf(context.nowSeconds)
  const totals = epochTotals(context, rows)
  const incentivesByEpoch = [...totals.entries()].map(([start, bar]) =>
    barOf(start, bar),
  )
  const now = incentivesByEpoch.at(-1)?.totalUsd ?? "0.00"
  const previous = incentivesByEpoch.at(-2)?.totalUsd ?? null
  const currentTotals = totals.get(current)
  const fundedGauges =
    currentTotals === undefined ? [] : fundedOf(context, currentTotals)
  return {
    epoch: epochRef(current),
    incentives: {
      usd: now,
      previousUsd: previous,
      changeUsd: previous === null ? null : subtractUsd(now, previous),
    },
    stats: statsOf(context, rows, directory),
    incentivesByEpoch,
    funded: { count: fundedGauges.length, gauges: fundedGauges },
    feed: {
      total: rows.feedTotal,
      rows: activityRows(context, rows.feed).slice(0, 20),
    },
  }
}

/**
 * The most rows kept for the Protocol page's "Load more" and filters. A
 * row is about 1.5 kB of JSON, so a full document is 300 kB, written only
 * when the feed moved. The snapshot reads 120 event rows today, which is
 * at most 120 rows here and usually fewer.
 */
export const protocolActivityRows = 200

/** The latest activity of everyone, newest first (see the contract). */
export function buildProtocolActivity(
  context: BuildContext,
  rows: ProtocolRows,
): ProtocolActivity {
  return {
    rows: activityRows(context, rows.feed).slice(0, protocolActivityRows),
  }
}

/** Funded gauges kept per past epoch document. */
const fundedPerEpoch = 50

/**
 * Protocol history: one summary row per epoch since launch, and one detail
 * document per epoch. The current epoch carries today's stats; past epochs
 * keep the stats their document had when the epoch ended (`frozenStats`),
 * or null for epochs that ended before snapshots were kept.
 */
export function buildProtocolHistory(
  context: BuildContext,
  rows: ProtocolRows,
  directory: GaugeDirectory | null,
  frozenStats: ReadonlyMap<number, ProtocolStats | null>,
): { history: ProtocolHistory; epochs: ProtocolEpoch[] } {
  const current = epochStartOf(context.nowSeconds)
  const totals = [...epochTotals(context, rows).entries()]
  const stats = statsOf(context, rows, directory)
  const epochs: ProtocolEpoch[] = []
  const summaries: ProtocolHistory["epochs"] = []
  let previousUsd: string | null = null
  for (const [start, bar] of totals) {
    const byVoter = barOf(start, bar)
    const funded = fundedOf(context, bar)
    const epoch = epochRef(start)
    epochs.push({
      epoch,
      incentives: {
        usd: byVoter.totalUsd,
        previousUsd,
        changeUsd:
          previousUsd === null
            ? null
            : subtractUsd(byVoter.totalUsd, previousUsd),
      },
      byVoter,
      funded: { count: funded.length, gauges: funded.slice(0, fundedPerEpoch) },
      deposits: bar.deposits,
      stats:
        start === current ? stats : (frozenStats.get(epoch.number) ?? null),
    })
    summaries.push({
      ...byVoter,
      fundedGauges: funded.length,
      deposits: bar.deposits,
    })
    previousUsd = byVoter.totalUsd
  }
  return { history: { epochs: summaries }, epochs }
}
