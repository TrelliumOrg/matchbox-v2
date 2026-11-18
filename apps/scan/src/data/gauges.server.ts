import {
  type GaugeCard,
  type GaugeProfileReadModel,
  isRetiredGauge,
} from "@matchbox/contracts/read-models"
import type {
  ScanEpochItem,
  ScanGaugeEpochItem,
  ScanIncentiveDepositRow,
  ScanLockVoteItem,
} from "@matchbox/contracts/scan"
import { escrowOf } from "@matchbox/domain/activity"
import {
  EPOCH_SECONDS,
  epochIndexFor,
  epochStartForIndex,
  epochStartOf,
} from "@matchbox/domain/epoch"
import {
  formatBtc,
  formatCompact,
  formatDecimal,
  formatDuration,
  formatTokenWithSymbol,
  formatUsd,
  groupThousands,
  shortAddress,
} from "@matchbox/domain/format"
import { setCacheClass } from "../cache-class.server"
import type { PeriodInput, PeriodView } from "../explorer/voting/range"
import { canonicalQuery } from "./caller.server"
import { nowSeconds } from "./clock.server"
import type { Entity, Section } from "./explorer"
import { proVoteUrl } from "./pro-links"
import { readGaugeApr, readVotingApr } from "./scan/governance.server"
import { gaugeAprView, gaugeVoterApr } from "./scan/governance-views"
import { type FigureWire, figureWireOut } from "./scan/lock-wire"
import { signedCount } from "./scan/network-views"
import { type Period, periodOf, periodSeries, periodView } from "./scan/period"
import { readDailyPrices } from "./scan/prices.server"
import {
  addPriced,
  amountUsd,
  anyUnpriced,
  type DailyPrices,
  dayOf,
  decimalUsd,
  emptyPriced,
  epochPriceDay,
  mezoToken,
  noPrices,
  type PricedMap,
  pricedText,
  tokenPriceOn,
  usdCompact,
  usdDecimal,
} from "./scan/pricing"
import { readScan, type ScanRead } from "./scan/read.server"
import {
  paidByEpoch,
  paidToVoters,
  type RewardBar,
  type RewardSeries,
  type RewardsView,
  tokenBar,
  tokenSeries,
} from "./scan/rewards"
import { scanSchemas } from "./scan/schemas"
import { metric } from "./scan/series"
import { readSeries } from "./scan/series.server"
import {
  countText,
  type SeriesPanelData,
  seriesPanel,
} from "./scan/series-views"
import {
  changeText,
  decimalUnits,
  type EpochSpan,
  epochSpan,
  type GaugeIdentity,
  type GaugeKind,
  gaugeIdentity,
  hasUnpriced,
  kindOfSource,
  mezoWhole,
  percentDecimal,
  percentText,
  scanSection,
  shareBps,
  sourceOrder,
  tokenMapTexts,
  usdText,
  type VoteUnit,
  votesShort,
  votesText,
} from "./scan/voting-views"

/**
 * The Gauges pages: the directory (`ELrUTI5YDe`) and a gauge
 * (`kChmtpKRqP`), with a pool gauge's pool figures (`ak42S52PlW`) as far as
 * the series serve them. Pro's gauge documents come through
 * `/internal/scan/gauges`; votes, rankings, deposits and history from the
 * Scan rows. Every read runs at once; a failed read degrades its own
 * section.
 */

/** Series the pool panels chart (one map, so a rename is one line). */
const charts = {
  volume: metric("dex.volume_in"),
  fees: metric("dex.fees"),
  swaps: metric("dex.swaps"),
  balance: metric("pool.balance"),
}

/** The server's now (the fixture world's own in fixtures mode). */
function now(): number {
  return nowSeconds()
}

export type Stat = {
  label: string
  value: string
  tone?: "pos" | "neg"
  /** A quieter second line under the value. */
  note?: string
}

export type EpochBar = {
  epoch: number
  /** Display height only. */
  value: number
  /** The exact figure for the bar's label. */
  text: string
  current: boolean
}

/** A gauge with a bar against the list's largest value. */
export type GaugeBar = {
  gauge: GaugeIdentity
  value: string
  /** 0 to 10,000 of the largest in the list. */
  bps: number
  note: string | null
}

// -- directory --------------------------------------------------------------

export type GaugeType = "all" | GaugeKind
export type GaugeSort = "votes" | "rewards" | "apy" | "voters"

export type GaugeRow = {
  gauge: GaugeIdentity
  tagline: string | null
  expired: boolean
  votes: string
  /** "5.88M veMEZO" for phones. */
  votesShort: string
  /** "1.09M to optimal", "At 5×", "10.2% of veBTC". */
  votesNote: string | null
  voters: string | null
  rewards: string
  rewardTickers: string[]
  apy: string | null
  proUrl: string
}

export type VeBtcSplit = {
  /** "74.5%". */
  figure: string
  segments: { label: string; value: string; bps: number }[]
  counts: { validators: number; pools: number }
  top: GaugeBar[]
}

export type DirectoryView = {
  /** Null once the epoch has ended (Pro's next one is not out yet). */
  epoch: { number: number; closesIn: string | null }
  counts: Record<GaugeType, number>
  /** One page of the filtered, ordered gauges. */
  rows: GaugeRow[]
  /** Gauges matching the tab, across every page. */
  total: number
  /** The first row's place in the whole order, from 1. */
  from: number
  /** The last row's address: the next page starts after it; null at the end. */
  next: string | null
  /** How many gauges the next page holds. */
  nextCount: number
  /** The cursor was not in today's order, so this is the top again. */
  restarted: boolean
  split: VeBtcSplit | null
  bestApy: GaugeBar[]
}

export type EmissionsView = {
  figure: string
  /** The latest epoch and its emission in USD at its closing price. */
  note: string
  latest: number
  stats: Stat[]
  bars: EpochBar[]
  since: number
  /** Unix seconds the aggregates are as of, while they still fill. */
  filling: { asOf: number | null } | null
}

