import {
  addressCountersSchema,
  addressSchema,
  blockSchema,
  logsPageSchema,
  transactionSchema,
  transactionsPageSchema,
} from "@matchbox/contracts/blockscout"
import type { ScanMorphoMarket, ScanPartReason } from "@matchbox/contracts/scan"
import { formatUnits, formatUsd } from "@matchbox/domain/format"
import { setCacheClass } from "../cache-class.server"
import { transactionCount } from "./address-counts"
import { type Read, readBlockscout } from "./blockscout/read.server"
import { canonicalQuery, degrade } from "./caller.server"
import { nowSeconds } from "./clock.server"
import { pickCursor } from "./cursors"
import type { Entity, Section } from "./explorer"
import {
  type ActivityView,
  activityView,
  activityViews,
  headline,
  type LabelMap,
  type SentencePart,
} from "./scan/activity-view"
import {
  type EnclavePositionView,
  enclavePositionView,
  type MorphoPositionView,
  marketsById,
  marketView,
  morphoPositionView,
  type TroveView,
  troveView,
} from "./scan/borrow-views"
import { attachLabels } from "./scan/labels"
import { type LockView, lockView } from "./scan/lock-views"
import { readBudgetMs, readScan, skippedOf } from "./scan/read.server"
import { scanSchemas } from "./scan/schemas"
import { type TokenInfo, tokenLookup } from "./scan/tokens"
import { loanRefs, type TxLoanView } from "./scan/tx-loan"
import { txLoan } from "./scan/tx-loan.server"
import {
  type AddressLabel,
  type AddressSummary,
  addressSummary,
  type BlockDetail,
  blockDetail,
  cursorOf,
  type LogView,
  liveLogViews,
  liveTxDetail,
  logView,
  type Page,
  rawUnits,
  type TokenBalance,
  type TokenBalances,
  type TxDetail,
  type TxRow,
  txDetail,
  txRow,
} from "./views"

/**
 * The entity pages read one composed document each from the API
 * (`/internal/scan/entities/tx|address|block`): the Blockscout parts, our
 * decoded activity, locks, loans and labels in one subrequest. Each part
 * degrades on its own exactly as the separate reads did. A document with
 * any unavailable part is not stored (degrade); a final one is kept long.
 *
 * Until the API's database is bound, the documents answer 503 as a whole
 * (the composer reads SCAN_DB first). Then the page reads the Blockscout
 * proxy directly, as before, and our parts show "Not available yet".
 */

type Part<T> =
  | { status: "ok"; data: T }
  | { status: "unavailable"; reason: ScanPartReason }

/** The fixture world's now in fixtures mode, else the clock. */
function now(): number {
  return nowSeconds()
}

/** A part as a section; any unavailable part marks the page degraded. */
function partSection<In, Out>(
  part: Part<In>,
  map: (data: In) => Out,
): Section<Out> {
  if (part.status === "ok") {
    const skipped = skippedOf(part.data)
    return {
      status: "ok",
      data: map(part.data),
      ...(skipped > 0 ? { skipped } : {}),
    }
  }
  degrade()
  if (part.reason === "rate_limited") return { status: "rate-limited" }
  if (part.reason === "disabled") return { status: "disabled" }
  return { status: "unavailable" }
}

/** The page's own part: not found makes it the page's 404. */
function partEntity<In, Out>(
  part: Part<In>,
  map: (data: In) => Out,
): Entity<Out> {
  if (part.status === "unavailable" && part.reason === "not_found") {
    return { status: "missing" }
  }
  return partSection(part, map)
}

function readSection<In, Out>(
  read: Read<In>,
  map: (data: In) => Out,
): Section<Out> {
  if (read.status === "ok") return { status: "ok", data: map(read.data) }
  if (read.status === "rate-limited") return { status: "rate-limited" }
  return { status: "unavailable" }
}

function readEntity<In, Out>(
  read: Read<In>,
  map: (data: In) => Out,
): Entity<Out> {
  if (read.status === "missing") return { status: "missing" }
  return readSection(read, map)
}

const disabled = { status: "disabled" } as const

