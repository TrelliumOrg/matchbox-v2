import { getTokenPriceType } from "@matchbox/chain"
import type {
  ActivityRow,
  Allocation,
  ChainHead,
  ClaimEstimate,
  ClaimValue,
  EpochRef,
  GaugeCard,
  GaugeDirectory,
  GaugePicture,
  GaugeProfileReadModel,
  Prices,
  ProSummary,
  GaugeRef as SharedGaugeRef,
  LockRef as SharedLockRef,
  Protocol as SharedProtocol,
  ProtocolEpoch as SharedProtocolEpoch,
  TokenAmount as SharedTokenAmount,
  TokenPrice,
  WalletActivity,
  WalletBalances,
  WalletLock,
  WalletOverview,
  WalletRewards,
} from "@matchbox/contracts/read-models"
import { EPOCH_SECONDS, epochNumberFor, epochStartOf } from "@matchbox/domain"
import {
  apyMinVotes,
  FUNDED_MIN_MICRO_USD,
  type Funding,
  funding,
  usdTextToMicro,
} from "@matchbox/domain/funding"
import {
  nameWithPoolType,
  poolTypeDescription,
  poolTypeLabel,
} from "@matchbox/domain/pool-type"
import { kindOrder } from "../features/gauge/kinds"
import {
  formatCompact,
  formatDate,
  formatToken,
  formatTokenWithSymbol,
  formatUsd,
  formatVeBtc,
  shortAddress,
} from "../lib/format"
import { gaugeDetailRows } from "./gauge-detail-rows"
import type {
  ActivityEvent,
  ActivityFilter,
  ActivityPage,
  ClaimEstimateView,
  GaugeKind,
  GaugeKindTotals,
  GaugeList,
  GaugeMeta,
  GaugeProfile,
  GaugeRef,
  GaugeSummary,
  Home,
  Lock,
  LockRef,
  Market,
  Overview,
  Picture,
  Price,
  Protocol,
  ProtocolEvent,
  Rewards,
  TokenAmount,
  Voter,
  VoteUnit,
  Wallet,
  WhenClaimed,
} from "./view-models"

/**
 * Maps the API Worker's read models (`@matchbox/contracts/read-models`,
 * already validated) into the view models the screens draw. Runs on the Pro
 * Worker inside the server functions. Pure, so it is tested against the
 * shared demo fixtures.
 */

// ---------------------------------------------------------------------------
// Units
// ---------------------------------------------------------------------------

const weiPerUnit = 10n ** 18n

/** "5880000.5" whole votes to an integer wei string. */
export function toWei(decimal: string): string {
  const [int = "0", fraction = ""] = decimal.split(".")
  return `${BigInt(int || "0") * weiPerUnit + BigInt(fraction.padEnd(18, "0").slice(0, 18) || "0")}`
}

/** A percent decimal ("2.56", "-1.8") to basis points, rounded half up. */
export function percentToBps(decimal: string): number {
  const negative = decimal.startsWith("-")
  const [int = "0", fraction = ""] = (
    negative ? decimal.slice(1) : decimal
  ).split(".")
  const digits = fraction.padEnd(3, "0")
  let bps = Number(int) * 100 + Number(digits.slice(0, 2))
  if (Number(digits.charAt(2)) >= 5) bps += 1
  return negative ? -bps : bps
}

/** `whole * bps / 10000` in wei, exactly. */
function shareOfWei(whole: string, basisPoints: number): string {
  return `${(BigInt(toWei(whole)) * BigInt(basisPoints)) / 10_000n}`
}

function isPositive(decimal: string): boolean {
  return /[1-9]/.test(decimal)
}

/**
 * Whether a gauge's incentive tokens fund it, by the rule Stuart shares
 * (`@matchbox/domain/funding`): registry tokens by address, an unpriced
 * registry token as funding of unknown size, an unregistered token never.
 * Decided here, on the server, so the browser gets flags and no maths.
 */
function incentivesFunding(tokens: readonly SharedTokenAmount[]): Funding {
  return funding(
    tokens
      .filter((token) => isPositive(token.amount))
      .map((token) => {
        const registered = getTokenPriceType(token.token.address) !== "unknown"
        return {
          address: token.token.address,
          registered,
          usdMicro:
            !registered || token.usd === null
              ? null
              : usdTextToMicro(token.usd),
        }
      }),
  )
}

/**
 * Micro-USD to the cent, half up, as the API rounds each token's USD.
 * Pro shows and judges a gauge's incentives by its registry tokens'
 * dollars (`Funding.pricedMicro`), never by the API's total: a token
 * outside the registry may carry any USD value, and adds none.
 */
function microToUsd(micro: bigint): string {
  const cents = (micro + 5_000n) / 10_000n
  return `${cents / 100n}.${(cents % 100n).toString().padStart(2, "0")}`
}

/** The flags a gauge's view model carries, from its funding. */
function fundingFlags(result: Funding): {
  funded: boolean
  priced: boolean
  unpriced: number
} {
  return {
    funded: result.status === "funded",
    priced: result.pricedMicro >= FUNDED_MIN_MICRO_USD,
    unpriced: result.unpriced,
  }
}