export type GaugesPage = {
  type: GaugeType
  sort: GaugeSort
  directory: Section<DirectoryView>
  emissions: Section<EmissionsView | null>
  /** Incentives and fees paid to voters per epoch, in USD. */
  paid: Section<RewardsView | null>
}

const typeOrder: readonly GaugeType[] = [
  "all",
  "vebtc",
  "mezo",
  "validator",
  "pool",
]

function votesUnitOf(card: GaugeCard): VoteUnit {
  return card.votesUnit
}

function sumUnits(cards: readonly GaugeCard[]): bigint {
  return cards.reduce((total, card) => total + decimalUnits(card.votes), 0n)
}

function votesNote(card: GaugeCard, veBtcTotal: bigint): string | null {
  if (card.optimalVotes !== null) {
    const votes = decimalUnits(card.votes)
    const optimal = decimalUnits(card.optimalVotes)
    if (votes >= optimal) return "At 5×"
    return `${formatCompact((optimal - votes) / 10n ** 18n)} to optimal`
  }
  if (card.votesUnit === "veBTC" && veBtcTotal > 0n) {
    return `${percentText(shareBps(decimalUnits(card.votes), veBtcTotal))} of veBTC`
  }
  return null
}

/** Each vote unit's total over the live gauges, base units. */
export type UnitTotals = Readonly<Record<VoteUnit, bigint>>

export function unitTotals(live: readonly GaugeCard[]): UnitTotals {
  return {
    veBTC: sumUnits(live.filter((card) => votesUnitOf(card) === "veBTC")),
    veMEZO: sumUnits(live.filter((card) => votesUnitOf(card) === "veMEZO")),
  }
}

/**
 * Votes, largest share first. veBTC and veMEZO are different escrows whose
 * amounts do not compare (a veBTC vote is about 1/100,000 of a veMEZO one
 * in size), so "All" ranks each gauge by its share of its own escrow's
 * votes: the top pool or validator gauge sits beside the top veBTC gauge.
 * Within one unit that is the votes order itself. Exact: the shares are
 * compared cross-multiplied, never rounded.
 */
export function byVoteShare(totals: UnitTotals) {
  return (a: GaugeCard, b: GaugeCard): number => {
    const left = decimalUnits(a.votes) * totals[votesUnitOf(b)]
    const right = decimalUnits(b.votes) * totals[votesUnitOf(a)]
    return left === right ? 0 : left > right ? -1 : 1
  }
}

function sortRows(
  cards: GaugeCard[],
  sort: GaugeSort,
  voters: ReadonlyMap<string, number>,
  totals: UnitTotals,
): GaugeCard[] {
  const shareOrder = byVoteShare(totals)
  const decorated = cards.map((card, index) => ({ card, index }))
  const key = (card: GaugeCard): bigint | null => {
    // A total that leaves out unpriced tokens is not known: sort it last.
    if (sort === "rewards") {
      return hasUnpriced(card.incentives)
        ? null
        : decimalUnits(card.incentives.usd)
    }
    if (sort === "apy") return card.apy === null ? null : decimalUnits(card.apy)
    if (sort === "voters") {
      const count = voters.get(card.gauge.address.toLowerCase())
      return count === undefined ? null : BigInt(count)
    }
    return null
  }
  decorated.sort((a, b) => {
    const retired =
      Number(isRetiredGauge(a.card)) - Number(isRetiredGauge(b.card))
    if (retired !== 0) return retired
    if (sort !== "votes") {
      const left = key(a.card)
      const right = key(b.card)
      if (left !== right) {
        if (left === null) return 1
        if (right === null) return -1
        return left > right ? -1 : 1
      }
    }
    if (sort === "votes") {
      const share = shareOrder(a.card, b.card)
      if (share !== 0) return share
    }
    // Ties: the document's own order (Pro's, votes descending).
    return a.index - b.index
  })
  return decorated.map(({ card }) => card)
}

function bars(
  items: {
    gauge: GaugeIdentity
    units: bigint
    value: string
    note: string | null
  }[],
): GaugeBar[] {
  const max = items.reduce(
    // biome-ignore lint/complexity/useMathMinMax: bigint, Math.max takes numbers
    (largest, item) => (item.units > largest ? item.units : largest),
    0n,
  )
  return items.map((item) => ({
    gauge: item.gauge,
    value: item.value,
    bps: shareBps(item.units, max),
    note: item.note,
  }))
}

/**
 * Gauges per page of the directory. Production holds about 800, which
 * rendered whole made a 2.8 MB page (78 kB brotli); a page of 50 keeps the
 * HTML within its first round trips (see measure's HTML budget) and the
 * table short enough to read on a phone.
 */
export const directoryPageSize = 50

const anAddress = /^0x[0-9a-f]{40}$/

