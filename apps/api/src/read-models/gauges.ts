import type { GaugeProfile } from "@matchbox/contracts/gauge-profiles"
import {
  epochStartOf,
  type Gauge,
  type GaugeIncentives,
} from "@matchbox/contracts/market"
import type { NetworkSlug } from "@matchbox/contracts/network"
import {
  cardMetaOf,
  type EpochRef,
  type GaugeCard,
  type GaugeDetails,
  type GaugeDirectory,
  type GaugeIncentiveEpoch,
  type GaugeKindTotals,
  type GaugePicture,
  type GaugeProfileReadModel,
  type GaugeRef,
  gaugeKindFor,
  isRetiredGauge,
  type PoolKind,
  type Prices,
  type TokenAmount,
  type TokenRef,
  type ValueBreakdown,
  voteUnitFor,
} from "@matchbox/contracts/read-models"
import {
  calculateOptimalVeMEZO,
  EPOCH_SECONDS,
  epochIndexFor,
} from "@matchbox/domain"
import type { MarketStore } from "../market/store"
import { gaugeColor } from "./colors"
import type { GaugeDetailsReader, GaugeDetailsRequest } from "./gauge-details"
import {
  crossChainFallbackName,
  type GaugeLabel,
  type GaugeLabelReader,
} from "./gauge-labels"
import {
  btcTokenRef,
  fromRaw,
  knownTokens,
  mergeTokenAmounts,
  sumUsd,
} from "./money"
import { currentKey, type ReadModelKind, type ReadModelWrite } from "./store"

// Vote's gauge directory and one profile document per gauge, built from the
// market snapshot (gauges, weights, incentives), curated profiles and a few
// veBTC reads. Written by the API's market cron every 15 minutes; between
// those, gauge-votes.ts keeps each card's votes and what follows from them
// (APY, boost) as the chain has them, every minute.

/** veBTC reads for boost gauges; null values when a read failed. */
export type GaugeChainExtras = {
  /** veMEZO `totalVotingPower`, 18 decimals. */
  vemezoTotalVotingPower: bigint | null
  /** veBTC `unboostedTotalVotingPower`, 18 decimals. */
  vebtcUnboostedTotal: bigint | null
  /** Per veBTC token id. */
  locks: Map<string, { unboostedVotingPower: bigint; locked: bigint }>
  /** Per veBTC token id: `locked(tokenId)`, read even when power is not. */
  lockInfo: Map<string, { amount: bigint; end: bigint; isPermanent: boolean }>
}

export type GaugeChainReader = (
  vebtcTokenIds: readonly string[],
) => Promise<GaugeChainExtras>

export type GaugeBuildInput = {
  network: NetworkSlug
  market: MarketStore
  profiles: readonly GaugeProfile[]
  /** veBTC reads; null (or a failed read) leaves those fields null. */
  chain: GaugeChainReader | null
  /** Gauge address to the colour extracted from its profile picture. */
  avatarColors: ReadonlyMap<string, string>
  /** Pair, vault and cross-chain names; null skips them. */
  labels: GaugeLabelReader | null
  /** Each kind's metadata from chain reads; null leaves `meta` null. */
  details: GaugeDetailsReader | null
  /** For TVL and APR in pool metadata. */
  prices: Prices | null
  nowSeconds: number
}

/** Epoch numbering for display, from `@matchbox/domain`. */
export function epochRef(start: number): EpochRef {
  return { number: epochIndexFor(start), start, end: start + EPOCH_SECONDS }
}

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}

function initials(text: string): string {
  const letters = text
    .split(/[\s/]+/)
    .map((word) => word.replace(/[^A-Za-z0-9]/g, "").charAt(0))
    .filter((letter) => letter.length > 0)
    .join("")
  return (letters.length > 0 ? letters : text.slice(0, 2)).slice(0, 2)
}

function gaugeName(gauge: Gauge, profile: GaugeProfile | undefined): string {
  if (profile?.displayName) return profile.displayName
  switch (gauge.voter) {
    case "boost":
      return gauge.vebtcTokenId === null
        ? shortAddress(gauge.gaugeAddress)
        : `veBTC #${gauge.vebtcTokenId}`
    case "pools":
      return gauge.poolSymbol ?? shortAddress(gauge.gaugeAddress)
    case "validators":
      return gauge.moniker ?? shortAddress(gauge.gaugeAddress)
    case "third-party":
      return shortAddress(gauge.gaugeAddress)
  }
}

/** Tokens by symbol, for reading pool pairs out of pool symbols. */
export type TokensBySymbol = ReadonlyMap<string, TokenRef>

