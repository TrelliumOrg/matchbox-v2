import { MORPHO_MARKETS } from "@matchbox/chain"
import { canonicalQuery } from "./caller.server"
import type { Section } from "./explorer"
import { type ActivityView, activityViews } from "./scan/activity-view"
import {
  enclaveEventView,
  type LoanEventView,
  morphoEventView,
  troveEventView,
} from "./scan/borrow-views"
import { type LockVoteView, lockVoteView } from "./scan/lock-views"
import { readScan, type ScanRead } from "./scan/read.server"
import { scanSchemas } from "./scan/schemas"
import { tokenLookup } from "./scan/tokens"
import type { Page } from "./views"

/**
 * The address page's tabs beyond its composed document: votes of the
 * address's locks, later pages of its activity, and its loan history.
 * Each read degrades its own tab.
 */

const anAddress = /^0x[0-9a-f]{40}$/
const aCursor = /^[A-Za-z0-9_-]{4,512}$/

function scanSection<In, Out>(
  read: ScanRead<In>,
  map: (data: In) => Out,
): Section<Out> {
  if (read.status === "ok") {
    return {
      status: "ok",
      data: map(read.data),
      ...(read.skipped > 0 ? { skipped: read.skipped } : {}),
      ...(read.restarted === true ? { restarted: true } : {}),
    }
  }
  if (read.status === "rate-limited") return { status: "rate-limited" }
  if (read.status === "disabled") return { status: "disabled" }
  return { status: "unavailable" }
}

export type VotesByEpoch = { epoch: number; votes: LockVoteView[] }[]

/** Votes read for the Votes tab: the API's largest page. */
const voteLimit = 100

/**
 * The votes of every lock the address owns now, in one read
 * (`/owners/{a}/votes`, by lock, each lock's newest epoch first, with the
 * gauges' labels), grouped by epoch, newest first. `partial` when the
 * address has more votes than one page.
 */
export async function addressVotes(data: {
  address: string
}): Promise<Section<{ epochs: VotesByEpoch; partial: boolean }>> {
  if (!anAddress.test(data.address)) return { status: "unavailable" }
  const read = await readScan(
    `owners/${data.address}/votes`,
    canonicalQuery({ limit: voteLimit }),
    scanSchemas.ownerVotePage,
  )
  return scanSection(read, (page) => {
    const byEpoch = new Map<number, LockVoteView[]>()
    for (const vote of page.data) {
      const view = lockVoteView(vote, page.labels)
      byEpoch.set(view.epoch, [...(byEpoch.get(view.epoch) ?? []), view])
    }
    return {
      epochs: [...byEpoch]
        .sort(([a], [b]) => b - a)
        .map(([epoch, list]) => ({ epoch, votes: list })),
      partial: page.nextCursor !== null,
    }
  })
}

export async function addressActivity(data: {
  address: string
  cursor: string | null
}): Promise<Section<Page<ActivityView>>> {
  if (!anAddress.test(data.address)) return { status: "unavailable" }
  if (data.cursor !== null && !aCursor.test(data.cursor)) {
    return { status: "unavailable" }
  }
  const read = await readScan(
    `activity/address/${data.address}`,
    canonicalQuery({ role: "any", cursor: data.cursor }),
    scanSchemas.activityPage,
  )
  const context = { tokens: tokenLookup(), labels: {}, viewer: data.address }
  return scanSection(read, (page) => ({
    items: activityViews(page.data, context),
    next: page.nextCursor === null ? null : { cursor: page.nextCursor },
  }))
}

export type LoanHistory = {
  /** Newest first, down to where every source is still whole. */
  items: LoanEventView[]
  /** A source has older events than these: the history is not whole. */
  more: boolean
}

/** Events read per source: the API's largest page. */
const loanLimit = 100

/**
 * Loan events from several sources (troves, Enclaves, each Morpho market),
 * each a newest-first page that may have more (`more`), merged newest
 * first. A source with more stops at its oldest event read: anything older
 * from the other sources would sit in its gap, so the merge is cut there
 * and says it is not whole.
 */
export function mergeLoanSources(
  sources: readonly { events: readonly LoanEventView[]; more: boolean }[],
): LoanHistory {
  let cutoff: number | null = null
  for (const source of sources) {
    const oldest = source.events.reduce<number | null>(
      (low, event) => (low === null || event.block < low ? event.block : low),
      null,
    )
    if (
      source.more &&
      oldest !== null &&
      (cutoff === null || oldest > cutoff)
    ) {
      cutoff = oldest
    }
  }
  const items = sources
    .flatMap((source) => source.events)
    .filter((event) => cutoff === null || event.block >= cutoff)
    .sort((a, b) => b.block - a.block || b.key.localeCompare(a.key))
  return { items, more: sources.some((source) => source.more) }
}

export async function loanHistory(data: {
  address: string
}): Promise<Section<LoanHistory>> {
  if (!anAddress.test(data.address)) return { status: "unavailable" }
  const markets = Object.values(MORPHO_MARKETS.mainnet)
  const query = canonicalQuery({ limit: loanLimit })
  const [troves, enclave, ...morpho] = await Promise.all([
    readScan(
      `borrow/troves/${data.address}/events`,
      query,
      scanSchemas.troveEventPage,
    ),
    readScan(
      `borrow/enclave/borrowers/${data.address}/events`,
      query,
      scanSchemas.enclaveEventPage,
    ),
    ...markets.map((market) =>
      readScan(
        `borrow/markets/${market}/positions/${data.address}/events`,
        query,
        scanSchemas.morphoEventPage,
      ),
    ),
  ])
  const reads = [troves, enclave, ...morpho]
  const failed = reads.find((read) => read.status !== "ok")
  if (failed !== undefined) {
    return scanSection(failed, () => ({ items: [], more: false }))
  }
  const sources = [
    troves.status === "ok"
      ? {
          events: troves.data.data.map(troveEventView),
          more: troves.data.nextCursor !== null,
        }
      : null,
    enclave.status === "ok"
      ? {
          events: enclave.data.data.map(enclaveEventView),
          more: enclave.data.nextCursor !== null,
        }
      : null,
    ...morpho.map((read) =>
      read.status === "ok"
        ? {
            events: read.data.data.map(morphoEventView),
            more: read.data.nextCursor !== null,
          }
        : null,
    ),
  ].filter((source) => source !== null)
  // Rows the API left out of any source (failed their schema).
  const skipped = reads.reduce(
    (sum, read) => sum + (read.status === "ok" ? read.skipped : 0),
    0,
  )
  return {
    status: "ok",
    data: mergeLoanSources(sources),
    ...(skipped > 0 ? { skipped } : {}),
  }
}
