import type {
  ScanEpochItem,
  ScanGaugeEpochItem,
  ScanIncentiveDepositRow,
} from "@matchbox/contracts/scan"
import {
  EPOCH_SECONDS,
  epochIndexFor,
  epochStartForIndex,
  epochStartOf,
} from "@matchbox/domain/epoch"
import {
  formatDuration,
  formatUsd,
  groupThousands,
} from "@matchbox/domain/format"
import { setCacheClass } from "../cache-class.server"
import { cursorOf } from "../explorer/voting/range"
import { canonicalQuery } from "./caller.server"
import { nowSeconds } from "./clock.server"
import type { Entity, Section } from "./explorer"
import {
  type EmissionsView,
  type EpochBar,
  emissionsView,
  type Stat,
} from "./gauges.server"
import { readEpochSources, readVotingApr } from "./scan/governance.server"
import { paidBySource, votingAprView } from "./scan/governance-views"
import { type FigureWire, figureWireOut } from "./scan/lock-wire"
import { readDailyPrices } from "./scan/prices.server"
import {
  amountUsd,
  type DailyPrices,
  dayOf,
  epochPriceDay,
  mezoToken,
  noPrices,
  pricedText,
  priceMap,
  usdCompact,
  usdDecimal,
} from "./scan/pricing"
import { readScan } from "./scan/read.server"
import {
  type EpochPaid,
  paidByEpoch,
  type RewardsView,
  rewardsToVoters,
} from "./scan/rewards"
import { scanSchemas } from "./scan/schemas"
import { readSeries } from "./scan/series.server"
import {
  type EpochSpan,
  epochSpan,
  type GaugeIdentity,
  type GaugeKind,
  gaugeIndex,
  kindOfSource,
  mezoWhole,
  moreStats,
  percentText,
  scanSection,
  shareBps,
  sourceOrder,
  tokenMapTexts,
  unitOfKind,
  unknownGauge,
  votesShort,
  votesText,
} from "./scan/voting-views"

/**
 * The Epochs pages: the list (`T4lYGIj9dz`) and one epoch (`2Uik1bZ5w5`),
 * from `/epochs` and `/epochs/{start}` (aggregates: `complete` false while
 * the jobs Worker recomputes, an epoch not computed yet is never shown as
 * zero), with gauge names from Pro's directory. Reads run at once.
 */

/** The server's now (the fixture world's own in fixtures mode). */
function now(): number {
  return nowSeconds()
}

type Filling = { asOf: number | null } | null

/** "5 Nov to 12 Nov". */
function shortDates(span: EpochSpan): string {
  return span.dates.replace(/\b[A-Z][a-z]{2} (?=\d)/g, "")
}

/** "18,840.00 MEZO", "+1 more" folded in: one line of a token map. */
function tokensLine(map: Readonly<Record<string, string>>): string | null {
  const texts = tokenMapTexts(map)
  const first = texts[0]
  if (first === undefined) return null
  return texts.length === 1 ? first : `${first}, ${texts.length - 1} more`
}

function progress(span: EpochSpan, at: number): number {
  return Math.min(
    10_000,
    Math.max(0, Math.round(((at - span.start) / EPOCH_SECONDS) * 10_000)),
  )
}

// -- the list ---------------------------------------------------------------

export type CurrentEpoch = {
  span: EpochSpan
  closesIn: string
  /** 0 to 10,000 of the week gone. */
  progress: number
  stats: Stat[]
  /** Not computed yet (no row): show no figures. */
  computed: boolean
  filling: Filling
}

export type EpochRow = {
  number: number
  dates: string
  current: boolean
  emission: string | null
  votes: string
  voters: string
  incentives: string | null
  fees: string | null
  topGauge: GaugeIdentity | null
  complete: boolean
}

export type VotesCast = {
  figure: string
  latest: number
  stats: Stat[]
  bars: EpochBar[]
}