/** The read models' known tokens plus every priced reward token. */
export function tokensBySymbol(
  extra: readonly {
    address: string
    symbol: string | null
    decimals: number | null
  }[],
): TokensBySymbol {
  const map = new Map<string, TokenRef>()
  for (const token of Object.values(knownTokens)) map.set(token.symbol, token)
  for (const token of extra) {
    if (token.symbol === null || token.decimals === null) continue
    if (map.has(token.symbol)) continue
    map.set(token.symbol, {
      address: token.address.toLowerCase(),
      symbol: token.symbol,
      name: token.symbol,
      decimals: token.decimals,
    })
  }
  return map
}

type Pair = {
  tokens: [TokenRef, TokenRef]
  poolType: "volatile" | "stable" | "cl"
  tickSpacing: number | null
}

/** "vAMM-BTC/MUSD" → BTC and MUSD, volatile; null when a side is unknown. */
export function pairFromSymbol(
  symbol: string | null,
  tokens: TokensBySymbol,
): Pair | null {
  const match = /^([vs])AMM-([^/]+)\/(.+)$/.exec(symbol ?? "")
  if (match === null) return null
  const [, kind, left = "", right = ""] = match
  const first = tokens.get(left)
  const second = tokens.get(right)
  if (first === undefined || second === undefined) return null
  return {
    tokens: [first, second],
    poolType: kind === "s" ? "stable" : "volatile",
    tickSpacing: null,
  }
}

/** Gauges per kind in `cards`. */
export function kindTotals(cards: readonly GaugeCard[]): GaugeKindTotals {
  const totals: GaugeKindTotals = {
    vebtc: 0,
    validator: 0,
    pool: 0,
    mezo: 0,
  }
  for (const card of cards) totals[card.gauge.kind] += 1
  return totals
}

/** Extra inputs to a gauge's reference. */
export type GaugeRefExtras = {
  tokens?: TokensBySymbol
  /** Colour picked from the profile picture. */
  avatarColor?: string | null
  /** Resolved pair, vault or cross-chain name (gauge-labels.ts). */
  label?: GaugeLabel | null
}

function picture(
  gauge: Gauge,
  name: string,
  profile: GaugeProfile | undefined,
  pair: Pair | null,
): GaugePicture {
  const avatar = profile?.avatarUrl ?? null
  if (avatar?.startsWith("https://")) {
    return { type: "image", url: avatar }
  }
  if (pair !== null) return { type: "pair", tokens: pair.tokens }
  // Unprofiled boost gauges show the beneficiary's first byte ("44").
  if (gauge.voter === "boost" && profile === undefined) {
    const owner = gauge.beneficiary ?? gauge.gaugeAddress
    return { type: "initials", text: owner.slice(2, 4).toUpperCase() }
  }
  return { type: "initials", text: initials(name).toUpperCase() }
}

/**
 * A gauge's reference. Its colour, in order: the profile's curated
 * `brandColor`, the colour extracted from its profile picture
 * (`avatarColor`), a pool's lead token colour, a palette pick.
 */
export function gaugeRef(
  gauge: Gauge,
  profile: GaugeProfile | undefined,
  extras: GaugeRefExtras = {},
): GaugeRef {
  const label = extras.label ?? null
  const pair =
    gauge.voter !== "pools"
      ? null
      : label?.type === "pair"
        ? label
        : pairFromSymbol(gauge.poolSymbol, extras.tokens ?? tokensBySymbol([]))
  const vault = label?.type === "vault" ? label.token : null
  const fallbackName =
    pair !== null
      ? `${pair.tokens[0].symbol}/${pair.tokens[1].symbol}`
      : vault !== null
        ? vault.symbol
        : label?.type === "named"
          ? label.name
          : gauge.voter === "third-party"
            ? crossChainFallbackName(gauge.gaugeAddress)
            : gaugeName(gauge, profile)
  const name = profile?.displayName ?? fallbackName
  return {
    address: gauge.gaugeAddress,
    voter: gauge.voter,
    kind: gaugeKindFor(gauge.voter),
    name,
    vebtcTokenId: gauge.voter === "boost" ? gauge.vebtcTokenId : null,
    picture: picture(gauge, name, profile, pair),
    poolType: pair?.poolType ?? null,
    color:
      profile?.brandColor ??
      extras.avatarColor ??
      gaugeColor(
        gauge.gaugeAddress,
        gauge.voter,
        pair?.tokens ?? (vault === null ? null : [vault]),
      ),
    tickSpacing: pair?.tickSpacing ?? null,
    coin: vault,
  }
}