/** Tokens a page's own Blockscout transfers name, with their decimals. */
function transferTokens(
  transfers: readonly {
    token: {
      address_hash: string
      symbol: string | null
      decimals: string | null
    }
  }[],
): Record<string, TokenInfo> {
  const out: Record<string, TokenInfo> = {}
  for (const transfer of transfers) {
    const { address_hash, symbol, decimals } = transfer.token
    if (symbol !== null && decimals !== null) {
      out[address_hash.toLowerCase()] = { symbol, decimals: Number(decimals) }
    }
  }
  return out
}

// -- transaction ----------------------------------------------------------

export type Headline = { parts: SentencePart[]; text: string; decoded: boolean }

export type TxPage = {
  tx: Entity<TxDetail>
  logs: Section<LogView[]>
  /** Our decoded rows for this transaction, in plain words. */
  activity: Section<ActivityView[]>
  /** The page title: the first decoded action, else the decoded method. */
  headline: Headline | null
  final: boolean
  /**
   * The document names at most this many distinct addresses (the API's
   * labelLimit) and named more: the rest show as addresses. Null when all
   * were named.
   */
  labelsCapped: number | null
  /**
   * The loan the transaction moved (tx-loan): its title, what changed and
   * the position. Null when its logs name no loan Scan knows.
   */
  loan: Section<TxLoanView> | null
  /**
   * Still on its way into our data, from the API's live read: `pending`
   * (in the mempool) and `mined` (in a block the explorer has not
   * indexed) are drawn from the chain; `indexing` has the explorer's page
   * with our rows read from the chain. The page re-reads until null.
   */
  live: LiveState
}

export type LiveState = "pending" | "mined" | "indexing" | null

async function txFromProxy(hash: string): Promise<TxPage> {
  const [tx, logs] = await Promise.all([
    readBlockscout(
      `transactions/${hash}`,
      new URLSearchParams(),
      transactionSchema,
    ),
    readBlockscout(
      `transactions/${hash}/logs`,
      new URLSearchParams(),
      logsPageSchema,
    ),
  ])
  const detail = readEntity(tx, txDetail)
  return {
    tx: detail,
    logs: readSection(logs, (page) => page.items.map(logView)),
    activity: disabled,
    headline:
      detail.status === "ok"
        ? headline([], detail.data.method, {
            tokens: tokenLookup(),
            labels: {},
          })
        : null,
    final: false,
    labelsCapped: null,
    loan: null,
    live: null,
  }
}

export async function transactionPage(data: { hash: string }): Promise<TxPage> {
  if (!/^0x[0-9a-f]{64}$/.test(data.hash)) {
    return {
      tx: { status: "missing" },
      logs: { status: "unavailable" },
      activity: { status: "unavailable" },
      headline: null,
      final: false,
      labelsCapped: null,
      loan: null,
      live: null,
    }
  }
  const read = await readScan(
    `entities/tx/${data.hash}`,
    new URLSearchParams(),
    scanSchemas.txDocument,
  )
  if (read.status === "disabled") {
    setCacheClass("fresh")
    return txFromProxy(data.hash)
  }
  if (read.status !== "ok") {
    setCacheClass("fresh")
    const state =
      read.status === "rate-limited"
        ? ({ status: "rate-limited" } as const)
        : ({ status: "unavailable" } as const)
    return {
      tx: read.status === "missing" ? { status: "missing" } : state,
      logs: state,
      activity: state,
      headline: null,
      final: false,
      labelsCapped: null,
      loan: null,
      live: null,
    }
  }
  const doc = read.data.data
  const labels: LabelMap = doc.labels
  const tokens = tokenLookup(
    doc.tokenTransfers.status === "ok"
      ? transferTokens(doc.tokenTransfers.data.items)
      : {},
  )
  const context = { tokens, labels }
  const live = doc.live?.status === "ok" ? doc.live.data : null
  // The explorer lacks it but the chain has it: drawn from the chain.
  const chainOnly =
    doc.transaction.status === "unavailable" &&
    doc.transaction.reason === "not_found" &&
    live !== null &&
    live.state !== "unknown"
  const liveDetail = chainOnly ? liveTxDetail(data.hash, live) : null
  const tx: Entity<TxDetail> =
    liveDetail === null
      ? partEntity(doc.transaction, txDetail)
      : { status: "ok", data: liveDetail }
  const indexed = doc.activity.status === "ok" ? doc.activity.data : []
  // Our rows as the chain gives them, until the copy has written them.
  const activityRows =
    indexed.length === 0 && live !== null ? live.activity : indexed
  // A loan the logs name: read through the position's own routes.
  const refs =
    doc.logs.status === "ok"
      ? loanRefs(
          doc.logs.data.items.map((log) => ({
            address: log.address.hash,
            topics: log.topics,
          })),
        )
      : []
  const loan = refs.length === 0 ? null : await txLoan(data.hash, refs)
  const activity: Section<ActivityView[]> =
    live !== null && indexed.length === 0
      ? {
          status: "ok",
          data: live.activity.map((row) => activityView(row, context)),
        }
      : partSection(doc.activity, (rows) =>
          rows.map((row) => activityView(row, context)),
        )
  const page: TxPage = {
    tx,
    logs:
      liveDetail === null
        ? partSection(doc.logs, (logs) => logs.items.map(logView))
        : { status: "ok", data: live === null ? [] : liveLogViews(live) },
    activity,
    headline:
      tx.status === "ok"
        ? headline(activityRows, tx.data.method, context)
        : null,
    final: doc.final,
    labelsCapped: doc.labelsTruncated === true ? (doc.labelLimit ?? 50) : null,
    loan,
    // Sent (read or not) only while our data has yet to catch up.
    live:
      doc.live === undefined
        ? null
        : liveDetail === null
          ? "indexing"
          : liveDetail.pending
            ? "pending"
            : "mined",
  }
  // A loan's position moves on: the page is kept as a fresh one. One on
  // its way in changes every block.
  setCacheClass(
    page.live !== null
      ? "list"
      : doc.final && loan === null
        ? "final"
        : "fresh",
  )
  return attachLabels(page, labels)
}