function directoryView(
  cards: readonly GaugeCard[],
  epoch: { number: number; end: number },
  counts: Record<GaugeType, number>,
  type: GaugeType,
  sort: GaugeSort,
  voters: ReadonlyMap<string, number>,
  at: number,
  after: string | null,
): DirectoryView {
  const live = cards.filter((card) => card.isAlive && !isRetiredGauge(card))
  const veBtcCards = live.filter((card) => votesUnitOf(card) === "veBTC")
  const veBtcTotal = sumUnits(veBtcCards)
  const validators = veBtcCards.filter(
    (card) => card.gauge.kind === "validator",
  )
  const pools = veBtcCards.filter((card) => card.gauge.kind === "pool")
  const validatorUnits = sumUnits(validators)
  const poolUnits = sumUnits(pools)
  const split: VeBtcSplit | null =
    veBtcTotal === 0n
      ? null
      : {
          figure: percentText(shareBps(validatorUnits, veBtcTotal)),
          segments: [
            {
              label: "Validators",
              value: votesText(validatorUnits, "veBTC"),
              bps: shareBps(validatorUnits, veBtcTotal),
            },
            {
              label: "Pools",
              value: votesText(poolUnits, "veBTC"),
              bps: shareBps(poolUnits, veBtcTotal),
            },
          ],
          counts: { validators: validators.length, pools: pools.length },
          top: bars(
            [...veBtcCards]
              .sort((a, b) =>
                decimalUnits(b.votes) > decimalUnits(a.votes) ? 1 : -1,
              )
              .slice(0, 5)
              .map((card) => ({
                gauge: gaugeIdentity(card.gauge),
                units: decimalUnits(card.votes),
                value: votesText(decimalUnits(card.votes), "veBTC"),
                note: null,
              })),
          ),
        }
  const bestApy = bars(
    live
      .filter((card) => card.apy !== null)
      .sort((a, b) =>
        decimalUnits(b.apy ?? "0") > decimalUnits(a.apy ?? "0") ? 1 : -1,
      )
      .slice(0, 7)
      .map((card) => ({
        gauge: gaugeIdentity(card.gauge),
        units: decimalUnits(card.apy ?? "0"),
        value: percentDecimal(card.apy ?? "0"),
        note: null,
      })),
  )
  // Filter and order the whole directory, then take one page of it: the
  // cursor is the last row's address, so a page holds the same gauges
  // however the reader got there.
  const ordered = sortRows(
    cards.filter((card) => type === "all" || card.gauge.kind === type),
    sort,
    voters,
    unitTotals(live),
  )
  const cursorAt =
    after === null
      ? -1
      : ordered.findIndex((card) => card.gauge.address.toLowerCase() === after)
  const restarted = after !== null && cursorAt === -1
  const start = cursorAt + 1
  const shown = ordered.slice(start, start + directoryPageSize)
  const last = shown.at(-1)
  return {
    total: ordered.length,
    from: start + 1,
    next:
      last !== undefined && start + shown.length < ordered.length
        ? last.gauge.address.toLowerCase()
        : null,
    nextCount: Math.min(
      directoryPageSize,
      ordered.length - start - shown.length,
    ),
    restarted,
    epoch: {
      number: epoch.number,
      closesIn: epoch.end > at ? formatDuration(epoch.end - at) : null,
    },
    counts,
    split,
    bestApy,
    rows: shown.map((card) => {
      const count = voters.get(card.gauge.address.toLowerCase())
      return {
        gauge: gaugeIdentity(card.gauge),
        tagline: card.tagline,
        expired: isRetiredGauge(card),
        votes: votesText(decimalUnits(card.votes), card.votesUnit),
        votesShort: votesShort(decimalUnits(card.votes), card.votesUnit),
        votesNote: votesNote(card, veBtcTotal),
        voters: count === undefined ? null : groupThousands(BigInt(count)),
        rewards: usdText(card.incentives),
        rewardTickers: card.incentives.tokens.map((each) => each.token.symbol),
        apy: card.apy === null ? null : percentDecimal(card.apy),
        proUrl: proVoteUrl(card.gauge.address, card.gauge.kind),
      }
    }),
  }
}

export function emissionsView(
  items: readonly ScanEpochItem[],
  complete: boolean,
  asOf: number | null,
  current: number,
  prices: DailyPrices = noPrices,
  at: number = now(),
): EmissionsView | null {
  const withEmission = items
    .filter((item) => item.emission !== null)
    .sort((a, b) => a.epoch_start - b.epoch_start)
  const last = withEmission.at(-1)
  if (last === undefined || last.emission === null) return null
  const before = withEmission.at(-2)
  const latest = BigInt(last.emission)
  let peak = withEmission[0]
  for (const item of withEmission) {
    if (BigInt(item.emission ?? "0") > BigInt(peak?.emission ?? "0")) {
      peak = item
    }
  }
  const stats: Stat[] = []
  if (before?.emission != null) {
    stats.push({
      label: `Epoch ${epochIndexFor(before.epoch_start)}`,
      value: `${formatCompact(BigInt(before.emission) / 10n ** 18n)} MEZO`,
    })
    const change = changeText(latest, BigInt(before.emission))
    if (change !== null) {
      stats.push({
        label: "Change",
        value: change,
        tone: change.startsWith("-") ? "neg" : "pos",
      })
    }
  }
  if (peak?.emission != null) {
    stats.push({
      label: `Peak Epoch ${epochIndexFor(peak.epoch_start)}`,
      value: `${formatCompact(BigInt(peak.emission) / 10n ** 18n)} MEZO`,
    })
  }
  const since = epochIndexFor(withEmission[0]?.epoch_start ?? last.epoch_start)
  const total = withEmission.reduce(
    (sum, item) => sum + BigInt(item.emission ?? "0"),
    0n,
  )
  stats.push({
    label: `Since Epoch ${since}`,
    value: `${formatCompact(total / 10n ** 18n)} MEZO`,
  })
  const usd = amountUsd(
    mezoToken,
    latest,
    epochPriceDay(last.epoch_start, at),
    prices,
  )
  return {
    figure: mezoWhole(latest),
    note: `Epoch ${epochIndexFor(last.epoch_start)}${usd === null ? "" : `, ${usdCompact(usd)}`}`,
    latest: epochIndexFor(last.epoch_start),
    stats,
    bars: withEmission.map((item) => ({
      epoch: epochIndexFor(item.epoch_start),
      value: Number(BigInt(item.emission ?? "0") / 10n ** 18n),
      text: mezoWhole(item.emission ?? "0"),
      current: epochIndexFor(item.epoch_start) === current,
    })),
    since,
    filling: complete ? null : { asOf },
  }
}

const directorySources = sourceOrder

const sortOrder: readonly GaugeSort[] = ["votes", "rewards", "apy", "voters"]

