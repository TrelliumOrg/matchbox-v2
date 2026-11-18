import type {
  ScanActivityItem,
  ScanLabelItem,
  ScanLiveLock,
  ScanLockItem,
  ScanLockVoteItem,
} from "@matchbox/contracts/scan"
import { epochIndexFor, epochStartOf } from "@matchbox/domain/epoch"
import { formatBtc, formatTokenWithSymbol } from "@matchbox/domain/format"
import { setCacheClass } from "../cache-class.server"
import {
  cursorOf,
  type PeriodInput,
  type PeriodView,
} from "../explorer/voting/range"
import { canonicalQuery } from "./caller.server"
import { nowSeconds } from "./clock.server"
import type { Entity, Section } from "./explorer"
import type { Stat } from "./gauges.server"
import {
  type ActivityView,
  activityViews,
  type SentenceContext,
  type SentencePart,
} from "./scan/activity-view"
import { type LockEnclaveView, lockEnclaveView } from "./scan/borrow-views"
import { readLockDistribution } from "./scan/governance.server"
import { lockDistributionView } from "./scan/governance-views"
import { type LockView, lockView } from "./scan/lock-views"
import { type LockDistributionWire, lockWireOut } from "./scan/lock-wire"
import { compactUsd, usdValue } from "./scan/network-views"
import { periodOf, periodSeries, periodView } from "./scan/period"
import { readDailyPrices } from "./scan/prices.server"
import { latestPrice } from "./scan/pricing"
import { readScan, type ScanRead } from "./scan/read.server"
import { scanSchemas } from "./scan/schemas"
import { metric } from "./scan/series"
import { readSeries } from "./scan/series.server"
import {
  countText,
  latestOf,
  type SeriesPanelData,
  seriesPanel,
} from "./scan/series-views"
import { tokenLookup } from "./scan/tokens"
import {
  failedSection,
  type GaugeIdentity,
  gaugeIndex,
  kindOfSource,
  scanSection,
  shareBps,
  unknownGauge,
  votesText,
} from "./scan/voting-views"

/**
 * The Locks pages: the list (`uNyejMCnPb`) and one lock (`bG-Fb-_hxD`),
 * from `/locks`, `/locks/{escrow}/{id}`, its votes and its activity, with
 * the escrows' daily series. veBTC and veMEZO are separate escrows whose
 * ids overlap: a lock is always its escrow and id.
 */

/** Series the Locks panels chart (one map, so a rename is one line). */
const charts = {
  locked: metric("escrow.supply"),
  net: metric("locks.net"),
  deposited: metric("locks.deposited"),
  withdrawn: metric("locks.withdrawn"),
  created: metric("locks.created"),
}

export type Escrow = "vebtc" | "vemezo"
export type LockOrder = "amount" | "unlock" | "created"

/** The server's now (the fixture world's own in fixtures mode). */
function now(): number {
  return nowSeconds()
}

/** Whole BTC or MEZO from a series decimal, with the sign kept. */
function amountText(escrow: Escrow): (decimal: string) => string {
  return (decimal) =>
    escrow === "vebtc"
      ? formatBtc(decimal).text
      : formatTokenWithSymbol(decimal, "MEZO")
}

function signed(format: (decimal: string) => string) {
  return (decimal: string) =>
    decimal.startsWith("-") || /^[0.]+$/.test(decimal)
      ? format(decimal)
      : `+${format(decimal)}`
}

// -- the list ---------------------------------------------------------------

export type LocksPage = {
  escrow: Escrow
  order: LockOrder
  period: PeriodView
  paged: boolean
  list: Section<{
    rows: LockView[]
    next: { cursor: string } | null
    /**
     * By unlock date: rows on this page whose unlock date has passed but
     * whose BTC or MEZO was never withdrawn. The API lists them first
     * (soonest unlock first), so the page says so.
     */
    expired: number
  }>
  locked: Section<SeriesPanelData>
  lockedStats: Stat[]
  net: Section<SeriesPanelData>
  netStats: Stat[]
  /**
   * Every lock read from the chain once a day: time left, size, permanent
   * against timed, and the unlock calendar. Null before the first read.
   */
  distribution: Section<LockDistributionWire | null>
  now: number
}