export type EpochsPage = {
  current: Section<CurrentEpoch>
  emissions: Section<EmissionsView | null>
  /** Incentives and fees to voters per epoch, in USD. */
  rewards: Section<RewardsView | null>
  votes: Section<VotesCast | null>
  /** What veBTC is paid per epoch, by where it comes from. */
  paid: Section<RewardsView | null>
  /**
   * veBTC voters' voting APR per epoch (the market cron's figures), with
   * veMEZO voters' this epoch beside it.
   */
  apr: Section<FigureWire | null>
  table: Section<{
    rows: EpochRow[]
    next: { cursor: string } | null
    filling: Filling
  }>
  paged: boolean
}

/** The current epoch's figures, in USD at today's prices where priced. */
function epochStats(
  item: ScanEpochItem,
  paid: EpochPaid | null,
  before: EpochPaid | null,
  prices: DailyPrices,
  at: number,
): Stat[] {
  const stats: Stat[] = []
  if (item.emission !== null) {
    const usd = amountUsd(
      mezoToken,
      BigInt(item.emission),
      epochPriceDay(item.epoch_start, at),
      prices,
    )
    stats.push({
      label: "Emissions",
      value: mezoWhole(item.emission),
      ...(usd === null ? {} : { note: usdCompact(usd) }),
    })
  }
  stats.push({
    label: "Votes cast",
    value: groupThousands(BigInt(item.vote_transactions)),
    note: `${groupThousands(BigInt(item.voters))} voters`,
  })
  const incentives = paid === null ? null : pricedText(paid.incentives)
  const posted = tokensLine(item.incentives)
  stats.push({
    label: "Incentives posted",
    value: incentives ?? "None",
    ...(incentives === null || posted === null ? {} : { note: posted }),
  })
  const fees = paid === null ? null : pricedText(paid.fees)
  const earlier = before === null ? null : pricedText(before.fees)
  stats.push({
    label: "Fees to voters so far",
    value: fees ?? "None",
    ...(before === null || earlier === null
      ? {}
      : { note: `Epoch ${before.epoch} ${earlier}` }),
  })
  return stats
}

function votesCast(
  items: readonly ScanEpochItem[],
  current: number,
): VotesCast | null {
  const ordered = [...items].sort((a, b) => a.epoch_start - b.epoch_start)
  const last = ordered.at(-1)
  if (last === undefined) return null
  const before = ordered.at(-2)
  const stats: Stat[] = []
  if (before !== undefined) {
    stats.push({
      label: `Epoch ${epochIndexFor(before.epoch_start)}`,
      value: groupThousands(BigInt(before.vote_transactions)),
    })
  }
  stats.push({ label: "Voters", value: groupThousands(BigInt(last.voters)) })
  stats.push({ label: "Gauges", value: groupThousands(BigInt(last.gauges)) })
  return {
    figure: groupThousands(BigInt(last.vote_transactions)),
    latest: epochIndexFor(last.epoch_start),
    stats,
    bars: ordered.map((item) => ({
      epoch: epochIndexFor(item.epoch_start),
      value: item.vote_transactions,
      text: `${groupThousands(BigInt(item.vote_transactions))} votes`,
      current: epochIndexFor(item.epoch_start) === current,
    })),
  }
}

/** Epochs the by-source and APR panels draw. */
const governanceEpochs = 26