// ---------------------------------------------------------------------------
// Gauges, tokens, locks
// ---------------------------------------------------------------------------

/** A stable hue from the address, for initials circles and colours. */
export function hueOf(address: string): number {
  const byte = Number.parseInt(address.slice(2, 4), 16)
  return Math.round(((Number.isNaN(byte) ? 0 : byte) * 360) / 256)
}

function picture(shared: GaugePicture, address: string, name: string): Picture {
  switch (shared.type) {
    case "image":
      return { kind: "image", url: shared.url }
    case "initials":
      return { kind: "initials", initials: shared.text, hue: hueOf(address) }
    case "pair":
      return {
        kind: "initials",
        initials: name.slice(0, 2).toUpperCase(),
        hue: hueOf(address),
      }
  }
}

/**
 * A gauge's name without the spaces around it. Profile names are typed by
 * hand: SNF's came as "SNF ", and its page title read "SNF , Matchbox Pro"
 * (19 Nov 2026). A name of spaces only stays as it is.
 */
export function gaugeDisplayName(name: string): string {
  const trimmed = name.trim()
  return trimmed === "" ? name : trimmed
}

export function gaugeRef(shared: SharedGaugeRef): GaugeRef {
  const hue = hueOf(shared.address)
  return {
    address: shared.address,
    voter: shared.voter,
    name: gaugeDisplayName(shared.name),
    poolLabel:
      shared.voter === "pools"
        ? poolTypeLabel({
            poolType: shared.poolType,
            tickSpacing: shared.tickSpacing,
          })
        : null,
    picture: picture(shared.picture, shared.address, shared.name),
    color: { light: `hsl(${hue} 42% 32%)`, dark: `hsl(${hue} 34% 64%)` },
  }
}

function gaugeKind(shared: SharedGaugeRef): GaugeKind {
  if (shared.voter === "pools") return "pool"
  if (shared.voter === "validators") return "validator"
  if (shared.voter === "third-party") return "mezo"
  return "vebtc"
}

export function voteUnitFor(kind: GaugeKind): VoteUnit {
  return kind === "vebtc" || kind === "mezo" ? "veMEZO" : "veBTC"
}

/**
 * The type's card fields from what the directory serves today. The data
 * agent is adding each type's metadata to the read model; until then a
 * veBTC gauge with no veBTC weight left is taken as expired.
 */
function gaugeMeta(card: GaugeCard, kind: GaugeKind): GaugeMeta {
  switch (kind) {
    case "vebtc": {
      const weight = card.vebtcWeight ?? "0"
      return {
        kind,
        tokenId: card.gauge.vebtcTokenId,
        weight,
        boost: card.boost,
        lock: /[1-9]/.test(weight) ? "active" : "expired",
      }
    }
    case "validator":
      return {
        kind,
        operator: null,
        status: card.isAlive ? "active" : "inactive",
      }
    case "pool":
      return {
        kind,
        pair:
          card.gauge.picture.type === "pair"
            ? card.gauge.picture.tokens.map((token) => token.symbol)
            : [],
        poolKind: card.gauge.poolType,
        tvlUsd: null,
      }
    case "mezo":
      return { kind, chain: null, protocol: null }
  }
}

export function tokenAmount(shared: SharedTokenAmount): TokenAmount {
  return {
    symbol: shared.token.symbol,
    token: shared.token.address,
    amount: shared.amount,
    usd: shared.usd,
  }
}

/** A claim's estimate while its day settles; nothing otherwise. */
function estimateOf(
  atClaim: ClaimValue | undefined,
  estimate: ClaimEstimate | undefined,
): { estimate?: ClaimEstimateView } {
  if (atClaim !== undefined || estimate === undefined) return {}
  return {
    estimate: {
      usd: estimate.usd,
      finalOn: Date.parse(`${estimate.finalOn}T00:00:00Z`) / 1000,
      tokens: estimate.tokens.map((token) => ({
        token: token.token.toLowerCase(),
        usd: token.usd,
      })),
    },
  }
}

/** A claim's value when claimed, by its tokens; nothing while pending. */
function whenClaimedOf(
  tokens: readonly SharedTokenAmount[],
  atClaim: ClaimValue | undefined,
): { whenClaimed?: WhenClaimed } {
  if (atClaim === undefined) return {}
  const day = atClaim.tokens[0]?.day
  return {
    whenClaimed: {
      usd: atClaim.usd,
      complete: atClaim.tokens.every((token) => token.price !== null),
      pricedAt: day === undefined ? 0 : Date.parse(`${day}T00:00:00Z`) / 1000,
      tokens: atClaim.tokens.map((value, index) => ({
        token: value.token.toLowerCase(),
        symbol:
          tokens.find(
            (amount) => amount.token.address.toLowerCase() === value.token,
          )?.token.symbol ??
          tokens[index]?.token.symbol ??
          "",
        usd: value.usd,
      })),
    },
  }
}

function lockRef(shared: SharedLockRef): LockRef {
  return { kind: shared.escrow, tokenId: shared.tokenId }
}