/** Each voter source's ranking for the epoch starting at `start`. */
function readRankings(start: number) {
  return Promise.all(
    directorySources.map((source) =>
      readScan(
        `epochs/${start}/gauges`,
        canonicalQuery({ source, limit: 100 }),
        scanSchemas.epochGauges,
      ),
    ),
  )
}

/**
 * The directory. Its epoch is Pro's (the votes, incentives and countdown
 * the document holds), so it is the page's epoch: voters come from that
 * epoch's rankings too. They are read with the clock's epoch at once; at
 * a Thursday rollover, while Pro's document still holds the epoch that
 * just ended, they are read again for the document's (`at` is the clock,
 * a parameter so tests can stand on the boundary).
 */
export async function gaugesPage(
  input: { type: GaugeType; sort: GaugeSort; after?: string | null },
  at: number = now(),
): Promise<GaugesPage> {
  setCacheClass("list")
  const after =
    typeof input.after === "string" && anAddress.test(input.after.toLowerCase())
      ? input.after.toLowerCase()
      : null
  const data: { type: GaugeType; sort: GaugeSort } = {
    type: typeOrder.includes(input.type) ? input.type : "all",
    sort: sortOrder.includes(input.sort) ? input.sort : "votes",
  }
  const clockStart = epochStartOf(at)
  const [directory, epochs, clockRankings, prices] = await Promise.all([
    readScan("gauges", new URLSearchParams(), scanSchemas.gauges),
    readScan("epochs", canonicalQuery({ limit: 100 }), scanSchemas.epochPage),
    readRankings(clockStart),
    readDailyPrices(at),
  ])
  const start =
    directory.status === "ok" ? directory.data.data.epoch.start : clockStart
  const rankings =
    start === clockStart ? clockRankings : await readRankings(start)
  const voters = new Map<string, number>()
  for (const ranking of rankings) {
    if (ranking.status !== "ok") continue
    for (const row of ranking.data.data) voters.set(row.gauge, row.voters)
  }
  const current = epochIndexFor(start)
  return {
    type: data.type,
    sort: data.sort,
    directory: scanSection(directory, (body) => {
      const doc = body.data
      const counts: Record<GaugeType, number> = {
        all: doc.gauges.length,
        vebtc: doc.kinds.vebtc,
        mezo: doc.kinds.mezo,
        validator: doc.kinds.validator,
        pool: doc.kinds.pool,
      }
      return directoryView(
        doc.gauges,
        doc.epoch,
        counts,
        data.type,
        data.sort,
        voters,
        at,
        after,
      )
    }),
    emissions: scanSection(epochs, (page) =>
      emissionsView(
        page.data,
        page.meta.complete,
        page.meta.asOf,
        current,
        prices,
        at,
      ),
    ),
    paid: scanSection(epochs, (page) =>
      paidToVoters(
        paidByEpoch(page.data, prices, at),
        current,
        page.meta.complete,
        page.meta.asOf,
      ),
    ),
  }
}

export const gaugeTypes = typeOrder

// -- one gauge --------------------------------------------------------------

export type GaugeLink = { label: string; url: string }

export type GaugeHeader = {
  gauge: GaugeIdentity
  tagline: string | null
  description: string | null
  tags: string[]
  links: GaugeLink[]
  owner: string | null
  /** Who receives a veBTC or validator gauge's rewards, when read. */
  beneficiary: string | null
  /** This epoch's incentives, in USD at today's prices. */
  incentives: string
  /** "3.1047 BTC" behind a veBTC gauge. */
  locked: string | null
  expired: boolean
  alive: boolean
  stats: Stat[]
  /** veBTC gauges: votes against the optimal that gives 5×. */
  band: {
    votes: string
    of: string
    /** 0 to 10,000. */
    bps: number
    note: string
  } | null
  unit: VoteUnit
  proUrl: string
}

export type VotesPanel = {
  figure: string
  stats: Stat[]
  bars: EpochBar[]
  filling: { asOf: number | null } | null
}

export type IncentivesPanel = {
  figure: string
  stats: Stat[]
  /** Each epoch's incentives stacked by token kind (priced part only). */
  bars: RewardBar[]
  series: RewardSeries[]
}

export type VoterRow = {
  escrow: "vebtc" | "vemezo" | null
  id: string
  weight: string
  share: string | null
  bps: number
  carried: boolean
}

export type WhoVotes = {
  figure: string
  top: number
  segments: { label: string; value: string; bps: number }[]
  stats: Stat[]
}

export type DepositRow = {
  key: string
  /** "6,413.04 MEZO". */
  amount: string
  /** "$1,180.00" at the deposit day's close; null unpriced. */
  usd: string | null
  ticker: string | null
  kind: "Incentive" | "Fees" | string
  epoch: number
  depositor: string
  txHash: string
  timestamp: number
}

export type PoolPanels = {
  name: string
  /**
   * What the two charts are: the pool's first token only, swapped in and
   * held ("BTC swapped into BTC/MUSD", "BTC in BTC/MUSD"). The series are
   * per pool and token; the other side's balance is in the stats.
   */
  volumeLabel: string
  liquidityLabel: string
  facts: Stat[]
  volume: Section<SeriesPanelData>
  volumeStats: Stat[]
  liquidity: Section<SeriesPanelData>
  liquidityStats: Stat[]
  tickers: string[]
}

export type GaugeDetailPage = {
  address: string
  period: PeriodView
  header: Entity<GaugeHeader>
  votes: Section<VotesPanel | null>
  incentives: Section<IncentivesPanel | null>
  who: Section<WhoVotes | null>
  voters: Section<VoterRow[]>
  deposits: Section<DepositRow[]>
  pool: PoolPanels | null
  /**
   * The gauge's APR per epoch as the market cron computed it, with its
   * voters' escrow-wide APR this epoch.
   */
  apr: Section<FigureWire | null>
  epoch: EpochSpan
  /** Unix seconds the page was built (ages). */
  now: number
}

