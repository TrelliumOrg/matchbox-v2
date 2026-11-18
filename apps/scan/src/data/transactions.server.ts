import { CONTRACTS, MUSD_CONTRACTS } from "@matchbox/chain"
import {
  type BlockscoutTransactionSummary,
  transactionsPageSchema,
} from "@matchbox/contracts/blockscout"
import type { ScanActivityItem } from "@matchbox/contracts/scan"
import { setCacheClass } from "../cache-class.server"
import { canonicalQuery, readBlockscout } from "./blockscout/read.server"
import { pickCursor } from "./cursors"
import type { Section } from "./explorer"
import {
  decodePlaces,
  encodePlaces,
  mergePages,
  readLimit,
  type SourcePage,
  startPlaces,
} from "./scan/activity-merge"
import {
  type ActivityView,
  activityViews,
  headline,
  type SentenceContext,
  type SentencePart,
} from "./scan/activity-view"
import { type KnownNames, labelMapOf, nameViews } from "./scan/names"
import { knownNames } from "./scan/names.server"
import { readScan } from "./scan/read.server"
import { scanSchemas } from "./scan/schemas"
import { formatTokenAmount, tokenLookup } from "./scan/tokens"
import { scanSection } from "./scan/voting-views"
import { type TxTab, txTabActions } from "./transaction-tabs"
import { type Cursor, cursorOf, type TxRow, txRow } from "./views"

/**
 * Transactions (`ndoSD6xB0U`) in plain words. All is Blockscout's list,
 * each transaction worded from what Matchscan already knows: its activity
 * rows (the newest activity in one read, then each remaining transaction
 * to a protocol contract or a gauge, at most `perTxReads` a page), else a
 * loan action from MUSD's decoded method name, else the decoded method
 * ("Called execute"), else "Contract call". Votes, Claims and Swaps are
 * their activity actions merged newest first (activity-merge). Left out
 * until their data exists: the Loans, Transfers, Bridge and Contract calls
 * tabs, every tab's count, the hourly chart and CSV.
 */

/** Activity read per transaction page, at most. */
const perTxReads = 8

/** Rows a category tab shows. */
const tabLimit = 25

/** Contracts whose transactions activity rows describe. */
const protocol = new Set(
  [
    CONTRACTS.mainnet.veBTC,
    CONTRACTS.mainnet.veMEZO,
    CONTRACTS.mainnet.boostVoter,
    CONTRACTS.mainnet.poolsVoter,
    CONTRACTS.mainnet.validatorsVoter,
    CONTRACTS.mainnet.thirdPartyVoter,
  ].map((address) => address.toLowerCase()),
)

const loanContracts = new Set(
  [
    MUSD_CONTRACTS.mainnet.borrowerOperations,
    MUSD_CONTRACTS.mainnet.troveManager,
  ].map((address) => address.toLowerCase()),
)

/** MUSD's borrower and trove manager calls, as the design words them. */
const loanWords: Readonly<Record<string, string>> = {
  openTrove: "Opened loan",
  closeTrove: "Closed loan",
  addColl: "Added collateral",
  withdrawColl: "Withdrew collateral",
  withdrawMUSD: "Borrowed MUSD",
  repayMUSD: "Repaid MUSD",
  adjustTrove: "Adjusted loan",
  refinance: "Refinanced loan",
  liquidate: "Liquidated loan",
  batchLiquidateTroves: "Liquidated loans",
  redeemCollateral: "Redeemed MUSD",
}

/** A transaction in words: what it did, and the amount with its token. */
export type TxWords = TxRow & {
  parts: SentencePart[]
  text: string
  /** Activity rows of the transaction past the one shown. */
  more: number
  /** The icon's key: the activity action, or how it was worded. */
  icon: string
  /** "5,000.00 MUSD", "1.1000 BTC"; null when nothing moved. */
  amount: string | null
}

const selector = /^0x[0-9a-f]{8}$/i

function text(value: string): SentencePart[] {
  return [{ kind: "text", text: value }]
}

/** Words for a transaction no activity row describes. */
function plainWords(
  tx: BlockscoutTransactionSummary,
  row: TxRow,
  context: SentenceContext,
): Pick<TxWords, "parts" | "text" | "icon"> {
  const to = row.to?.address ?? null
  const method = tx.method
  if (to !== null && method !== null && loanContracts.has(to)) {
    const words = loanWords[method]
    if (words !== undefined) {
      return { parts: text(words), text: words, icon: "LOAN" }
    }
  }
  if (tx.to === null && tx.created_contract !== null) {
    return {
      parts: text("Created contract"),
      text: "Created contract",
      icon: "CONTRACT",
    }
  }
  if (method === null) {
    return row.value === null
      ? { parts: text("Contract call"), text: "Contract call", icon: "CALL" }
      : { parts: text("Sent BTC"), text: "Sent BTC", icon: "TRANSFER" }
  }
  if (selector.test(method)) {
    return { parts: text("Contract call"), text: "Contract call", icon: "CALL" }
  }
  const words = headline([], method, context)
  return { parts: words.parts, text: words.text, icon: "CALL" }
}

function activityAmount(
  row: ScanActivityItem,
  context: SentenceContext,
): string | null {
  if (row.amount === null || row.token === null) return null
  return formatTokenAmount(row.amount, context.tokens(row.token))
}

