import {
  addressCountersSchema,
  addressSchema,
  type BlockscoutAddressRef,
  type BlockscoutTokenRef,
  type BlockscoutTokenTransfer,
  type BlockscoutTransactionSummary,
  blockSchema,
  blocksPageSchema,
  internalTransactionsPageSchema,
  logsPageSchema,
  mainPageBlocksSchema,
  mainPageTransactionsSchema,
  marketChartSchema,
  searchPageSchema,
  searchQuickSchema,
  smartContractSchema,
  statsSchema,
  tokenBalancesPageSchema,
  tokenCountersSchema,
  tokenHoldersPageSchema,
  tokenSchema,
  tokensPageSchema,
  tokenTransfersPageSchema,
  transactionSchema,
  transactionsChartSchema,
  transactionsPageSchema,
} from "@matchbox/contracts/blockscout"
import { z } from "zod"
import { traceSummaryFromRaw } from "./trace"

// The allowlist: every Blockscout path the proxy serves, the query
// parameters each one takes, the schema that validates and trims its body,
// and how fresh the result must be. Anything else is a 404 (unknown path)
// or 400 (unknown, repeated, malformed or partial parameters). Not a
// passthrough.

/**
 * How a stored answer is kept (README, "Cache classes"):
 * - `immutable`: final and settled chain data, a year.
 * - `final`: final chain data whose Blockscout enrichment (decoding,
 *   verification, token metadata) may still change, a day.
 * - `per-block`: re-read when the head moves (lists that change every
 *   block; transaction lists skip blocks proven idle).
 * - `swr`: address views, served at once and refreshed in the background
 *   at most once per N blocks, and not at all over idle blocks.
 * - `search`: 45 seconds.
 * - `slow`: the route's TTL (5 to 15 minutes).
 */
export type CacheClass =
  | "immutable"
  | "final"
  | "per-block"
  | "swr"
  | "search"
  | "slow"

/** What the proxy knows about the chain when it classifies a body. */
export type HeadContext = {
  /** Current head, or null when BlockHub could not be read in time. */
  height: number | null
  /** Blocks behind the head before Blockscout's copy is treated as final. */
  finalityDepth: number
  /**
   * Blockscout's own `finished_indexing_blocks` (main-page/indexing-status):
   * false or unknown while it backfills a gap, when an older page can be
   * missing blocks it has not indexed yet.
   */
  blocksIndexed?: boolean | null
}

/** A page past the first: its keyset cursor's block, when it has one. */
export type HistoryCursor = { block: number | null }

export type Freshness =
  /** Classified per body: immutable, final or per-block. */
  | { kind: "chain" }
  /** Per block; `skipIdle` keeps an entry over blocks with no activity. */
  | { kind: "per-block"; skipIdle: boolean }
  | { kind: "swr" }
  | { kind: "ttl"; cacheClass: "search" | "slow"; seconds: number }

type ParamRule = {
  pattern: RegExp
  /** Lower-cased before keying and forwarding (hashes, addresses). */
  lower?: true
}

export type ProxyRoute = {
  /** Path template, for logs and the README table. */
  template: string
  pattern: RegExp
  /** Optional filters, each on its own. */
  filters: Readonly<Record<string, ParamRule>>
  /**
   * Keyset cursor: Blockscout's `next_page_params` for this route. All of
   * them or none; `items_count` may accompany a complete cursor.
   */
  cursor: Readonly<Record<string, ParamRule>>
  required: readonly string[]
  freshness: Freshness
  /** Pages past the first may be kept long (a `history` verdict). */
  historyPages: boolean
  /**
   * Validates and trims an upstream body, then classifies it. `cursor`:
   * the request carried the keyset cursor, so on a route with a `history`
   * verdict the page is older history that a final head settles.
   */
  decode: (
    raw: unknown,
    head: HeadContext,
    cursor?: HistoryCursor | null,
  ) =>
    | { ok: true; body: unknown; cacheClass: CacheClass }
    | { ok: false; error: z.ZodError }
}

