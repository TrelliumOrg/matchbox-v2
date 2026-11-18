import { CONTRACTS } from "@matchbox/chain"
import {
  epochStartOf,
  type GaugeIncentives,
  type VoterKind,
} from "@matchbox/contracts/market"
import type { NetworkSlug } from "@matchbox/contracts/network"
import type {
  GaugeCard,
  GaugeDirectory,
  GaugeProfileReadModel,
} from "@matchbox/contracts/read-models"
import { decimalToScaledBigInt } from "@matchbox/domain"
import type { Logger } from "@matchbox/logger"
import { getAddress, type PublicClient, parseAbi } from "viem"
import { aprPercent, boostMultiplier } from "../market/money"
import type { ReferencePrices } from "../market/prices"
import { votingTokenUsd } from "../market/snapshot"
import type { MarketStore } from "../market/store"
import { compareVotesDescending, percent2 } from "./gauges"
import {
  askChain,
  type Call,
  type ChainAnswer,
  type ChainRequest,
  type ClaimableTiming,
  createChainRequest,
} from "./live-claimable"
import { fromRaw } from "./money"
import {
  currentKey,
  type ReadDatabase,
  type ReadModelKind,
  type ReadModelWrite,
  readReadModel,
  replaceReadModel,
  writeReadModels,
} from "./store"

// Gauge votes, kept as the chain has them between gauge publishes.
//
// The gauge directory is rebuilt every 15 minutes (publish.ts). A vote
// changes a gauge's total, and with it the APY a voter gets there and a
// veBTC gauge's boost, the moment it is mined: on 13 Nov 2026 someone voted
// in Pro and the gauge showed its old total and its old, higher APY "till
// much later". So every minute this reads `weights` for every gauge (two
// or three requests for 780 gauges) and compares them with the stored
// cards. Nothing changed, which is most minutes: nothing is written. Some
// did: those cards get their new votes, APY and boost, in the directory
// and in their own profile documents.
//
// Incentives, names, metadata and history stay the publish's.

export type GaugeVotes = {
  block: number
  /** Votes per gauge address, 18 decimals; a gauge whose read failed is absent. */
  weights: Map<string, bigint>
  /** BoostVoter's `totalWeight`; null when unread. */
  boostTotal: bigint | null
}

export type GaugeVotesReader = (
  gauges: readonly { address: string; voter: VoterKind }[],
  /** Unix ms: no request starts after it. */
  deadline: number,
) => Promise<GaugeVotes>

/** `BoostVoter.getBoost` per veBTC token id, raw (1e18 = 1x). */
export type GaugeBoostReader = (
  tokenIds: readonly string[],
  deadline: number,
) => Promise<Map<string, bigint>>

const voterAddress: Record<VoterKind, `0x${string}`> = {
  boost: CONTRACTS.mainnet.boostVoter,
  pools: CONTRACTS.mainnet.poolsVoter,
  validators: CONTRACTS.mainnet.validatorsVoter,
  "third-party": CONTRACTS.mainnet.thirdPartyVoter,
}

const voterAbi = parseAbi([
  "function weights(address target) view returns (uint256)",
  "function totalWeight() view returns (uint256)",
  "function poolForGauge(address gauge) view returns (address)",
  "function getBoost(uint256 tokenId) view returns (uint256)",
])

/** One storage read each: these never failed 400 to a request. */
const callsPerRequest = 400
const zero = "0x0000000000000000000000000000000000000000"

function ask(
  request: ChainRequest,
  calls: readonly Call[],
  deadline: number,
): Promise<ChainAnswer> {
  return askChain(request, calls, deadline, callsPerRequest)
}