export function gaugeSummary(card: GaugeCard): GaugeSummary {
  const kind = gaugeKind(card.gauge)
  const meta = gaugeMeta(card, kind)
  const result = incentivesFunding(card.incentives.tokens)
  const flags = fundingFlags(result)
  const incentivesUsd = microToUsd(result.pricedMicro)
  const votes = toWei(card.votes)
  const minVotes = apyMinVotes({
    funded: flags.funded,
    incentivesUsd,
    unit: voteUnitFor(kind),
  })
  // The API works its APY out from its own total. When that counts
  // dollars the registry does not, the APY is not Pro's to show.
  const apiCountsMore = usdTextToMicro(card.incentives.usd) > result.pricedMicro
  return {
    ...gaugeRef(card.gauge),
    kind,
    meta,
    votesUnit: voteUnitFor(kind),
    expired: meta.kind === "vebtc" && meta.lock === "expired",
    tokenId: card.gauge.vebtcTokenId,
    // A pool's own line says which pool it is, spelled out.
    tagline:
      card.tagline ??
      (kind === "pool"
        ? poolTypeDescription({
            poolType: card.gauge.poolType,
            tickSpacing: card.gauge.tickSpacing,
          })
        : null),
    // No APY unless funded, and no headline on a few cents or a handful
    // of votes (P6).
    apyBps:
      card.apy === null ||
      minVotes === null ||
      BigInt(votes) < minVotes ||
      apiCountsMore
        ? null
        : percentToBps(card.apy),
    incentivesUsd,
    incentiveTokens: card.incentives.tokens.map((token) => token.token.symbol),
    ...flags,
    apyMinVotes: minVotes === null ? null : minVotes.toString(),
    veBtcWeight: card.vebtcWeight ?? "0",
    votes,
    optimalVotes: card.optimalVotes === null ? null : toWei(card.optimalVotes),
  }
}

function lock(shared: WalletLock): Lock {
  const vote = shared.vote
  const epochStart = epochStartOf(Math.floor(Date.now() / 1000))
  // Per voter when the document has it (written from 12 Nov 2026).
  const byVoter =
    vote.status === "voted" && vote.byVoter.length > 0 ? vote.byVoter : null
  return {
    kind: shared.escrow,
    tokenId: shared.tokenId,
    amount: shared.locked.amount,
    usd: shared.locked.usd ?? "0",
    votingPower: shared.votingPower,
    votingPowerWei: toWei(shared.votingPower),
    unlocksAt: shared.unlocksAt,
    expired: shared.tab === "expired",
    autoMax: shared.isPermanent,
    // "voted" means the lock carries votes, which stay from epoch to epoch.
    // Only a vote cast since this epoch began blocks voting again (the
    // live epoch, so a snapshot from before the flip never blocks).
    votedThisEpoch: vote.status === "voted" && vote.votedAt >= epochStart,
    ...(byVoter === null
      ? {}
      : {
          votedVoters: byVoter
            .filter((each) => each.votedAt >= epochStart)
            .map((each) => each.voter),
        }),
    votes:
      byVoter !== null
        ? byVoter.flatMap((each) =>
            each.allocations.map((allocation) => ({
              gauge: gaugeRef(allocation.gauge),
              weight: shareOfWei(each.votes, allocation.basisPoints),
              shareBps: allocation.basisPoints,
            })),
          )
        : vote.status === "voted"
          ? vote.allocations.map((allocation) => ({
              gauge: gaugeRef(allocation.gauge),
              weight: shareOfWei(vote.votes, allocation.basisPoints),
              shareBps: allocation.basisPoints,
            }))
          : [],
    claimableUsd: shared.claimable.usd,
    projectedUsd: shared.projected?.usd ?? null,
    // The wallet read model has no "if voted" estimate yet.
    ifVotedUsd: null,
    boost: shared.boost,
  }
}

// ---------------------------------------------------------------------------
// Market
// ---------------------------------------------------------------------------

/** How epochs are numbered: from the launch epoch (fixtures number the same way). */
export type EpochReference = { number: number; start: number }

export function epochFor(
  timestamp: number,
  reference: EpochReference | null,
): Market["epoch"] {
  const start = epochStartOf(timestamp)
  const number =
    reference === null
      ? (epochNumberFor(BigInt(start)) ?? 0)
      : reference.number + Math.round((start - reference.start) / EPOCH_SECONDS)
  return { number, startsAt: start, endsAt: start + EPOCH_SECONDS }
}

/**
 * An epoch's number from its start, through the domain numbering (Epoch 0
 * is Thu 11 Dec 2025), never a stored index: the indexer still stores
 * Classic's old numbers.
 */
export function numberOf(
  epoch: Pick<EpochRef, "start">,
  reference: EpochReference | null = null,
): number {
  return epochFor(epoch.start, reference).number
}

function price(shared: TokenPrice | null): Price | null {
  if (shared === null) return null
  return {
    usd: shared.usd,
    change24hBps:
      shared.change24h === null ? null : percentToBps(shared.change24h),
    source: shared.source,
  }
}

