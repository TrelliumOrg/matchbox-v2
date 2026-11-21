import type {
  ScanEpochItem,
  ScanGaugeEpochItem,
  ScanValidatorRow,
} from "@matchbox/contracts/scan"
import {
  epochIndexFor,
  epochStartForIndex,
  epochStartOf,
} from "@matchbox/domain/epoch"
import {
  addressAvatar,
  formatDay,
  groupThousands,
  shortAddress,
} from "@matchbox/domain/format"
import { setCacheClass } from "../cache-class.server"
import { canonicalQuery } from "./caller.server"
import { nowSeconds } from "./clock.server"
import type { Entity, Section } from "./explorer"
import {
  type EpochBar,
  type GaugeDetailPage,
  gaugePage,
  type Stat,
} from "./gauges.server"
import { proVoteUrl } from "./pro-links"
import {
  readEpochEmissions,
  readGaugeEmissions,
} from "./scan/governance.server"
import { emissionsEarnedView } from "./scan/governance-views"
import { type FigureWire, figureWireOut } from "./scan/lock-wire"
import { readDailyPrices } from "./scan/prices.server"
import {
  amountUsd,
  type DailyPrices,
  epochPriceDay,
  mezoToken,
  noPrices,
  pricedText,
  priceMap,
  usdCompact,
} from "./scan/pricing"
import { readScan } from "./scan/read.server"
import { scanSchemas } from "./scan/schemas"
import {
  changeText,
  chartValue,
  type EpochSpan,
  epochSpan,
  failedSection,
  type GaugeIdentity,
  type GaugePictureView,
  percentText,
  scanSection,
  shareBps,
  tokenMapTexts,
  unknownGauge,
  votesShort,
  votesText,
} from "./scan/voting-views"
import { readUptimeOverview, readValidatorUptime } from "./uptime.server"
import type {
  UptimeFigures,
  UptimeFreshness,
  UptimeOverview,
  ValidatorUptimeView,
} from "./uptime-views"

/**
 * The Validators pages: the list (`9qiDCpYgJ3`) and one validator
 * (`MecoxYurzZ`). Mezo's validators are a PoA set (`x/poa`); each one has a
 * gauge on the ValidatorsVoter. `/validators` (the API) gives the set as
 * the API matches it (ValidatorPool operator, gauge, status, name, by
 * proposer address) and blocks proposed per validator on the latest day
 * with counts, with shares and running totals. Votes, voters and
 * incentives come from the validators' epoch ranking and, for one
 * validator, its gauge's own routes.
 *
 * Uptime, missed blocks and missed proposals come from `/uptime` and
 * `/validators/{address}/uptime` (CometBFT commit signatures the jobs
 * Worker reads from a community node, uptime.server), matched by operator
 * address, each with where it came from and how fresh it is.
 *
 * Emissions per validator gauge and epoch come from the jobs Worker's
 * summary of the validators voter's DistributeReward events. Not available
 * yet, and said so on the pages: what validators claimed and have
 * unclaimed (their claims are not indexed). Before the
 * jobs Worker's second daily read there is no day's count either: the
 * pages say so with the API's reason.
 */

const validatorsSource = "VALIDATORS_VOTER"
const poolsSource = "POOLS_VOTER"
/** The fixture world's now in fixtures mode, else the clock. */
function now(): number {
  return nowSeconds()
}

function proUrl(gauge: string): string {
  return proVoteUrl(gauge, "validator")
}

/** A token map as one line of text; null for no tokens. */
type TokenText = (map: Readonly<Record<string, string>>) => string | null

/** "652.17 MEZO", "+1 more" folded in; null for no tokens. */
function tokensLine(map: Readonly<Record<string, string>>): string | null {
  const texts = tokenMapTexts(map)
  const first = texts[0]
  if (first === undefined) return null
  return texts.length === 1 ? first : `${first}, ${texts.length - 1} more`
}

function count(value: string | null): string | null {
  return value === null ? null : groupThousands(BigInt(value))
}

/** "2026-11-08" as "Sun 8 Nov". */
function dayText(day: string): string {
  return formatDay(Math.floor(Date.parse(`${day}T00:00:00Z`) / 1000))
}

