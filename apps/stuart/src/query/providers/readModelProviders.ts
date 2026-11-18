import { ZERO_ADDRESS } from "@matchbox/chain"
import type {
  Escrow,
  GaugeCard,
  GaugeDirectoryResponse,
  GaugeKind,
  GaugePicture,
  GaugeProfileReadModel,
  TokenAmount,
  WalletOverview,
  WalletRewards,
} from "@matchbox/contracts/read-models"
import { nameWithPoolType, poolTypeLabel } from "@matchbox/domain/pool-type"
import { targetApyBps, type VoteTarget } from "@matchbox/domain/voteMath"
import type { VoteBranch } from "@matchbox/stuart-ui/contract"
import { type Address, getAddress } from "viem"
import {
  type ClaimableEntry,
  type ClaimableLock,
  sourceForDomain,
} from "./claims"
import type { WireEarnings, WireGaugeEpochs, WireTokenAmount } from "./history"
import { type PriceSnapshot, priceMicroUsd } from "./prices"
import type { RewardContracts } from "./rewardContracts"
import { microToUsd, usdToMicro, wholeToBaseUnits } from "./units"
import {
  assetFor,
  EPOCH_SECONDS,
  type LockVoteState,
  MAX_VOTING_NUM,
  type VotingDomain,
  voterFor,
  voterSource,
  type WalletLock,
} from "./voting"

// Pure mappings from the API read models (whole-unit decimal strings, lower
// case addresses) to the shapes Stuart's tools compute with (bigint base
// units, checksummed addresses). Every conversion is exact; see units.ts.

const BPS = 10_000n
const VOTE_DECIMALS = 18

function escrowFor(asset: "veMEZO" | "veBTC"): Escrow {
  return asset === "veMEZO" ? "vemezo" : "vebtc"
}

function iso(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString()
}

// "veBTC #604" and "0x449b…3d1E" are the API's fallbacks for a gauge with no
// profile, pool symbol or moniker.
function nameSourceOf(name: string): VoteTarget["nameSource"] {
  return /^veBTC #\d+$/.test(name) ||
    /^0x[0-9a-fA-F]{4}…[0-9a-fA-F]{4}$/.test(name)
    ? "derived"
    : "profile"
}

function baseAmount(amount: TokenAmount): bigint {
  return wholeToBaseUnits(amount.amount, amount.token.decimals)
}

/** One voting domain from the gauge directory (directory `voter` = branch). */
export function votingDomainFromDirectory(input: {
  directory: GaugeDirectoryResponse
  branch: VoteBranch
  rewardContracts: ReadonlyMap<string, RewardContracts>
}): VotingDomain {
  const { directory, branch } = input
  const cards = directory.data.gauges.filter(
    (card) => card.gauge.voter === branch,
  )
  const pictures = new Map<string, GaugePicture>()
  const kinds = new Map<string, GaugeKind>()
  const labels = new Map<string, string>()
  const targets: VoteTarget[] = []
  for (const card of cards) {
    const target = voteTarget(card, branch, input.rewardContracts)
    if (target === null) continue
    targets.push(target)
    pictures.set(target.targetAddress.toLowerCase(), card.gauge.picture)
    kinds.set(target.targetAddress.toLowerCase(), card.gauge.kind)
    const label = labelOf(card)
    if (label !== null) labels.set(target.targetAddress.toLowerCase(), label)
  }
  const targetWeights = targets.reduce((sum, target) => sum + target.weight, 0n)
  return {
    branch,
    voter: voterFor(branch),
    governanceAsset: assetFor(branch),
    epochStart: BigInt(directory.data.epoch.start),
    epochNext: BigInt(directory.data.epoch.end),
    blockNumber: BigInt(directory.meta.block),
    fetchedAt: iso(directory.meta.updatedAt),
    // The directory's total is the boost voter's; other voters sum their
    // targets.
    totalWeight:
      branch === "boost"
        ? wholeToBaseUnits(directory.data.totalVotes, VOTE_DECIMALS)
        : targetWeights,
    maxVotingNum: MAX_VOTING_NUM,
    source: voterSource(branch),
    targets,
    pictures,
    kinds,
    labels,
    rewardContracts: input.rewardContracts,
  }
}

