import type { GaugeKind, GaugePicture } from "@matchbox/contracts/read-models"
import { currentAndNextEpoch, epochIndexFor } from "@matchbox/domain/epoch"
import {
  formatCompact,
  parseDecimal,
  roundDecimal,
} from "@matchbox/domain/format"

/**
 * The homepage's live figures: what the server renders from its last
 * snapshot and what the browser swaps in after (live-data-spec). Amounts
 * are exact decimal strings in whole units ("14820.37" USD, "1404.32"
 * BTC), formatted by Intl from the string, never parsed to a float.
 * Every slot is null when there has never been a value: the page then
 * says "Not available", never zero or a dash.
 */

export type VoteUnit = "veBTC" | "veMEZO"

export type ProGauge = {
  address: string
  name: string
  kind: GaugeKind
  picture: GaugePicture
  votes: string
  votesUnit: VoteUnit
  incentivesUsd: string
  /** The incentive tokens' symbols, for the coin stack. */
  tokens: string[]
}

export type LatestBlock = {
  number: number
  /** The proposer's address (Blockscout's miner), lower case. */
  address: string
  /**
   * The proposer as Matchscan shows it: its validator's name
   * (`validators.ts`), else a short address. Never blank.
   */
  proposer: string
  transactions: number
}

export type ProFigures = {
  incentivesUsd: string | null
  gauges: ProGauge[] | null
}

/**
 * Daily levels scaled to 0..1, oldest first, today last. A day with no
 * value is null: a gap in the line, never a zero.
 */
export type Series = (number | null)[]

/**
 * Each day of a series as its sparkline reads it out on hover, touch or
 * focus: its day ("9 Nov", "Today so far") and exact value with its unit
 * ("1,204,330 MUSD"). Null for a gap, as in the series.
 */
export type SeriesDays = ({ label: string; text: string } | null)[]