export function createGaugeVotesReader(
  client: PublicClient,
  timing?: ClaimableTiming,
): { votes: GaugeVotesReader; boosts: GaugeBoostReader } {
  const request = createChainRequest(client, timing)
  // PoolsVoter keys votes by pool. A gauge's pool never changes, so it is
  // asked for once per isolate.
  const poolOf = new Map<string, string>()

  const votes: GaugeVotesReader = async (gauges, deadline) => {
    const unknown = gauges.filter(
      (gauge) => gauge.voter === "pools" && !poolOf.has(gauge.address),
    )
    if (unknown.length > 0) {
      const pools = await ask(
        request,
        unknown.map((gauge) => ({
          address: voterAddress.pools,
          abi: voterAbi,
          functionName: "poolForGauge",
          args: [getAddress(gauge.address)],
        })),
        deadline,
      )
      unknown.forEach((gauge, position) => {
        const pool = pools.results[position]
        if (typeof pool === "string" && pool !== zero) {
          poolOf.set(gauge.address, pool.toLowerCase())
        }
      })
    }
    const asked = gauges.flatMap((gauge) => {
      const target =
        gauge.voter === "pools" ? poolOf.get(gauge.address) : gauge.address
      return target === undefined ? [] : [{ gauge, target }]
    })
    const read = await ask(
      request,
      [
        {
          address: voterAddress.boost,
          abi: voterAbi,
          functionName: "totalWeight",
        },
        ...asked.map(
          (entry): Call => ({
            address: voterAddress[entry.gauge.voter],
            abi: voterAbi,
            functionName: "weights",
            args: [getAddress(entry.target)],
          }),
        ),
      ],
      deadline,
    )
    const [boostTotal, ...results] = read.results
    const weights = new Map<string, bigint>()
    asked.forEach((entry, position) => {
      const weight = results[position]
      if (typeof weight === "bigint") weights.set(entry.gauge.address, weight)
    })
    return {
      block: Number(read.block),
      weights,
      boostTotal: typeof boostTotal === "bigint" ? boostTotal : null,
    }
  }

  const boosts: GaugeBoostReader = async (tokenIds, deadline) => {
    const found = new Map<string, bigint>()
    if (tokenIds.length === 0) return found
    const read = await ask(
      request,
      tokenIds.map((tokenId) => ({
        address: voterAddress.boost,
        abi: voterAbi,
        functionName: "getBoost",
        args: [BigInt(tokenId)],
      })),
      deadline,
    )
    tokenIds.forEach((tokenId, position) => {
      const boost = read.results[position]
      if (typeof boost === "bigint") found.set(tokenId, boost)
    })
    return found
  }

  return { votes, boosts }
}

/** The stored cards whose votes differ from the chain's. */
export function changedVotes(
  directory: GaugeDirectory,
  votes: GaugeVotes,
): GaugeCard[] {
  return directory.gauges.filter((card) => {
    const weight = votes.weights.get(card.gauge.address)
    return weight !== undefined && fromRaw(weight, 18) !== card.votes
  })
}

export type GaugeVoteInputs = {
  /** The changed gauges' incentives this epoch, from the market snapshot. */
  incentives: ReadonlyMap<string, GaugeIncentives>
  /** The market snapshot's prices; null when it has none. */
  prices: ReferencePrices | null
  /** `getBoost` for the changed veBTC gauges, by token id. */
  boosts: ReadonlyMap<string, bigint>
}

/**
 * The APY a voter gets at `weight`. From the market snapshot's own figures
 * when it has them, which is what the next publish computes. Without them
 * the stored APY is scaled by the change in votes: the incentives are the
 * same, shared among more or fewer votes.
 */
function apyAt(
  card: GaugeCard,
  weight: bigint,
  inputs: GaugeVoteInputs,
): string | null {
  if (card.incentives.tokens.length === 0 || weight === 0n) return null
  const totalUsd = inputs.incentives.get(card.gauge.address)?.totalUsd ?? null
  const price =
    inputs.prices === null
      ? null
      : votingTokenUsd(card.gauge.voter, inputs.prices)
  if (totalUsd !== null && price !== null) {
    return percent2(aprPercent({ totalUsd, weight, votingTokenUsd: price }))
  }
  const before = decimalToScaledBigInt(card.votes, 18)
  if (card.apy === null || before === 0n) return null
  return percent2(
    fromRaw((decimalToScaledBigInt(card.apy, 2) * before) / weight, 2),
  )
}

/**
 * The directory with the changed cards' votes, APY and boost as the chain
 * has them, in its usual order. Pure. `changed` are the new cards.
 */
export function applyGaugeVotes(
  directory: GaugeDirectory,
  votes: GaugeVotes,
  inputs: GaugeVoteInputs,
): { directory: GaugeDirectory; changed: GaugeCard[] } {
  const changed: GaugeCard[] = []
  const gauges = directory.gauges.map((card) => {
    const weight = votes.weights.get(card.gauge.address)
    if (weight === undefined || fromRaw(weight, 18) === card.votes) return card
    const boost =
      card.gauge.vebtcTokenId === null
        ? undefined
        : inputs.boosts.get(card.gauge.vebtcTokenId)
    const next: GaugeCard = {
      ...card,
      votes: fromRaw(weight, 18),
      apy: apyAt(card, weight, inputs),
      // An unread boost keeps the stored one until the next publish.
      boost: boost === undefined ? card.boost : boostMultiplier(boost),
    }
    changed.push(next)
    return next
  })
  return {
    directory: {
      ...directory,
      gauges: gauges.sort(compareVotesDescending),
      totalVotes:
        votes.boostTotal === null
          ? directory.totalVotes
          : fromRaw(votes.boostTotal, 18),
    },
    changed,
  }
}