const linkLabels: Record<string, string> = {
  website: "Website",
  x: "X",
  discord: "Discord",
  other: "Link",
}

/** "+0.12 pts vs Epoch 46" from a change in percentage points. */
function apyChangeNote(change: string | null, epoch: number): string | null {
  if (change === null) return null
  const trimmed = change.trim()
  const negative = trimmed.startsWith("-")
  const size = formatDecimal(trimmed.replace(/^[-+]/, ""), 2)
  if (/^0(\.0+)?$/.test(size)) return `No change vs Epoch ${epoch - 1}`
  return `${negative ? "-" : "+"}${size} pts vs Epoch ${epoch - 1}`
}

/** "6,413.04 MEZO", "+1 more": the tokens behind a USD figure. */
function breakdownTokens(breakdown: GaugeCard["incentives"]): string | null {
  const texts = breakdown.tokens.map((each) =>
    each.token.symbol === "BTC"
      ? formatBtc(each.amount).text
      : formatTokenWithSymbol(each.amount, each.token.symbol),
  )
  const first = texts[0]
  if (first === undefined) return null
  return texts.length === 1 ? first : `${first}, ${texts.length - 1} more`
}

function headerView(
  profile: GaugeProfileReadModel,
  epoch: EpochSpan,
): GaugeHeader {
  const card = profile.card
  const gauge = gaugeIdentity(card.gauge)
  const details = profile.details ?? null
  const stats: Stat[] = []
  if (card.apy !== null) {
    const note = apyChangeNote(profile.apyChange, epoch.number)
    stats.push({
      label: "APY",
      value: percentDecimal(card.apy),
      ...(note === null ? {} : { note }),
    })
  }
  const tokens = breakdownTokens(card.incentives)
  stats.push({
    label: "Incentives",
    value: usdText(card.incentives),
    note:
      tokens === null
        ? `Epoch ${epoch.number}`
        : `Epoch ${epoch.number}, ${tokens}`,
  })
  if (card.boost !== null) {
    stats.push({ label: "Boost", value: `${formatDecimal(card.boost, 1)}×` })
  }
  if (details?.kind === "pool") {
    if (details.tvlUsd !== null) {
      stats.push({ label: "Pool value", value: formatUsd(details.tvlUsd) })
    }
    if (details.emissionApr !== null) {
      stats.push({
        label: "Emission APR",
        value: percentDecimal(details.emissionApr),
      })
    }
  }
  if (details?.kind === "validator") {
    stats.push({
      label: "Status",
      value: details.status === "active" ? "Active" : "Left",
    })
  }
  if (details?.kind === "mezo" && details.chain !== null) {
    stats.push({ label: "Chain", value: details.chain })
  }
  const optimal = card.optimalVotes
  let band: GaugeHeader["band"] = null
  if (optimal !== null && card.votesUnit === "veMEZO") {
    const votes = decimalUnits(card.votes)
    const target = decimalUnits(optimal)
    band = {
      votes: groupThousands(votes / 10n ** 18n),
      of: `of ${formatCompact(target / 10n ** 18n)} veMEZO`,
      bps: Math.min(10_000, shareBps(votes, target)),
      note:
        votes >= target
          ? "At 5×"
          : `${formatCompact((target - votes) / 10n ** 18n)} to go`,
    }
  }
  return {
    gauge,
    tagline: card.tagline,
    description: profile.description,
    tags: profile.tags,
    links: profile.links.map((link) => ({
      label: linkLabels[link.kind] ?? "Link",
      url: link.url,
    })),
    owner: profile.owner,
    incentives: usdText(card.incentives),
    beneficiary:
      details?.kind === "validator" || details?.kind === "vebtc"
        ? details.beneficiary
        : null,
    locked:
      profile.locked === null ? null : formatBtc(profile.locked.amount).text,
    expired: isRetiredGauge(card),
    alive: card.isAlive,
    stats: stats.slice(0, 4),
    band,
    unit: card.votesUnit,
    proUrl: proVoteUrl(gauge.address, card.gauge.kind),
  }
}

/**
 * The voters' change from the epoch before; while this epoch runs, the
 * epoch before's own count instead ("41 in Epoch 46").
 */
function votersNote(
  last: ScanGaugeEpochItem,
  before: ScanGaugeEpochItem,
  running: boolean,
): string {
  const epoch = epochIndexFor(before.epoch_start)
  if (running)
    return `${groupThousands(BigInt(before.voters))} in Epoch ${epoch}`
  return `${signedCount(BigInt(last.voters - before.voters))} vs Epoch ${epoch}`
}

function votesPanel(
  rows: readonly (ScanGaugeEpochItem & { complete: boolean })[],
  unit: VoteUnit,
  optimal: string | null,
  complete: boolean,
  asOf: number | null,
  current: number,
): VotesPanel | null {
  const ordered = [...rows].sort((a, b) => a.epoch_start - b.epoch_start)
  const last = ordered.at(-1)
  if (last === undefined) return null
  const before = ordered.at(-2)
  const latest = BigInt(last.vote_weight)
  const stats: Stat[] = []
  // A running epoch's votes are not whole yet: the epoch before is shown
  // as its own figure, not as a change from it.
  const running = epochIndexFor(last.epoch_start) === current
  if (before !== undefined) {
    const diff = latest - BigInt(before.vote_weight)
    const text = votesShort(diff < 0n ? -diff : diff, unit)
    stats.push(
      running
        ? {
            label: `Epoch ${epochIndexFor(before.epoch_start)}`,
            value: votesShort(BigInt(before.vote_weight), unit),
          }
        : {
            label: `vs Epoch ${epochIndexFor(before.epoch_start)}`,
            value: `${diff < 0n ? "-" : "+"}${text}`,
          },
    )
  }
  if (optimal !== null) {
    stats.push({
      label: "Optimal",
      value: votesShort(decimalUnits(optimal), unit),
    })
  }
  stats.push({
    label: "Voters",
    value: groupThousands(BigInt(last.voters)),
    ...(before === undefined
      ? {}
      : { note: votersNote(last, before, running) }),
  })
  if (last.rank !== null) {
    stats.push({ label: "Rank by votes", value: String(last.rank) })
  }
  return {
    figure: votesShort(latest, unit),
    stats: stats.slice(0, 4),
    bars: ordered.slice(-12).map((row) => ({
      epoch: epochIndexFor(row.epoch_start),
      value: Number(BigInt(row.vote_weight) / 10n ** 14n) / 10_000,
      text: votesText(row.vote_weight, unit),
      current: epochIndexFor(row.epoch_start) === current,
    })),
    filling: complete ? null : { asOf },
  }
}