const months = [
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

/** "9 Nov" from "2026-11-09"; "Today so far" for today's partial point. */
export function dayText(day: string, partial: boolean): string {
  if (partial) return "Today so far"
  const [, month, date] = day.split("-")
  return `${Number(date)} ${months[Number(month) - 1] ?? ""}`
}

export type ScanFigures = {
  /**
   * MUSD owed across Mezo's borrow venues, in whole MUSD
   * ("4055533.25"): not USD, since nothing prices MUSD.
   */
  borrowedMusd: string | null
  /** Percent of it borrowed through Enclaves, "98.6". */
  borrowedEnclaves: string | null
  borrowedSeries: Series | null
  borrowedDays: SeriesDays | null
  vebtcLocked: string | null
  vebtcLockedUsd: string | null
  vebtcSeries: Series | null
  vebtcDays: SeriesDays | null
  blocks: LatestBlock[] | null
}

/**
 * The figures as the edge reads them: five upstream reads, each of which
 * can answer or fail on its own. `summary` fills Pro's incentives total
 * and Matchscan's veBTC locked, `gauges` the gauge rows, `vebtcSeries`
 * the veBTC sparkline, `blocks` the latest blocks and `borrow` the
 * Borrowed stat (its value, Enclaves share and sparkline).
 */
export type FigureGroup =
  | "summary"
  | "gauges"
  | "vebtcSeries"
  | "blocks"
  | "borrow"

/** When each group was last read successfully (unix ms); null if never. */
export type ReadTimes = Record<FigureGroup, number | null>

export type HomeFigures = {
  pro: ProFigures
  scan: ScanFigures
  /**
   * When each group's figures were last read upstream, for "As of". A
   * group whose read fails keeps its values and its old time, so a
   * single stale figure stays visible as stale.
   */
  at: ReadTimes
}

export const noReads: ReadTimes = {
  summary: null,
  gauges: null,
  vebtcSeries: null,
  blocks: null,
  borrow: null,
}

export const emptyFigures: HomeFigures = {
  pro: { incentivesUsd: null, gauges: null },
  scan: {
    borrowedMusd: null,
    borrowedEnclaves: null,
    borrowedSeries: null,
    borrowedDays: null,
    vebtcLocked: null,
    vebtcLockedUsd: null,
    vebtcSeries: null,
    vebtcDays: null,
    blocks: null,
  },
  at: noReads,
}

function keep<T>(fresh: T | null, known: T | null): T | null {
  return fresh ?? known
}

/**
 * A figure that has a value keeps it: a fresh read fills the slots it
 * has and leaves the others as they were (live-data-spec, "No cached
 * value"). A group read earlier than the one already shown never
 * replaces it, so an answer that lands late cannot step the page back.
 */
export function mergeFigures(
  known: HomeFigures,
  fresh: HomeFigures,
): HomeFigures {
  const newer = (group: FigureGroup): boolean => {
    const was = known.at[group]
    const now = fresh.at[group]
    return was === null || now === null || now >= was
  }
  const take = <T>(group: FigureGroup, next: T | null, was: T | null) =>
    newer(group) ? keep(next, was) : was
  // The Borrowed stat's three figures come from one answer and move
  // together: a read that answered replaces all three, so a share or a
  // sparkline the new answer lacks is not left beside a newer total. A
  // read that did not answer (no read time) keeps all three.
  const borrowRead =
    fresh.at.borrow !== null &&
    (known.at.borrow === null || fresh.at.borrow >= known.at.borrow)
  const borrow = borrowRead ? fresh.scan : known.scan
  return {
    pro: {
      incentivesUsd: take(
        "summary",
        fresh.pro.incentivesUsd,
        known.pro.incentivesUsd,
      ),
      gauges: take("gauges", fresh.pro.gauges, known.pro.gauges),
    },
    scan: {
      borrowedMusd: borrow.borrowedMusd,
      borrowedEnclaves: borrow.borrowedEnclaves,
      borrowedSeries: borrow.borrowedSeries,
      borrowedDays: borrow.borrowedDays,
      vebtcLocked: take(
        "summary",
        fresh.scan.vebtcLocked,
        known.scan.vebtcLocked,
      ),
      vebtcLockedUsd: take(
        "summary",
        fresh.scan.vebtcLockedUsd,
        known.scan.vebtcLockedUsd,
      ),
      vebtcSeries: take(
        "vebtcSeries",
        fresh.scan.vebtcSeries,
        known.scan.vebtcSeries,
      ),
      vebtcDays: take(
        "vebtcSeries",
        fresh.scan.vebtcDays,
        known.scan.vebtcDays,
      ),
      blocks: take("blocks", fresh.scan.blocks, known.scan.blocks),
    },
    at: {
      summary: latest(known.at.summary, fresh.at.summary),
      gauges: latest(known.at.gauges, fresh.at.gauges),
      vebtcSeries: latest(known.at.vebtcSeries, fresh.at.vebtcSeries),
      blocks: latest(known.at.blocks, fresh.at.blocks),
      borrow: latest(known.at.borrow, fresh.at.borrow),
    },
  }
}

function latest(a: number | null, b: number | null): number | null {
  if (a === null) return b
  if (b === null) return a
  return Math.max(a, b)
}

/* Epoch, computed locally and never fetched. */

export type EpochView = { number: number; countdown: string }

const minuteMs = 60_000

/**
 * The current epoch's number and the time left in it: "3d 12h" from a
 * day, "11h 20m" under a day, "42m" under an hour, never below "1m".
 */
export function epochView(nowMs: number): EpochView {
  const { current } = currentAndNextEpoch(Math.floor(nowMs / 1000))
  const leftMinutes = Math.max(
    1,
    Math.ceil((current.end * 1000 - nowMs) / minuteMs),
  )
  return {
    number: epochIndexFor(current.start),
    countdown: countdownText(leftMinutes),
  }
}

export function countdownText(leftMinutes: number): string {
  const minutes = Math.max(1, leftMinutes)
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)
  const rest = minutes % 60
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`
  if (hours > 0) return `${hours}h ${rest}m`
  return `${rest}m`
}

/** Unix ms of the next epoch boundary (Thursday 00:00 UTC). */
export function nextEpochAt(nowMs: number): number {
  return currentAndNextEpoch(Math.floor(nowMs / 1000)).current.end * 1000
}

/* Number formats: Intl options, so NumberFlow rolls the same text. */

/** Intl's options as NumberFlow takes them: standard or compact notation. */
export type NumberFormat = Omit<Intl.NumberFormatOptions, "notation"> & {
  notation?: "standard" | "compact"
}

export const usdWhole: NumberFormat = {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
}

export const usdCompact: NumberFormat = {
  style: "currency",
  currency: "USD",
  notation: "compact",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
}

export const twoPlaces: NumberFormat = {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
}

export const compactTwo: NumberFormat = {
  notation: "compact",
  maximumFractionDigits: 2,
}

export const wholeNumber: NumberFormat = {
  maximumFractionDigits: 0,
}

export const oneDecimal: NumberFormat = {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
}

/** A decimal string Intl formats exactly; anything else is no number. */
export type Numeric = `${number}`

function isNumeric(value: string): value is Numeric {
  return /^-?\d+(\.\d+)?$/.test(value)
}

export function numeric(value: string): Numeric | null {
  return isNumeric(value) ? value : null
}

/** Whole part of a non-negative decimal string, as a bigint. */
function wholePart(value: string): bigint {
  const whole = value.split(".")[0] ?? "0"
  return /^\d+$/.test(whole) ? BigInt(whole) : 0n
}

/** At or above this many whole units, a figure goes compact. */
export function atLeast(value: string, threshold: bigint): boolean {
  return wholePart(value) >= threshold
}

/** USD from $1,000,000 compact with 2 decimals ($1.24M), else whole. */
export function usdFormat(value: string): NumberFormat {
  return atLeast(value, 1_000_000n) ? usdCompact : usdWhole
}

/**
 * Votes in the gauge's unit: veBTC with 2 decimals, veMEZO compact with 2
 * decimals from 1,000 (5.88M, 22.15k) and whole below.
 */
export function votesFormat(value: string, unit: VoteUnit): NumberFormat {
  if (unit === "veBTC") return twoPlaces
  return atLeast(value, 1000n) ? compactTwo : wholeNumber
}

/** An abbreviated amount: the digits that roll and the suffix after them. */
export type CompactAmount = {
  value: Numeric
  format: NumberFormat
  /** "M", "k", "B" or "". */
  suffix: string
}

/** "4.06M" from "4055533.25": the compact figure the stats show, as text. */
export function compactText(value: string): string {
  return formatCompact(roundDecimal(parseDecimal(value), 0).int)
}

/**
 * Whole units abbreviated as `@matchbox/domain/format` abbreviates counts
 * (4.06M, 55.53k, 553), rounded half up to whole units first, in bigint.
 * Null for anything that is not a non-negative decimal string.
 */
export function compactAmount(value: string): CompactAmount | null {
  if (!/^\d+(\.\d+)?$/.test(value)) return null
  const whole = roundDecimal(parseDecimal(value), 0).int
  const match = /^([\d,]+)(?:\.(\d+))?([kMB]?)$/.exec(formatCompact(whole))
  if (match === null) return null
  const fraction = match[2] ?? ""
  const digits = numeric(
    `${(match[1] ?? "").replaceAll(",", "")}${fraction === "" ? "" : `.${fraction}`}`,
  )
  if (digits === null) return null
  return {
    value: digits,
    format: {
      minimumFractionDigits: fraction.length,
      maximumFractionDigits: fraction.length,
    },
    suffix: match[3] ?? "",
  }
}

export function txnsUnit(count: number): string {
  return count === 1 ? "txn" : "txns"
}

/* Sparklines */

/**
 * Daily levels (base-unit integer strings) scaled to 0..1 against their
 * own range, exactly in bigint, then to a float only for drawing. The
 * range is never narrower than 0.5% of the latest level, centred on the
 * days' own: a larger move fills the height as before, and a small one
 * (804 of 806 BTC) draws as a slope, not as a fall to the floor. A flat
 * series sits in the middle. A day with no value (null) stays null and
 * the range is the other days'. Fewer than two days with a value is no
 * series: there is no line to draw.
 */
/** The least range a sparkline spans: a two-hundredth (0.5%) of the latest level. */
const minSpanDivisor = 200n

export function scaleSeries(values: readonly (string | null)[]): Series | null {
  const parsed: (bigint | null)[] = []
  let low: bigint | null = null
  let high: bigint | null = null
  let count = 0
  let latest = 0n
  for (const value of values) {
    if (value === null) {
      parsed.push(null)
      continue
    }
    if (!/^-?\d+$/.test(value)) return null
    const level = BigInt(value)
    parsed.push(level)
    count++
    if (low === null || level < low) low = level
    if (high === null || level > high) high = level
    latest = level
  }
  if (low === null || high === null || count < 2) return null
  const floor = low
  const own = high - low
  const least = (latest < 0n ? -latest : latest) / minSpanDivisor
  // The padding is split either side; the sums below are doubled so that
  // centring a narrow range needs no half units.
  const pad = own < least ? least - own : 0n
  const span = own + pad
  const steps = 10_000n
  return parsed.map((value) => {
    if (value === null) return null
    if (span === 0n) return 0.5
    return Number(((2n * (value - floor) + pad) * steps) / (2n * span)) / 10_000
  })
}

const sparkWidth = 300
const sparkHeight = 44
const sparkTop = 8
const sparkBottom = 40

function sparkY(value: number): number {
  return +(sparkBottom - value * (sparkBottom - sparkTop)).toFixed(2)
}

/** Where day `index` of `count` sits in the sparkline's 300 by 44 box. */
export function sparkPoint(
  index: number,
  count: number,
  value: number,
): [number, number] {
  return [
    +((index / Math.max(1, count - 1)) * sparkWidth).toFixed(2),
    sparkY(value),
  ]
}

/**
 * The line and the area under it, in a 300 by 44 box. Each day keeps its
 * place on the x axis, so a day with no value is a gap: each run of days
 * with values is its own piece, closed to the bottom on its own. A step
 * holds a day's level until the next day starts, so a lone day between
 * gaps is still a short level; a line needs two days to draw anything.
 */
export function sparkPaths(
  series: readonly (number | null)[],
  shape: "step" | "line",
): { line: string; area: string } {
  const last = series.length - 1
  const x = (index: number): number =>
    +((index / Math.max(1, last)) * sparkWidth).toFixed(2)
  const lines: string[] = []
  const areas: string[] = []
  let index = 0
  while (index <= last) {
    const start = series[index]
    if (start === null || start === undefined) {
      index++
      continue
    }
    const from = index
    let piece = `M${x(from)} ${sparkY(start)}`
    for (index = from + 1; index <= last; index++) {
      const value = series[index]
      if (value === null || value === undefined) break
      piece +=
        shape === "step"
          ? ` H${x(index)} V${sparkY(value)}`
          : ` L${x(index)} ${sparkY(value)}`
    }
    // `index` is the first day after the run: a gap, or past the end.
    if (shape === "step") {
      piece += ` H${index > last ? sparkWidth : x(index)}`
    } else if (index - from < 2) {
      continue
    }
    lines.push(piece)
    areas.push(`${piece} V${sparkHeight} H${x(from)}Z`)
  }
  return { line: lines.join(" "), area: areas.join(" ") }
}

/* "As of" */

/**
 * How old each group's figures may be before the card says "As of". Each
 * fits how often the figure really changes and how often the page re-reads
 * it, so a missed re-read or two never raises the note, and a figure that
 * has stopped moving does:
 *
 * - `blocks`: Mezo makes a block about every 3.8 s. The page re-reads
 *   every 30 s on a new block, or, while the head socket is down, on the
 *   fallback poll, which backs off to every 2 minutes. Add the edge's
 *   15 s reuse and the 5 s deadline and a healthy page's blocks are at
 *   most about 2.5 minutes old; three minutes is past every normal
 *   re-read, and some 50 blocks behind: no longer "latest".
 * - `summary` and `gauges`: incentives, votes and locks change when
 *   someone deposits, votes or locks, minutes apart, and are read in the
 *   same request as the blocks. Five minutes is the spec's threshold
 *   (live-data-spec, "As of note") and at least two missed re-reads.
 * - `borrow`: the route answers from a live snapshot taken every five
 *   minutes, and the edge re-reads it at most once a minute (the route's
 *   `max-age`) on the page's 30 s re-reads. Five minutes is the spec's
 *   threshold: a missed snapshot, and at least three missed re-reads.
 * - `vebtcSeries`: thirty daily points, where only today's moves, by
 *   much less than a pixel of the 44 px sparkline in an hour. An hour.
 */
export const staleAfterMs: Readonly<Record<FigureGroup, number>> = {
  blocks: 180_000,
  summary: 300_000,
  gauges: 300_000,
  borrow: 300_000,
  vebtcSeries: 3_600_000,
}

/** The groups each card shows, so each card's note covers its own figures. */
export const cardGroups = {
  pro: ["summary", "gauges"],
  scan: ["summary", "borrow", "vebtcSeries", "blocks"],
} as const satisfies Record<string, readonly FigureGroup[]>

/** A fresh request slower than this counts as unavailable. */
export const freshDeadlineMs = 5_000

/**
 * "As of 14:05" in the visitor's time zone, 24 hour; older than a day,
 * "As of Thu 5 Nov, 14:05".
 */
export function asOfText(atMs: number, nowMs: number, timeZone?: string) {
  const time = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    ...(timeZone === undefined ? {} : { timeZone }),
  }).format(atMs)
  if (nowMs - atMs < 86_400_000) return `As of ${time}`
  const day = new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    ...(timeZone === undefined ? {} : { timeZone }),
  })
    .format(atMs)
    .replace(",", "")
  return `As of ${day}, ${time}`
}

/**
 * The time a card's "As of" note shows, or null when it shows none: the
 * oldest read among the card's groups that are past their threshold.
 * A group never read has no value on screen ("Not available"), so it
 * never raises the note.
 */
export function staleSince(
  at: ReadTimes,
  groups: readonly FigureGroup[],
  nowMs: number,
): number | null {
  let oldest: number | null = null
  for (const group of groups) {
    const readAt = at[group]
    if (readAt === null || nowMs - readAt <= staleAfterMs[group]) continue
    if (oldest === null || readAt < oldest) oldest = readAt
  }
  return oldest
}

/**
 * Whether a card shows its "As of" note: once the page has heard from
 * its first fresh request (or that request ran past its 5 s deadline),
 * whenever a figure on the card is older than its threshold. A fresh
 * request that answers with old figures, as the edge does when its own
 * upstream reads fail, therefore still shows the note.
 */
export function asOfAt(
  at: ReadTimes,
  groups: readonly FigureGroup[],
  nowMs: number,
  waiting: boolean,
): number | null {
  if (waiting) return null
  return staleSince(at, groups, nowMs)
}