export function market(
  head: ChainHead,
  prices: Prices,
  reference: EpochReference | null,
): Market {
  return {
    block: { number: head.block, timestamp: head.timestamp },
    epoch: epochFor(head.timestamp, reference),
    prices: { btc: price(prices.btc), mezo: price(prices.mezo) },
  }
}

// ---------------------------------------------------------------------------
// Activity
// ---------------------------------------------------------------------------

const lockActions = {
  "lock-create": "create",
  "lock-add": "increase",
  "lock-extend": "extend",
  "lock-merge": "merge",
  "lock-withdraw": "withdraw",
} as const

/** A wallet row as Activity draws it; boost rows belong to Protocol only. */
export function activityEvent(
  row: ActivityRow,
  reference: EpochReference | null,
): ActivityEvent | null {
  const base = {
    id: row.id,
    status:
      row.status === "pending"
        ? ("confirming" as const)
        : row.status === "reverted"
          ? ("reverted" as const)
          : ("confirmed" as const),
    at: row.timestamp,
    epoch: epochFor(row.timestamp, reference).number,
    block: row.block,
    tx: row.txHash,
  }
  switch (row.type) {
    case "vote":
      return {
        ...base,
        epoch: numberOf(row.epoch, reference),
        detail: {
          kind: "vote",
          lock: lockRef(row.lock),
          votes: row.votes,
          allocation: row.allocations.map((allocation: Allocation) => ({
            gauge: gaugeRef(allocation.gauge),
            shareBps: allocation.basisPoints,
          })),
        },
      }
    case "claim":
      return {
        ...base,
        epoch:
          row.epoch === null || row.epoch === undefined
            ? base.epoch
            : numberOf(row.epoch, reference),
        detail: {
          kind: "claim",
          usd: row.rewards.usd,
          tokens: row.rewards.tokens.map(tokenAmount),
          ...whenClaimedOf(row.rewards.tokens, row.atClaim),
          ...estimateOf(row.atClaim, row.estimate),
          locks: row.locks.map(lockRef),
          gauges: row.gauges.map((gauge) => gaugeDisplayName(gauge.name)),
        },
      }
    case "lock-create":
    case "lock-add":
    case "lock-withdraw":
      return {
        ...base,
        detail: {
          kind: "lock",
          action: lockActions[row.type],
          lock: lockRef(row.lock),
          amount: tokenAmount(row.amount),
          unlocksAt: row.type === "lock-withdraw" ? null : row.unlocksAt,
        },
      }
    case "lock-merge":
      return {
        ...base,
        detail: {
          kind: "lock",
          action: "merge",
          lock: lockRef(row.into),
          amount: tokenAmount(row.amount),
          unlocksAt: null,
        },
      }
    case "lock-extend":
      return null
    case "incentive":
      return {
        ...base,
        epoch: numberOf(row.epoch, reference),
        detail: {
          kind: "incentive",
          gauge: gaugeRef(row.gauge),
          amount: tokenAmount(row.amount),
        },
      }
    case "boost":
    case "boost-refresh":
      return null
  }
}

function events(
  rows: readonly ActivityRow[],
  reference: EpochReference | null,
): ActivityEvent[] {
  return rows.flatMap((row) => {
    const event = activityEvent(row, reference)
    return event === null ? [] : [event]
  })
}

const filterOf: Record<ActivityEvent["detail"]["kind"], ActivityFilter> = {
  vote: "votes",
  claim: "claims",
  lock: "locks",
  incentive: "incentives",
  // Never from the API: the browser adds these, under All only.
  own: "all",
}

export function activityPage(
  shared: WalletActivity,
  reference: EpochReference | null,
): ActivityPage {
  const list = events(shared.rows, reference)
  const counts: Record<ActivityFilter, number> = {
    all: list.length,
    votes: 0,
    claims: 0,
    locks: 0,
    incentives: 0,
  }
  for (const event of list) {
    const filter = filterOf[event.detail.kind]
    if (filter !== "all") counts[filter] += 1
  }
  return {
    address: shared.address,
    counts,
    events: list,
    nextCursor: shared.nextCursor,
  }
}

// ---------------------------------------------------------------------------
// Screens
// ---------------------------------------------------------------------------

/**
 * Display names for the gauges a wallet's locks voted: the wallet read
 * model can name a gauge by its lock ("veBTC #6033") where the directory
 * and Vote call it by its profile ("SNF").
 */
export function withGaugeNames(
  data: Overview,
  names: ReadonlyMap<string, string>,
): Overview {
  if (names.size === 0) return data
  return {
    ...data,
    locks: data.locks.map((entry) => ({
      ...entry,
      votes: entry.votes.map((vote) => ({
        ...vote,
        gauge: {
          ...vote.gauge,
          name: gaugeDisplayName(
            names.get(vote.gauge.address.toLowerCase()) ?? vote.gauge.name,
          ),
        },
      })),
    })),
  }
}

/** Two-decimal dollars of token values; a token without a price adds none. */
function usdTotal(values: readonly (string | null)[]): string {
  const cents = values.reduce(
    (sum, value) =>
      value === null ? sum : sum + BigInt(toWei(value)) / 10n ** 16n,
    0n,
  )
  return `${cents / 100n}.${(cents % 100n).toString().padStart(2, "0")}`
}