// -- block ----------------------------------------------------------------

export type BlockPage = {
  block: Entity<BlockDetail>
  transactions: Section<Page<TxRow>>
  final: boolean
  /**
   * The document names at most this many distinct addresses (the API's
   * labelLimit) and named more: the rest show as addresses. Null when all
   * were named.
   */
  labelsCapped: number | null
}

const blockId = /^(\d{1,12}|0x[0-9a-f]{64})$/

export async function blockPage(data: {
  id: string
  cursor: Record<string, unknown>
}): Promise<BlockPage> {
  if (!blockId.test(data.id)) {
    return {
      block: { status: "missing" },
      transactions: { status: "unavailable" },
      final: false,
      labelsCapped: null,
    }
  }
  const cursor = pickCursor("blockTransactions", data.cursor)
  // A later page of transactions is not in the document: read it from
  // the proxy beside the document's block.
  const [read, later] = await Promise.all([
    readScan(
      `entities/block/${data.id}`,
      new URLSearchParams(),
      scanSchemas.blockDocument,
    ),
    cursor === null
      ? Promise.resolve(null)
      : readBlockscout(
          `blocks/${data.id}/transactions`,
          canonicalQuery(cursor),
          transactionsPageSchema,
        ),
  ])
  const laterPage =
    later === null
      ? null
      : readSection(later, (page) => ({
          items: page.items.map(txRow),
          next: cursorOf(page.next_page_params),
        }))
  if (read.status === "disabled") {
    setCacheClass("fresh")
    const [block, transactions] = await Promise.all([
      readBlockscout(`blocks/${data.id}`, new URLSearchParams(), blockSchema),
      laterPage === null
        ? readBlockscout(
            `blocks/${data.id}/transactions`,
            new URLSearchParams(),
            transactionsPageSchema,
          )
        : Promise.resolve(null),
    ])
    return {
      block: readEntity(block, blockDetail),
      transactions:
        laterPage ??
        (transactions === null
          ? { status: "unavailable" }
          : readSection(transactions, (page) => ({
              items: page.items.map(txRow),
              next: cursorOf(page.next_page_params),
            }))),
      final: false,
      labelsCapped: null,
    }
  }
  if (read.status !== "ok") {
    setCacheClass("fresh")
    const state =
      read.status === "rate-limited"
        ? ({ status: "rate-limited" } as const)
        : ({ status: "unavailable" } as const)
    return {
      block: read.status === "missing" ? { status: "missing" } : state,
      transactions: state,
      final: false,
      labelsCapped: null,
    }
  }
  const doc = read.data.data
  const page: BlockPage = {
    block: partEntity(doc.block, blockDetail),
    transactions:
      laterPage ??
      partSection(doc.transactions, (transactions) => ({
        items: transactions.items.map(txRow),
        next: cursorOf(transactions.next_page_params),
      })),
    final: doc.final && laterPage === null,
    labelsCapped: doc.labelsTruncated === true ? (doc.labelLimit ?? 50) : null,
  }
  setCacheClass(page.final ? "final" : "fresh")
  return attachLabels(page, doc.labels)
}