export function txWords(
  tx: BlockscoutTransactionSummary,
  activity: readonly ScanActivityItem[],
  context: SentenceContext,
): TxWords {
  const row = txRow(tx)
  const value = row.value === null ? null : `${row.value} BTC`
  const ordered = [...activity].sort((a, b) => a.log_index - b.log_index)
  // A lock's votes in one call read as one sentence (activityViews).
  const views = activityViews(ordered, context)
  const view = views[0]
  const first = ordered[0]
  if (view !== undefined && first !== undefined) {
    return {
      ...row,
      parts: view.parts,
      text: view.text,
      more: views.length - 1,
      icon: first.action_type,
      amount: activityAmount(first, context) ?? value,
    }
  }
  return { ...row, ...plainWords(tx, row, context), more: 0, amount: value }
}

function byTx(
  rows: readonly ScanActivityItem[],
): Map<string, ScanActivityItem[]> {
  const map = new Map<string, ScanActivityItem[]>()
  for (const row of rows) {
    const hash = row.tx_hash.toLowerCase()
    map.set(hash, [...(map.get(hash) ?? []), row])
  }
  return map
}

/** Whether activity rows may describe a transaction to `to`. */
function describable(to: string | null, names: KnownNames): boolean {
  if (to === null) return false
  return protocol.has(to) || names.gauges[to] !== undefined
}

export type AllTransactions = {
  items: TxWords[]
  next: Cursor | null
}

async function allTransactions(
  cursor: Record<string, unknown>,
): Promise<Section<AllTransactions>> {
  const [read, names, feed] = await Promise.all([
    readBlockscout(
      "transactions",
      canonicalQuery(pickCursor("transactions", cursor) ?? {}),
      transactionsPageSchema,
    ),
    knownNames(),
    readScan(
      "activity",
      canonicalQuery({ limit: 100 }),
      scanSchemas.activityPage,
    ),
  ])
  if (read.status !== "ok") {
    return read.status === "rate-limited"
      ? { status: "rate-limited" }
      : { status: "unavailable" }
  }
  const found = byTx(feed.status === "ok" ? feed.data.data : [])
  const missing = read.data.items
    .filter((tx) => !found.has(tx.hash.toLowerCase()))
    .filter((tx) => describable(tx.to?.hash.toLowerCase() ?? null, names))
    .slice(0, perTxReads)
  const extra = await Promise.all(
    missing.map((tx) =>
      readScan(
        `activity/tx/${tx.hash.toLowerCase()}`,
        new URLSearchParams(),
        scanSchemas.activityPage,
      ),
    ),
  )
  for (const page of extra) {
    if (page.status !== "ok") continue
    for (const [hash, rows] of byTx(page.data.data)) found.set(hash, rows)
  }
  const context = { tokens: tokenLookup(), labels: labelMapOf(names) }
  return {
    status: "ok",
    data: nameViews(
      {
        items: read.data.items.map((tx) =>
          txWords(tx, found.get(tx.hash.toLowerCase()) ?? [], context),
        ),
        next: cursorOf(read.data.next_page_params),
      },
      names,
    ),
  }
}

export type ActivityTab = {
  rows: ActivityView[]
  next: string | null
}

async function activityTab(
  actions: readonly string[],
  cursor: string | null,
): Promise<Section<ActivityTab>> {
  const places =
    cursor === null
      ? startPlaces(actions.length)
      : (decodePlaces(cursor, actions.length) ?? startPlaces(actions.length))
  const [reads, names] = await Promise.all([
    Promise.all(
      actions.map((action, index) => {
        const place = places[index]
        if (place === undefined || place.done) return Promise.resolve(null)
        return readScan(
          `activity/action/${action}`,
          canonicalQuery({
            cursor: place.cursor,
            limit: readLimit(place, tabLimit),
          }),
          scanSchemas.activityPage,
        )
      }),
    ),
    knownNames(),
  ])
  const failed = reads.find((read) => read !== null && read.status !== "ok")
  if (failed !== undefined && failed !== null) {
    return scanSection(failed, () => ({ rows: [], next: null }))
  }
  const pages = reads.map((read): SourcePage<ScanActivityItem> | null =>
    read === null || read.status !== "ok"
      ? null
      : { rows: read.data.data, next: read.data.nextCursor },
  )
  const merged = mergePages(places, pages, tabLimit)
  const context = { tokens: tokenLookup(), labels: labelMapOf(names) }
  const skipped = reads.reduce(
    (sum, read) =>
      sum + (read !== null && read.status === "ok" ? read.skipped : 0),
    0,
  )
  return {
    status: "ok",
    data: {
      rows: activityViews(merged.rows, context),
      next: merged.next === null ? null : encodePlaces(merged.next),
    },
    ...(skipped > 0 ? { skipped } : {}),
  }
}

export type TransactionsPage =
  | { tab: "all"; list: Section<AllTransactions> }
  | {
      tab: Exclude<TxTab, "all">
      list: Section<ActivityTab>
    }

export async function transactionsPage(input: {
  tab: TxTab
  cursor: Record<string, unknown>
}): Promise<TransactionsPage> {
  setCacheClass("list")
  if (input.tab === "all") {
    return { tab: "all", list: await allTransactions(input.cursor) }
  }
  const tab = input.tab in txTabActions ? input.tab : "votes"
  const raw = input.cursor.cursor
  return {
    tab,
    list: await activityTab(
      txTabActions[tab],
      typeof raw === "string" ? raw : null,
    ),
  }
}