/**
 * The wallet's unlocked BTC and MEZO, or null when the balances could not
 * be read: the screens then keep the state that needs no balance.
 */
export function wallet(shared: WalletBalances | null): Wallet | null {
  if (shared === null) return null
  return {
    btc: tokenAmount(shared.btc),
    mezo: tokenAmount(shared.mezo),
    usd: usdTotal([shared.btc.usd, shared.mezo.usd]),
  }
}

/**
 * The Overview banner. The API suggests one of four things; the banner is
 * designed for one, a boost gauge the wallet votes for that is short of 5x.
 * The others (withdraw, vote, claim) show nothing until they have a design.
 */
function suggestion(
  shared: WalletOverview["suggestion"],
): Overview["suggestion"] {
  if (shared === null || shared.type !== "boost") return null
  if (!isPositive(shared.missingVotes)) return null
  return {
    gauge: gaugeRef(shared.gauge),
    votesToMax: toWei(shared.missingVotes),
  }
}

export function overview(
  shared: WalletOverview,
  reference: EpochReference | null,
  currentEpoch: number,
  balances: WalletBalances | null = null,
): Overview {
  return {
    address: shared.address,
    ...(shared.claimableAsOf === undefined
      ? {}
      : { claimableAsOf: shared.claimableAsOf }),
    ...(shared.locksAsOf === undefined ? {} : { locksAsOf: shared.locksAsOf }),
    claimable: {
      epoch:
        shared.claimableEpoch === null || shared.claimableEpoch === undefined
          ? currentEpoch - 1
          : numberOf(shared.claimableEpoch, reference),
      usd: shared.claimable.usd,
      tokens: shared.claimable.tokens.map(tokenAmount),
    },
    projected:
      shared.projected === null || !/[1-9]/.test(shared.projected.usd)
        ? null
        : {
            usd: shared.projected.usd,
            tokens: shared.projected.tokens.map(tokenAmount),
          },
    locks: shared.locks.map(lock),
    wallet: wallet(balances),
    suggestion: suggestion(shared.suggestion),
    activity: events(shared.recentActivity, reference).slice(0, 3),
  }
}

/**
 * The ballot votes with one live lock at a time: the largest veMEZO lock by
 * default (boost and MEZO gauges), and any other live lock on request
 * (veBTC votes validators and pools).
 */
export function voter(
  shared: WalletOverview,
  balances: WalletBalances | null = null,
): Voter {
  const byPower = (left: WalletLock, right: WalletLock): number =>
    BigInt(toWei(right.votingPower)) > BigInt(toWei(left.votingPower)) ? 1 : -1
  const live = shared.locks.filter((entry) => entry.tab !== "expired")
  const ordered = [
    ...live.filter((entry) => entry.escrow === "vemezo").sort(byPower),
    ...live.filter((entry) => entry.escrow === "vebtc").sort(byPower),
  ].map(lock)
  return {
    address: shared.address,
    ...(shared.locksAsOf?.source === "live"
      ? { block: shared.locksAsOf.block }
      : {}),
    lock: ordered[0] ?? null,
    locks: ordered,
    watching: [],
    wallet: wallet(balances),
  }
}

export function gaugeList(shared: GaugeDirectory, block?: number): GaugeList {
  const gauges = shared.gauges.map(gaugeSummary)
  return {
    ...(block === undefined ? {} : { block }),
    epoch: shared.epoch.number,
    total: shared.gauges.length,
    funded: gauges.filter((gauge) => gauge.funded).length,
    fundedKinds: fundedKinds(gauges),
    kindTotals: kindTotals(gauges),
    gauges,
  }
}

/** Count and this epoch's incentives per type (Vote's type cards). */
function kindTotals(gauges: readonly GaugeSummary[]): GaugeKindTotals {
  const micro = new Map<GaugeKind, bigint>()
  const count = new Map<GaugeKind, number>()
  for (const gauge of gauges) {
    count.set(gauge.kind, (count.get(gauge.kind) ?? 0) + 1)
    micro.set(
      gauge.kind,
      (micro.get(gauge.kind) ?? 0n) + usdTextToMicro(gauge.incentivesUsd),
    )
  }
  return Object.fromEntries(
    kindOrder.map((kind) => [
      kind,
      {
        count: count.get(kind) ?? 0,
        incentivesUsd: microToUsd(micro.get(kind) ?? 0n),
      },
    ]),
  ) as GaugeKindTotals
}

/**
 * The types with funded gauges, most priced incentives first (`/vote`'s
 * default type, P3). A type funded only by unpriced registry tokens comes
 * after every priced one, in the types' own order.
 */
function fundedKinds(gauges: readonly GaugeSummary[]): GaugeKind[] {
  const totals = new Map<GaugeKind, bigint>()
  for (const gauge of gauges) {
    if (!gauge.funded) continue
    const priced = gauge.priced ? usdTextToMicro(gauge.incentivesUsd) : 0n
    totals.set(gauge.kind, (totals.get(gauge.kind) ?? 0n) + priced)
  }
  return kindOrder
    .filter((kind) => totals.has(kind))
    .sort((left, right) => {
      const a = totals.get(left) ?? 0n
      const b = totals.get(right) ?? 0n
      return a === b ? 0 : a > b ? -1 : 1
    })
}