/** Whether a block is final at `head` by our RPC head. */
export function isFinal(block: number, head: HeadContext): boolean {
  return head.height !== null && block <= head.height - head.finalityDepth
}

/**
 * Whether an older page can be kept past the head: Blockscout reports its
 * blocks indexed (a catch-up that restarts at the head backfills a gap
 * later, and a page spanning it would miss those blocks) and the cursor's
 * block is final. Blockscout's flag is true from 99% indexed, so this is a
 * guard, not proof: such pages are kept a day, never a year.
 */
function historySettles(cursor: HistoryCursor, head: HeadContext): boolean {
  return (
    head.blocksIndexed === true &&
    cursor.block !== null &&
    isFinal(cursor.block, head)
  )
}

/**
 * Blockscout's own view: `confirmations` counts from Blockscout's latest
 * indexed block, so a transaction is final for Blockscout only once it has
 * indexed `finalityDepth` blocks past it.
 */
function confirmedByBlockscout(
  confirmations: number | null | undefined,
  head: HeadContext,
): boolean {
  return (
    confirmations === null ||
    confirmations === undefined ||
    confirmations > head.finalityDepth
  )
}

/** An embedded address whose name tags and verification are settled. */
export function refSettled(ref: BlockscoutAddressRef | null): boolean {
  if (ref === null) return true
  return ref.is_contract === false || ref.is_verified === true
}

export function tokenSettled(token: BlockscoutTokenRef): boolean {
  return token.name !== null && token.symbol !== null && token.decimals !== null
}

function transferSettled(transfer: BlockscoutTokenTransfer): boolean {
  return (
    tokenSettled(transfer.token) &&
    refSettled(transfer.from) &&
    refSettled(transfer.to)
  )
}

const undecodedMethod = /^0x[0-9a-f]{8}$/i

function summarySettled(transaction: BlockscoutTransactionSummary): boolean {
  return (
    refSettled(transaction.from) &&
    refSettled(transaction.to) &&
    refSettled(transaction.created_contract) &&
    !(
      transaction.to?.is_contract === true &&
      transaction.method !== null &&
      undecodedMethod.test(transaction.method)
    )
  )
}

/** Raw `confirmations`, read beside the trimmed body (it is not served). */
const rawConfirmationsSchema = z.object({
  confirmations: z.number().int().nullish(),
})
const rawPageConfirmationsSchema = z.object({
  items: z.array(rawConfirmationsSchema),
})

type ChainVerdict = { final: boolean; settled: boolean }

type RouteSpec<Output> = {
  template: string
  pattern: RegExp
  filters?: Record<string, ParamRule>
  cursor?: Record<string, ParamRule>
  required?: readonly string[]
  schema: z.ZodType<Output>
} & (
  | {
      freshness: Exclude<Freshness, { kind: "chain" }>
      /**
       * Pages past the first (keyset cursor given) of an address list:
       * every item is older than the cursor, so once they are all final,
       * the cursor's block is final and Blockscout reports every block
       * indexed (no gap it is still backfilling), the page cannot change
       * and is kept like other final chain data. The first page keeps the
       * route's freshness.
       */
      history?: (body: Output, head: HeadContext, raw: unknown) => ChainVerdict
    }
  | {
      freshness: { kind: "chain" }
      verdict: (body: Output, head: HeadContext, raw: unknown) => ChainVerdict
    }
)

function staticClass(freshness: Exclude<Freshness, { kind: "chain" }>) {
  if (freshness.kind === "ttl") return freshness.cacheClass
  return freshness.kind
}