/** "NN" from "Northfield Nodes", else the address's own initials. */
function pictureOf(name: string | null, address: string): GaugePictureView {
  const avatar = addressAvatar(address)
  const words = (name ?? "").match(/[A-Za-z0-9]+/g) ?? []
  const initials = words
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join("")
  return {
    kind: "initials",
    initials: initials === "" ? avatar.initials : initials,
    hue: avatar.hue,
  }
}

function validatorGauge(gauge: string, name: string | null): GaugeIdentity {
  return {
    ...unknownGauge(gauge, "validator"),
    name,
    picture: pictureOf(name, gauge),
  }
}

// -- blocks proposed --------------------------------------------------------

export type ValidatorStatus = "active" | "left"

/**
 * The day the counts are for. A day runs from one daily read to the next
 * (between 00:00 and 03:00 UTC), so its edges are approximate.
 */
export type BlocksDay =
  | {
      available: true
      /** "Sun 8 Nov". */
      day: string
      /**
       * The shares' denominator: every block the chain produced on the day
       * with `shareOf` "all_blocks", else the known validators' sum.
       */
      total: string
      /**
       * What the shares are of: "all_blocks"; "known" (the known
       * validators' blocks, from an API that does not say); null when the
       * day's block count is not read yet, so there are no shares.
       */
      shareOf: "all_blocks" | "known" | null
      /** Blocks no known validator was counted for, when above zero. */
      unattributed: { blocks: string; share: string } | null
      /** False while a validator has no count for the day. */
      complete: boolean
      /** Validators with no count for the day, by name or address. */
      missing: string[]
    }
  | { available: false; reason: string }

type ValidatorsBody = {
  data: {
    available: boolean
    reason: string | null
    day: string | null
    day_total: string | null
    shares_complete: boolean
    share_of?: "all_blocks" | null | undefined
    blocks_in_day?: string | null | undefined
    unattributed_blocks?: string | null | undefined
    missing_counts: string[]
    validators: ScanValidatorRow[]
    pool_without_operator: {
      gauge: string
      name: string
      pool_status: ValidatorStatus
    }[]
  }
}

/**
 * The API's reason as a clause the page frames itself: "A day's count
 * needs two daily reads of each validator's counter" (no "Not available
 * yet:" lead, which the page says already, and no closing stop).
 */
function reasonText(reason: string | null): string {
  const text = (reason ?? "")
    .replace(/^not available yet:\s*/i, "")
    .replace(/\.\s*$/, "")
    .trim()
  return text === ""
    ? "A day's count needs two daily reads of each validator's counter"
    : `${text.charAt(0).toUpperCase()}${text.slice(1)}`
}

function rowName(row: ScanValidatorRow): string | null {
  return row.name ?? row.label
}

function blocksDay(body: ValidatorsBody): BlocksDay {
  const data = body.data
  if (!data.available || data.day === null || data.day_total === null) {
    return { available: false, reason: reasonText(data.reason) }
  }
  const byAddress = new Map(
    data.validators.map((row) => [row.address.toLowerCase(), row]),
  )
  // An API from before shares of every block sends no share_of.
  const shareOf =
    data.share_of === undefined
      ? ("known" as const)
      : data.share_of === "all_blocks" && data.blocks_in_day != null
        ? ("all_blocks" as const)
        : null
  const inDay = shareOf === "all_blocks" ? BigInt(data.blocks_in_day ?? 0) : 0n
  const rest = BigInt(data.unattributed_blocks ?? 0)
  return {
    available: true,
    day: dayText(data.day),
    total: groupThousands(
      shareOf === "all_blocks" ? inDay : BigInt(data.day_total),
    ),
    shareOf,
    unattributed:
      shareOf === "all_blocks" && rest > 0n && inDay > 0n
        ? {
            blocks: groupThousands(rest),
            share: percentText(Number((rest * 10_000n) / inDay)),
          }
        : null,
    complete: data.shares_complete,
    missing: data.missing_counts.map((address) => {
      const row = byAddress.get(address.toLowerCase())
      return (row === undefined ? null : rowName(row)) ?? shortAddress(address)
    }),
  }
}

/** One validator's blocks on the day, its share and its running total. */
export type ProposedFigures = {
  /** Null without a count for the day. */
  blocks: string | null
  /** Null unless every validator has a count for the day. */
  share: string | null
  /** Every block it has proposed, at the last read. */
  total: string | null
}