// -- address --------------------------------------------------------------

export type BorrowView = {
  trove: TroveView | null
  morpho: MorphoPositionView[]
  enclave: EnclavePositionView[]
}

export type AddressDocument = {
  summary: Entity<AddressSummary>
  transactionCount: string | null
  transferCount: string | null
  label: AddressLabel | null
  locks: Section<{ items: LockView[]; more: boolean }>
  borrow: Section<BorrowView>
  /**
   * Whether the live snapshot behind the loans is stale, from the borrow
   * part's own `snapshot`. Null when the answer carries none (an older API,
   * or no borrow part) or it cannot tell (`stale` null, the block or the
   * head unknown): the page then asks /status.
   */
  borrowDelayed: boolean | null
  /** The first page of our activity for the address. */
  activity: Section<Page<ActivityView>>
  /**
   * The first page of ERC-20 balances, with USD values (the document's
   * `tokens` part); null when the answer has no such part (the page then
   * reads the balances through the proxy).
   */
  tokens: Section<TokenBalances> | null
}

async function addressFromProxy(address: string): Promise<AddressDocument> {
  const [summary, counters] = await Promise.all([
    readBlockscout(
      `addresses/${address}`,
      new URLSearchParams(),
      addressSchema,
    ),
    readBlockscout(
      `addresses/${address}/counters`,
      new URLSearchParams(),
      addressCountersSchema,
    ),
  ])
  return {
    summary: readEntity(summary, addressSummary),
    transactionCount:
      counters.status === "ok"
        ? transactionCount(
            counters.data.transactions_count,
            summary.status === "ok"
              ? summary.data.creation_transaction_hash
              : null,
          )
        : null,
    transferCount:
      counters.status === "ok" ? counters.data.token_transfers_count : null,
    label: null,
    locks: disabled,
    borrow: disabled,
    borrowDelayed: null,
    activity: disabled,
    tokens: null,
  }
}

/** A Scan keyset cursor as page search params. */
export function scanCursorOf(
  next: string | null,
): Record<string, string> | null {
  return next === null ? null : { cursor: next }
}

function marketViewOf(market: ScanMorphoMarket | undefined) {
  return market === undefined ? null : marketView(market)
}

/**
 * A document whose part failed before this is read once more
 * (`addressDocument`); the API cuts a slow part at 2.4 s.
 */
export const partRetryBeforeMs = 1_500

/** A part as the address document carries it. */
type PartState = { status: string; reason?: string | undefined }

/** Whether a part of the address document failed in passing. */
export function passingPart(doc: {
  summary: PartState
  counters: PartState
  locks: PartState
  borrow: PartState
  activity: PartState
  tokens?: PartState | undefined
}): boolean {
  return [
    doc.summary,
    doc.counters,
    doc.locks,
    doc.borrow,
    doc.activity,
    ...(doc.tokens === undefined ? [] : [doc.tokens]),
  ].some((part) => part.status === "unavailable" && part.reason === "upstream")
}