/** "CL200", "Volatile", "Stable" for pool gauges; null otherwise. */
function labelOf(card: GaugeCard): string | null {
  return card.gauge.kind === "pool"
    ? poolTypeLabel({
        poolType: card.gauge.poolType,
        tickSpacing: card.gauge.tickSpacing,
      })
    : null
}

function voteTarget(
  card: GaugeCard,
  branch: VoteBranch,
  rewardContracts: ReadonlyMap<string, RewardContracts>,
): VoteTarget | null {
  const gaugeAddress = getAddress(card.gauge.address)
  const contracts = rewardContracts.get(card.gauge.address.toLowerCase())
  // PoolsVoter votes for the pool, which the read model does not carry.
  const pool = contracts?.pool ?? null
  if (branch === "pools" && pool === null) return null
  const bribe = contracts?.bribe ?? null
  const fees = contracts?.fees ?? null
  return {
    targetAddress: branch === "pools" && pool !== null ? pool : gaugeAddress,
    gaugeAddress,
    // "BTC/MUSD CL200": pools that share a pair are told apart by type.
    name: nameWithPoolType(card.gauge.name, labelOf(card)).slice(0, 80),
    nameSource: nameSourceOf(card.gauge.name),
    tokenId: card.gauge.vebtcTokenId,
    isAlive: card.isAlive,
    weight: wholeToBaseUnits(card.votes, VOTE_DECIMALS),
    rewardContracts: [fees, bribe].filter(
      (value): value is Address => value !== null,
    ),
    incentives: card.incentives.tokens.map((token) => ({
      contract: bribe ?? ZERO_ADDRESS,
      token: getAddress(token.token.address),
      symbol: token.token.symbol,
      decimals: token.token.decimals,
      amount: baseAmount(token),
    })),
  }
}

/** The wallet's locks in one escrow. A wallet the API has no document for
 * has none. */
export function walletLocksFromOverview(
  overview: WalletOverview | null,
  asset: "veMEZO" | "veBTC",
): WalletLock[] {
  if (overview === null) return []
  const escrow = escrowFor(asset)
  return overview.locks
    .filter((lock) => lock.escrow === escrow)
    .map((lock) => ({
      asset,
      tokenId: BigInt(lock.tokenId),
      amount: baseAmount(lock.locked),
      end: BigInt(lock.unlocksAt ?? 0),
      isPermanent: lock.isPermanent,
      votingPower: wholeToBaseUnits(lock.votingPower, VOTE_DECIMALS),
    }))
}

/**
 * This epoch's vote per lock on one voter. The read model gives the votes
 * cast and basis points per gauge, so each target's weight is
 * `votes * bps / 10_000`, floored (at most one base unit low per target).
 * A lock that voted in an earlier epoch reads as not voted: its standing
 * votes are not in the read model, so they count as competing weight.
 */