function tagline(gauge: Gauge, profile: GaugeProfile | undefined) {
  const description = profile?.description?.split("\n")[0]?.trim() ?? ""
  if (description.length > 0 && description.length <= 80) return description
  if (gauge.voter === "boost" && gauge.beneficiary !== null) {
    return shortAddress(gauge.beneficiary)
  }
  return null
}

/** Rewards as token amounts (unknown tokens are left out). */
export function incentiveBreakdown(
  incentives: GaugeIncentives | undefined,
): ValueBreakdown {
  if (incentives === undefined) return { usd: "0", tokens: [] }
  const amounts: TokenAmount[] = []
  const usdByToken = new Map<string, string[]>()
  for (const reward of incentives.rewards) {
    const token = knownTokens[reward.token]
    if (token === undefined) continue
    amounts.push({
      token,
      amount: fromRaw(BigInt(reward.amount), token.decimals),
      usd: null,
    })
    if (reward.usd !== null) {
      usdByToken.set(token.address, [
        ...(usdByToken.get(token.address) ?? []),
        reward.usd,
      ])
    }
  }
  const tokens = mergeTokenAmounts([amounts]).map((amount) => {
    const values = usdByToken.get(amount.token.address)
    return { ...amount, usd: values === undefined ? null : sumUsd(values) }
  })
  return {
    usd: sumUsd(
      tokens.flatMap((token) => (token.usd === null ? [] : [token.usd])),
    ),
    tokens,
  }
}

/** Two decimals, half up (the same rounding as cents). */
export function percent2(value: string | null): string | null {
  return value === null ? null : sumUsd([value])
}

function card(
  gauge: Gauge,
  incentives: GaugeIncentives | undefined,
  profile: GaugeProfile | undefined,
  chain: GaugeChainExtras | null,
  tokens: TokensBySymbol,
  avatarColor: string | null,
  label: GaugeLabel | null,
): GaugeCard {
  const weight = BigInt(gauge.weight ?? "0")
  const breakdown = incentiveBreakdown(incentives)
  const isBoost = gauge.voter === "boost"
  const lock =
    isBoost && gauge.vebtcTokenId !== null
      ? chain?.locks.get(gauge.vebtcTokenId)
      : undefined
  const optimal =
    lock === undefined
      ? undefined
      : calculateOptimalVeMEZO(
          lock.unboostedVotingPower,
          weight,
          chain?.vebtcUnboostedTotal ?? undefined,
          chain?.vemezoTotalVotingPower ?? undefined,
        )
  return {
    gauge: gaugeRef(gauge, profile, { tokens, avatarColor, label }),
    tagline: tagline(gauge, profile),
    isAlive: gauge.isAlive ?? true,
    apy:
      breakdown.tokens.length === 0
        ? null
        : percent2(incentives?.aprPercent ?? null),
    incentives: breakdown,
    vebtcWeight:
      lock === undefined ? null : fromRaw(lock.unboostedVotingPower, 18),
    votes: fromRaw(weight, 18),
    votesUnit: voteUnitFor(gaugeKindFor(gauge.voter)),
    optimalVotes:
      optimal === undefined ? null : fromRaw(optimal.optimalVeMEZO, 18),
    boost: isBoost ? (gauge.boostMultiplier ?? null) : null,
    meta: null,
  }
}

/** Whole-unit decimal to an 18-decimal integer for exact comparison. */
function scaled18(value: string): bigint {
  const [whole = "0", fraction = ""] = value.split(".")
  return BigInt(whole) * 10n ** 18n + BigInt(fraction.padEnd(18, "0"))
}

/** Most votes first; veBTC gauges with expired or withdrawn locks last. */
export function compareVotesDescending(
  left: GaugeCard,
  right: GaugeCard,
): number {
  const retired = Number(isRetiredGauge(left)) - Number(isRetiredGauge(right))
  if (retired !== 0) return retired
  const difference = scaled18(right.votes) - scaled18(left.votes)
  if (difference === 0n) return 0
  return difference > 0n ? 1 : -1
}

function profileLinks(profile: GaugeProfile | undefined) {
  if (profile === undefined) return []
  const links: GaugeProfileReadModel["links"] = []
  if (profile.websiteUrl?.startsWith("https://")) {
    links.push({ kind: "website", url: profile.websiteUrl })
  }
  for (const [name, url] of Object.entries(profile.socialLinks)) {
    if (!url.startsWith("https://")) continue
    const lower = name.toLowerCase()
    const kind =
      lower === "x" || lower === "twitter"
        ? "x"
        : lower === "discord"
          ? "discord"
          : "other"
    links.push({ kind, url })
  }
  return links
}