export async function locksPage(
  input: {
    escrow: Escrow
    order: LockOrder
    cursor: string | null
  } & PeriodInput,
): Promise<LocksPage> {
  setCacheClass("list")
  const escrow: Escrow = input.escrow === "vemezo" ? "vemezo" : "vebtc"
  const order: LockOrder =
    input.order === "unlock" || input.order === "created"
      ? input.order
      : "amount"
  const cursor = cursorOf(input.cursor) ?? null
  const at = now()
  const period = periodOf(input, at)
  const days = period.read
  const series = (name: string) =>
    readSeries({ metric: name, dimension: escrow, days, now: at })
  const [
    list,
    locked,
    net,
    deposited,
    withdrawn,
    created,
    prices,
    distribution,
  ] = await Promise.all([
    readScan(
      "locks",
      canonicalQuery({ escrow, order, cursor, limit: 25 }),
      scanSchemas.lockPage,
    ),
    series(charts.locked),
    series(charts.net),
    series(charts.deposited),
    series(charts.withdrawn),
    series(charts.created),
    readDailyPrices(at, at - 7 * 86_400),
    readLockDistribution(escrow),
  ])
  const format = amountText(escrow)
  const lockedStats: Stat[] = []
  // The amount locked now, at the latest daily close of its token.
  const lastLocked =
    locked.status === "ok" ? (locked.data.points.at(-1) ?? null) : null
  const close = latestPrice(escrow === "vebtc" ? prices.btc : prices.mezo)
  if (lastLocked !== null && close !== null) {
    lockedStats.push({
      label: "In USD",
      value: compactUsd(usdValue(lastLocked.decimal, close.price)),
    })
  }
  const newLocks = latestOf(created, countText)
  if (newLocks !== null) {
    lockedStats.push({
      label: newLocks.partial ? "New locks today" : "New locks",
      value: newLocks.text,
    })
  }
  const netStats: Stat[] = []
  const inflow = latestOf(deposited, format)
  if (inflow !== null) {
    netStats.push({
      label: inflow.partial ? "Locked today" : "Locked",
      value: inflow.text,
    })
  }
  const outflow = latestOf(withdrawn, format)
  if (outflow !== null) {
    netStats.push({
      label: outflow.partial ? "Withdrawn today" : "Withdrawn",
      value: outflow.text,
    })
  }
  return {
    escrow,
    order,
    period: periodView(period, at),
    paged: cursor !== null,
    now: at,
    list: scanSection(list, (page) => {
      const rows = page.data.map((lock) => lockView(lock, at))
      return {
        rows,
        next: page.nextCursor === null ? null : { cursor: page.nextCursor },
        expired:
          order === "unlock"
            ? rows.filter((row) => row.state === "expired").length
            : 0,
      }
    }),
    locked: seriesPanel(periodSeries(locked, period), format),
    lockedStats,
    net: seriesPanel(periodSeries(net, period), signed(format)),
    netStats,
    distribution: scanSection(distribution, (body) =>
      body.data.latest === null
        ? null
        : lockWireOut(
            lockDistributionView({
              latest: body.data.latest,
              ago30: body.data.ago30,
              ago90: body.data.ago90,
              now: at,
            }),
          ),
    ),
  }
}

// -- one lock ---------------------------------------------------------------

export type VoteSplit = {
  epoch: number
  total: string
  carried: boolean
  parts: { gauge: GaugeIdentity; weight: string; bps: number }[]
}

/**
 * A lock's votes by epoch, newest first. `cut`: the lock has older votes
 * than one page holds, so the oldest epochs are not shown.
 */
export type VoteHistory = { splits: VoteSplit[]; cut: boolean }