export function lockVoteStateFromOverview(input: {
  overview: WalletOverview | null
  domain: VotingDomain
  tokenIds: readonly bigint[]
}): LockVoteState[] {
  const { domain } = input
  const escrow = escrowFor(domain.governanceAsset)
  const targetByGauge = new Map(
    domain.targets.map((target) => [
      target.gaugeAddress.toLowerCase(),
      target.targetAddress.toLowerCase(),
    ]),
  )
  return input.tokenIds.map((tokenId) => {
    const lock = input.overview?.locks.find(
      (entry) => entry.escrow === escrow && BigInt(entry.tokenId) === tokenId,
    )
    const vote = lock?.vote
    if (
      vote === undefined ||
      vote.status !== "voted" ||
      BigInt(vote.epoch.start) !== domain.epochStart
    ) {
      return { tokenId, lastVoted: 0n, usedWeight: 0n, votes: new Map() }
    }
    // Per voter when the document has it: the shares are then of this
    // voter's votes and the time is this voter's. Older documents add both
    // voters together, and `votes` times a share is still the weight.
    const own = vote.byVoter.find((each) => each.voter === domain.branch)
    const perVoter = vote.byVoter.length > 0
    const allocations = perVoter
      ? (own?.allocations ?? [])
      : vote.allocations.filter(
          (allocation) => allocation.gauge.voter === domain.branch,
        )
    if (allocations.length === 0) {
      return { tokenId, lastVoted: 0n, usedWeight: 0n, votes: new Map() }
    }
    const cast = wholeToBaseUnits(own?.votes ?? vote.votes, VOTE_DECIMALS)
    const votes = new Map<string, bigint>()
    let used = 0n
    for (const allocation of allocations) {
      const gauge = allocation.gauge.address.toLowerCase()
      const target = targetByGauge.get(gauge) ?? gauge
      const weight = (cast * BigInt(allocation.basisPoints)) / BPS
      if (weight <= 0n) continue
      votes.set(target, (votes.get(target) ?? 0n) + weight)
      used += weight
    }
    return {
      tokenId,
      lastVoted: BigInt(own?.votedAt ?? vote.votedAt),
      usedWeight: used,
      votes,
    }
  })
}

/**
 * Claimable rewards per lock on one voter, from the rewards read model. A
 * pool gauge's token is claimed from its bribe contract when it is one of
 * the gauge's incentive tokens, otherwise from its fee contract. Tokens
 * whose contract is unknown are left out (and reported in `skipped`).
 */
export function claimableFromRewards(input: {
  rewards: WalletRewards | null
  domain: VotingDomain
  locks: readonly WalletLock[]
}): { locks: ClaimableLock[]; skipped: number } {
  const { domain } = input
  if (input.rewards === null) return { locks: [], skipped: 0 }
  const escrow = escrowFor(domain.governanceAsset)
  const wanted = new Set(input.locks.map((lock) => lock.tokenId))
  const incentiveTokens = new Map(
    domain.targets.map((target) => [
      target.gaugeAddress.toLowerCase(),
      new Set(target.incentives.map((token) => token.token.toLowerCase())),
    ]),
  )
  const result: ClaimableLock[] = []
  let skipped = 0
  for (const entry of input.rewards.byLock) {
    if (entry.lock.escrow !== escrow) continue
    const tokenId = BigInt(entry.lock.tokenId)
    if (!wanted.has(tokenId)) continue
    const entries: ClaimableEntry[] = []
    for (const row of entry.gauges) {
      if (row.gauge.voter !== domain.branch) continue
      const gauge = row.gauge.address.toLowerCase()
      const contracts = domain.rewardContracts.get(gauge)
      const bribeTokens = incentiveTokens.get(gauge) ?? new Set<string>()
      for (const token of row.tokens) {
        const earned = baseAmount(token)
        if (earned <= 0n) continue
        const isBribe =
          domain.branch !== "pools" ||
          bribeTokens.has(token.token.address.toLowerCase())
        const contract = isBribe
          ? (contracts?.bribe ?? null)
          : (contracts?.fees ?? contracts?.bribe ?? null)
        if (contract === null) {
          skipped += 1
          continue
        }
        entries.push({
          contract,
          token: getAddress(token.token.address),
          symbol: token.token.symbol,
          decimals: token.token.decimals,
          earned,
        })
      }
    }
    if (entries.length === 0) continue
    result.push({
      source: sourceForDomain(domain),
      voter: domain.voter,
      tokenId,
      entries,
    })
  }
  return { locks: result, skipped }
}

function funded(epoch: GaugeProfileReadModel["incentivesHistory"][number]) {
  return epoch.incentives.tokens.some((token) => baseAmount(token) > 0n)
}

/** Completed epochs (of the last `window`) in which each target had
 * incentives, from each gauge profile's `incentivesHistory`. */