function proposedOf(
  row: ScanValidatorRow | null,
  sharesComplete: boolean,
): ProposedFigures {
  return {
    blocks: count(row?.blocks ?? null),
    share:
      !sharesComplete || row?.share_bps == null
        ? null
        : percentText(row.share_bps),
    total: count(row?.blocks_total?.value ?? null),
  }
}

// -- epochs -----------------------------------------------------------------

export type EpochNav = {
  number: number
  span: EpochSpan
  current: boolean
  /** The current epoch's number. */
  latest: number
  /** Null at Epoch 0 and at the current epoch. */
  prev: number | null
  next: number | null
}

function epochNav(requested: number | null, at: number): EpochNav {
  const latest = epochIndexFor(epochStartOf(at))
  const number =
    requested !== null &&
    Number.isInteger(requested) &&
    requested >= 0 &&
    requested <= latest
      ? requested
      : latest
  return {
    number,
    span: epochSpan(epochStartForIndex(number)),
    current: number === latest,
    latest,
    prev: number > 0 ? number - 1 : null,
    next: number < latest ? number + 1 : null,
  }
}

type Ranking = {
  rows: ScanGaugeEpochItem[]
  /** Every validator gauge's weight, killed ones included. */
  total: bigint
  /** The list had more than one page: shares are of what was read. */
  partial: boolean
  killed: number
  complete: boolean
  asOf: number | null
}

function rankingOf(body: {
  data: ScanGaugeEpochItem[]
  killed: ScanGaugeEpochItem[]
  nextCursor: string | null
  meta: { complete: boolean; asOf: number | null }
}): Ranking {
  const rows = [...body.data, ...body.killed]
  return {
    rows,
    total: rows.reduce((sum, row) => sum + BigInt(row.vote_weight), 0n),
    partial: body.nextCursor !== null,
    killed: body.killed.length,
    complete: body.meta.complete,
    asOf: body.meta.asOf,
  }
}

function readRanking(start: number) {
  return readScan(
    `epochs/${start}/gauges`,
    canonicalQuery({ source: validatorsSource, limit: 100 }),
    scanSchemas.gaugeRanking,
  )
}

function readValidators() {
  return readScan("validators", new URLSearchParams(), scanSchemas.validators)
}

// -- the list ---------------------------------------------------------------

export type ValidatorSort = "share" | "proposed" | "uptime"

export type ValidatorRow = ProposedFigures & {
  gauge: GaugeIdentity
  /** The proposer address; null once the validator left the set. */
  operator: string | null
  status: ValidatorStatus | null
  /** The epoch's vote share; null without a ranking row. */
  voteShare: string | null
  /** 0 to 10,000 of the validators' votes. */
  bps: number
  votes: string | null
  voters: string | null
  /** Incentives posted for the epoch's voters; null when none. */
  incentives: string | null
  proUrl: string
  /** Its last 24 hours of signing; null without uptime counts for it. */
  uptime: UptimeFigures | null
}

/** A proposer the API matched to no validator gauge. */
export type OutsideRow = ProposedFigures & {
  address: string
  /** Scan's label, where one exists (untrusted). */
  name: string | null
  uptime: UptimeFigures | null
}

export type ValidatorTable = {
  active: number
  left: number
  rows: ValidatorRow[]
  outside: OutsideRow[]
  blocks: BlocksDay
  /** Why the vote columns are blank: their read failed. */
  /** "not-yet" while the epoch's ranking has not been computed. */
  votes: Section<null>["status"] | "not-yet"
  /**
   * Where the uptime column's figures came from and how fresh they are;
   * the read's state when it failed.
   */
  uptime: UptimeFreshness | Exclude<Section<null>["status"], "ok">
  /** "20 of 21 signing" for the newest counted block, only while live. */
  signing: string | null
}

export type ShareBarView = { gauge: GaugeIdentity; value: string; bps: number }

export type EpochVotes = {
  /** "124.0000 veBTC". */
  figure: string
  gauges: number
  inactive: number
  leader: { gauge: GaugeIdentity; share: string } | null
  bars: ShareBarView[]
  stats: Stat[]
  /** Incentives posted for validators' voters, per token. */
  incentives: string[]
  /**
   * The same in USD at the epoch's closing daily prices (the latest while
   * it runs); null when nothing was posted.
   */
  incentivesUsd: string | null
  /** Validators whose voters have incentives this epoch. */
  incentivized: number
  partial: boolean
  filling: { asOf: number | null } | null
}