/**
 * A past epoch's breakdown at that epoch's closing daily prices, as the
 * Epochs pages price it: each token's amount at its close.
 */
function breakdownAt(
  breakdown: GaugeCard["incentives"],
  day: string,
  prices: DailyPrices,
): PricedMap {
  const tokens = breakdown.tokens.map((each) => {
    const price = tokenPriceOn(each.token.address, day, prices)
    return {
      token: each.token.address.toLowerCase(),
      symbol: each.token.symbol,
      units: decimalUnits(each.amount),
      usd: price === null ? null : decimalUsd(each.amount, price),
    }
  })
  return {
    usd: tokens.reduce((sum, line) => sum + (line.usd ?? 0n), 0n),
    tokens,
  }
}

/** A Pro value breakdown as a priced map (its USD at today's prices). */
function breakdownPriced(breakdown: GaugeCard["incentives"]): PricedMap {
  return {
    usd: decimalUnits(breakdown.usd),
    tokens: breakdown.tokens.map((each) => ({
      token: each.token.address.toLowerCase(),
      symbol: each.token.symbol,
      units: decimalUnits(each.amount),
      usd: each.usd === null ? null : decimalUnits(each.usd),
    })),
  }
}

/**
 * Incentives per epoch in USD: past epochs at their closing daily prices
 * (as the Epochs pages), the running one at today's (Pro's profile prices
 * it so). This epoch's, the epoch before's, the last 12 epochs together,
 * this epoch's per 1,000 veMEZO (per veBTC on veBTC-voted gauges) and how
 * many addresses deposited this epoch; bars by token kind.
 */
function incentivesPanel(
  profile: GaugeProfileReadModel,
  current: number,
  depositors: string | null,
  prices: DailyPrices,
  at: number,
): IncentivesPanel | null {
  const history =
    profile.history !== undefined && profile.history.length > 0
      ? profile.history.map((row) => ({
          epoch: row.epoch.number,
          incentives: row.incentives,
        }))
      : [...profile.incentivesHistory].reverse().map((row) => ({
          epoch: row.epoch.number,
          incentives: row.incentives,
        }))
  if (history.length === 0) return null
  const card = profile.card
  const now = breakdownPriced(card.incentives)
  const priced = (row: (typeof history)[number]) =>
    row.epoch === current
      ? breakdownPriced(row.incentives)
      : breakdownAt(
          row.incentives,
          epochPriceDay(epochStartForIndex(row.epoch), at),
          prices,
        )
  const shown = history.slice(-12)
  const stats: Stat[] = []
  // This epoch still takes deposits: the one before is its own figure.
  const before = history.find((row) => row.epoch === current - 1)
  if (before !== undefined) {
    stats.push({
      label: `Epoch ${current - 1}`,
      value: pricedText(priced(before)) ?? "$0",
    })
  }
  const twelve = shown.reduce(
    (total, row) => addPriced(total, priced(row)),
    emptyPriced,
  )
  stats.push({
    label: `${shown.length} epochs`,
    value: pricedText(twelve) ?? "$0",
  })
  const votes = decimalUnits(card.votes)
  if (votes > 0n && now.usd > 0n && !anyUnpriced(now)) {
    const veBtc = card.votesUnit === "veBTC"
    // USD per vote unit: veMEZO counted in thousands, veBTC one by one.
    const per = (now.usd * 10n ** 18n * (veBtc ? 1n : 1_000n)) / votes
    stats.push({
      label: veBtc ? "Per veBTC" : "Per 1k veMEZO",
      value: formatUsd(usdDecimal(per)),
    })
  }
  if (depositors !== null) {
    stats.push({ label: "Depositors", value: depositors })
  }
  return {
    figure: usdText(card.incentives),
    stats: stats.slice(0, 4),
    series: tokenSeries.map((group) => group.series),
    bars: shown.map((row) => {
      const map = priced(row)
      return tokenBar(
        row.epoch,
        row.epoch === current,
        map,
        pricedText(map) ?? "$0",
      )
    }),
  }
}

function voterRows(
  votes: readonly ScanLockVoteItem[],
  total: bigint | null,
  unit: VoteUnit,
): VoterRow[] {
  return votes.map((vote) => {
    const weight = BigInt(vote.weight)
    const bps = total === null ? 0 : shareBps(weight, total)
    return {
      escrow: escrowOf(vote.escrow),
      id: vote.token_id,
      weight: votesText(weight, unit),
      share: total === null ? null : percentText(bps),
      bps,
      carried: vote.carried,
    }
  })
}