export function fundedEpochsFromProfiles(input: {
  domain: VotingDomain
  profiles: ReadonlyMap<string, GaugeProfileReadModel | null>
  window: number
}): Map<string, number> {
  const { domain } = input
  const oldest = domain.epochStart - BigInt(input.window) * EPOCH_SECONDS
  const result = new Map<string, number>()
  for (const target of domain.targets) {
    if (target.incentives.length === 0) continue
    const profile = input.profiles.get(target.gaugeAddress.toLowerCase())
    if (profile === null || profile === undefined) continue
    // Epochs funded in the full gauge history or the profile's recent
    // incentives, whichever has them: either alone can be shallow.
    const starts = new Set<string>()
    for (const epoch of profile.history ?? []) {
      if (epoch.incentives.tokens.some((token) => baseAmount(token) > 0n)) {
        starts.add(String(epoch.epoch.start))
      }
    }
    for (const epoch of profile.incentivesHistory) {
      if (funded(epoch)) starts.add(String(epoch.epoch.start))
    }
    const count = [...starts].filter((value) => {
      const start = BigInt(value)
      return start < domain.epochStart && start >= oldest
    }).length
    if (count > 0) result.set(target.targetAddress.toLowerCase(), count)
  }
  return result
}

type Merged = {
  token: string
  symbol: string
  decimals: number
  amount: bigint
  usd: bigint | null
}

/** Sums token lines by token; a line without USD makes the token unpriced. */
function mergeTokens(lines: readonly TokenAmount[]): Merged[] {
  const byToken = new Map<string, Merged>()
  for (const line of lines) {
    const key = line.token.address.toLowerCase()
    const amount = baseAmount(line)
    const usd = line.usd === null ? null : usdToMicro(line.usd)
    const current = byToken.get(key)
    if (current === undefined) {
      byToken.set(key, {
        token: key,
        symbol: line.token.symbol,
        decimals: line.token.decimals,
        amount,
        usd,
      })
      continue
    }
    current.amount += amount
    current.usd =
      current.usd === null || usd === null ? null : current.usd + usd
  }
  return [...byToken.values()]
}

function wireToken(line: Merged): WireTokenAmount {
  const usd = line.usd === null ? null : microToUsd(line.usd)
  return {
    token: line.token,
    symbol: line.symbol,
    decimals: line.decimals,
    amount: line.amount.toString(),
    usdAtEarn: usd,
    usdNow: usd,
  }
}

/** USD of priced lines; null when there are lines and none is priced. */
function pricedSum(lines: readonly Merged[]): {
  usd: string | null
  unpriced: number
} {
  const unpriced = lines.filter((line) => line.usd === null).length
  if (lines.length > 0 && unpriced === lines.length) {
    return { usd: null, unpriced }
  }
  const micro = lines.reduce((sum, line) => sum + (line.usd ?? 0n), 0n)
  return { usd: microToUsd(micro), unpriced }
}

/**
 * One boost gauge's recent epochs, newest first, from its profile. APY uses
 * each epoch's incentive USD and votes at the current MEZO price; the boost
 * multiplier is known for the current epoch only.
 */