/**
 * The signed-out Overview. Totals come from the summary, which covers
 * every gauge; `top` is the directory's own page of funded gauges by
 * incentives. Counting or ranking a page of the directory as if it were
 * the directory is what once read "13 of 50 gauges funded" with 782
 * gauges, over a top four that had no incentives.
 *
 * The API counts a gauge with any incentive token as funded, dust
 * included, so its count is never Pro's. Pro counts the page by
 * `@matchbox/domain/funding`. When the page is not the whole list, the
 * rest may hold funded gauges, those funded only by unpriced tokens
 * sorting after the dust, so the count reads "100+".
 */
export function home(summary: ProSummary, top: GaugeDirectory): Home {
  const funded = top.gauges.map(gaugeSummary).filter((gauge) => gauge.funded)
  return {
    epoch: summary.epoch.number,
    incentivesUsd: summary.incentives.usd,
    gaugesFunded: funded.length,
    gaugesFundedMore: top.gauges.length < top.total,
    gaugesTotal: summary.gaugeCount,
    veMezoVoted: toWei(summary.totalVotes),
    veMezoLocked: toWei(summary.stats.vemezoLocked),
    topGauges: funded.slice(0, 4),
  }
}

export function gaugeProfile(shared: GaugeProfileReadModel): GaugeProfile {
  // The veBTC lock is in Details when the API read it; Strategy keeps it
  // only for a document without details.
  const lockInDetails = shared.details?.kind === "vebtc"
  const card = shared.card
  const link = (kind: "website" | "x" | "discord"): string | null =>
    shared.links.find((entry) => entry.kind === kind)?.url ?? null
  const strategy = [
    { label: "Voting", value: shared.votingStrategy },
    { label: "Incentives", value: shared.incentiveStrategy },
    {
      label: "Lock",
      value:
        lockInDetails ||
        shared.locked === null ||
        card.gauge.vebtcTokenId === null
          ? null
          : `veBTC #${card.gauge.vebtcTokenId}, ${formatToken(shared.locked.amount, "BTC")} BTC`,
    },
  ].flatMap((row) =>
    row.value === null ? [] : [{ label: row.label, value: row.value }],
  )
  const gauge = gaugeSummary(card)
  return {
    gauge,
    about: shared.description,
    // No change beside an APY Pro does not show: "n/a" over "+12.57 vs
    // Epoch 48" would credit a dust gauge with a rising APY.
    apyChangeBps:
      shared.apyChange === null || gauge.apyBps === null
        ? null
        : percentToBps(shared.apyChange),
    strategy,
    details: gaugeDetailRows(shared.details),
    owner: shared.owner,
    links: { website: link("website"), x: link("x"), discord: link("discord") },
    votesHistory: shared.votesHistory.map((entry) => ({
      epoch: entry.epoch.number,
      votes: toWei(entry.votes),
    })),
    incentivesHistory: shared.incentivesHistory.map((entry) => ({
      epoch: entry.epoch.number,
      usd: microToUsd(incentivesFunding(entry.incentives.tokens).pricedMicro),
      tokens: entry.incentives.tokens.map(tokenAmount),
      paysAt: entry.paysAt,
      paid: entry.status === "paid",
    })),
  }
}

export function rewards(shared: WalletRewards): Rewards {
  return {
    address: shared.address,
    ...(shared.claimableAsOf === undefined
      ? {}
      : { claimableAsOf: shared.claimableAsOf }),
    claimable: {
      epoch:
        shared.epoch === null || shared.epoch === undefined
          ? null
          : numberOf(shared.epoch),
      usd: shared.readyToClaim.usd,
      tokens: shared.readyToClaim.tokens.map(tokenAmount),
    },
    projected: null,
    earned: {
      usd: shared.earned.usd,
      fromEpoch: shared.earned.fromEpoch,
      toEpoch: shared.earned.toEpoch,
      ...(shared.earned.whenClaimed === undefined
        ? {}
        : { whenClaimed: shared.earned.whenClaimed }),
    },
    locks: shared.byLock.map((entry) => ({
      lock: lockRef(entry.lock),
      usd: entry.rewards.usd,
      tokens: entry.rewards.tokens.map(tokenAmount),
      gauges: entry.gauges.map((gauge) => ({
        address: gauge.gauge.address,
        voter: gauge.gauge.voter,
        name: gaugeDisplayName(gauge.gauge.name),
        usd: gauge.usd,
      })),
      projectedUsd: null,
      projectedShares: [],
    })),
    history: shared.history.map((claim) => ({
      id: claim.txHash,
      status: "confirmed",
      at: claim.claimedAt,
      epoch: numberOf(claim.epoch),
      block: claim.block,
      tx: claim.txHash,
      detail: {
        kind: "claim",
        usd: claim.rewards.usd,
        tokens: claim.rewards.tokens.map(tokenAmount),
        ...whenClaimedOf(claim.rewards.tokens, claim.atClaim),
        ...estimateOf(claim.atClaim, claim.estimate),
        locks: [],
        gauges: [],
      },
    })),
  }
}