function route<Output>(spec: RouteSpec<Output>): ProxyRoute {
  return {
    template: spec.template,
    pattern: spec.pattern,
    filters: spec.filters ?? {},
    cursor: spec.cursor ?? {},
    required: spec.required ?? [],
    freshness: spec.freshness,
    historyPages: "history" in spec && spec.history !== undefined,
    decode(raw, head, cursor = null) {
      const parsed = spec.schema.safeParse(raw)
      if (!parsed.success) return { ok: false, error: parsed.error }
      if (!("verdict" in spec)) {
        const history =
          cursor !== null &&
          historySettles(cursor, head) &&
          "history" in spec &&
          spec.history !== undefined
            ? spec.history(parsed.data, head, raw)
            : null
        // Kept a day at most, never a year, settled or not: Blockscout
        // reports every block indexed at 99% (a gap of up to about 130k
        // blocks), so a page spanning a gap it backfills later heals
        // within a day.
        if (history?.final === true) {
          return { ok: true, body: parsed.data, cacheClass: "final" }
        }
        return {
          ok: true,
          body: parsed.data,
          cacheClass: staticClass(spec.freshness),
        }
      }
      const { final, settled } = spec.verdict(parsed.data, head, raw)
      let cacheClass: CacheClass = "per-block"
      if (final) cacheClass = settled ? "immutable" : "final"
      return { ok: true, body: parsed.data, cacheClass }
    },
  }
}

const address = "0x[0-9a-f]{40}"
const hash = "0x[0-9a-f]{64}"
/** A block height (below 2^53) or a block hash. */
const blockId = `(?:0|[1-9][0-9]{0,15}|${hash})`

function path(source: string): RegExp {
  return new RegExp(`^${source}$`)
}

/** Query parameter shapes. */
const value = {
  integer: { pattern: /^(0|[1-9][0-9]{0,15})$/ },
  /** uint256 in base 10 (keyset cursors on value and fee). */
  bigInteger: { pattern: /^(0|[1-9][0-9]{0,77})$/ },
  hash: { pattern: /^0x[0-9a-fA-F]{64}$/, lower: true },
  address: { pattern: /^0x[0-9a-fA-F]{40}$/, lower: true },
  timestamp: { pattern: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/ },
  tokenTypes: {
    pattern:
      /^(ERC-20|ERC-721|ERC-1155|ERC-404)(,(ERC-20|ERC-721|ERC-1155|ERC-404)){0,3}$/,
  },
  direction: { pattern: /^(to|from)$/ },
  /** A cursor field that may be a decimal or null. */
  decimalOrNull: { pattern: /^(null|(0|[1-9][0-9]{0,77})(\.[0-9]{1,36})?)$/ },
  boolean: { pattern: /^(true|false)$/ },
  /** Free text: 1 to 100 characters, no control characters. */
  text: { pattern: /^[^\p{Cc}]{1,100}$/u },
  textOrNull: { pattern: /^[^\p{Cc}]{1,100}$/u },
  blockType: { pattern: /^(block|uncle|reorg)$/ },
} as const satisfies Record<string, ParamRule>

/** Keyset cursor of block- and index-ordered lists. */
const blockIndexCursor = {
  block_number: value.integer,
  index: value.integer,
}

function allFinal(
  blocks: readonly (number | null)[],
  head: HeadContext,
): boolean {
  return (
    blocks.length > 0 &&
    blocks.every((block) => block !== null && isFinal(block, head))
  )
}

/** A page of transaction summaries (block transactions). */
function transactionPageVerdict(
  page: { items: BlockscoutTransactionSummary[] },
  head: HeadContext,
  raw: unknown,
): ChainVerdict {
  const confirmations = rawPageConfirmationsSchema.safeParse(raw)
  const blockscoutFinal =
    confirmations.success &&
    confirmations.data.items.every((item) =>
      confirmedByBlockscout(item.confirmations, head),
    )
  return {
    // Empty pages are never final: during a Blockscout catch-up they may
    // only be empty because the block is not indexed yet.
    final:
      blockscoutFinal &&
      allFinal(
        page.items.map((item) => item.block_number),
        head,
      ),
    settled: page.items.every(summarySettled),
  }
}

/** A page of token transfers: final once every transfer's block is. */
function transferPageHistory(
  page: { items: BlockscoutTokenTransfer[] },
  head: HeadContext,
): ChainVerdict {
  return {
    final: allFinal(
      page.items.map((item) => item.block_number),
      head,
    ),
    settled: page.items.every(transferSettled),
  }
}