export function gaugeHistoryFromProfile(input: {
  profile: GaugeProfileReadModel
  count: number
  currentEpochStart: bigint
  mezoPriceMicroUsd: bigint | null
}): WireGaugeEpochs {
  const { profile } = input
  const starts = new Set<number>([
    ...profile.incentivesHistory.map((entry) => entry.epoch.start),
    ...profile.votesHistory.map((entry) => entry.epoch.start),
  ])
  const ordered = [...starts]
    .filter((start) => BigInt(start) <= input.currentEpochStart)
    .sort((left, right) => right - left)
    .slice(0, input.count)
  const boost = profile.card.boost
  return {
    rows: ordered.map((start) => {
      const incentives = profile.incentivesHistory.find(
        (entry) => entry.epoch.start === start,
      )
      const votes = profile.votesHistory.find(
        (entry) => entry.epoch.start === start,
      )
      const lines = mergeTokens(incentives?.incentives.tokens ?? [])
      const sum = pricedSum(lines)
      const weight =
        votes === undefined ? 0n : wholeToBaseUnits(votes.votes, VOTE_DECIMALS)
      const current = BigInt(start) === input.currentEpochStart
      const apy =
        sum.usd === null
          ? null
          : targetApyBps({
              incentiveMicroUsd: usdToMicro(sum.usd),
              weight,
              assetPriceMicroUsd: input.mezoPriceMicroUsd,
            })
      return {
        epochStart: String(start),
        epochEnd: String(BigInt(start) + EPOCH_SECONDS),
        status: current ? "current" : "sealed",
        veMezo: weight.toString(),
        boostWad:
          current && boost !== null
            ? wholeToBaseUnits(boost, 18).toString()
            : null,
        incentives: lines.map(wireToken),
        incentivesUsd: sum.usd,
        apyBps: apy === null ? null : String(apy),
      }
    }),
  }
}

function totals(lines: readonly Merged[]): WireEarnings["totals"]["claimable"] {
  const sum = pricedSum(lines)
  return {
    tokens: lines.map(wireToken),
    usdAtEarn: sum.usd,
    usdNow: sum.usd,
    unpriced: sum.unpriced,
  }
}

/**
 * veMEZO voting-incentive earnings from the wallet overview (projected and
 * claimable per lock) and rewards (last sealed epoch while unclaimed).
 * `partial` marks USD sums that leave unpriced tokens out.
 */
export function walletEarningsFromReadModels(input: {
  overview: WalletOverview | null
  rewards: WalletRewards | null
  epoch: { start: number; end: number }
}): WireEarnings {
  const locks = (input.overview?.locks ?? []).filter(
    (lock) => lock.escrow === "vemezo",
  )
  const projectedLines = mergeTokens(
    locks.flatMap((lock) => lock.projected?.tokens ?? []),
  )
  const claimableLines = mergeTokens(
    locks.flatMap((lock) => lock.claimable.tokens),
  )
  const projected = pricedSum(projectedLines)
  const lastStart = input.epoch.start - Number(EPOCH_SECONDS)
  const rewards = input.rewards
  const lastUnclaimed =
    rewards !== null &&
    rewards.epoch !== null &&
    rewards.epoch.start === lastStart &&
    !rewards.history.some((claim) => claim.epoch.start === lastStart)
  const lastLines = lastUnclaimed
    ? mergeTokens(
        rewards.byLock
          .filter((entry) => entry.lock.escrow === "vemezo")
          .flatMap((entry) => entry.rewards.tokens),
      )
    : []
  const last = pricedSum(lastLines)
  const epochs: WireEarnings["epochs"] = lastUnclaimed
    ? [
        {
          epochStart: String(lastStart),
          epochEnd: String(input.epoch.start),
          status: "sealed",
          tokens: lastLines.map(wireToken),
          usdAtEarn: last.usd,
          usdNow: last.usd,
          unpriced: last.unpriced,
        },
      ]
    : []
  const unknown = { tokens: [], usdAtEarn: null, usdNow: null, unpriced: 0 }
  return {
    tokenIds: locks.map((lock) => lock.tokenId),
    current: {
      epochStart: String(input.epoch.start),
      epochEnd: String(input.epoch.end),
      status: "projected",
      tokens: projectedLines.map(wireToken),
      usdNow: projected.usd,
    },
    epochs,
    totals: {
      realized: lastUnclaimed ? totals(lastLines) : unknown,
      claimed: unknown,
      claimable: totals(claimableLines),
      projected: totals(projectedLines),
    },
    verified: false,
    partial:
      projected.unpriced > 0 ||
      claimableLines.some((line) => line.usd === null) ||
      last.unpriced > 0,
  }
}

/** Price inputs the history mapping needs, from the snapshot. */
export function mezoPriceMicro(prices: PriceSnapshot): bigint | null {
  return priceMicroUsd(prices.mezo.priceUsd)
}