export type VotesHistory = {
  figure: string | null
  stats: Stat[]
  bars: EpochBar[]
  filling: { asOf: number | null } | null
}

export type ValidatorsPage = {
  epoch: EpochNav
  sort: ValidatorSort
  table: Section<ValidatorTable>
  /**
   * Null when the epoch's ranking is computed and holds no validator
   * gauge; "not-yet" while it is still being computed and holds none (a
   * new epoch before the aggregates run), never "no votes".
   */
  votes: Section<EpochVotes | NotYet | null>
  history: Section<VotesHistory | NotYet | null>
  /** MEZO the validators voter distributed in the epoch; null for none. */
  emissions: Section<{ value: string; note: string } | null>
  now: number
}

/** A figure the aggregates have not computed yet: not zero, not none. */
export type NotYet = "not-yet"

function epochVotes(
  ranking: Ranking,
  names: ReadonlyMap<string, string>,
  priced: TokenText = () => null,
): EpochVotes | NotYet | null {
  if (ranking.rows.length === 0) return ranking.complete ? null : "not-yet"
  const identity = (row: ScanGaugeEpochItem) =>
    validatorGauge(
      row.gauge.toLowerCase(),
      names.get(row.gauge.toLowerCase()) ?? null,
    )
  const ordered = [...ranking.rows].sort((a, b) =>
    BigInt(b.vote_weight) > BigInt(a.vote_weight) ? 1 : -1,
  )
  const top = ordered.slice(0, 7)
  const leader = ordered[0]
  const incentives: Record<string, bigint> = {}
  let incentivized = 0
  for (const row of ranking.rows) {
    const posted = Object.entries(row.incentives).filter(
      ([, amount]) => amount !== "0",
    )
    if (posted.length > 0) incentivized += 1
    for (const [token, amount] of posted) {
      incentives[token] = (incentives[token] ?? 0n) + BigInt(amount)
    }
  }
  const posted = Object.fromEntries(
    Object.entries(incentives).map(([token, amount]) => [
      token,
      amount.toString(),
    ]),
  )
  const largest = BigInt(leader?.vote_weight ?? "0")
  const stats: Stat[] = [
    { label: "Validators", value: String(ranking.rows.length) },
  ]
  if (leader !== undefined && ranking.total > 0n) {
    stats.push({
      label: "Largest",
      value: percentText(shareBps(largest, ranking.total)),
    })
  }
  stats.push({ label: "With incentives", value: String(incentivized) })
  return {
    figure: votesText(ranking.total, "veBTC"),
    gauges: ranking.rows.length,
    inactive: ranking.killed,
    leader:
      leader === undefined || ranking.total === 0n
        ? null
        : {
            gauge: identity(leader),
            share: percentText(shareBps(largest, ranking.total)),
          },
    bars: top.map((row) => ({
      gauge: identity(row),
      value: percentText(shareBps(BigInt(row.vote_weight), ranking.total)),
      bps: shareBps(BigInt(row.vote_weight), largest),
    })),
    stats,
    incentives: tokenMapTexts(posted),
    incentivesUsd: priced(posted),
    incentivized,
    partial: ranking.partial,
    filling: ranking.complete ? null : { asOf: ranking.asOf },
  }
}