function lockActor(shared: SharedLockRef): ProtocolEvent["actor"] {
  return { kind: shared.escrow, label: `#${shared.tokenId}` }
}

function where(gauges: readonly SharedGaugeRef[]): ProtocolEvent["where"] {
  const first = gauges[0]
  if (first === undefined) return { label: "None", gauge: null }
  if (gauges.length === 1) {
    return { label: gaugeDisplayName(first.name), gauge: gaugeRef(first) }
  }
  return { label: `${gauges.length} gauges`, gauge: gaugeRef(first) }
}

/** One page of everyone's activity, as Protocol's Live activity shows it. */
export function protocolActivityPage(shared: {
  rows: readonly ActivityRow[]
  nextCursor: string | null
}): { events: ProtocolEvent[]; nextCursor: string | null } {
  return {
    events: shared.rows.map(protocolEvent),
    nextCursor: shared.nextCursor,
  }
}

export function protocolEvent(row: ActivityRow): ProtocolEvent {
  const base = { id: row.id, at: row.timestamp, action: row.type }
  const address = { kind: "address" as const, label: shortAddress(row.actor) }
  switch (row.type) {
    case "lock-create":
    case "lock-add":
    case "lock-withdraw":
      return {
        ...base,
        actor: lockActor(row.lock),
        amount: formatToken(row.amount.amount, row.amount.token.symbol),
        amountTokens: [row.amount.token.symbol],
        where: {
          label: row.type === "lock-create" ? "New lock" : "Lock",
          gauge: null,
        },
      }
    case "lock-merge":
      return {
        ...base,
        actor: lockActor(row.from),
        amount: formatTokenWithSymbol(
          row.amount.amount,
          row.amount.token.symbol,
        ),
        amountTokens: [],
        where: { label: `Into #${row.into.tokenId}`, gauge: null },
      }
    case "lock-extend": {
      const years =
        row.unlocksAt === null
          ? null
          : Math.round((row.unlocksAt - row.timestamp) / 31_536_000)
      return {
        ...base,
        actor: lockActor(row.lock),
        amount:
          row.unlocksAt === null
            ? "Permanent"
            : years !== null && years >= 1
              ? `to ${years} ${years === 1 ? "year" : "years"}`
              : `to ${formatDate(row.unlocksAt)}`,
        amountTokens: [],
        where: { label: "Lock", gauge: null },
      }
    }
    case "vote":
      return {
        ...base,
        actor: lockActor(row.lock),
        amount:
          row.lock.escrow === "vemezo"
            ? `${formatCompact(row.votes.split(".")[0] ?? "0")} veMEZO`
            : formatVeBtc(row.votes),
        amountTokens: [],
        where: where(row.allocations.map((allocation) => allocation.gauge)),
      }
    case "incentive":
      return {
        ...base,
        actor: address,
        amount:
          row.amount.usd === null
            ? formatTokenWithSymbol(row.amount.amount, row.amount.token.symbol)
            : formatUsd(row.amount.usd, "cents"),
        amountTokens: [row.amount.token.symbol],
        where: where([row.gauge]),
      }
    case "boost":
      return {
        ...base,
        actor: lockActor(row.lock),
        amount: `${row.previousBoost}× to ${row.boost}×`,
        amountTokens: [],
        where: where([row.gauge]),
      }
    case "claim":
      return {
        ...base,
        actor: address,
        amount: formatUsd(row.rewards.usd, "cents"),
        amountTokens: row.rewards.tokens.map((token) => token.token.symbol),
        where:
          row.gauges.length > 1
            ? { label: `${row.gauges.length} gauges`, gauge: null }
            : where(row.gauges),
      }
    case "boost-refresh":
      return {
        ...base,
        actor: {
          kind: "system",
          label: row.actorName ?? shortAddress(row.actor),
        },
        amount: `${row.positions} positions`,
        amountTokens: [],
        where: { label: "System", gauge: null },
      }
  }
}

/**
 * The line under a funded gauge's name. A pool's type is in its name
 * ("BTC/MUSD CL200"), so its line is its address, as a validator's is:
 * the pool description it had was the icon's hidden label, and the row
 * showed an icon over nothing (P7, 19 Nov 2026).
 */
function fundedSubline(shared: SharedGaugeRef): string {
  if (shared.vebtcTokenId !== null && !shared.name.includes("#")) {
    return `veBTC #${shared.vebtcTokenId}`
  }
  return shortAddress(shared.address)
}

function protocolStats(stats: SharedProtocol["stats"]): Protocol["stats"] {
  return {
    veMezoLocked: toWei(stats.vemezoLocked),
    lockers: stats.vemezoLockers,
    veBtcLocked: stats.vebtcLocked,
    veBtcLockedUsd: stats.vebtcLockedUsd,
    veBtcVoteWeight: stats.vebtcVoteWeight,
    votesThisEpoch: stats.vebtcVotes,
    medianApyBps:
      stats.medianApy === null ? null : percentToBps(stats.medianApy),
  }
}