export type LockPage = {
  escrow: Escrow
  id: string
  /** Only what the page draws from the lock: its figures are `cards`. */
  lock: Entity<Pick<LockView, "owner" | "state">>
  /**
   * False for a lock the chain has and Scan's store does not yet: its
   * figures are the chain's, its history and older votes are not indexed.
   */
  indexed: boolean
  cards: Stat[]
  votes: Section<VoteHistory>
  activity: Section<{ rows: ActivityView[]; more: boolean }>
  /**
   * A veBTC lock's Enclave position (`ye58XxZO9m`), null in the section
   * when never pledged; null for a veMEZO lock, which Enclaves never take.
   */
  enclave: Section<LockEnclaveView | null> | null
  now: number
  epoch: number
}

function voteSplits(
  votes: readonly ScanLockVoteItem[],
  names: ReadonlyMap<string, GaugeIdentity>,
  unit: "veMEZO" | "veBTC",
): VoteSplit[] {
  const byEpoch = new Map<number, ScanLockVoteItem[]>()
  for (const vote of votes) {
    byEpoch.set(vote.epoch_start, [
      ...(byEpoch.get(vote.epoch_start) ?? []),
      vote,
    ])
  }
  return [...byEpoch]
    .sort(([a], [b]) => b - a)
    .map(([start, list]) => {
      const total = list.reduce((sum, vote) => sum + BigInt(vote.weight), 0n)
      return {
        epoch: epochIndexFor(start),
        total: votesText(total, unit),
        carried: list.every((vote) => vote.carried),
        parts: [...list]
          .sort((a, b) => (BigInt(b.weight) > BigInt(a.weight) ? 1 : -1))
          .map((vote) => ({
            gauge:
              names.get(vote.gauge.toLowerCase()) ??
              unknownGauge(vote.gauge, kindOfSource(vote.source)),
            weight: votesText(vote.weight, unit),
            bps: shareBps(BigInt(vote.weight), total),
          })),
      }
    })
}

/** How many votes one read of a lock's history takes (the API's most). */
export const voteHistoryLimit = 100

/** Whole epochs the votes panel reads on for. */
export const voteEpochsWanted = 12

/** The most reads of a lock's votes one page makes. */
export const voteReadsMost = 4

type VotePage = {
  data: ScanLockVoteItem[]
  nextCursor: string | null
}

/** Epochs a page of votes holds whole: all but its oldest while it is cut. */
function wholeEpochs(page: VotePage): number {
  const epochs = new Set(page.data.map((vote) => vote.epoch_start)).size
  return page.nextCursor === null ? epochs : Math.max(0, epochs - 1)
}

/**
 * A lock's votes, newest epoch first, read on until they hold
 * `voteEpochsWanted` whole epochs, the history ends, or `voteReadsMost`
 * reads. A lock voting for 27 gauges an epoch fills a read of 100 votes
 * in under four epochs, so one read showed it as "1 latest epochs voted".
 */
export async function readLockVotes<Page extends VotePage>(
  read: (cursor: string | null) => Promise<ScanRead<Page>>,
): Promise<ScanRead<Page>> {
  let page = await read(null)
  if (page.status !== "ok") return page
  for (let reads = 1; reads < voteReadsMost; reads += 1) {
    const cursor = page.data.nextCursor
    if (cursor === null || wholeEpochs(page.data) >= voteEpochsWanted) break
    const next = await read(cursor)
    // A later read that fails leaves the epochs read so far, cut.
    if (next.status !== "ok") break
    page = {
      ...next,
      data: { ...next.data, data: [...page.data.data, ...next.data.data] },
      skipped: page.skipped + next.skipped,
    }
  }
  return page
}

/**
 * This epoch's votes as the chain has them (`live.votes`: the weight on
 * each gauge now), as rows of the lock's history. Each voter keeps its own
 * last vote: a vote is carried when the lock last voted on that vote's
 * voter before the epoch began (an older answer without it falls back to
 * the lock's latest vote on any voter).
 */