function votesHistory(
  items: readonly ScanEpochItem[],
  selected: number,
  complete: boolean,
  asOf: number | null,
): VotesHistory | NotYet | null {
  const ordered = items
    .filter((item) => item.vote_weight[validatorsSource] !== undefined)
    .sort((a, b) => a.epoch_start - b.epoch_start)
  if (ordered.length === 0) return complete ? null : "not-yet"
  const index = ordered.findIndex(
    (item) => epochIndexFor(item.epoch_start) === selected,
  )
  const item = index < 0 ? undefined : ordered[index]
  const before = index > 0 ? ordered[index - 1] : undefined
  const stats: Stat[] = []
  if (item !== undefined) {
    const weight = BigInt(item.vote_weight[validatorsSource] ?? "0")
    const pools = BigInt(item.vote_weight[poolsSource] ?? "0")
    if (weight + pools > 0n) {
      stats.push({
        label: "Of veBTC votes",
        value: percentText(shareBps(weight, weight + pools)),
      })
    }
    if (before !== undefined) {
      const change = changeText(
        weight,
        BigInt(before.vote_weight[validatorsSource] ?? "0"),
      )
      if (change !== null) {
        stats.push({
          label: `vs Epoch ${epochIndexFor(before.epoch_start)}`,
          value: change,
          tone: change.startsWith("-") ? "neg" : "pos",
        })
      }
    }
  }
  const shown = ordered.slice(-12)
  const total = shown.reduce(
    (sum, each) => sum + BigInt(each.vote_weight[validatorsSource] ?? "0"),
    0n,
  )
  stats.push({
    label: `${shown.length} epoch average`,
    value: votesShort(total / BigInt(shown.length), "veBTC"),
  })
  return {
    figure:
      item === undefined
        ? null
        : votesText(item.vote_weight[validatorsSource] ?? "0", "veBTC"),
    stats,
    bars: shown.map((each) => ({
      epoch: epochIndexFor(each.epoch_start),
      value: chartValue(each.vote_weight[validatorsSource] ?? "0"),
      text: votesText(each.vote_weight[validatorsSource] ?? "0", "veBTC"),
      current: epochIndexFor(each.epoch_start) === selected,
    })),
    filling: complete ? null : { asOf },
  }
}

/** Every validator gauge's name, from the API's set. */
function gaugeNames(body: ValidatorsBody): Map<string, string> {
  const names = new Map<string, string>()
  for (const row of body.data.validators) {
    const name = rowName(row)
    if (row.gauge !== null && name !== null) {
      names.set(row.gauge.toLowerCase(), name)
    }
  }
  for (const entry of body.data.pool_without_operator) {
    names.set(entry.gauge.toLowerCase(), entry.name)
  }
  return names
}

export function validatorTable(
  body: ValidatorsBody,
  ranking: Ranking | null,
  votes: Section<null>["status"] | NotYet,
  sort: ValidatorSort,
  uptime: Section<UptimeOverview> = { status: "unavailable" },
  /** Incentives as text: USD where the page read prices, else tokens. */
  incentivesText: TokenText = tokensLine,
): ValidatorTable {
  const uptimeBy = uptime.status === "ok" ? uptime.data.byOperator : {}
  const uptimeOf = (operator: string | null) =>
    operator === null ? null : (uptimeBy[operator]?.day ?? null)
  const byGauge = new Map<string, ScanGaugeEpochItem>()
  for (const row of ranking?.rows ?? []) {
    byGauge.set(row.gauge.toLowerCase(), row)
  }
  const members = [
    ...body.data.validators.flatMap((row) =>
      row.gauge === null
        ? []
        : [
            {
              gauge: row.gauge.toLowerCase(),
              name: rowName(row),
              operator: row.address.toLowerCase(),
              status: row.pool_status,
              row,
            },
          ],
    ),
    ...body.data.pool_without_operator.map((entry) => ({
      gauge: entry.gauge.toLowerCase(),
      name: entry.name,
      operator: null,
      status: entry.pool_status,
      row: null,
    })),
  ]
  const rows = members.map((member, index) => {
    const ranked = byGauge.get(member.gauge)
    const weight = ranked === undefined ? null : BigInt(ranked.vote_weight)
    const bps =
      weight === null || ranking === null ? 0 : shareBps(weight, ranking.total)
    const row: ValidatorRow = {
      ...proposedOf(member.row, body.data.shares_complete),
      gauge: validatorGauge(member.gauge, member.name),
      operator: member.operator,
      status: member.status,
      voteShare: weight === null ? null : percentText(bps),
      bps,
      votes: weight === null ? null : votesText(weight, "veBTC"),
      voters:
        ranked === undefined ? null : groupThousands(BigInt(ranked.voters)),
      incentives:
        ranked === undefined ? null : incentivesText(ranked.incentives),
      proUrl: proUrl(member.gauge),
      uptime: uptimeOf(member.operator),
    }
    return {
      row,
      index,
      weight: weight ?? -1n,
      blocks: BigInt(member.row?.blocks ?? "-1"),
      uptime: row.uptime?.bps ?? -1,
    }
  })
  const gone = (row: ValidatorRow) => (row.status === "left" ? 1 : 0)
  rows.sort((a, b) => {
    const left = gone(a.row) - gone(b.row)
    if (left !== 0) return left
    if (sort === "proposed" && a.blocks !== b.blocks) {
      return a.blocks > b.blocks ? -1 : 1
    }
    if (sort === "uptime" && a.uptime !== b.uptime) {
      return b.uptime - a.uptime
    }
    if (a.weight !== b.weight) return a.weight > b.weight ? -1 : 1
    return a.index - b.index
  })
  const outside = body.data.validators
    .filter((row) => row.gauge === null)
    .sort((a, b) => {
      const left = BigInt(a.blocks ?? "-1")
      const right = BigInt(b.blocks ?? "-1")
      return left === right ? 0 : left > right ? -1 : 1
    })
    .map((row) => ({
      ...proposedOf(row, body.data.shares_complete),
      address: row.address.toLowerCase(),
      name: rowName(row),
      uptime: uptimeOf(row.address.toLowerCase()),
    }))
  return {
    active: members.filter((member) => member.status === "active").length,
    left: members.filter((member) => member.status === "left").length,
    rows: rows.map(({ row }) => row),
    outside,
    blocks: blocksDay(body),
    votes,
    uptime: uptime.status === "ok" ? uptime.data.freshness : uptime.status,
    signing:
      uptime.status === "ok" &&
      uptime.data.freshness.live &&
      uptime.data.signing !== null
        ? `${uptime.data.signing.signing} of ${uptime.data.signing.of} signing`
        : null,
  }
}