export async function epochsPage(input: {
  cursor: string | null
}): Promise<EpochsPage> {
  setCacheClass("list")
  const cursor = cursorOf(input.cursor) ?? null
  const at = now()
  const currentStart = epochStartOf(at)
  const current = epochIndexFor(currentStart)
  const [all, table, directory, prices, sources, distributed, apr] =
    await Promise.all([
      readScan("epochs", canonicalQuery({ limit: 100 }), scanSchemas.epochPage),
      readScan(
        "epochs",
        canonicalQuery({ limit: 12, cursor }),
        scanSchemas.epochPage,
      ),
      readScan("gauges", new URLSearchParams(), scanSchemas.gauges),
      readDailyPrices(at),
      readEpochSources(governanceEpochs),
      // BTC chain fees distributed to veBTC, per day (each for the epoch
      // before the day's).
      readSeries({
        metric: "fees.chain_vebtc",
        days: governanceEpochs * 7 + 1,
        now: at,
      }),
      readVotingApr(governanceEpochs),
    ])
  const paid =
    all.status === "ok" ? paidByEpoch(all.data.data, prices, at) : null
  const paidOf = (number: number) =>
    paid?.find((row) => row.epoch === number) ?? null
  const names = gaugeIndex(
    directory.status === "ok" ? directory.data.data.gauges : null,
  )
  const gaugeOf = (address: string | undefined, kind: GaugeKind) =>
    address === undefined
      ? null
      : (names.get(address.toLowerCase()) ?? unknownGauge(address, kind))
  const span = epochSpan(currentStart)
  return {
    paged: cursor !== null,
    current: scanSection(all, (page) => {
      const item = page.data.find((each) => each.epoch_start === currentStart)
      return {
        span,
        closesIn: formatDuration(span.end - at),
        progress: progress(span, at),
        stats:
          item === undefined
            ? []
            : epochStats(
                item,
                paidOf(current),
                paidOf(current - 1),
                prices,
                at,
              ),
        computed: item !== undefined,
        filling:
          item === undefined || !item.complete
            ? { asOf: page.meta.asOf }
            : null,
      }
    }),
    emissions: scanSection(all, (page) =>
      emissionsView(
        page.data,
        page.meta.complete,
        page.meta.asOf,
        current,
        prices,
        at,
      ),
    ),
    rewards: scanSection(all, (page) =>
      rewardsToVoters(
        paidByEpoch(page.data, prices, at),
        current,
        page.meta.complete,
        page.meta.asOf,
      ),
    ),
    votes: scanSection(all, (page) => votesCast(page.data, current)),
    paid: scanSection(sources, (body) =>
      paidBySource({
        escrow: "vebtc",
        sources: body.data,
        // A failed series leaves its source out; the rest still stand.
        distributed:
          distributed.status === "ok" ? distributed.data.points : null,
        prices,
        now: at,
        complete: body.meta.complete,
        asOf: body.meta.asOf,
      }),
    ),
    apr: scanSection(apr, (body) => {
      const view = votingAprView(body.data, "vebtc", at)
      return view === null ? null : figureWireOut(view)
    }),
    table: scanSection(table, (page) => ({
      rows: page.data.map((item) => {
        const itemSpan = epochSpan(item.epoch_start)
        return {
          number: itemSpan.number,
          dates: shortDates(itemSpan),
          current: itemSpan.number === current,
          emission: item.emission === null ? null : mezoWhole(item.emission),
          votes: groupThousands(BigInt(item.vote_transactions)),
          voters: groupThousands(BigInt(item.voters)),
          incentives: pricedText(
            priceMap(
              item.incentives,
              epochPriceDay(item.epoch_start, at),
              prices,
            ),
          ),
          fees: pricedText(
            priceMap(item.fees, epochPriceDay(item.epoch_start, at), prices),
          ),
          topGauge: gaugeOf(item.top_gauge.BOOST_VOTER, "vebtc"),
          complete: item.complete,
        }
      }),
      next: page.nextCursor === null ? null : { cursor: page.nextCursor },
      filling: page.meta.complete ? null : { asOf: page.meta.asOf },
    })),
  }
}

// -- one epoch --------------------------------------------------------------

export type SourceRow = {
  gauge: GaugeIdentity
  votes: string
  /** "5.88M veMEZO" for phones. */
  votesShort: string
  /** Null when the epoch has no total for the source to share. */
  share: string | null
  /** 0 to 10,000 of the source's votes. */
  bps: number
  voters: string
  incentives: string | null
  killed: boolean
}