export function liveVotes(
  lock: Pick<ScanLockItem, "escrow" | "token_id">,
  live: ScanLiveLock,
  now: number,
): ScanLockVoteItem[] {
  const start = epochStartOf(now)
  return live.votes.map((vote) => {
    const votedAt =
      vote.voted_at === undefined ? live.last_voted_at : vote.voted_at
    return {
      epoch_start: start,
      gauge: vote.gauge,
      escrow: lock.escrow,
      token_id: lock.token_id,
      source: vote.source,
      pool: null,
      weight: vote.weight,
      voted_at: votedAt ?? start,
      carried: votedAt === null || votedAt < start,
    }
  })
}

/**
 * A lock's stored votes with this epoch's from the chain in their place:
 * the store's copy of this epoch may be minutes behind a vote or a reset.
 */
export function withLiveEpoch(
  history: VoteHistory,
  live: readonly ScanLockVoteItem[],
  names: ReadonlyMap<string, GaugeIdentity>,
  unit: "veMEZO" | "veBTC",
  epoch: number,
): VoteHistory {
  const current = voteSplits(live, names, unit)
  return {
    ...history,
    splits: [
      ...current,
      ...history.splits.filter((split) => split.epoch !== epoch),
    ],
  }
}

/** How many entries of a lock's history the page shows. */
export const historyShown = 25

/** How many activity rows one read of a lock's history takes. */
export const historyReadLimit = 100

/**
 * A lock's latest history, each vote one entry (`activityViews`). One
 * read of 100 rows holds 25 entries even when every vote names many
 * gauges. While the history goes on, its last entry may be a vote the read
 * cut short, so it is left out rather than shown with part of its gauges.
 */
/**
 * A sentence with its neighbouring plain words joined ("Voted", " " as
 * "Voted "): it reads the same, and the page sends fewer parts.
 */
export function joinedText(parts: readonly SentencePart[]): SentencePart[] {
  const out: SentencePart[] = []
  for (const part of parts) {
    const last = out.at(-1)
    if (part.kind === "text" && last?.kind === "text") {
      out[out.length - 1] = { kind: "text", text: last.text + part.text }
    } else {
      out.push(part)
    }
  }
  return out
}

export function lockHistory(
  page: { data: readonly ScanActivityItem[]; nextCursor: string | null },
  context: SentenceContext,
): { rows: ActivityView[]; more: boolean } {
  const cut = page.nextCursor !== null
  const views = activityViews(page.data, context).map((view) => ({
    ...view,
    parts: joinedText(view.parts),
  }))
  const whole = cut && views.length > 1 ? views.slice(0, -1) : views
  return {
    rows: whole.slice(0, historyShown),
    more: cut || whole.length > historyShown,
  }
}

/**
 * One page of a lock's votes (newest epoch first) as whole epochs. When
 * the lock has more, the page's oldest epoch may go on into the next, so
 * its shares would be wrong: it is left out and the history says it is
 * cut (unless it is the only epoch on the page).
 */
export function voteHistory(
  page: { data: readonly ScanLockVoteItem[]; nextCursor: string | null },
  names: ReadonlyMap<string, GaugeIdentity>,
  unit: "veMEZO" | "veBTC",
): VoteHistory {
  const cut = page.nextCursor !== null
  let votes = page.data
  if (cut && votes.length > 0) {
    const oldest = Math.min(...votes.map((vote) => vote.epoch_start))
    const whole = votes.filter((vote) => vote.epoch_start !== oldest)
    if (whole.length > 0) votes = whole
  }
  return { splits: voteSplits(votes, names, unit), cut }
}

/** Gauge names as the activity sentences take them (labels by address). */
function gaugeLabels(
  names: ReadonlyMap<string, GaugeIdentity>,
): Record<string, ScanLabelItem> {
  const labels: Record<string, ScanLabelItem> = {}
  for (const gauge of names.values()) {
    if (gauge.name === null) continue
    labels[gauge.address] = {
      address: gauge.address,
      name: gauge.name,
      kind: "gauge",
      tags: [],
      source: "curated",
      pool: null,
      gauge: gauge.address,
      updated_at: 0,
    }
  }
  return labels
}