export async function validatorsPage(input: {
  epoch: number | null
  sort: ValidatorSort
}): Promise<ValidatorsPage> {
  setCacheClass("list")
  const at = now()
  const epoch = epochNav(input.epoch, at)
  const sort: ValidatorSort =
    input.sort === "proposed" || input.sort === "uptime" ? input.sort : "share"
  const [validators, ranking, epochs, uptime, prices, emissions] =
    await Promise.all([
      readValidators(),
      readRanking(epoch.span.start),
      readScan("epochs", canonicalQuery({ limit: 100 }), scanSchemas.epochPage),
      readUptimeOverview(),
      readDailyPrices(at, epoch.span.start),
      readEpochEmissions(epoch.span.start, validatorsSource),
    ])
  const names =
    validators.status === "ok"
      ? gaugeNames(validators.data)
      : new Map<string, string>()
  // Incentives in USD at the epoch's close (the latest while it runs).
  const day = epochPriceDay(epoch.span.start, at)
  const priced: TokenText = (map) => pricedText(priceMap(map, day, prices))
  const votes = scanSection(ranking, (body) =>
    epochVotes(rankingOf(body), names, priced),
  )
  const ranked = ranking.status === "ok" ? rankingOf(ranking.data) : null
  return {
    epoch,
    sort,
    now: at,
    // Distributed in this epoch, for the votes of the one before.
    emissions: scanSection(emissions, (body) => {
      const paid = body.data.filter((row) => BigInt(row.amount) > 0n)
      if (paid.length === 0) return null
      const total = paid.reduce((all, row) => all + BigInt(row.amount), 0n)
      const usd = amountUsd(mezoToken, total, day, prices)
      const votes =
        epoch.number === 0
          ? "this epoch"
          : `for Epoch ${epoch.number - 1} votes`
      return {
        value: `${groupThousands(total / 10n ** 18n)} MEZO`,
        note: usd === null ? votes : `${usdCompact(usd)} ${votes}`,
      }
    }),
    votes,
    history: scanSection(epochs, (page) =>
      votesHistory(page.data, epoch.number, page.meta.complete, page.meta.asOf),
    ),
    table: scanSection(validators, (body) =>
      validatorTable(
        body,
        ranked,
        votes.status === "ok" && votes.data === "not-yet"
          ? "not-yet"
          : votes.status,
        sort,
        uptime,
        priced,
      ),
    ),
  }
}

// -- one validator ----------------------------------------------------------

export type ValidatorHeader = {
  /** The proposer address the page is for. */
  address: string
  /** Pro's name, else Scan's label; untrusted. */
  name: string | null
  picture: GaugePictureView
  /** Null for a proposer the API matched to no validator gauge. */
  gauge: string | null
  status: ValidatorStatus | null
  /** False when the gauge was killed. */
  alive: boolean
  beneficiary: string | null
  /** This epoch's incentives for voters, in USD at today's prices. */
  incentives: string | null
  proUrl: string | null
}

export type ValidatorShare = {
  share: string
  /** "1 of 2". */
  rank: string | null
  votes: string
  voters: string
}