/** A gauge's profile with its card's new votes, APY and boost. */
export function profileWithCard(
  profile: GaugeProfileReadModel,
  card: GaugeCard,
  epochNumber: number,
): GaugeProfileReadModel {
  const details = profile.details ?? null
  return {
    ...profile,
    card,
    votesHistory: profile.votesHistory.map((entry) =>
      entry.epoch.number === epochNumber
        ? { ...entry, votes: card.votes }
        : entry,
    ),
    ...(details?.kind === "vebtc"
      ? { details: { ...details, boost: card.boost } }
      : {}),
  }
}

/** Profiles rewritten in one run; the rest wait for the next publish. */
export const maxProfilesPerRun = 60

/** A run may take this long reading the chain. */
const readBudgetMs = 20_000

export type GaugeVotesRefresh = {
  status: "unchanged" | "written" | "superseded" | "behind" | "no-directory"
  block: number | null
  /** Cards whose votes changed. */
  changed: number
  /** D1 rows written: the directory and the changed gauges' profiles. */
  rows: number
}

export type RefreshGaugeVotesOptions = {
  network: NetworkSlug
  readDb: ReadDatabase
  /** For the changed gauges' incentives and prices; null scales the APY. */
  market: MarketStore | null
  votes: GaugeVotesReader
  boosts: GaugeBoostReader
  now: () => Date
  logger: Logger
}

/**
 * One run: read every gauge's votes, and write only what changed. A minute
 * with no vote costs one D1 read and no write.
 */
export async function refreshGaugeVotes(
  options: RefreshGaugeVotesOptions,
): Promise<GaugeVotesRefresh> {
  const { network, readDb } = options
  const stored = await readReadModel(readDb, network, "gauges", currentKey)
  if (stored === null) {
    return { status: "no-directory", block: null, changed: 0, rows: 0 }
  }
  const startedMs = options.now().getTime()
  const deadline = startedMs + readBudgetMs
  const votes = await options.votes(
    stored.data.gauges.map((card) => card.gauge),
    deadline,
  )
  const summary = { block: votes.block, changed: 0, rows: 0 }
  // An RPC node behind the publish's block has nothing newer to say.
  if (votes.block <= stored.meta.block) return { status: "behind", ...summary }
  const stale = changedVotes(stored.data, votes)
  if (stale.length === 0) return { status: "unchanged", ...summary }

  const addresses = stale.map((card) => card.gauge.address)
  const nowSeconds = Math.floor(startedMs / 1000)
  const epoch =
    options.market === null
      ? null
      : await options.market
          .latestEpoch(network, epochStartOf(nowSeconds))
          .catch(() => null)
  const [incentives, boosts] = await Promise.all([
    epoch === null || options.market === null
      ? []
      : options.market
          .listIncentives(network, epoch.epochStart, {
            voter: null,
            gauges: addresses,
          })
          .catch((): GaugeIncentives[] => []),
    options
      .boosts(
        stale.flatMap((card) =>
          card.gauge.vebtcTokenId === null ? [] : [card.gauge.vebtcTokenId],
        ),
        deadline,
      )
      .catch(() => new Map<string, bigint>()),
  ])
  const patched = applyGaugeVotes(stored.data, votes, {
    incentives: new Map(incentives.map((entry) => [entry.gaugeAddress, entry])),
    prices: epoch?.prices ?? null,
    boosts,
  })
  const base = {
    network,
    block: votes.block,
    source: "live" as const,
    updatedAt: nowSeconds,
  }
  // Only over the directory that was read: a publish that landed meanwhile
  // is newer than this patch and stands.
  const written = await replaceReadModel(
    readDb,
    { ...base, kind: "gauges", key: currentKey, data: patched.directory },
    stored.etag,
  )
  if (!written) {
    return { status: "superseded", ...summary, changed: patched.changed.length }
  }
  const profiles: ReadModelWrite<ReadModelKind>[] = []
  for (const card of patched.changed.slice(0, maxProfilesPerRun)) {
    const profile = await readReadModel(
      readDb,
      network,
      "gauge-profile",
      card.gauge.address,
    ).catch(() => null)
    if (profile === null) continue
    profiles.push({
      ...base,
      kind: "gauge-profile",
      key: card.gauge.address,
      data: profileWithCard(profile.data, card, patched.directory.epoch.number),
    })
  }
  const rows = 1 + (await writeReadModels(readDb, profiles))
  const result: GaugeVotesRefresh = {
    status: "written",
    block: votes.block,
    changed: patched.changed.length,
    rows,
  }
  options.logger.info({ message: "Gauge votes refreshed", ...result })
  return result
}