function whoVotes(
  votes: readonly ScanLockVoteItem[],
  total: bigint | null,
  voters: number | null,
  unit: VoteUnit,
): WhoVotes | null {
  if (total === null || total === 0n || votes.length === 0) return null
  const top = votes.slice(0, 5)
  const topUnits = top.reduce((sum, vote) => sum + BigInt(vote.weight), 0n)
  const largest = BigInt(votes[0]?.weight ?? "0")
  const rest = total > topUnits ? total - topUnits : 0n
  const stats: Stat[] = [
    { label: "Largest voter", value: percentText(shareBps(largest, total)) },
  ]
  if (voters !== null) {
    stats.push({ label: "Voters", value: groupThousands(BigInt(voters)) })
  }
  return {
    figure: percentText(shareBps(topUnits, total)),
    top: top.length,
    segments: [
      {
        label: `Top ${top.length}`,
        value: votesShort(topUnits, unit),
        bps: shareBps(topUnits, total),
      },
      {
        label: "Others",
        value: votesShort(rest, unit),
        bps: shareBps(rest, total),
      },
    ],
    stats,
  }
}

function depositRow(
  row: ScanIncentiveDepositRow,
  prices: DailyPrices,
): DepositRow {
  const texts = tokenMapTexts({ [row.token]: row.amount })
  const amount = texts[0] ?? shortAddress(row.token)
  const ticker = /\s([A-Za-z]+)$/.exec(amount)?.[1] ?? null
  const usd = amountUsd(
    row.token,
    BigInt(row.amount),
    dayOf(row.timestamp),
    prices,
  )
  return {
    key: `${row.tx_hash}:${row.log_index}`,
    amount,
    usd: usd === null ? null : formatUsd(usdDecimal(usd)),
    ticker,
    kind:
      row.reward_type === "Bribe"
        ? "Incentive"
        : row.reward_type === "Fee"
          ? "Fees"
          : row.reward_type,
    epoch: epochIndexFor(row.epoch_start),
    depositor: row.depositor,
    txHash: row.tx_hash,
    timestamp: row.timestamp,
  }
}

function decimalText(symbol: string): (decimal: string) => string {
  return (decimal) =>
    symbol === "BTC"
      ? formatBtc(decimal).text
      : formatTokenWithSymbol(decimal, symbol)
}

async function poolPanels(
  profile: GaugeProfileReadModel,
  period: Period,
  at: number,
): Promise<PoolPanels | null> {
  const details = profile.details ?? null
  if (details?.kind !== "pool" || details.poolKind === "vault") return null
  const [first, second] = details.tokens
  if (first === undefined || second === undefined) return null
  const pool = details.pool.toLowerCase()
  const days = period.read
  const dimension = (token: string) => `${pool}:${token.toLowerCase()}`
  const [volume, fees, swaps, balance, other] = await Promise.all([
    readSeries({
      metric: charts.volume,
      dimension: dimension(first.address),
      days,
      now: at,
    }),
    readSeries({
      metric: charts.fees,
      dimension: dimension(first.address),
      days,
      now: at,
    }),
    // The warehouse holds swaps on basic pools only (CL swaps are not in it).
    details.poolKind === "cl"
      ? Promise.resolve(null)
      : readSeries({ metric: charts.swaps, dimension: pool, days, now: at }),
    readSeries({
      metric: charts.balance,
      dimension: dimension(first.address),
      days,
      now: at,
    }),
    readSeries({
      metric: charts.balance,
      dimension: dimension(second.address),
      days,
      now: at,
    }),
  ])
  const firstText = decimalText(first.symbol)
  const latest = (
    section: typeof fees | null,
    format: (decimal: string) => string,
  ): string | null => {
    if (section === null || section.status !== "ok") return null
    const last = section.data.points.at(-1)
    return last === undefined ? null : format(last.decimal)
  }
  const volumeStats: Stat[] = []
  const feeText = latest(fees, firstText)
  if (feeText !== null) volumeStats.push({ label: "Fees", value: feeText })
  const swapText = latest(swaps, countText)
  if (swapText !== null) volumeStats.push({ label: "Swaps", value: swapText })
  const liquidityStats: Stat[] = []
  const otherText = latest(other, decimalText(second.symbol))
  if (otherText !== null) {
    liquidityStats.push({ label: `${second.symbol} in pool`, value: otherText })
  }
  const facts: Stat[] = []
  if (details.tvlUsd !== null) {
    facts.push({ label: "Pool value", value: formatUsd(details.tvlUsd) })
  }
  if (details.feePercent !== null) {
    facts.push({ label: "Fee", value: percentDecimal(details.feePercent) })
  }
  if (details.stakedPercent !== null) {
    facts.push({
      label: "Staked in gauge",
      value: percentDecimal(details.stakedPercent),
    })
  }
  for (const reserve of details.reserves.slice(0, 2)) {
    facts.push({
      label: `${reserve.token.symbol} reserve`,
      value: decimalText(reserve.token.symbol)(reserve.amount),
    })
  }
  return {
    name: `${first.symbol}/${second.symbol}`,
    volumeLabel: `${first.symbol} swapped into ${first.symbol}/${second.symbol}`,
    liquidityLabel: `${first.symbol} in ${first.symbol}/${second.symbol}`,
    facts: facts.slice(0, 4),
    volume: seriesPanel(periodSeries(volume, period), firstText),
    volumeStats,
    liquidity: seriesPanel(periodSeries(balance, period), firstText),
    liquidityStats,
    tickers: [first.symbol, second.symbol],
  }
}

/**
 * The header's voters this epoch and their change, where the header has
 * room (pool and validator gauges keep their own figures).
 */
function withVoters(
  header: GaugeHeader,
  thisEpoch: ScanGaugeEpochItem | null,
  history: ScanRead<{ data: readonly ScanGaugeEpochItem[] }>,
): GaugeHeader {
  if (thisEpoch === null || header.stats.length >= 4) return header
  const before =
    history.status === "ok"
      ? history.data.data.find(
          (row) => row.epoch_start === thisEpoch.epoch_start - EPOCH_SECONDS,
        )
      : undefined
  const voters: Stat = {
    label: "Voters",
    value: groupThousands(BigInt(thisEpoch.voters)),
    // `thisEpoch` is the running epoch.
    ...(before === undefined
      ? {}
      : { note: votersNote(thisEpoch, before, true) }),
  }
  const stats = [...header.stats]
  // After APY and incentives, as the design orders them.
  const at = stats.findIndex((stat) => stat.label.endsWith("incentives"))
  stats.splice(at < 0 ? stats.length : at + 1, 0, voters)
  return { ...header, stats }
}