export const proxyRoutes: readonly ProxyRoute[] = [
  route({
    template: "blocks",
    pattern: path("blocks"),
    filters: { type: value.blockType },
    cursor: { block_number: value.integer },
    schema: blocksPageSchema,
    freshness: { kind: "per-block", skipIdle: false },
  }),
  route({
    template: "blocks/{block}",
    pattern: path(`blocks/(${blockId})`),
    schema: blockSchema,
    freshness: { kind: "chain" },
    verdict: (block, head) => ({
      final: block.is_pending_update !== true && isFinal(block.height, head),
      settled: refSettled(block.miner),
    }),
  }),
  route({
    template: "blocks/{block}/transactions",
    pattern: path(`blocks/(${blockId})/transactions`),
    cursor: blockIndexCursor,
    schema: transactionsPageSchema,
    freshness: { kind: "chain" },
    verdict: transactionPageVerdict,
  }),
  route({
    template: "transactions",
    pattern: path("transactions"),
    cursor: blockIndexCursor,
    schema: transactionsPageSchema,
    freshness: { kind: "per-block", skipIdle: true },
  }),
  route({
    template: "transactions/{hash}",
    pattern: path(`transactions/(${hash})`),
    schema: transactionSchema,
    freshness: { kind: "chain" },
    verdict: (transaction, head, raw) => {
      const confirmations = rawConfirmationsSchema.safeParse(raw)
      return {
        final:
          transaction.block_number !== null &&
          transaction.status !== null &&
          transaction.is_pending_update !== true &&
          isFinal(transaction.block_number, head) &&
          confirmations.success &&
          confirmedByBlockscout(confirmations.data.confirmations, head),
        settled:
          summarySettled(transaction) &&
          transaction.has_error_in_internal_transactions !== null &&
          (transaction.decoded_input !== null ||
            transaction.raw_input === "0x" ||
            transaction.to === null ||
            transaction.to.is_contract === false) &&
          (transaction.token_transfers ?? []).every(transferSettled),
      }
    },
  }),
  route({
    template: "transactions/{hash}/logs",
    pattern: path(`transactions/(${hash})/logs`),
    cursor: blockIndexCursor,
    schema: logsPageSchema,
    freshness: { kind: "chain" },
    verdict: (page, head) => ({
      final: allFinal(
        page.items.map((item) => item.block_number),
        head,
      ),
      settled: page.items.every(
        (log) => log.decoded !== null && refSettled(log.address),
      ),
    }),
  }),
  route({
    template: "transactions/{hash}/token-transfers",
    pattern: path(`transactions/(${hash})/token-transfers`),
    filters: { type: value.tokenTypes },
    cursor: blockIndexCursor,
    schema: tokenTransfersPageSchema,
    freshness: { kind: "chain" },
    verdict: (page, head) => ({
      final: allFinal(
        page.items.map((item) => item.block_number),
        head,
      ),
      settled: page.items.every(transferSettled),
    }),
  }),
  route({
    template: "transactions/{hash}/internal-transactions",
    pattern: path(`transactions/(${hash})/internal-transactions`),
    cursor: { ...blockIndexCursor, transaction_index: value.integer },
    schema: internalTransactionsPageSchema,
    freshness: { kind: "chain" },
    // Blockscout indexes internal transactions far behind the head; a page
    // is final only once its meta says the range is processed.
    verdict: (page, head) => ({
      final:
        (page.meta === null ||
          page.meta === undefined ||
          page.meta.status === 1) &&
        allFinal(
          page.items.map((item) => item.block_number),
          head,
        ),
      settled: page.items.every(
        (item) =>
          refSettled(item.from) &&
          refSettled(item.to) &&
          refSettled(item.created_contract),
      ),
    }),
  }),
  route({
    template: "transactions/{hash}/raw-trace",
    pattern: path(`transactions/(${hash})/raw-trace`),
    schema: traceSummaryFromRaw,
    freshness: { kind: "chain" },
    // A trace exists only for an included transaction (Mezo's blocks are
    // final once produced) and carries no Blockscout enrichment.
    verdict: (trace) => ({ final: trace.frames.length > 0, settled: true }),
  }),
  route({
    template: "addresses/{address}",
    pattern: path(`addresses/(${address})`),
    schema: addressSchema,
    freshness: { kind: "swr" },
  }),
  route({
    template: "addresses/{address}/counters",
    pattern: path(`addresses/(${address})/counters`),
    schema: addressCountersSchema,
    freshness: { kind: "swr" },
  }),
  route({
    template: "addresses/{address}/transactions",
    pattern: path(`addresses/(${address})/transactions`),
    filters: { filter: value.direction },
    cursor: {
      ...blockIndexCursor,
      value: value.bigInteger,
      hash: value.hash,
      inserted_at: value.timestamp,
      fee: value.bigInteger,
    },
    schema: transactionsPageSchema,
    freshness: { kind: "swr" },
    history: transactionPageVerdict,
  }),
  route({
    template: "addresses/{address}/token-transfers",
    pattern: path(`addresses/(${address})/token-transfers`),
    filters: {
      type: value.tokenTypes,
      filter: value.direction,
      token: value.address,
    },
    cursor: blockIndexCursor,
    schema: tokenTransfersPageSchema,
    freshness: { kind: "swr" },
    history: transferPageHistory,
  }),
  route({
    template: "addresses/{address}/tokens",
    pattern: path(`addresses/(${address})/tokens`),
    filters: { type: value.tokenTypes },
    cursor: {
      value: value.decimalOrNull,
      id: value.integer,
      fiat_value: value.decimalOrNull,
    },
    schema: tokenBalancesPageSchema,
    freshness: { kind: "swr" },
  }),
  route({
    template: "addresses/{address}/logs",
    pattern: path(`addresses/(${address})/logs`),
    filters: { topic: value.hash },
    cursor: blockIndexCursor,
    schema: logsPageSchema,
    freshness: { kind: "swr" },
    history: (page, head) => ({
      final: allFinal(
        page.items.map((item) => item.block_number),
        head,
      ),
      settled: page.items.every(
        (log) => log.decoded !== null && refSettled(log.address),
      ),
    }),
  }),
  route({
    template: "tokens",
    pattern: path("tokens"),
    filters: { q: value.text, type: value.tokenTypes },
    cursor: {
      name: value.textOrNull,
      contract_address_hash: value.address,
      holders_count: value.decimalOrNull,
      fiat_value: value.decimalOrNull,
      market_cap: value.decimalOrNull,
      is_name_null: value.boolean,
    },
    schema: tokensPageSchema,
    freshness: { kind: "ttl", cacheClass: "slow", seconds: 600 },
  }),
  route({
    // Slow, not immutable: the token resource carries holders, supply and
    // price. Embedded token metadata is classed with the body it sits in.
    template: "tokens/{address}",
    pattern: path(`tokens/(${address})`),
    schema: tokenSchema,
    freshness: { kind: "ttl", cacheClass: "slow", seconds: 600 },
  }),
  route({
    template: "tokens/{address}/counters",
    pattern: path(`tokens/(${address})/counters`),
    schema: tokenCountersSchema,
    freshness: { kind: "ttl", cacheClass: "slow", seconds: 300 },
  }),
  route({
    // First page only for now: no cursor is accepted.
    template: "tokens/{address}/holders",
    pattern: path(`tokens/(${address})/holders`),
    schema: tokenHoldersPageSchema,
    freshness: { kind: "ttl", cacheClass: "slow", seconds: 600 },
  }),
  route({
    template: "tokens/{address}/transfers",
    pattern: path(`tokens/(${address})/transfers`),
    cursor: blockIndexCursor,
    schema: tokenTransfersPageSchema,
    freshness: { kind: "swr" },
    history: transferPageHistory,
  }),
  route({
    // First page only.
    template: "search",
    pattern: path("search"),
    filters: { q: value.text },
    required: ["q"],
    schema: searchPageSchema,
    freshness: { kind: "ttl", cacheClass: "search", seconds: 45 },
  }),
  route({
    template: "search/quick",
    pattern: path("search/quick"),
    filters: { q: value.text },
    required: ["q"],
    schema: searchQuickSchema,
    freshness: { kind: "ttl", cacheClass: "search", seconds: 45 },
  }),
  route({
    template: "stats",
    pattern: path("stats"),
    schema: statsSchema,
    freshness: { kind: "ttl", cacheClass: "slow", seconds: 300 },
  }),
  route({
    template: "stats/charts/transactions",
    pattern: path("stats/charts/transactions"),
    schema: transactionsChartSchema,
    freshness: { kind: "ttl", cacheClass: "slow", seconds: 900 },
  }),
  route({
    template: "stats/charts/market",
    pattern: path("stats/charts/market"),
    schema: marketChartSchema,
    freshness: { kind: "ttl", cacheClass: "slow", seconds: 900 },
  }),
  route({
    template: "main-page/blocks",
    pattern: path("main-page/blocks"),
    schema: mainPageBlocksSchema,
    freshness: { kind: "per-block", skipIdle: false },
  }),
  route({
    template: "main-page/transactions",
    pattern: path("main-page/transactions"),
    schema: mainPageTransactionsSchema,
    freshness: { kind: "per-block", skipIdle: true },
  }),
  route({
    // ABI and verification status; a contract can be verified later.
    template: "smart-contracts/{address}",
    pattern: path(`smart-contracts/(${address})`),
    schema: smartContractSchema,
    freshness: { kind: "ttl", cacheClass: "slow", seconds: 900 },
  }),
]