export async function addressDocument(data: {
  address: string
}): Promise<AddressDocument> {
  setCacheClass("fresh")
  if (!/^0x[0-9a-f]{40}$/.test(data.address)) {
    return {
      summary: { status: "missing" },
      transactionCount: null,
      transferCount: null,
      label: null,
      locks: { status: "unavailable" },
      borrow: { status: "unavailable" },
      borrowDelayed: null,
      activity: { status: "unavailable" },
      tokens: { status: "unavailable" },
    }
  }
  // The market list beside the document, in the same round: the borrow
  // part lists Morpho positions without their market, and a discovered
  // market's name and decimals are only in the list.
  const started = Date.now()
  const path = `entities/address/${data.address}`
  const [first, marketList] = await Promise.all([
    readScan(path, new URLSearchParams(), scanSchemas.addressDocument),
    readScan("borrow/markets", new URLSearchParams(), scanSchemas.markets),
  ])
  let read = first
  // A part that failed fast in passing (a D1 error, a Blockscout 5xx) is
  // asked for once more, with the rest of the read's budget. Not one the
  // API cut at its deadline: asking again would only wait again, and its
  // read is finishing in the API for the next request.
  const spent = Date.now() - started
  if (
    first.status === "ok" &&
    passingPart(first.data.data) &&
    spent < partRetryBeforeMs
  ) {
    const again = await readScan(
      path,
      new URLSearchParams(),
      scanSchemas.addressDocument,
      readBudgetMs - spent,
    )
    if (again.status === "ok") read = again
  }
  const markets = marketsById(
    marketList.status === "ok" ? marketList.data.data : null,
  )
  if (read.status === "disabled") return addressFromProxy(data.address)
  if (read.status !== "ok") {
    const state =
      read.status === "rate-limited"
        ? ({ status: "rate-limited" } as const)
        : ({ status: "unavailable" } as const)
    return {
      summary: read.status === "missing" ? { status: "missing" } : state,
      transactionCount: null,
      transferCount: null,
      label: null,
      locks: state,
      borrow: state,
      borrowDelayed: null,
      activity: state,
      tokens: null,
    }
  }
  const doc = read.data.data
  const at = now()
  // Names for what the parts name (the address first); an answer from
  // before the API sent them labels only the address.
  const labels: LabelMap =
    doc.labels ?? (doc.label === null ? {} : { [doc.label.address]: doc.label })
  const context = { tokens: tokenLookup(), labels, viewer: data.address }
  const document: AddressDocument = {
    summary: partEntity(doc.summary, addressSummary),
    transactionCount:
      doc.counters.status === "ok"
        ? transactionCount(
            doc.counters.data.transactions_count,
            doc.summary.status === "ok"
              ? doc.summary.data.creation_transaction_hash
              : null,
          )
        : null,
    transferCount:
      doc.counters.status === "ok"
        ? doc.counters.data.token_transfers_count
        : null,
    label:
      doc.label === null
        ? null
        : {
            name: doc.label.name,
            kind: doc.label.kind,
            tags: doc.label.tags,
          },
    locks: partSection(doc.locks, (page) => ({
      items: page.data.map((lock) => lockView(lock, at)),
      more: page.nextCursor !== null,
    })),
    borrow: partSection(doc.borrow, (positions) => ({
      trove: positions.trove === null ? null : troveView(positions.trove),
      morpho: positions.morpho.map((position) =>
        morphoPositionView(
          position,
          marketViewOf(markets.get(position.market_id)),
        ),
      ),
      // The API lists each Enclave position the borrower ever had by its
      // latest event; one whose latest event closed it is not a loan now.
      enclave: positions.enclave
        .filter((position) => position.latest.action !== "POSITION_CLOSED")
        .map((position) =>
          enclavePositionView(position.position_id, position.latest),
        ),
    })),
    borrowDelayed:
      doc.borrow.status === "ok" ? (doc.borrow.snapshot?.stale ?? null) : null,
    activity: partSection(doc.activity, (page) => ({
      items: activityViews(page.data, context),
      next: scanCursorOf(page.nextCursor),
    })),
    tokens:
      doc.tokens === undefined
        ? null
        : partSection(doc.tokens, (part) => ({
            items: part.items.map(documentTokenBalance),
            more: part.next_page_params !== null,
          })),
  }
  return attachLabels(document, labels)
}

/**
 * A balance from the address document's `tokens` part: the API's own
 * decimals and its USD value, priced as BTC, MEZO or an assumed $1
 * (`priced_as: "usd"`, labelled so); unpriced balances have none.
 */
export function documentTokenBalance(item: {
  token: {
    address: string
    symbol: string | null
    name: string | null
    decimals: number | null
  }
  value: string
  value_usd: string | null
  priced_as: "btc" | "mezo" | "usd" | null
}): TokenBalance {
  const decimals = item.token.decimals
  return {
    address: item.token.address.toLowerCase(),
    symbol: item.token.symbol,
    name: item.token.name,
    type: "ERC-20",
    amount:
      decimals === null
        ? rawUnits(item.value)
        : formatUnits(item.value, decimals),
    usd:
      item.value_usd === null || item.priced_as === null
        ? null
        : formatUsd(item.value_usd, "whole"),
    usdAssumed: item.priced_as === "usd",
  }
}
