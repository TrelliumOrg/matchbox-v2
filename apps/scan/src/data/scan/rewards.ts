import type { ScanEpochItem } from "@matchbox/contracts/scan"
import { epochIndexFor } from "@matchbox/domain/epoch"
import { formatUsd } from "@matchbox/domain/format"
import {
  addPriced,
  anyUnpriced,
  type DailyPrices,
  epochPriceDay,
  type PricedMap,
  pricedText,
  pricedToken,
  priceMap,
  type Usd,
  usdDecimal,
  usdHeight,
  usdShort,
} from "./pricing"
import { percentText, shareBps } from "./voting-views"

/**
 * What voters were paid per epoch, in USD: the incentives deposited for
 * the epoch and the fees passed to its voters (`epoch_totals`), each token
 * at the epoch's closing daily price (the latest close while it runs).
 * Exact bigint sums; a token with no price is left out of the dollars and
 * the text says "+ unpriced", never a smaller total passed off as whole.
 */

export type EpochPaid = {
  epoch: number
  start: number
  /** The epoch has ended (`sealed`), so its figures are final. */
  closed: boolean
  complete: boolean
  incentives: PricedMap
  fees: PricedMap
  total: PricedMap
  votes: number
}

/** Each epoch's incentives and fees in USD, oldest first. */
export function paidByEpoch(
  items: readonly ScanEpochItem[],
  prices: DailyPrices,
  now: number,
): EpochPaid[] {
  return [...items]
    .sort((a, b) => a.epoch_start - b.epoch_start)
    .map((item) => {
      const day = epochPriceDay(item.epoch_start, now)
      const incentives = priceMap(item.incentives, day, prices)
      const fees = priceMap(item.fees, day, prices)
      return {
        epoch: epochIndexFor(item.epoch_start),
        start: item.epoch_start,
        closed: item.sealed,
        complete: item.complete,
        incentives,
        fees,
        total: addPriced(incentives, fees),
        votes: item.vote_transactions,
      }
    })
}

/** One series of a stacked bar (a token kind, or fees and incentives). */
export type RewardSeries = { label: string; tone: "mezo" | "ink" | "acc" }

export type RewardBar = {
  epoch: number
  /**
   * The epoch still fills (it runs, or its payouts are not in yet): drawn
   * as so far.
   */
  current: boolean
  /** Display height, whole dollars (priced part only). */
  value: number
  /** Heights per series, in `series` order. */
  parts: number[]
  /** "$20,200", "$1,180 + unpriced". */
  text: string
  /** "MEZO $14,820, MUSD $2,400": the parts for screen readers. */
  detail: string
}

export type RewardStat = {
  label: string
  value: string
  tone?: "pos" | "neg"
  /** A quieter line under the value ("average"). */
  note?: string
}

export type RewardsView = {
  figure: string
  note: string
  stats: RewardStat[]
  series: RewardSeries[]
  bars: RewardBar[]
  since: number
  /** Unix seconds the aggregates are as of, while they still fill. */
  filling: { asOf: number | null } | null
}

function sum(maps: readonly PricedMap[]): PricedMap {
  return maps.reduce(addPriced, { usd: 0n, tokens: [] })
}

function text(map: PricedMap): string {
  return pricedText(map) ?? "$0"
}

/** A stacked bar's series with what each holds of a priced map. */
export type SeriesPart = {
  series: RewardSeries
  usd: (map: PricedMap) => Usd
}

function groupUsd(map: PricedMap, test: (token: string) => boolean): Usd {
  return map.tokens.reduce(
    (total, line) =>
      line.usd !== null && test(line.token) ? total + line.usd : total,
    0n,
  )
}

/** By what a token is priced as: MEZO, the dollar tokens, BTC. */
export const tokenSeries: readonly SeriesPart[] = [
  {
    series: { label: "MEZO", tone: "mezo" },
    usd: (map) =>
      groupUsd(map, (token) => pricedToken(token)?.basis === "mezo"),
  },
  {
    series: { label: "Dollar tokens", tone: "ink" },
    usd: (map) => groupUsd(map, (token) => pricedToken(token)?.basis === "usd"),
  },
  {
    series: { label: "BTC", tone: "acc" },
    usd: (map) => groupUsd(map, (token) => pricedToken(token)?.basis === "btc"),
  },
]

/**
 * One epoch's bar: its total's height, and each series' part of it
 * (`values`, in `series` order).
 */
export function stackedBar(
  epoch: number,
  current: boolean,
  total: Usd,
  values: readonly Usd[],
  series: readonly RewardSeries[],
  label: string,
): RewardBar {
  return {
    epoch,
    current,
    value: usdHeight(total),
    parts: values.map(usdHeight),
    text: label,
    detail: series
      .flatMap((each, index) => {
        const value = values[index] ?? 0n
        return value > 0n ? [`${each.label} ${usdShort(value)}`] : []
      })
      .join(", "),
  }
}