export type SourceTable = {
  source: string
  kind: GaugeKind | null
  /** "veBTC gauges, 5.88M veMEZO". */
  total: string | null
  rows: SourceRow[]
}

export type DepositLine = {
  key: string
  gauge: GaugeIdentity
  amount: string
  /** In USD at the deposit day's close; null unpriced. */
  usd: string | null
  fees: boolean
  timestamp: number
  depositor: string
  txHash: string
}

export type EpochDoc = {
  emissions: { figure: string | null; note: string | null; stats: Stat[] }
  votes: { figure: string; stats: Stat[] }
  incentives: { figure: string | null; stats: Stat[]; deposits: DepositLine[] }
  sources: SourceTable[]
  filling: Filling
}

export type EpochPage = {
  number: number
  span: EpochSpan
  current: boolean
  closesIn: string | null
  progress: number | null
  /** Null while not computed: the page says so, never zeros. */
  doc: Entity<EpochDoc | null>
  asOf: number | null
  now: number
}

const sourceNames: Record<GaugeKind, string> = {
  vebtc: "veBTC gauges",
  mezo: "MEZO gauges",
  validator: "Validator gauges",
  pool: "Pool gauges",
}

export function sourceName(source: string): string {
  const kind = kindOfSource(source)
  return kind === null ? source : sourceNames[kind]
}

function sourceTables(
  item: ScanEpochItem,
  top: Readonly<Record<string, readonly ScanGaugeEpochItem[]>>,
  names: ReadonlyMap<string, GaugeIdentity>,
  priced: (map: Readonly<Record<string, string>>) => string | null,
): SourceTable[] {
  const known: readonly string[] = sourceOrder
  const sources = [
    ...sourceOrder.filter((source) => top[source] !== undefined),
    ...Object.keys(top)
      .filter((source) => !known.includes(source))
      .sort(),
  ]
  return sources.map((source) => {
    const kind = kindOfSource(source)
    const unit = unitOfKind(kind ?? "vebtc")
    const weight = item.vote_weight[source]
    const total = weight === undefined ? null : BigInt(weight)
    return {
      source,
      kind,
      total: total === null ? null : votesShort(total, unit),
      rows: (top[source] ?? []).map((row) => {
        const units = BigInt(row.vote_weight)
        const bps = total === null ? 0 : shareBps(units, total)
        return {
          gauge:
            names.get(row.gauge.toLowerCase()) ?? unknownGauge(row.gauge, kind),
          votes: votesText(units, unit),
          votesShort: votesShort(units, unit),
          share: total === null ? null : percentText(bps),
          bps,
          voters: groupThousands(BigInt(row.voters)),
          incentives: priced(row.incentives),
          killed: row.killed === 1,
        }
      }),
    }
  })
}

function depositLine(
  row: ScanIncentiveDepositRow,
  names: ReadonlyMap<string, GaugeIdentity>,
  prices: DailyPrices,
): DepositLine {
  const usd = amountUsd(
    row.token,
    BigInt(row.amount),
    dayOf(row.timestamp),
    prices,
  )
  return {
    key: `${row.tx_hash}:${row.log_index}`,
    gauge:
      names.get(row.gauge.toLowerCase()) ??
      unknownGauge(row.gauge, kindOfSource(row.voter_source)),
    amount: tokenMapTexts({ [row.token]: row.amount })[0] ?? "Tokens",
    usd: usd === null ? null : formatUsd(usdDecimal(usd)),
    fees: row.reward_type === "Fee",
    timestamp: row.timestamp,
    depositor: row.depositor,
    txHash: row.tx_hash,
  }
}