/** How a pool gauge's pool works, from its label or symbol. */
function poolKindOf(
  label: GaugeLabel | null,
  pair: Pair | null,
): PoolKind | null {
  if (label?.type === "vault") return "vault"
  const poolType = label?.type === "pair" ? label.poolType : pair?.poolType
  if (poolType === "cl") return "cl"
  if (poolType === "stable") return "samm"
  if (poolType === "volatile") return "vamm"
  return null
}

/** What the details reader needs for one gauge; null when nothing fits. */
export function detailsRequest(
  gauge: Gauge,
  gaugeCard: GaugeCard | undefined,
  profile: GaugeProfile | undefined,
  label: GaugeLabel | null,
  tokens: TokensBySymbol,
  chain: GaugeChainExtras | null,
): GaugeDetailsRequest | null {
  switch (gauge.voter) {
    case "boost": {
      const lock =
        gauge.vebtcTokenId === null
          ? undefined
          : chain?.locks.get(gauge.vebtcTokenId)
      return {
        kind: "vebtc",
        gauge: gauge.gaugeAddress,
        tokenId: gauge.vebtcTokenId,
        beneficiary: gauge.beneficiary,
        vebtcWeight: gaugeCard?.vebtcWeight ?? null,
        boost: gaugeCard?.boost ?? null,
        optimalVotes: gaugeCard?.optimalVotes ?? null,
        locked: lock?.locked ?? null,
        lock:
          gauge.vebtcTokenId === null
            ? null
            : (chain?.lockInfo.get(gauge.vebtcTokenId) ?? null),
        killed: gauge.isAlive === false,
      }
    }
    case "validators":
      return {
        kind: "validator",
        gauge: gauge.gaugeAddress,
        operator: gauge.operatorAddress,
        moniker: profile?.displayName ?? gauge.moniker,
      }
    case "pools": {
      const pair =
        label?.type === "pair"
          ? label
          : pairFromSymbol(gauge.poolSymbol, tokens)
      const poolTokens =
        label?.type === "vault" ? [label.token] : (pair?.tokens ?? [])
      if (poolTokens.length === 0) return null
      return {
        kind: "pool",
        gauge: gauge.gaugeAddress,
        pool: gauge.poolAddress,
        poolKind: poolKindOf(label, pair),
        tokens: poolTokens,
        tickSpacing: pair?.tickSpacing ?? null,
      }
    }
    case "third-party":
      return {
        kind: "mezo",
        gauge: gauge.gaugeAddress,
        metadata: label?.type === "named" ? label.metadata : null,
      }
  }
}