export type MatchedRoute = { route: ProxyRoute; match: RegExpExecArray }

/** The route for a lower-cased path below `api/v2/`, or null. */
export function matchRoute(path: string): MatchedRoute | null {
  for (const candidate of proxyRoutes) {
    const match = candidate.pattern.exec(path)
    if (match !== null) return { route: candidate, match }
  }
  return null
}

export type QueryCheck =
  /**
   * `cursored`: the keyset cursor was given (a page past the first);
   * `cursorBlock`: its `block_number`, when the cursor has one.
   */
  | {
      ok: true
      canonical: string
      cursored: boolean
      cursorBlock?: number
    }
  | {
      ok: false
      reason: "unknown" | "malformed" | "repeated" | "missing" | "partial"
    }

const itemsCount = value.integer

/**
 * Checks the query against the route's allowlist and returns it in a
 * canonical form (names sorted, hashes and addresses lower-cased) for
 * cache keys and the upstream URL. A cursor must be complete.
 */
export function checkQuery(
  route: ProxyRoute,
  query: URLSearchParams,
): QueryCheck {
  const names = [...new Set(query.keys())].sort()
  const cursorNames = Object.keys(route.cursor)
  const cursorGiven = cursorNames.filter((name) => query.has(name))
  if (cursorGiven.length > 0 && cursorGiven.length < cursorNames.length) {
    return { ok: false, reason: "partial" }
  }
  const canonical = new URLSearchParams()
  for (const name of names) {
    let rule: ParamRule | undefined = route.filters[name] ?? route.cursor[name]
    if (
      rule === undefined &&
      name === "items_count" &&
      cursorNames.length > 0 &&
      cursorGiven.length === cursorNames.length
    ) {
      rule = itemsCount
    }
    if (rule === undefined) {
      return {
        ok: false,
        reason:
          name === "items_count" && cursorNames.length > 0
            ? "partial"
            : "unknown",
      }
    }
    const values = query.getAll(name)
    if (values.length !== 1) return { ok: false, reason: "repeated" }
    const [single] = values
    if (single === undefined || !rule.pattern.test(single)) {
      return { ok: false, reason: "malformed" }
    }
    canonical.append(name, rule.lower === true ? single.toLowerCase() : single)
  }
  for (const name of route.required) {
    if (!query.has(name)) return { ok: false, reason: "missing" }
  }
  const cursored =
    cursorNames.length > 0 && cursorGiven.length === cursorNames.length
  const block = cursored ? canonical.get("block_number") : null
  return {
    ok: true,
    canonical: canonical.toString(),
    cursored,
    ...(block === null || !("block_number" in route.cursor)
      ? {}
      : { cursorBlock: Number.parseInt(block, 10) }),
  }
}