/** A priced map's bar, split by token kind. */
export function tokenBar(
  epoch: number,
  current: boolean,
  map: PricedMap,
  label: string,
): RewardBar {
  return stackedBar(
    epoch,
    current,
    map.usd,
    tokenSeries.map((part) => part.usd(map)),
    tokenSeries.map((part) => part.series),
    label,
  )
}

/** The last closed epoch and the one before it. */
function lastClosed(rows: readonly EpochPaid[]) {
  const closed = rows.filter((row) => row.closed)
  return { last: closed.at(-1), before: closed.at(-2), closed }
}

function changeStat(
  label: string,
  now: PricedMap,
  before: PricedMap,
): RewardStat | null {
  // A change between two floors (unpriced tokens left out) is not known.
  if (anyUnpriced(now) || anyUnpriced(before) || before.usd <= 0n) return null
  const bps = Number(((now.usd - before.usd) * 10_000n) / before.usd)
  const tenths = Math.round(Math.abs(bps) / 10)
  return {
    label,
    value: `${bps < 0 ? "-" : "+"}${Math.floor(tenths / 10)}.${tenths % 10}%`,
    tone: bps < 0 ? "neg" : "pos",
  }
}

function filling(
  complete: boolean,
  asOf: number | null,
): RewardsView["filling"] {
  return complete ? null : { asOf }
}

/**
 * Gauges' "Paid to voters by epoch": the last closed epoch's total, this
 * epoch's incentives and total so far, the change between the last two
 * closed epochs, and every epoch together; bars by token kind.
 */
export function paidToVoters(
  rows: readonly EpochPaid[],
  current: number,
  complete: boolean,
  asOf: number | null,
): RewardsView | null {
  const first = rows[0]
  if (first === undefined) return null
  const { last, before } = lastClosed(rows)
  const now = rows.find((row) => row.epoch === current)
  const shown = last ?? rows.at(-1) ?? first
  const stats: RewardStat[] = []
  if (now !== undefined) {
    stats.push({
      label: `Epoch ${now.epoch} posted`,
      value: text(now.incentives),
    })
    stats.push({ label: `Epoch ${now.epoch} so far`, value: text(now.total) })
  }
  if (last !== undefined && before !== undefined) {
    const change = changeStat(
      `vs Epoch ${before.epoch}`,
      last.total,
      before.total,
    )
    if (change !== null) stats.push(change)
  }
  stats.push({
    label: "All epochs",
    value: text(sum(rows.map((row) => row.total))),
  })
  return {
    figure: text(shown.total),
    note: `Epoch ${shown.epoch}`,
    stats,
    series: tokenSeries.map((part) => part.series),
    bars: rows.map((row) =>
      tokenBar(row.epoch, row.epoch === current, row.total, text(row.total)),
    ),
    since: first.epoch,
    filling: filling(complete, asOf),
  }
}

/**
 * Epochs' "Rewards to voters per epoch": every epoch together, the last
 * closed epoch, the incentives' share of everything, the mean of the last
 * eight closed epochs and the last closed epoch per vote cast; bars split
 * into fees and incentives.
 */
export function rewardsToVoters(
  rows: readonly EpochPaid[],
  current: number,
  complete: boolean,
  asOf: number | null,
): RewardsView | null {
  const first = rows[0]
  if (first === undefined) return null
  const { last, closed } = lastClosed(rows)
  const all = sum(rows.map((row) => row.total))
  const incentives = sum(rows.map((row) => row.incentives))
  const stats: RewardStat[] = []
  if (last !== undefined) {
    stats.push({ label: `Epoch ${last.epoch}`, value: text(last.total) })
  }
  if (all.usd > 0n && !anyUnpriced(all)) {
    stats.push({
      label: "From incentives",
      value: percentText(shareBps(incentives.usd, all.usd)),
    })
  }
  const recent = closed.slice(-8)
  if (recent.length > 0) {
    const total = sum(recent.map((row) => row.total))
    const mean = total.usd / BigInt(recent.length)
    stats.push({
      label: `Avg ${recent.length} epochs`,
      value: pricedText({ ...total, usd: mean }) ?? "$0",
    })
  }
  if (last !== undefined && last.votes > 0 && !anyUnpriced(last.total)) {
    stats.push({
      label: "Per vote",
      value: formatUsd(usdDecimal(last.total.usd / BigInt(last.votes))),
    })
  }
  return {
    figure: text(all),
    note: "All epochs",
    stats,
    series: feeSeries,
    bars: feeBars(rows, current),
    since: first.epoch,
    filling: filling(complete, asOf),
  }
}

/** Fees and incentives, bottom first. */
const feeSeries: RewardSeries[] = [
  { label: "Fees", tone: "acc" },
  { label: "Incentives", tone: "ink" },
]

function feeBars(rows: readonly EpochPaid[], current: number): RewardBar[] {
  return rows.map((row) =>
    stackedBar(
      row.epoch,
      row.epoch === current,
      row.total.usd,
      [row.fees.usd, row.incentives.usd],
      feeSeries,
      text(row.total),
    ),
  )
}