export type ValidatorBlocks = ProposedFigures & { day: BlocksDay }

export type ValidatorPage = {
  /** MEZO its gauge was distributed per epoch; null without a gauge. */
  emissions: Section<FigureWire | null> | null
  address: string
  header: Entity<ValidatorHeader>
  share: Section<ValidatorShare | NotYet | null>
  blocks: Section<ValidatorBlocks>
  /** Signing and proposals from CometBFT commits, with their freshness. */
  uptime: Section<ValidatorUptimeView>
  /** The gauge's own figures (votes, incentives, voters, deposits). */
  gauge: GaugeDetailPage | null
  epoch: EpochSpan
  now: number
}

/** Epochs of emissions a validator's page draws. */
const emissionEpochs = 26

export async function validatorPage(input: {
  address: string
}): Promise<ValidatorPage> {
  const at = now()
  const epoch = epochSpan(epochStartOf(at))
  const address = input.address.toLowerCase()
  const empty: ValidatorPage = {
    emissions: null,
    address,
    header: { status: "missing" },
    share: { status: "unavailable" },
    blocks: { status: "unavailable" },
    uptime: { status: "unavailable" },
    gauge: null,
    epoch,
    now: at,
  }
  if (!/^0x[0-9a-f]{40}$/.test(address)) return empty
  const [validators, ranking, uptime] = await Promise.all([
    readValidators(),
    readRanking(epoch.start),
    readValidatorUptime(address),
  ])
  setCacheClass("list")
  if (validators.status !== "ok") {
    const failed =
      validators.status === "missing"
        ? ({ status: "unavailable" } as const)
        : failedSection(validators)
    return { ...empty, header: failed, blocks: failed, uptime }
  }
  const row = validators.data.data.validators.find(
    (each) => each.address.toLowerCase() === address,
  )
  if (row === undefined) return empty
  const gaugeAddress = row.gauge?.toLowerCase() ?? null
  // The gauge page's closes (its last 12 epochs) price the emissions note.
  let prices: DailyPrices | null = null
  const [gauge, emissionsRead] = await Promise.all([
    gaugeAddress === null
      ? Promise.resolve(null)
      : gaugePage({
          gauge: gaugeAddress,
          range: "30d",
          validator: {
            prices: (read) => {
              prices = read
            },
          },
        }),
    gaugeAddress === null
      ? Promise.resolve(null)
      : readGaugeEmissions(gaugeAddress, emissionEpochs),
  ])
  setCacheClass("list")
  const share: Section<ValidatorShare | NotYet | null> =
    gaugeAddress === null
      ? { status: "ok", data: null }
      : scanSection(ranking, (body) => {
          const list = rankingOf(body)
          const ranked = list.rows.find(
            (each) => each.gauge.toLowerCase() === gaugeAddress,
          )
          if (ranked === undefined) return list.complete ? null : "not-yet"
          return {
            share: percentText(
              shareBps(BigInt(ranked.vote_weight), list.total),
            ),
            rank:
              ranked.rank === null
                ? null
                : `${ranked.rank} of ${body.data.length}`,
            votes: votesText(ranked.vote_weight, "veBTC"),
            voters: groupThousands(BigInt(ranked.voters)),
          }
        })
  const header = gauge?.header.status === "ok" ? gauge.header.data : null
  const name = header?.gauge.name ?? rowName(row)
  return {
    emissions:
      emissionsRead === null
        ? null
        : scanSection(emissionsRead, (body) => {
            const view = emissionsEarnedView(body.data, prices ?? noPrices, at)
            return view === null ? null : figureWireOut(view)
          }),
    address,
    header: {
      status: "ok",
      data: {
        address,
        name,
        picture: header?.gauge.picture ?? pictureOf(name, address),
        gauge: gaugeAddress,
        status: row.pool_status,
        alive: header?.alive ?? true,
        beneficiary: header?.beneficiary ?? null,
        incentives: header?.incentives ?? null,
        proUrl: gaugeAddress === null ? null : proUrl(gaugeAddress),
      },
    },
    share,
    blocks: {
      status: "ok",
      data: {
        ...proposedOf(row, validators.data.data.shares_complete),
        day: blocksDay(validators.data),
      },
    },
    uptime,
    gauge,
    epoch,
    now: at,
  }
}