/** Funded by `@matchbox/domain/funding`, as everywhere in Pro: no dust. */
function fundedOnly(
  funded: SharedProtocol["funded"]["gauges"],
): SharedProtocol["funded"]["gauges"] {
  return funded.filter(
    (entry) => incentivesFunding(entry.incentives.tokens).status === "funded",
  )
}

function fundedGauges(
  funded: SharedProtocol["funded"]["gauges"],
): Protocol["funded"] {
  return fundedOnly(funded).map(fundedGauge)
}

function fundedGauge(
  entry: SharedProtocol["funded"]["gauges"][number],
): Protocol["funded"][number] {
  const result = incentivesFunding(entry.incentives.tokens)
  const flags = fundingFlags(result)
  return {
    id: entry.gauge.address,
    // Pools that share a pair apart: "BTC/MUSD CL200", "BTC/MUSD Volatile".
    name: nameWithPoolType(
      gaugeDisplayName(entry.gauge.name),
      poolTypeLabel({
        poolType: entry.gauge.poolType,
        tickSpacing: entry.gauge.tickSpacing,
      }),
    ),
    kind: gaugeKind(entry.gauge),
    subline: fundedSubline(entry.gauge),
    picture:
      entry.gauge.picture.type === "pair"
        ? {
            kind: "pair" as const,
            tokens: entry.gauge.picture.tokens.map((token) => token.symbol),
          }
        : picture(entry.gauge.picture, entry.gauge.address, entry.gauge.name),
    gauge: entry.gauge.voter === "boost" ? entry.gauge.address : null,
    usd: microToUsd(result.pricedMicro),
    tokens: entry.incentives.tokens.map((token) => token.token.symbol),
    priced: flags.priced,
    unpriced: flags.unpriced,
    deposits: entry.deposits,
  }
}

/** Dollar strings with two decimals: `a - b`, signed. */
function subtractUsd(a: string, b: string): string {
  const cents = (value: string): bigint => {
    const [whole = "0", fraction = ""] = value.replace("-", "").split(".")
    const magnitude =
      BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0").slice(0, 2))
    return value.startsWith("-") ? -magnitude : magnitude
  }
  const difference = cents(a) - cents(b)
  const sign = difference < 0n ? "-" : ""
  const absolute = difference < 0n ? -difference : difference
  return `${sign}${absolute / 100n}.${(absolute % 100n).toString().padStart(2, "0")}`
}

/**
 * Protocol for the current epoch, or for `requested` from its epoch
 * snapshot. Every epoch in the chart can be picked: an epoch without a
 * snapshot shows its bar's figures and no funded list. Stats from before
 * snapshots were kept fall back to the current ones.
 */
export function protocol(
  shared: SharedProtocol,
  past: { epoch: number; snapshot: SharedProtocolEpoch | null } | null = null,
): Protocol {
  const current = shared.epoch.number
  const bars = shared.incentivesByEpoch
  const barIndex =
    past === null
      ? -1
      : bars.findIndex((bar) => bar.epoch.number === past.epoch)
  const bar = barIndex < 0 ? undefined : bars[barIndex]
  const previousBar = barIndex < 1 ? undefined : bars[barIndex - 1]
  const snapshot = past?.snapshot ?? null
  const viewing = past === null || bar === undefined ? null : past.epoch
  return {
    epoch: viewing ?? current,
    latestEpoch: current,
    browsableEpochs: bars.map((entry) => entry.epoch.number),
    incentivesUsd:
      viewing === null
        ? shared.incentives.usd
        : (snapshot?.incentives.usd ?? bar?.totalUsd ?? "0"),
    incentivesChangeUsd:
      viewing === null
        ? (shared.incentives.changeUsd ?? "0")
        : (snapshot?.incentives.changeUsd ??
          (bar === undefined || previousBar === undefined
            ? "0"
            : subtractUsd(bar.totalUsd, previousBar.totalUsd))),
    stats: protocolStats(snapshot?.stats ?? shared.stats),
    incentivesByEpoch: shared.incentivesByEpoch.map((entry) => ({
      epoch: entry.epoch.number,
      all: entry.totalUsd,
      vebtc: entry.vebtcUsd,
      validators: entry.validatorsUsd,
      pools: entry.poolsUsd,
    })),
    funded:
      viewing === null
        ? fundedGauges(shared.funded.gauges)
        : fundedGauges(snapshot?.funded.gauges ?? []),
    // The API's count less the dust it listed (its list is every funded
    // gauge, so this is the count of gauges above a cent).
    fundedTotal:
      viewing === null
        ? shared.funded.count -
          (shared.funded.gauges.length -
            fundedOnly(shared.funded.gauges).length)
        : (snapshot?.funded.count ?? 0) -
          ((snapshot?.funded.gauges.length ?? 0) -
            fundedOnly(snapshot?.funded.gauges ?? []).length),
    // The feed is what is happening now. A past epoch has no feed of its
    // own, and showing today's events under it would pass them off as its.
    events: viewing === null ? shared.feed.rows.map(protocolEvent) : [],
    eventsTotal: viewing === null ? shared.feed.total : 0,
  }
}

export type { EpochRef }