/** Builds the directory and every profile; returns the D1 writes. */
export async function buildGaugeReadModels(
  input: GaugeBuildInput,
): Promise<ReadModelWrite<ReadModelKind>[]> {
  const current = epochStartOf(input.nowSeconds)
  const epoch = await input.market.latestEpoch(input.network, current)
  if (epoch === null) return []
  const filter = { voter: null, gauges: null }
  const [gauges, incentives] = await Promise.all([
    input.market.listGauges(input.network, epoch.epochStart, filter),
    input.market.listIncentives(input.network, epoch.epochStart, filter),
  ])
  const incentivesByGauge = new Map(
    incentives.map((entry) => [entry.gaugeAddress, entry]),
  )
  const profiles = new Map(
    input.profiles.map((profile) => [profile.gaugeAddress, profile]),
  )
  const boostTokenIds = gauges.flatMap((gauge) =>
    gauge.voter === "boost" && gauge.vebtcTokenId !== null
      ? [gauge.vebtcTokenId]
      : [],
  )
  const chain =
    input.chain === null
      ? null
      : await input.chain(boostTokenIds).catch(() => null)
  const tokens = tokensBySymbol(
    incentives.flatMap((entry) =>
      entry.rewards.map((reward) => ({
        address: reward.token,
        symbol: reward.symbol,
        decimals: reward.decimals,
      })),
    ),
  )
  const labels =
    input.labels === null
      ? new Map<string, GaugeLabel>()
      : await input.labels(gauges).catch(() => new Map<string, GaugeLabel>())
  const cards = gauges
    .map((gauge) =>
      card(
        gauge,
        incentivesByGauge.get(gauge.gaugeAddress),
        profiles.get(gauge.gaugeAddress),
        chain,
        tokens,
        input.avatarColors.get(gauge.gaugeAddress) ?? null,
        labels.get(gauge.gaugeAddress) ?? null,
      ),
    )
    .sort(compareVotesDescending)
  const details =
    input.details === null
      ? new Map<string, GaugeDetails>()
      : await input
          .details(
            gauges.flatMap((gauge) => {
              const gaugeCard = cards.find(
                (entry) => entry.gauge.address === gauge.gaugeAddress,
              )
              const request = detailsRequest(
                gauge,
                gaugeCard,
                profiles.get(gauge.gaugeAddress),
                labels.get(gauge.gaugeAddress) ?? null,
                tokens,
                chain,
              )
              return request === null ? [] : [request]
            }),
            input.prices,
            input.nowSeconds,
          )
          .catch(() => new Map<string, GaugeDetails>())
  for (const gaugeCard of cards) {
    const entry = details.get(gaugeCard.gauge.address)
    if (entry !== undefined) gaugeCard.meta = cardMetaOf(entry)
  }
  // Expired and withdrawn veBTC locks go last, now that cards know them.
  cards.sort(compareVotesDescending)
  const block = Number(epoch.blockNumber)
  const base = {
    network: input.network,
    block,
    source: "live" as const,
    updatedAt: input.nowSeconds,
  }
  const directory: GaugeDirectory = {
    epoch: epochRef(epoch.epochStart),
    gauges: cards,
    totalVotes: fromRaw(BigInt(epoch.totalWeights.boost ?? "0"), 18),
    total: cards.length,
    kinds: kindTotals(cards),
    nextCursor: null,
  }
  const writes: ReadModelWrite<ReadModelKind>[] = [
    { ...base, kind: "gauges", key: currentKey, data: directory },
  ]
  const lockedBy = chain?.locks
  for (const gauge of gauges) {
    const gaugeCard = cards.find(
      (entry) => entry.gauge.address === gauge.gaugeAddress,
    )
    if (gaugeCard === undefined) continue
    const profile = profiles.get(gauge.gaugeAddress)
    const history = await input.market.listGaugeHistory(
      input.network,
      gauge.gaugeAddress,
      epoch.epochStart + EPOCH_SECONDS,
      12,
    )
    const previous = history.find(
      (entry) => entry.epoch.epochStart === epoch.epochStart - EPOCH_SECONDS,
    )
    const currentApr = incentivesByGauge.get(gauge.gaugeAddress)?.aprPercent
    const previousApr = previous?.incentives.aprPercent ?? null
    const lock =
      gauge.voter === "boost" && gauge.vebtcTokenId !== null
        ? lockedBy?.get(gauge.vebtcTokenId)
        : undefined
    const incentivesHistory: GaugeIncentiveEpoch[] = history
      .filter((entry) => entry.incentives.rewards.length > 0)
      .slice(0, 6)
      .map((entry) => ({
        epoch: epochRef(entry.epoch.epochStart),
        status:
          entry.epoch.epochStart + EPOCH_SECONDS > input.nowSeconds
            ? "upcoming"
            : "paid",
        paysAt: entry.epoch.epochStart + EPOCH_SECONDS,
        incentives: incentiveBreakdown(entry.incentives),
      }))
    const profileModel: GaugeProfileReadModel = {
      card: gaugeCard,
      description: profile?.description ?? null,
      tags: profile?.tags ?? [],
      links: profileLinks(profile),
      owner: gauge.voter === "boost" ? gauge.beneficiary : null,
      locked:
        lock === undefined
          ? null
          : {
              token: btcTokenRef,
              amount: fromRaw(lock.locked, 18),
              usd: null,
            },
      votingStrategy: profile?.votingStrategy ?? null,
      incentiveStrategy: profile?.incentiveStrategy ?? null,
      apyChange:
        currentApr === undefined || currentApr === null || previousApr === null
          ? null
          : subtractPercent(currentApr, previousApr),
      votesHistory: history
        .filter((entry) => entry.epoch.epochStart <= epoch.epochStart)
        .slice(0, 12)
        .reverse()
        .map((entry) => ({
          epoch: epochRef(entry.epoch.epochStart),
          votes: fromRaw(BigInt(entry.incentives.weight ?? "0"), 18),
        })),
      incentivesHistory,
      history: [],
      details: details.get(gauge.gaugeAddress) ?? null,
    }
    writes.push({
      ...base,
      kind: "gauge-profile",
      key: gauge.gaugeAddress,
      data: profileModel,
    })
  }
  return writes
}

function subtractPercent(left: string, right: string): string {
  const scale = (value: string) => {
    const [whole = "0", fraction = ""] = value.split(".")
    return BigInt(whole) * 100n + BigInt(fraction.slice(0, 2).padEnd(2, "0"))
  }
  const difference = scale(left) - scale(right)
  const sign = difference < 0n ? "-" : ""
  const absolute = difference < 0n ? -difference : difference
  return `${sign}${absolute / 100n}.${(absolute % 100n).toString().padStart(2, "0")}`
}