/** Deposits read: enough to count this epoch's depositors. */
const depositReadLimit = 50

/** Deposits the list shows. */
const depositsShown = 8

/**
 * Distinct depositors this epoch from the newest deposits; "50+" style
 * when the read ended inside the epoch, so more may exist.
 */
export function depositorsThisEpoch(
  rows: readonly ScanIncentiveDepositRow[],
  epochStart: number,
  more: boolean,
): string | null {
  const mine = rows.filter((row) => row.epoch_start === epochStart)
  if (mine.length === 0) return rows.length === 0 ? null : "0"
  const count = new Set(mine.map((row) => row.depositor.toLowerCase())).size
  const cut = more && mine.length === rows.length
  return `${groupThousands(BigInt(count))}${cut ? "+" : ""}`
}

export async function gaugePage(
  input: {
    gauge: string
    /**
     * For a validator's page, which shows no APY history: skip its reads,
     * and hand back the daily closes the page read.
     */
    validator?: { prices: (prices: DailyPrices) => void }
  } & PeriodInput,
): Promise<GaugeDetailPage> {
  const data = { gauge: input.gauge }
  const at = now()
  const period = periodOf(input, at)
  const epoch = epochSpan(epochStartOf(at))
  const gauge = data.gauge
  if (!/^0x[0-9a-f]{40}$/.test(gauge)) {
    return {
      address: gauge,
      period: periodView(period, at),
      header: { status: "missing" },
      votes: { status: "unavailable" },
      incentives: { status: "unavailable" },
      who: { status: "unavailable" },
      voters: { status: "unavailable" },
      deposits: { status: "unavailable" },
      pool: null,
      apr: { status: "unavailable" },
      epoch,
      now: at,
    }
  }
  setCacheClass("fresh")
  // A pool gauge's series need its pool and tokens, which only the profile
  // names: they start the moment the profile answers, not after the
  // slowest of the other reads.
  const profileRead = readScan(
    `gauges/${gauge}`,
    new URLSearchParams(),
    scanSchemas.gaugeProfile,
  )
  const poolRead = profileRead.then((read) =>
    read.status === "ok" ? poolPanels(read.data.data, period, at) : null,
  )
  const [profile, history, votes, deposits, pool, prices, apr, ballotApr] =
    await Promise.all([
      profileRead,
      readScan(
        `gauges/${gauge}/epochs`,
        canonicalQuery({ limit: 100 }),
        scanSchemas.gaugeHistory,
      ),
      readScan(
        `gauges/${gauge}/voters`,
        canonicalQuery({ limit: 10 }),
        scanSchemas.votePage,
      ),
      readScan(
        `gauges/${gauge}/incentives`,
        canonicalQuery({ limit: depositReadLimit }),
        scanSchemas.incentivePage,
      ),
      poolRead,
      // The 12 epochs the incentives chart prices at their close.
      readDailyPrices(at, epochStartForIndex(Math.max(0, epoch.number - 12))),
      input.validator === undefined
        ? readGaugeApr(gauge, 13)
        : Promise.resolve({ status: "unavailable" as const }),
      input.validator === undefined
        ? readVotingApr(1)
        : Promise.resolve({ status: "unavailable" as const }),
    ])
  input.validator?.prices(prices)
  const doc = profile.status === "ok" ? profile.data.data : null
  const unit: VoteUnit =
    doc?.card.votesUnit ??
    (history.status === "ok"
      ? (() => {
          const kind = kindOfSource(history.data.data[0]?.source ?? "")
          return kind === "validator" || kind === "pool" ? "veBTC" : "veMEZO"
        })()
      : "veMEZO")
  const thisEpoch =
    history.status === "ok"
      ? (history.data.data.find((row) => row.epoch_start === epoch.start) ??
        null)
      : null
  const total = thisEpoch === null ? null : BigInt(thisEpoch.vote_weight)
  return {
    address: gauge,
    period: periodView(period, at),
    epoch,
    now: at,
    header:
      profile.status === "missing"
        ? { status: "missing" }
        : scanSection(profile, (body) =>
            withVoters(headerView(body.data, epoch), thisEpoch, history),
          ),
    votes: scanSection(history, (page) =>
      votesPanel(
        page.data,
        unit,
        doc?.card.optimalVotes ?? null,
        page.meta.complete,
        page.meta.asOf,
        epoch.number,
      ),
    ),
    incentives: scanSection(profile, (body) =>
      incentivesPanel(
        body.data,
        epoch.number,
        deposits.status === "ok"
          ? depositorsThisEpoch(
              deposits.data.data,
              epoch.start,
              deposits.data.nextCursor !== null,
            )
          : null,
        prices,
        at,
      ),
    ),
    who: scanSection(votes, (page) =>
      whoVotes(page.data, total, thisEpoch?.voters ?? null, unit),
    ),
    voters: scanSection(votes, (page) => voterRows(page.data, total, unit)),
    deposits: scanSection(deposits, (page) =>
      page.data.slice(0, depositsShown).map((row) => depositRow(row, prices)),
    ),
    pool,
    apr: scanSection(apr, (body) => {
      const view = gaugeAprView(
        body.data,
        ballotApr.status === "ok"
          ? gaugeVoterApr(body.data, ballotApr.data.data, epoch.start)
          : null,
        at,
      )
      return view === null ? null : figureWireOut(view)
    }),
  }
}