export async function lockPage(input: {
  escrow: Escrow
  id: string
}): Promise<LockPage> {
  const escrow: Escrow = input.escrow === "vemezo" ? "vemezo" : "vebtc"
  const id = /^[0-9]{1,12}$/.test(input.id) ? input.id : "0"
  const at = now()
  const epoch = epochIndexFor(epochStartOf(at))
  setCacheClass("fresh")
  const [lock, votes, activity, directory, enclave] = await Promise.all([
    readScan(`locks/${escrow}/${id}`, new URLSearchParams(), scanSchemas.lock),
    readLockVotes((cursor) =>
      readScan(
        `locks/${escrow}/${id}/votes`,
        canonicalQuery({ limit: voteHistoryLimit, cursor }),
        scanSchemas.votePage,
      ),
    ),
    readScan(
      `activity/lock/${escrow}/${id}`,
      canonicalQuery({ limit: historyReadLimit }),
      scanSchemas.activityPage,
    ),
    readScan("gauges", new URLSearchParams(), scanSchemas.gauges),
    escrow === "vebtc"
      ? readScan(
          `borrow/enclave/locks/${id}`,
          new URLSearchParams(),
          scanSchemas.enclaveLock,
        )
      : null,
  ])
  const names = gaugeIndex(
    directory.status === "ok" ? directory.data.data.gauges : null,
  )
  const unit = escrow === "vebtc" ? "veBTC" : "veMEZO"
  const view = lock.status === "ok" ? lockView(lock.data.data, at) : null
  // The chain's figures (the API reads them at most once a minute); null
  // when it could not, and for a withdrawn or merged lock.
  const live = lock.status === "ok" ? (lock.data.live ?? null) : null
  const indexed = lock.status === "ok" ? (lock.data.indexed ?? true) : true
  const chainVotes =
    live === null || lock.status !== "ok"
      ? null
      : liveVotes(lock.data.data, live, at)
  const cards: Stat[] = []
  if (view !== null) {
    cards.push({ label: "Amount locked", value: view.amount })
    cards.push({
      label: "Unlocks",
      value:
        view.state === "auto-max"
          ? "Auto max"
          : view.state === "withdrawn"
            ? "Withdrawn"
            : view.state === "merged"
              ? "Merged"
              : (view.unlockText ?? "Unknown"),
    })
    if (live !== null) {
      cards.push({
        label: "Voting power",
        value: votesText(live.voting_power, unit),
      })
    }
    const current =
      chainVotes ??
      (votes.status === "ok"
        ? votes.data.data.filter(
            (vote) => epochIndexFor(vote.epoch_start) === epoch,
          )
        : null)
    if (current !== null) {
      const total = current.reduce((sum, vote) => sum + BigInt(vote.weight), 0n)
      cards.push({
        label: `Votes Epoch ${epoch}`,
        value: total === 0n ? "Not voted" : votesText(total, unit),
      })
    }
    if (view.boost !== null) cards.push({ label: "Boost", value: view.boost })
  }
  const lockState: LockPage["lock"] =
    lock.status === "missing"
      ? { status: "missing" }
      : view === null
        ? failedSection(lock)
        : { status: "ok", data: { owner: view.owner, state: view.state } }
  return {
    escrow,
    id,
    epoch,
    now: at,
    lock: lockState,
    indexed,
    cards,
    votes: scanSection(votes, (page) => {
      const history = voteHistory(page, names, unit)
      return chainVotes === null
        ? history
        : withLiveEpoch(history, chainVotes, names, unit, epoch)
    }),
    activity: scanSection(activity, (page) =>
      lockHistory(page, {
        tokens: tokenLookup(),
        labels: gaugeLabels(names),
      }),
    ),
    enclave:
      enclave === null
        ? null
        : scanSection(enclave, (body) =>
            lockEnclaveView(id, body.data.positions),
          ),
  }
}
