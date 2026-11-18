import type {
  ScanEpochSources,
  ScanGaugeAprPoint,
  ScanGaugeEmissionRow,
  ScanLockDistribution,
  ScanLockEscrow,
  ScanLockGroup,
  ScanVoterEpoch,
} from "@matchbox/contracts/scan"
import {
  EPOCH_SECONDS,
  EPOCH_ZERO_START,
  epochIndexFor,
  epochStartOf,
} from "@matchbox/domain/epoch"
import {
  formatBtc,
  formatCompact,
  groupThousands,
  unitsToDecimal,
} from "@matchbox/domain/format"
import {
  addPriced,
  amountUsd,
  anyUnpriced,
  btcToken,
  type DailyPrices,
  dayOf,
  epochPriceDay,
  mezoToken,
  type PricedMap,
  pricedText,
  priceMap,
  scaled,
  type Usd,
  usdCompact,
} from "./pricing"
import {
  type RewardBar,
  type RewardSeries,
  type RewardStat,
  type RewardsView,
  stackedBar,
} from "./rewards"
import { percentText, shareBps, votesShort } from "./voting-views"

/**
 * Matchscan's governance panels from the API's summaries (apps/api README
 * "Governance"): rewards to each escrow's voters by source, voting APR per
 * epoch, a gauge's emissions and APR history, and the escrows' lock
 * distribution. Amounts stay bigint; USD at each epoch's closing daily
 * price, as every other voting panel.
 */

// -- rewards to voters by source ----------------------------------------------

export type VoterEscrow = ScanLockEscrow

/** The voter sources whose gauges each escrow votes on. */
export const escrowSources: Record<VoterEscrow, readonly string[]> = {
  vebtc: ["POOLS_VOTER", "VALIDATORS_VOTER"],
  vemezo: ["BOOST_VOTER", "THIRD_PARTY_VOTER"],
}

type DailyAmount = { day: string; decimal: string }

/**
 * A daily series of 18-decimal amounts summed by the epoch each payment
 * is for: the one before the day's. The distributors pay an epoch's chain
 * fees and rebase at the next flip (veBTC's on 29 Oct 2026 at 00:10 UTC,
 * tx 0x64ded3f7…b1b2ca, for 22 to 29 Oct), so the running epoch has none
 * yet.
 */
function byPaidEpoch(points: readonly DailyAmount[]): Map<number, bigint> {
  const totals = new Map<number, bigint>()
  for (const point of points) {
    const start =
      epochStartOf(Date.parse(`${point.day}T00:00:00Z`) / 1000) - EPOCH_SECONDS
    totals.set(start, (totals.get(start) ?? 0n) + scaled(point.decimal))
  }
  return totals
}

function addMaps(
  maps: readonly Readonly<Record<string, string>>[],
): Record<string, string> {
  const sum = new Map<string, bigint>()
  for (const map of maps) {
    for (const [token, amount] of Object.entries(map)) {
      sum.set(token, (sum.get(token) ?? 0n) + BigInt(amount))
    }
  }
  return Object.fromEntries(
    [...sum.entries()].map(([token, amount]) => [token, amount.toString()]),
  )
}

/**
 * The newest closed epoch's start while its flip-day payment is not in the
 * series yet (the series reads finished days once a day, so Thursday's
 * point lands on Friday at the earliest), else null. Only held when the
 * series has the previous flip's payment: a failed read (`null`), an empty
 * series (jobs deployed before the backfill) or a week with no payment
 * single out no epoch, since nothing shows a payment is due.
 */
function pendingPayment(
  rows: readonly { start: number; closed: boolean }[],
  points: readonly DailyAmount[] | null,
): number | null {
  if (points === null) return null
  const newest = rows.filter((row) => row.closed).at(-1)
  if (newest === undefined) return null
  const previousFlip = dayOf(newest.start)
  const flip = dayOf(newest.start + EPOCH_SECONDS)
  const paidBefore = points.some(
    (point) => point.day >= previousFlip && point.day < flip,
  )
  if (!paidBefore) return null
  return points.some((point) => point.day >= flip) ? null : newest.start
}

type SourcePart = { series: RewardSeries; map: PricedMap }

type EpochParts = {
  epoch: number
  start: number
  closed: boolean
  parts: SourcePart[]
  total: PricedMap
}

const sum = (maps: readonly PricedMap[]): PricedMap =>
  maps.reduce(addPriced, { usd: 0n, tokens: [] })