function epochDoc(
  item: ScanEpochItem,
  top: Readonly<Record<string, readonly ScanGaugeEpochItem[]>>,
  deposits: readonly ScanIncentiveDepositRow[],
  names: ReadonlyMap<string, GaugeIdentity>,
  complete: boolean,
  asOf: number | null,
  prices: DailyPrices = noPrices,
  at: number = now(),
): EpochDoc {
  const day = epochPriceDay(item.epoch_start, at)
  const priced = (map: Readonly<Record<string, string>>) =>
    pricedText(priceMap(map, day, prices))
  const emissionStats: Stat[] = []
  if (item.gauge_rewards !== null) {
    emissionStats.push({
      label: "To gauges",
      value: mezoWhole(item.gauge_rewards),
    })
  }
  if (item.rebase !== null) {
    emissionStats.push({ label: "Rebase", value: mezoWhole(item.rebase) })
  }
  const voteStats: Stat[] = [
    { label: "Voters", value: groupThousands(BigInt(item.voters)) },
    { label: "Gauges", value: groupThousands(BigInt(item.gauges)) },
  ]
  for (const source of sourceOrder) {
    const weight = item.vote_weight[source]
    const kind = kindOfSource(source)
    if (weight === undefined || kind === null) continue
    voteStats.push({
      label: sourceNames[kind],
      value: votesShort(weight, unitOfKind(kind)),
    })
  }
  const incentiveTexts = tokenMapTexts(item.incentives)
  const feeTexts = tokenMapTexts(item.fees)
  const emissionUsd =
    item.emission === null
      ? null
      : amountUsd(mezoToken, BigInt(item.emission), day, prices)
  const incentivesUsd = priced(item.incentives)
  const feesUsd = priced(item.fees)
  return {
    emissions: {
      figure: item.emission === null ? null : mezoWhole(item.emission),
      note: emissionUsd === null ? null : usdCompact(emissionUsd),
      stats: emissionStats,
    },
    votes: {
      figure: groupThousands(BigInt(item.vote_transactions)),
      stats: voteStats.slice(0, 4),
    },
    incentives: {
      // In USD at the epoch's close; the tokens behind it as stats. With
      // no incentives at all, fees alone still show.
      figure: incentivesUsd,
      stats: [
        ...moreStats(incentiveTexts, "Incentives", feesUsd === null ? 4 : 2),
        ...(feesUsd === null
          ? []
          : [
              { label: "Fees to voters", value: feesUsd },
              ...moreStats(feeTexts, "Fees in tokens", 1),
            ]),
      ].slice(0, 4),
      deposits: deposits
        .slice(0, 6)
        .map((row) => depositLine(row, names, prices)),
    },
    sources: sourceTables(item, top, names, priced),
    filling: complete ? null : { asOf },
  }
}

export async function epochPage(input: { epoch: number }): Promise<EpochPage> {
  const at = now()
  const number = Number.isInteger(input.epoch) ? Math.max(0, input.epoch) : 0
  const start = epochStartForIndex(number)
  const span = epochSpan(start)
  const current = start === epochStartOf(at)
  const [epoch, directory, prices] = await Promise.all([
    readScan(`epochs/${start}`, new URLSearchParams(), scanSchemas.epoch),
    readScan("gauges", new URLSearchParams(), scanSchemas.gauges),
    readDailyPrices(at, start),
  ])
  const names = gaugeIndex(
    directory.status === "ok" ? directory.data.data.gauges : null,
  )
  const body = epoch.status === "ok" ? epoch.data : null
  const sealed = body?.data?.epoch.sealed === true && body.meta.complete
  setCacheClass(sealed ? "final" : "fresh")
  return {
    number,
    span,
    current,
    closesIn: current ? formatDuration(span.end - at) : null,
    progress: current ? progress(span, at) : null,
    asOf: body?.meta.asOf ?? null,
    now: at,
    doc:
      epoch.status === "missing"
        ? { status: "missing" }
        : scanSection(epoch, (document) =>
            document.data === null
              ? null
              : epochDoc(
                  document.data.epoch,
                  document.data.topGauges,
                  document.data.incentives.data,
                  names,
                  document.meta.complete,
                  document.meta.asOf,
                  prices,
                  at,
                ),
          ),
  }
}