const usdText = (map: PricedMap): string => pricedText(map) ?? "$0"

/**
 * Each epoch's rewards to one escrow by where they come from: veBTC voters
 * get the incentives and pool fees deposited for pool and validator gauges,
 * and every veBTC lock (voting or not) the BTC chain fees
 * (`fees.chain_vebtc`); veMEZO voters the incentives on boost and
 * third-party gauges, and every veMEZO lock the MEZO rebase
 * (`emissions.rebase_distributed`). Chain fees and rebase count toward the
 * epoch they were paid for (`byPaidEpoch`). The series holds finished days
 * only, so the newest closed epoch's payment, made at the flip, is pending
 * until the series reaches the flip day: that epoch is drawn as so far,
 * left out of the average, and the headline is the epoch before it. An
 * epoch neither source has is left out, never drawn as zero; every amount
 * is priced at its epoch's close.
 */
export function paidBySource(input: {
  escrow: VoterEscrow
  sources: ScanEpochSources["data"]
  /** `fees.chain_vebtc` (veBTC) or `emissions.rebase_distributed` (veMEZO). */
  distributed: readonly DailyAmount[] | null
  prices: DailyPrices
  now: number
  complete: boolean
  asOf: number | null
}): RewardsView | null {
  const { escrow, prices, now } = input
  const current = epochStartOf(now)
  const wanted = new Set(escrowSources[escrow])
  const distributed = byPaidEpoch(input.distributed ?? [])
  const starts = new Set<number>()
  for (const row of input.sources) {
    if (wanted.has(row.source)) starts.add(row.epoch_start)
  }
  // The series reaches one epoch further back than the sources (each
  // payment is for the epoch before it): no bar of chain fees alone there.
  const oldest = Math.min(...starts)
  for (const start of distributed.keys()) {
    if (starts.size === 0 || start >= oldest) starts.add(start)
  }
  const series: RewardSeries[] =
    escrow === "vebtc"
      ? [
          { label: "Chain fees", tone: "acc" },
          { label: "Pool fees", tone: "mezo" },
          { label: "Incentives", tone: "ink" },
        ]
      : [
          { label: "Rebase", tone: "mezo" },
          { label: "Fees", tone: "acc" },
          { label: "Incentives", tone: "ink" },
        ]
  const rows: EpochParts[] = [...starts]
    .filter((start) => start >= EPOCH_ZERO_START && start <= current)
    .sort((a, b) => a - b)
    .map((start) => {
      const day = epochPriceDay(start, now)
      const own = input.sources.filter(
        (row) => row.epoch_start === start && wanted.has(row.source),
      )
      const incentives = priceMap(
        addMaps(own.map((row) => row.incentives)),
        day,
        prices,
      )
      const fees = priceMap(addMaps(own.map((row) => row.fees)), day, prices)
      const units = distributed.get(start) ?? 0n
      const paidOut = priceMap(
        units === 0n
          ? {}
          : { [escrow === "vebtc" ? btcToken : mezoToken]: units.toString() },
        day,
        prices,
      )
      const maps = [paidOut, fees, incentives]
      return {
        epoch: epochIndexFor(start),
        start,
        closed: start + EPOCH_SECONDS <= now,
        parts: series.map((each, index) => ({
          series: each,
          map: maps[index] ?? { usd: 0n, tokens: [] },
        })),
        total: sum(maps),
      }
    })
  const first = rows[0]
  if (first === undefined) return null
  const pending = pendingPayment(rows, input.distributed)
  const settled = rows.filter((row) => row.closed && row.start !== pending)
  const last = settled.at(-1)
  const stats: RewardStat[] = []
  const shown = last ?? rows.at(-1) ?? first
  const all = sum(rows.map((row) => row.total))
  // The two largest sources' shares of everything, when all is priced.
  if (all.usd > 0n && !anyUnpriced(all)) {
    const shares = series
      .map((each, index) => ({
        label: `From ${each.label.toLowerCase()}`,
        usd: sum(rows.map((row) => row.parts[index]?.map ?? row.total)).usd,
      }))
      .filter((part) => part.usd > 0n)
      .sort((a, b) => (a.usd === b.usd ? 0 : a.usd > b.usd ? -1 : 1))
      .slice(0, 2)
    for (const part of shares) {
      stats.push({
        label: part.label,
        value: percentText(shareBps(part.usd, all.usd)),
      })
    }
  }
  const recent = settled.slice(-8)
  if (recent.length > 0) {
    const total = sum(recent.map((row) => row.total))
    stats.push({
      label: `Avg ${recent.length} epochs`,
      value:
        pricedText({ ...total, usd: total.usd / BigInt(recent.length) }) ??
        "$0",
    })
  }
  stats.push({ label: "All epochs", value: usdText(all) })
  const bars: RewardBar[] = rows.map((row) =>
    stackedBar(
      row.epoch,
      row.start === current || row.start === pending,
      row.total.usd,
      row.parts.map((part) => part.map.usd),
      series,
      usdText(row.total),
    ),
  )
  return {
    figure: usdText(shown.total),
    note:
      shown === last ? `Epoch ${shown.epoch}` : `Epoch ${shown.epoch} so far`,
    stats,
    series,
    bars,
    since: first.epoch,
    filling: input.complete ? null : { asOf: input.asOf },
  }
}

// -- voting APR per epoch -----------------------------------------------------

export type AprBar = {
  epoch: number
  value: number
  text: string
  current: boolean
}

export type AprView = {
  figure: string
  note: string
  stats: RewardStat[]
  bars: AprBar[]
}

/** "2.56%" from the API's percent string ("2.56"). */
export function aprText(percent: string): string {
  const [whole = "0", fraction = ""] = percent.split(".")
  return `${whole}.${fraction.padEnd(2, "0").slice(0, 2)}%`
}

/** Percent strings as hundredths, for means and changes (exact). */
function hundredths(percent: string): bigint {
  const [whole = "0", fraction = ""] = percent.split(".")
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0").slice(0, 2))
}

function hundredthsText(value: bigint): string {
  const negative = value < 0n
  const abs = negative ? -value : value
  return `${negative ? "-" : ""}${abs / 100n}.${(abs % 100n).toString().padStart(2, "0")}`
}

/** "+0.42 pts" between two APRs. */
function pointsChange(now: string, before: string): string {
  const change = hundredths(now) - hundredths(before)
  return `${change >= 0n ? "+" : ""}${hundredthsText(change)} pts`
}

function aprStats(
  points: readonly { epoch: number; percent: string; closed: boolean }[],
  extra: RewardStat[],
): RewardStat[] {
  const closed = points.filter((point) => point.closed)
  const stats: RewardStat[] = []
  const last = closed.at(-1)
  if (last !== undefined) {
    stats.push({ label: `Epoch ${last.epoch}`, value: aprText(last.percent) })
  }
  if (closed.length > 0) {
    const values = closed.map((point) => hundredths(point.percent))
    // Bigints: Math.max and Math.min do not take them.
    const sorted = [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    const high = sorted.at(-1) ?? 0n
    const low = sorted[0] ?? 0n
    const mean = values.reduce((a, b) => a + b, 0n) / BigInt(values.length)
    stats.push({
      label: `${closed.length} epoch avg`,
      value: `${hundredthsText(mean)}%`,
    })
    stats.push({ label: "High", value: `${hundredthsText(high)}%` })
    stats.push({ label: "Low", value: `${hundredthsText(low)}%` })
  }
  return [...extra, ...stats].slice(0, 4)
}

function aprBars(
  points: readonly { epoch: number; percent: string; current: boolean }[],
): AprBar[] {
  return points.map((point) => ({
    epoch: point.epoch,
    value: Number(hundredths(point.percent)) / 100,
    text: aprText(point.percent),
    current: point.current,
  }))
}

/**
 * One escrow's voting APR per epoch (`/apr`, its `vebtc` or `vemezo`
 * rows): the running epoch's projection and each past epoch's final
 * figure. Epochs with no priced rewards have no APR and no bar.
 */
export function votingAprView(
  rows: readonly ScanVoterEpoch[],
  escrow: VoterEscrow,
  now: number,
): AprView | null {
  const current = epochStartOf(now)
  const other: VoterEscrow = escrow === "vebtc" ? "vemezo" : "vebtc"
  const beside = rows.find(
    (row) =>
      row.voter === other &&
      row.epoch_start === current &&
      row.apr_percent !== null,
  )
  const points = rows
    .filter((row) => row.voter === escrow && row.apr_percent !== null)
    .sort((a, b) => a.epoch_start - b.epoch_start)
    .map((row) => ({
      epoch: epochIndexFor(row.epoch_start),
      percent: row.apr_percent ?? "0",
      closed: !row.open && row.epoch_start < current,
      current: row.epoch_start === current,
    }))
  const latest = points.at(-1)
  if (latest === undefined) return null
  const before = points.at(-2)
  return {
    figure: aprText(latest.percent),
    note:
      before === undefined
        ? `Epoch ${latest.epoch}`
        : `${pointsChange(latest.percent, before.percent)} vs Epoch ${before.epoch}`,
    stats: aprStats(
      points,
      beside?.apr_percent == null
        ? []
        : [
            {
              label: `${other === "vebtc" ? "veBTC" : "veMEZO"} voters`,
              value: aprText(beside.apr_percent),
            },
          ],
    ),
    bars: aprBars(points),
  }
}

/** The gauges one voter's ballot covers. */
const ballotLabels: Record<ScanGaugeAprPoint["voter"], string> = {
  pools: "Pool gauges",
  validators: "Validator gauges",
  boost: "veBTC gauges",
  "third-party": "MEZO gauges",
}

/**
 * The APR of the ballot a gauge is on (its voter's row this epoch), to
 * set beside the gauge's own. Not the escrow's row: that adds both of its
 * ballots, which no single gauge earns.
 */
export function gaugeVoterApr(
  points: readonly ScanGaugeAprPoint[],
  rows: readonly ScanVoterEpoch[],
  epochStart: number,
): { label: string; percent: string } | null {
  const voter = points.at(-1)?.voter
  if (voter === undefined) return null
  const row = rows.find(
    (candidate) =>
      candidate.voter === voter && candidate.epoch_start === epochStart,
  )
  return row?.apr_percent == null
    ? null
    : { label: ballotLabels[voter], percent: row.apr_percent }
}

/**
 * A gauge's APR per epoch as the market cron stored it (its projected APR
 * at each epoch's last snapshot), with its ballot's APR this epoch beside
 * it (`gaugeVoterApr`).
 */
export function gaugeAprView(
  points: readonly ScanGaugeAprPoint[],
  ballotApr: { label: string; percent: string } | null,
  now: number,
): AprView | null {
  const current = epochStartOf(now)
  const shown = points
    .filter((point) => point.apr_percent !== null)
    .map((point) => ({
      epoch: epochIndexFor(point.epoch_start),
      percent: point.apr_percent ?? "0",
      closed: point.epoch_start < current,
      current: point.epoch_start === current,
    }))
  const latest = shown.at(-1)
  if (latest === undefined) return null
  const before = shown.at(-2)
  return {
    figure: aprText(latest.percent),
    note:
      before === undefined
        ? `Epoch ${latest.epoch}`
        : `${pointsChange(latest.percent, before.percent)} vs Epoch ${before.epoch}`,
    stats: aprStats(
      shown,
      ballotApr === null
        ? []
        : [{ label: ballotApr.label, value: aprText(ballotApr.percent) }],
    ),
    bars: aprBars(shown),
  }
}

// -- a gauge's emissions ------------------------------------------------------

export type EmissionsEarnedView = {
  figure: string
  note: string
  stats: RewardStat[]
  bars: AprBar[]
}

function mezoText(units: bigint): string {
  return groupThousands(units / 10n ** 18n)
}

/** "1.30M MEZO", "59.27k MEZO": a stat's compact amount, with its unit. */
function mezoShort(units: bigint): string {
  return `${formatCompact(units / 10n ** 18n)} MEZO`
}

/**
 * The MEZO a voter distributed to one gauge per epoch (validator gauges:
 * the validator's emissions), newest last, in MEZO and in USD at each
 * epoch's close. Claims are not indexed, so nothing says what is
 * unclaimed.
 */
export function emissionsEarnedView(
  rows: readonly ScanGaugeEmissionRow[],
  prices: DailyPrices,
  now: number,
): EmissionsEarnedView | null {
  const current = epochStartOf(now)
  const sorted = [...rows].sort((a, b) => a.epoch_start - b.epoch_start)
  const latest = sorted.at(-1)
  if (latest === undefined) return null
  const amount = (row: ScanGaugeEmissionRow) => BigInt(row.amount)
  const total = sorted.reduce((all, row) => all + amount(row), 0n)
  const latestUsd = amountUsd(
    mezoToken,
    amount(latest),
    epochPriceDay(latest.epoch_start, now),
    prices,
  )
  const first = sorted[0] ?? latest
  const stats: RewardStat[] = [
    {
      label: `Since Epoch ${epochIndexFor(first.epoch_start)}`,
      value: mezoShort(total),
    },
    {
      label: "Average",
      value: mezoShort(total / BigInt(sorted.length)),
    },
    { label: "Epochs paid", value: String(sorted.length) },
    { label: "Claimed", value: "Not indexed" },
  ]
  return {
    figure: `${mezoText(amount(latest))} MEZO`,
    note: `Epoch ${epochIndexFor(latest.epoch_start)}${latestUsd === null ? "" : `, ${usdCompact(latestUsd)}`}`,
    stats,
    bars: sorted.map((row) => ({
      epoch: epochIndexFor(row.epoch_start),
      value: Number(amount(row) / 10n ** 18n),
      text: `${mezoText(amount(row))} MEZO`,
      current: row.epoch_start === current,
    })),
  }
}

// -- lock distribution --------------------------------------------------------

export type ColumnView = {
  /** "1 week", "Permanent", "Dec". */
  label: string
  value: number
  /** The column's amount, exactly ("500.0700 BTC", "1.2M MEZO"): its readout. */
  text: string
  /** The amount drawn over the column ("500.07 BTC", "1.2M MEZO"). */
  short: string
  /** Locks in the column. */
  count: number
  tone: "acc" | "ink" | "soft"
}

export type LockPanelView = {
  figure: string
  note: string
  stats: RewardStat[]
  columns: ColumnView[]
}

export type LockShareView = {
  figure: string
  note: string
  stats: RewardStat[]
  amount: { label: string; value: string; bps: number }[]
  power: { label: string; value: string; bps: number }[]
}

export type LockDistributionView = {
  escrow: VoterEscrow
  /**
   * "As of 15 Nov": the day of the chain read; "Last read 12 Nov" when it
   * is older than yesterday (the daily read keeps failing).
   */
  asOf: string
  stale: boolean
  length: LockPanelView
  size: LockPanelView
  permanence: LockShareView
  calendar: LockPanelView
}

const asset: Record<VoterEscrow, string> = { vebtc: "BTC", vemezo: "MEZO" }

const one = 10n ** 18n
/** 0.0001 BTC: smaller amounts read "<0.0001 BTC" in these panels. */
const btcFloor = 10n ** 14n

/**
 * An amount for the escrow's token with its unit: BTC as the shared
 * formatter writes it ("500.0700 BTC"), never finer than 0.0001
 * ("<0.0001 BTC"); MEZO compact ("1.2M MEZO", "<1 MEZO").
 */
export function lockAmount(
  escrow: VoterEscrow,
  units: string | bigint,
): string {
  const value = typeof units === "bigint" ? units : BigInt(units)
  if (escrow === "vebtc") {
    if (value > 0n && value < btcFloor) return "<0.0001 BTC"
    return formatBtc(unitsToDecimal(value.toString(), 18)).text
  }
  if (value > 0n && value < one) return "<1 MEZO"
  return `${formatCompact(value / one)} MEZO`
}

/** Whole tokens to three significant figures: "35.9M", "121M", "897k". */
function compactThree(whole: bigint): string {
  const tiers: Array<[bigint, string]> = [
    [10n ** 9n, "B"],
    [10n ** 6n, "M"],
    [10n ** 3n, "k"],
  ]
  for (const [scale, suffix] of tiers) {
    if (whole < scale) continue
    const integer = whole / scale
    const places = integer >= 100n ? 0 : integer >= 10n ? 1 : 2
    const factor = 10n ** BigInt(places)
    const step = scale / factor
    const rounded = (whole + step / 2n) / step
    const text =
      places === 0
        ? rounded.toString()
        : `${rounded / factor}.${(rounded % factor).toString().padStart(places, "0")}`
    return `${text}${suffix}`
  }
  return groupThousands(whole)
}

/**
 * The amount drawn over a column, where width is short: BTC to 2 decimals
 * from 1 BTC ("500.07 BTC"), up to 4 below ("0.26 BTC", "0.0015 BTC");
 * MEZO to three significant figures ("35.9M MEZO"). Hover reads the exact
 * amount.
 */
export function columnAmount(
  escrow: VoterEscrow,
  units: string | bigint,
): string {
  const value = typeof units === "bigint" ? units : BigInt(units)
  if (escrow === "vemezo") {
    if (value < one) return lockAmount(escrow, value)
    return `${compactThree(value / one)} MEZO`
  }
  if (value <= 0n || value < btcFloor) {
    return lockAmount(escrow, value)
  }
  const places = value >= one ? 2 : 4
  const step = 10n ** BigInt(18 - places)
  const rounded = ((value + step / 2n) / step) * step
  const [int = "0", fraction = ""] = unitsToDecimal(
    rounded.toString(),
    18,
  ).split(".")
  const digits = fraction.padEnd(places, "0").slice(0, places)
  const shown = places === 2 ? digits : digits.replace(/0{1,2}$/, "")
  return `${groupThousands(BigInt(int))}.${shown} BTC`
}

/** Voting power with its unit: "1,389.0500 veBTC", "36.72M veMEZO". */
function powerAmount(escrow: VoterEscrow, units: string | bigint): string {
  return votesShort(units, escrow === "vebtc" ? "veBTC" : "veMEZO")
}

function chartAmount(units: string | bigint): number {
  const value = typeof units === "bigint" ? units : BigInt(units)
  return Number(value / 10n ** 12n) / 1_000_000
}

/** "1 lock", "1,200 locks". */
export function locksText(count: number): string {
  return `${groupThousands(BigInt(count))} ${count === 1 ? "lock" : "locks"}`
}

const week = 7 * 86_400

/** "1 week", "3 weeks", "1 year", "4 years". */
function spanText(seconds: number): string {
  const weeks = Math.round(seconds / week)
  if (weeks >= 52 && weeks % 52 === 0) {
    const years = weeks / 52
    return `${years} ${years === 1 ? "year" : "years"}`
  }
  return `${weeks} ${weeks === 1 ? "week" : "weeks"}`
}

/** "3.2 years", "12 days". */
function durationText(seconds: number): string {
  const days = seconds / 86_400
  if (days >= 365) return `${(days / 365).toFixed(1)} years`
  if (days >= 14) return `${(days / 7).toFixed(1)} weeks`
  return `${days.toFixed(1)} days`
}

const shareOf = (part: bigint, whole: bigint) =>
  percentText(shareBps(part, whole))

function share(group: ScanLockGroup, whole: bigint): number {
  return shareBps(BigInt(group.amount), whole)
}

/** "Lock length": live locks by time left, then permanent. */
function lengthPanel(doc: ScanLockDistribution): LockPanelView {
  const escrow = doc.escrow
  const total = BigInt(doc.live.amount)
  const longest = doc.by_remaining.at(-1)
  const longOrPermanent =
    BigInt(doc.permanent.amount) + BigInt(longest?.amount ?? "0")
  const columns: ColumnView[] = [
    ...doc.by_remaining.map((bucket) => ({
      label: spanText(bucket.max_seconds),
      value: chartAmount(bucket.amount),
      text: lockAmount(escrow, bucket.amount),
      short: columnAmount(escrow, bucket.amount),
      count: bucket.count,
      tone: "acc" as const,
    })),
    {
      label: "Permanent",
      value: chartAmount(doc.permanent.amount),
      text: lockAmount(escrow, doc.permanent.amount),
      short: columnAmount(escrow, doc.permanent.amount),
      count: doc.permanent.count,
      tone: "ink",
    },
  ]
  if (doc.expired.count > 0) {
    columns.push({
      label: "Expired",
      value: chartAmount(doc.expired.amount),
      text: lockAmount(escrow, doc.expired.amount),
      short: columnAmount(escrow, doc.expired.amount),
      count: doc.expired.count,
      tone: "soft",
    })
  }
  const stats: RewardStat[] = []
  if (doc.mean_remaining_seconds !== null) {
    stats.push({
      label: "Average time left",
      value: durationText(doc.mean_remaining_seconds),
    })
  }
  if (doc.median !== null) {
    stats.push({ label: "Median lock", value: lockAmount(escrow, doc.median) })
  }
  if (doc.largest !== null) {
    stats.push({
      label: "Largest lock",
      value: lockAmount(escrow, doc.largest),
    })
  }
  stats.push({
    label: "Timed locks",
    value: groupThousands(BigInt(doc.timed.count)),
  })
  return {
    figure: total === 0n ? "0.0%" : shareOf(longOrPermanent, total),
    note:
      longest === undefined
        ? "permanent"
        : `over ${spanText(longest.min_seconds)} or permanent`,
    stats,
    columns,
  }
}

/** A bucket edge: "0.01", "10" BTC; "1k", "1M" MEZO. */
function edgeText(escrow: VoterEscrow, units: string): string {
  if (escrow === "vemezo") {
    // Round edges: "1M", not "1.00M".
    return formatCompact(BigInt(units) / 10n ** 18n).replace(
      /\.0+(?=[kMB]$)/,
      "",
    )
  }
  const decimal = unitsToDecimal(units, 18)
  return decimal.includes(".")
    ? decimal.replace(/0+$/, "").replace(/\.$/, "")
    : decimal
}

/** "Lock size": live locks by amount. */
function sizePanel(doc: ScanLockDistribution): LockPanelView {
  const escrow = doc.escrow
  const total = BigInt(doc.live.amount)
  const columns: ColumnView[] = doc.by_size.map((bucket) => {
    const label =
      bucket.max === null
        ? `${edgeText(escrow, bucket.min)}+`
        : BigInt(bucket.min) === 0n
          ? `<${edgeText(escrow, bucket.max)}`
          : `${edgeText(escrow, bucket.min)}+`
    return {
      label,
      value: chartAmount(bucket.amount),
      text: lockAmount(escrow, bucket.amount),
      short: columnAmount(escrow, bucket.amount),
      count: bucket.count,
      tone: "acc" as const,
    }
  })
  const top = doc.by_size.at(-1)
  return {
    figure:
      top === undefined || total === 0n
        ? "0.0%"
        : shareOf(BigInt(top.amount), total),
    note:
      top === undefined
        ? ""
        : `in locks of ${edgeText(escrow, top.min)} ${asset[escrow]} or more`,
    stats: [
      { label: "Live locks", value: groupThousands(BigInt(doc.live.count)) },
      ...(top === undefined
        ? []
        : [
            {
              label: `Locks of ${edgeText(escrow, top.min)}+`,
              value: groupThousands(BigInt(top.count)),
            },
          ]),
    ],
    columns,
  }
}

/** "Permanent vs timed": shares of the amount and of the voting power. */
function permanencePanel(
  doc: ScanLockDistribution,
  ago30: ScanLockDistribution | null,
  ago90: ScanLockDistribution | null,
): LockShareView {
  const escrow = doc.escrow
  const total = BigInt(doc.live.amount)
  const average = (group: ScanLockGroup) =>
    group.count === 0
      ? "None"
      : lockAmount(escrow, BigInt(group.amount) / BigInt(group.count))
  const stats: RewardStat[] = [
    // Amount per lock: "Avg permanent" alone did not say what it averaged.
    { label: "Permanent lock", value: average(doc.permanent), note: "average" },
    { label: "Timed lock", value: average(doc.timed), note: "average" },
  ]
  if (ago30 !== null) {
    const change = doc.permanent.count - ago30.permanent.count
    stats.push({
      label: "Permanent 30d",
      value: change >= 0 ? `+${locksText(change)}` : `-${locksText(-change)}`,
    })
  }
  if (ago90 !== null && BigInt(ago90.live.amount) > 0n) {
    stats.push({
      label: "Share 90d ago",
      value: percentText(share(ago90.permanent, BigInt(ago90.live.amount))),
    })
  }
  const power =
    BigInt(doc.permanent.voting_power) + BigInt(doc.timed.voting_power)
  return {
    figure: total === 0n ? "0.0%" : percentText(share(doc.permanent, total)),
    note: "permanent",
    stats,
    amount: [
      {
        label: `Permanent, ${locksText(doc.permanent.count)}`,
        value: lockAmount(escrow, doc.permanent.amount),
        bps: share(doc.permanent, total),
      },
      {
        label: `Timed, ${locksText(doc.timed.count)}`,
        value: lockAmount(escrow, doc.timed.amount),
        bps: share(doc.timed, total),
      },
      ...(doc.expired.count === 0
        ? []
        : [
            {
              label: `Expired, ${locksText(doc.expired.count)}`,
              value: lockAmount(escrow, doc.expired.amount),
              bps: share(doc.expired, total),
            },
          ]),
    ],
    power: [
      {
        label: "Permanent",
        value: powerAmount(escrow, doc.permanent.voting_power),
        bps: shareBps(BigInt(doc.permanent.voting_power), power),
      },
      {
        label: "Timed",
        value: powerAmount(escrow, doc.timed.voting_power),
        bps: shareBps(BigInt(doc.timed.voting_power), power),
      },
    ],
  }
}

const monthNames = [
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

/**
 * "Unlock calendar": what unlocks ahead, per epoch for veBTC (four weeks
 * at most) and per month for veMEZO, over the next twelve months.
 */
function calendarPanel(doc: ScanLockDistribution): LockPanelView {
  const escrow = doc.escrow
  // 12 columns at most: veMEZO's months from the read's to 11 after it
  // (a 365-day window spans 13 month names); veBTC's 4-week locks all fit.
  const read = new Date(doc.read_at * 1000)
  const horizon =
    escrow === "vebtc"
      ? doc.read_at + 365 * 86_400
      : Date.UTC(read.getUTCFullYear(), read.getUTCMonth() + 12, 1) / 1000 - 1
  const ahead = doc.unlocks.filter((entry) => entry.at <= horizon)
  const groups = new Map<
    string,
    { at: number; count: number; amount: bigint }
  >()
  for (const entry of ahead) {
    const date = new Date(entry.at * 1000)
    const key =
      escrow === "vebtc"
        ? String(entry.at)
        : `${date.getUTCFullYear()}-${date.getUTCMonth()}`
    const group = groups.get(key) ?? { at: entry.at, count: 0, amount: 0n }
    group.count += entry.count
    group.amount += BigInt(entry.amount)
    groups.set(key, group)
  }
  const label = (at: number) => {
    const date = new Date(at * 1000)
    return escrow === "vebtc"
      ? `${date.getUTCDate()} ${monthNames[date.getUTCMonth()]}`
      : (monthNames[date.getUTCMonth()] ?? "")
  }
  const ordered = [...groups.values()].sort((a, b) => a.at - b.at)
  const total = ordered.reduce((all, group) => all + group.amount, 0n)
  const count = ordered.reduce((all, group) => all + group.count, 0)
  const next30 = ahead
    .filter((entry) => entry.at <= doc.read_at + 30 * 86_400)
    .reduce((all, entry) => all + BigInt(entry.amount), 0n)
  const biggest = ordered.reduce<(typeof ordered)[number] | null>(
    (best, group) =>
      best === null || group.amount > best.amount ? group : best,
    null,
  )
  const timed = BigInt(doc.timed.amount)
  const stats: RewardStat[] = [
    { label: "Next 30 days", value: lockAmount(escrow, next30) },
  ]
  if (biggest !== null) {
    const date = new Date(biggest.at * 1000)
    stats.push({
      label: escrow === "vebtc" ? "Biggest week" : "Biggest month",
      value:
        escrow === "vebtc"
          ? label(biggest.at)
          : `${monthNames[date.getUTCMonth()]} ${date.getUTCFullYear()}`,
    })
  }
  stats.push({ label: "Locks unlocking", value: groupThousands(BigInt(count)) })
  if (timed > 0n) {
    stats.push({ label: "Share of timed", value: shareOf(total, timed) })
  }
  return {
    figure: lockAmount(escrow, total),
    note: "in the next 12 months",
    stats,
    columns: ordered.map((group) => ({
      label: label(group.at),
      value: chartAmount(group.amount),
      text: lockAmount(escrow, group.amount),
      short: columnAmount(escrow, group.amount),
      count: group.count,
      tone: "acc" as const,
    })),
  }
}

const shortMonth = (day: string) => {
  const date = new Date(`${day}T00:00:00Z`)
  return `${date.getUTCDate()} ${monthNames[date.getUTCMonth()]}`
}

/** Every lock panel from one day's distribution. */
export function lockDistributionView(input: {
  latest: ScanLockDistribution
  ago30: ScanLockDistribution | null
  ago90: ScanLockDistribution | null
  now: number
}): LockDistributionView {
  const { latest } = input
  const yesterday = new Date((input.now - 86_400) * 1000)
    .toISOString()
    .slice(0, 10)
  const stale = latest.day < yesterday
  return {
    escrow: latest.escrow,
    asOf: `${stale ? "Last read" : "As of"} ${shortMonth(latest.day)}`,
    stale,
    length: lengthPanel(latest),
    size: sizePanel(latest),
    permanence: permanencePanel(latest, input.ago30, input.ago90),
    calendar: calendarPanel(latest),
  }
}

/** USD of an amount at a close, for a figure's note; null unpriced. */
export function lockUsd(
  escrow: VoterEscrow,
  units: string,
  day: string,
  prices: DailyPrices,
): Usd | null {
  return amountUsd(
    escrow === "vebtc" ? btcToken : mezoToken,
    BigInt(units),
    day,
    prices,
  )
}
