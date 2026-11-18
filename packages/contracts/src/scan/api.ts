import { z } from "zod"
import {
  addressCountersSchema,
  type BlockscoutAddress,
  type BlockscoutBlock,
  type BlockscoutTokenTransfer,
  type BlockscoutTransaction,
  addressSchema as blockscoutAddressSchema,
  blockSchema as blockscoutBlockSchema,
  transactionSchema as blockscoutTransactionSchema,
  logsPageSchema,
  nextPageParamsSchema,
  tokenTransfersPageSchema,
  transactionsPageSchema,
} from "../blockscout/schemas"
import { addressSchema, decimalStringSchema } from "../common"
import { txHashSchema, unixSecondsSchema } from "../read-models/primitives"
import {
  activityExtraSchema,
  scanActivityRowSchema,
  scanDailyRowSchema,
  scanDaySchema,
  scanEnclaveEventRowSchema,
  scanEpochTotalsRowSchema,
  scanGaugeEpochRowSchema,
  scanIncentiveDepositRowSchema,
  scanLabelRowSchema,
  scanLockRowSchema,
  scanLockVoteRowSchema,
  scanMorphoEventRowSchema,
  scanTroveEventRowSchema,
  signedIntegerStringSchema,
  sourceMapSchema,
  tokenAmountMapSchema,
} from "./rows"

// /internal/scan/* response bodies (apps/api/src/scan). Lists are
// `{ data, nextCursor }` with an opaque keyset cursor; documents are
// `{ data }`. Items are the matchbox-scan rows with their JSON columns
// parsed, 0/1 flags as booleans and sort keys left out. Amounts stay
// base-unit integer strings: format them with the token's decimals.

/** An opaque keyset cursor: pass `nextCursor` back as `cursor`. */
export const scanCursorSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{4,512}$/, "Expected a cursor")

/** Rows of a response that failed their schema and were left out. */
export const scanSkippedSchema = z.number().int().min(0)

export function scanPageSchema<Item extends z.ZodType>(item: Item) {
  return z.object({
    data: z.array(item),
    nextCursor: scanCursorSchema.nullable(),
    /**
     * `skipped`: stored rows read for this page that failed their schema,
     * left out (and logged) instead of failing the page. Always sent;
     * optional for older fixtures.
     */
    meta: z.object({ skipped: scanSkippedSchema }).optional(),
  })
}

export function scanDocumentSchema<Data extends z.ZodType>(data: Data) {
  return z.object({ data })
}

/** Page size bounds for every list. */
export const scanPageSize = { default: 25, max: 100 } as const

export const scanActivityItemSchema = scanActivityRowSchema
  .omit({ extra: true })
  .extend({ extra: activityExtraSchema })

export type ScanActivityItem = z.infer<typeof scanActivityItemSchema>

export const scanLockItemSchema = scanLockRowSchema
  .omit({
    amount_key: true,
    is_permanent: true,
    is_withdrawn: true,
    is_merged: true,
  })
  .extend({
    is_permanent: z.boolean(),
    is_withdrawn: z.boolean(),
    is_merged: z.boolean(),
    /**
     * Null for a lock made from the chain that the store does not have
     * yet (`indexed: false` on its page): only the store counts its
     * activity and knows when its row was written.
     */
    activity_count: z.number().int().nonnegative().nullable(),
    updated_at: unixSecondsSchema.nullable(),
  })

export type ScanLockItem = z.infer<typeof scanLockItemSchema>

/**
 * A lock's voting power and current votes, read from the chain for the
 * lock's page. `votes` are the weights on each gauge now, in the lock's
 * unit (base units), with the voter contract they were cast on (`source`,
 * as on lock_votes rows) and when the lock last voted on that voter;
 * `last_voted_at` is the latest of those, null when the lock never voted.
 */
export const scanLiveLockSchema = z.object({
  block: z.number().int().nonnegative(),
  voting_power: decimalStringSchema,
  votes: z.array(
    z.object({
      gauge: addressSchema,
      source: z.string().min(1),
      weight: decimalStringSchema,
      /**
       * `lastVoted` on the voter this vote is on (each voter keeps its
       * own): a vote from before the epoch began is carried. Null when
       * that voter does not say. Optional for older answers.
       */
      voted_at: unixSecondsSchema.nullable().optional(),
    }),
  ),
  last_voted_at: unixSecondsSchema.nullable(),
})

export type ScanLiveLock = z.infer<typeof scanLiveLockSchema>

/**
 * `/locks/{escrow}/{id}`: the lock with its owner, amount and unlock as
 * the chain has them, read at most once a minute per data centre.
 * - `indexed`: false for a lock the chain has and Scan's store does not
 *   yet. Its row is made from the chain: no creation time, no history,
 *   `activity_count` and `updated_at` null.
 * - `live`: the chain's figures, null when the read failed (the row is
 *   then the store's) or was not made (a withdrawn or merged lock).
 * Both always sent; optional for older fixtures.
 */
export const scanLockDocumentSchema = z.object({
  data: scanLockItemSchema,
  indexed: z.boolean().optional(),
  live: scanLiveLockSchema.nullable().optional(),
})

export type ScanLockDocument = z.infer<typeof scanLockDocumentSchema>

export const scanLockVoteItemSchema = scanLockVoteRowSchema
  .omit({ weight_key: true, carried: true })
  .extend({ carried: z.boolean() })

export type ScanLockVoteItem = z.infer<typeof scanLockVoteItemSchema>

export const scanIncentiveItemSchema = scanIncentiveDepositRowSchema

export const scanGaugeEpochItemSchema = scanGaugeEpochRowSchema
  .omit({ weight_key: true, incentives: true, fees: true })
  .extend({
    incentives: tokenAmountMapSchema,
    fees: tokenAmountMapSchema,
    // `killed` stays the row's 0 or 1 (Scan reads it so): 1 when killed as
    // of the epoch's end, unranked (`rank` null) and never a top gauge.
  })

export type ScanGaugeEpochItem = z.infer<typeof scanGaugeEpochItemSchema>

export const scanEpochItemSchema = scanEpochTotalsRowSchema
  .omit({
    vote_weight: true,
    incentives: true,
    fees: true,
    top_gauge: true,
    killed_weight: true,
  })
  .extend({
    vote_weight: sourceMapSchema,
    incentives: tokenAmountMapSchema,
    fees: tokenAmountMapSchema,
    top_gauge: sourceMapSchema,
    /** {voter source: weight} on killed gauges (also inside vote_weight). */
    killed_weight: sourceMapSchema.default({}),
    /** True once the epoch has ended. */
    sealed: z.boolean(),
    /** False while the jobs Worker still has this epoch to recompute. */
    complete: z.boolean(),
  })

export type ScanEpochItem = z.infer<typeof scanEpochItemSchema>

/**
 * On every aggregate response (epochs, rankings, gauge history): whether
 * the aggregates it reads are fully computed, and as of when (the finish of
 * the last successful Scan copy run, unix seconds; null before the first).
 */
export const scanAggregateMetaSchema = z.object({
  /** This response's own rows are fully computed. */
  complete: z.boolean(),
  /** When a Scan copy run last changed the data (`last_ok_at`). */
  asOf: unixSecondsSchema.nullable(),
  /** No epoch or day anywhere waits for its aggregates; null if unknown. */
  aggregatesComplete: z.boolean().nullable().default(null),
  /** The one-time history fill has been applied; null if unknown. */
  historyFilled: z.boolean().nullable().default(null),
  /**
   * Copy runs are failing, a re-fill is required, or the copy has halted a
   * table: data may lag.
   */
  stale: z.boolean().default(false),
  /**
   * Stored rows of this response that failed their schema and were left
   * out; `complete` is false when any were. Always sent.
   */
  skipped: scanSkippedSchema.optional(),
})

export type ScanAggregateMeta = z.infer<typeof scanAggregateMetaSchema>

/** `/internal/scan/status`: how complete and current Scan's data is. */
/**
 * How far behind the chain head READ_DB's live snapshot (Borrow state:
 * markets, positions, troves, the Stability Pool) is. `block` is the
 * block of the last live run (`stability_pool.musd_btc_price_block`,
 * written every run); `behind_blocks` the head minus it. The snapshot
 * runs every 5 minutes, about 79 blocks at 3.8 s, so `stale` is true past
 * 240 blocks (two runs missed). All null when the block or the head is
 * unknown: never a guess.
 */
export const scanLiveSnapshotSchema = z.object({
  block: z.number().int().nonnegative().nullable(),
  head: z.number().int().nonnegative().nullable(),
  behind_blocks: z.number().int().nonnegative().nullable(),
  stale: z.boolean().nullable(),
  max_behind_blocks: z.number().int().positive(),
})
export type ScanLiveSnapshot = z.infer<typeof scanLiveSnapshotSchema>

export const scanStatusSchema = z.object({
  /** `status`: the jobs Worker's status row; `runs`: derived without it. */
  source: z.enum(["status", "runs"]),
  asOf: unixSecondsSchema.nullable(),
  lastRunStatus: z.enum(["ok", "skipped", "failed"]).nullable(),
  lastRunAt: unixSecondsSchema.nullable(),
  consecutiveFailures: z.number().int().nonnegative().nullable(),
  /** Newest activity second copied. */
  copiedThrough: unixSecondsSchema.nullable(),
  dirtyEpochs: z.number().int().nonnegative().nullable(),
  dirtyDays: z.number().int().nonnegative().nullable(),
  aggregatesComplete: z.boolean().nullable(),
  historyFilled: z.boolean().nullable(),
  refillRequired: z.boolean().nullable(),
  quarantinedRows: z.number().int().nonnegative().nullable(),
  /**
   * The copy has stopped one or more tables (a systematic failure); their
   * rows stop moving, and `stale` is true while it lasts. Null without a
   * status row. Always sent; optional for older fixtures.
   */
  halted: z.boolean().nullable().optional(),
  /** The stopped tables' names, where known ([] when none or unknown). */
  haltedTables: z.array(z.string()).nullable().optional(),
  /** Copy runs failing, a re-fill required, or a table halted. */
  stale: z.boolean(),
  /**
   * READ_DB's live snapshot (Borrow state), apart from Scan's copy.
   * Always sent; optional for older fixtures.
   */
  liveSnapshot: scanLiveSnapshotSchema.optional(),
})

export type ScanStatus = z.infer<typeof scanStatusSchema>

/** `/epochs/{start}/gauges`: the ranking, plus that source's killed gauges. */
export const scanGaugeRankingSchema = z.object({
  data: z.array(scanGaugeEpochItemSchema),
  nextCursor: scanCursorSchema.nullable(),
  killed: z.array(scanGaugeEpochItemSchema).default([]),
  meta: scanAggregateMetaSchema,
})

/** A page of aggregate rows, with its meta. */
export function scanAggregatePageSchema<Item extends z.ZodType>(item: Item) {
  return scanPageSchema(item).extend({ meta: scanAggregateMetaSchema })
}

export const scanGaugeEpochAggregateSchema = scanGaugeEpochItemSchema.extend({
  /** False while this gauge's epoch is still to be recomputed. */
  complete: z.boolean(),
})

export const scanEpochDetailSchema = z.object({
  epoch: scanEpochItemSchema,
  /** The top gauges by weight for each voter source in the epoch. */
  topGauges: z.record(z.string(), z.array(scanGaugeEpochItemSchema)),
  /** Killed gauges per voter source, where any (unranked, with weight). */
  killedGauges: z
    .record(z.string(), z.array(scanGaugeEpochItemSchema))
    .default({}),
  incentives: scanPageSchema(scanIncentiveItemSchema),
})

/**
 * `/epochs/{start}`: `data` is null while the epoch's aggregates have not
 * been computed yet (`computed: false`), which is not the same as an epoch
 * with zero votes. A start before Epoch 0 or in the future is a 404.
 */
export const scanEpochDocumentSchema = z.object({
  data: scanEpochDetailSchema.nullable(),
  meta: scanAggregateMetaSchema.extend({ computed: z.boolean() }),
})

export const scanTroveEventItemSchema = scanTroveEventRowSchema
export const scanMorphoEventItemSchema = scanMorphoEventRowSchema

/** `/borrow/liquidations`: trove and Morpho liquidations, newest first. */
export const scanLiquidationItemSchema = z.discriminatedUnion("kind", [
  scanTroveEventRowSchema.extend({ kind: z.literal("trove") }),
  scanMorphoEventRowSchema.extend({ kind: z.literal("morpho") }),
])

export type ScanLiquidationItem = z.infer<typeof scanLiquidationItemSchema>
export const scanEnclaveEventItemSchema = scanEnclaveEventRowSchema
  .omit({ pledged_ve_btc: true })
  .extend({ pledged_ve_btc: z.array(decimalStringSchema) })

export type ScanEnclaveEventItem = z.infer<typeof scanEnclaveEventItemSchema>

/**
 * `/borrow/events`: the latest borrow events of every venue, troves,
 * Morpho markets and Enclaves (one item per Enclave event, its pledged
 * locks in `pledged_ve_btc`), newest first.
 */
export const scanBorrowEventItemSchema = z.discriminatedUnion("kind", [
  scanTroveEventRowSchema.extend({ kind: z.literal("trove") }),
  scanMorphoEventRowSchema.extend({ kind: z.literal("morpho") }),
  scanEnclaveEventItemSchema.extend({ kind: z.literal("enclave") }),
])

export type ScanBorrowEventItem = z.infer<typeof scanBorrowEventItemSchema>

/** Events `/borrow/events` answers at most. */
export const scanBorrowEventsMax = 25

export const scanBorrowEventsSchema = z.object({
  data: z.array(scanBorrowEventItemSchema),
  meta: z.object({ skipped: z.number().int().nonnegative() }),
})

export const scanLabelItemSchema = scanLabelRowSchema
  .omit({ name_lower: true, tags: true })
  .extend({ tags: z.array(z.string()) })

export type ScanLabelItem = z.infer<typeof scanLabelItemSchema>

/** Labels by address; an address with no label is absent. */
export const scanLabelMapSchema = z.record(addressSchema, scanLabelItemSchema)

/**
 * `/owners/{address}/votes`: the votes of every lock the address owns now
 * (`locks.owner`; votes a previous owner cast on a lock come with it), by
 * lock (escrow, token id), each lock's newest epoch first; `?epoch=` keeps
 * one epoch. `labels` names the page's gauges (at most 50, first in page
 * order; `labelsTruncated` when the page named more).
 */
export const scanOwnerVotesPageSchema = z.object({
  data: z.array(scanLockVoteItemSchema),
  nextCursor: scanCursorSchema.nullable(),
  meta: z.object({ skipped: scanSkippedSchema }).optional(),
  labels: scanLabelMapSchema,
  labelLimit: z.number().int().positive(),
  labelsTruncated: z.boolean(),
})

// ---------------------------------------------------------------------------
// Borrow (live state from READ_DB, computed at read time)

/** 1e18-scaled ratios and prices as base-10 integer strings. */
const wad = decimalStringSchema

/** Morpho Blue market with derived figures. */
export const scanMorphoMarketSchema = z.object({
  market_id: z.string().regex(/^0x[0-9a-f]{64}$/),
  loan_token: addressSchema,
  collateral_token: addressSchema,
  oracle: addressSchema,
  irm: addressSchema,
  /** 1e18 = 100%. */
  lltv: wad,
  total_supply_assets: decimalStringSchema,
  total_supply_shares: decimalStringSchema,
  total_borrow_assets: decimalStringSchema,
  total_borrow_shares: decimalStringSchema,
  fee: wad,
  /** Borrowed over supplied, 1e18 = 100%; null with nothing supplied. */
  utilization: wad.nullable(),
  /** Borrow rate per second, 1e18-scaled; null when unread. */
  borrow_rate_per_second: wad.nullable(),
  /** Oracle price, Morpho's 1e36 convention scaled by token decimals. */
  oracle_price: decimalStringSchema.nullable(),
  /**
   * The loan and collateral tokens' decimals: read on chain when the jobs
   * Worker discovered the market, else the API's token registry; null when
   * neither knows (amounts are raw base units either way; never assume
   * 18). Always sent on `/borrow/markets`; optional for older fixtures.
   */
  loan_decimals: z.number().int().min(0).max(36).nullable().optional(),
  collateral_decimals: z.number().int().min(0).max(36).nullable().optional(),
  block: z.number().int().nonnegative(),
  updated_at: unixSecondsSchema,
})

export type ScanMorphoMarket = z.infer<typeof scanMorphoMarketSchema>

/** Health of one borrow position, from state and the current price. */
export const scanLoanHealthSchema = z.object({
  /** Debt over collateral value, 1e18 = 100%; null without debt. */
  ltv: wad.nullable(),
  /**
   * Collateral value times the liquidation threshold over debt, 1e18 =
   * 1.0; below 1e18 is liquidatable. Null without debt or price.
   */
  health_factor: wad.nullable(),
  /** Collateral price at which the position becomes liquidatable. */
  liquidation_price: decimalStringSchema.nullable(),
  /**
   * `unknown`: debt and no price to value the collateral with (a Morpho
   * market whose oracle has no price, or no MUSD PriceFeed price for a
   * trove). Never `healthy` by default.
   */
  band: z.enum([
    "healthy",
    "near_liquidation",
    "liquidatable",
    "no_debt",
    "unknown",
  ]),
})

export type ScanLoanHealth = z.infer<typeof scanLoanHealthSchema>

export const scanMorphoPositionSchema = z.object({
  market_id: z.string().regex(/^0x[0-9a-f]{64}$/),
  account: addressSchema,
  supply_shares: decimalStringSchema,
  supply_assets: decimalStringSchema,
  borrow_shares: decimalStringSchema,
  borrow_assets: decimalStringSchema,
  collateral: decimalStringSchema,
  health: scanLoanHealthSchema,
  block: z.number().int().nonnegative(),
  updated_at: unixSecondsSchema,
})

export type ScanMorphoPosition = z.infer<typeof scanMorphoPositionSchema>

export const scanTroveSchema = z.object({
  owner: addressSchema,
  status: z.string(),
  coll: decimalStringSchema,
  principal: decimalStringSchema,
  interest: decimalStringSchema,
  /** Basis points. */
  interest_rate: z.number().int(),
  /**
   * Collateral ratio (ICR), 1e18 = 100%, liquidation price in USD per BTC
   * (1e18-scaled) and band, from the live BTC price. `ltv` is debt over
   * collateral value; `health_factor` is ICR over the 110% MCR.
   */
  health: scanLoanHealthSchema.extend({ collateral_ratio: wad.nullable() }),
  /**
   * The price `health` was computed at: MUSD's own PriceFeed price, the
   * one the protocol prices every trove with (`source: "price_feed"`,
   * `estimate: false`), read by the live snapshot at `block`. `btc_usd`
   * and `block` are null when there is none (the read reverted, or no
   * read since the column was added); `band` is then `unknown`, and no
   * market price stands in for it. Always sent; optional for older
   * fixtures.
   */
  health_basis: z
    .object({
      source: z.enum(["market", "price_feed"]),
      btc_usd: z.string().nullable(),
      estimate: z.boolean(),
      block: z.number().int().nonnegative().nullable().optional(),
      /**
       * True when the price's block is older than the trove's or the
       * pool's last write: a later live run wrote them and failed to write
       * the price, so it is from an earlier run. The band is then
       * `unknown`. Null when it cannot be judged (no price or no block).
       */
      stale: z.boolean().nullable().optional(),
      /** Blocks the price is behind the newer of those two (0 current). */
      lag_blocks: z.number().int().nonnegative().nullable().optional(),
    })
    .optional(),
  block: z.number().int().nonnegative(),
  updated_at: unixSecondsSchema,
})

export type ScanTrove = z.infer<typeof scanTroveSchema>

export const scanStabilityPoolSchema = z.object({
  total_musd_deposits: decimalStringSchema,
  total_collateral: decimalStringSchema,
  block: z.number().int().nonnegative(),
  updated_at: unixSecondsSchema,
})

/** An Enclave position: its latest event and when it started. */
export const scanEnclavePositionSchema = z.object({
  position_id: z.string(),
  latest: scanEnclaveEventItemSchema,
})

/** Where an Enclave position's event sits on chain. */
export const scanEnclaveMomentSchema = z.object({
  block_number: z.number().int().nonnegative(),
  timestamp: unixSecondsSchema,
  tx_hash: txHashSchema,
})

/**
 * An Enclave position summed from its `enclave_events` rows
 * (`/borrow/enclave/positions`, `/borrow/enclave/locks/{tokenId}`).
 * Amounts are MUSD base units (18 decimals). `principal` is the principal
 * after the latest event ("0" once closed): EnclaveDebtManager accrues
 * interest with no event, so live debt with interest and the collateral
 * ratio are not here. `minted` (opened with plus every increase),
 * `repaid` and `opened` need the whole history: null when the read
 * stopped before its first event (`complete` false).
 */
export const scanEnclavePositionSummarySchema = z.object({
  position_id: z.string(),
  enclave: addressSchema,
  borrower: addressSchema.nullable(),
  /** "closed" once its latest event is POSITION_CLOSED. */
  status: z.enum(["open", "closed"]),
  principal: decimalStringSchema.nullable(),
  minted: decimalStringSchema.nullable(),
  repaid: decimalStringSchema.nullable(),
  /** veBTC token ids pledged now, ascending; empty once closed. */
  pledged_ve_btc: z.array(decimalStringSchema),
  /** Every veBTC token id the position has pledged, ascending. */
  ve_btc_token_ids: z.array(decimalStringSchema),
  opened: scanEnclaveMomentSchema.nullable(),
  latest: scanEnclaveMomentSchema.extend({ action: z.string().min(1) }),
  /** Every one of its events was read. */
  complete: z.boolean(),
})

export type ScanEnclavePositionSummary = z.infer<
  typeof scanEnclavePositionSummarySchema
>

/**
 * `/borrow/enclave/locks/{tokenId}`: the Enclave positions a veBTC has
 * been pledged to, newest first (empty when never pledged). The lock backs
 * a position now when `pledged_ve_btc` holds its id.
 */
export const scanEnclaveLockSchema = z.object({
  token_id: decimalStringSchema,
  positions: z.array(scanEnclavePositionSummarySchema),
})

export type ScanEnclaveLock = z.infer<typeof scanEnclaveLockSchema>

/** An owner's open borrow positions. */
export const scanBorrowPositionsSchema = z.object({
  owner: addressSchema,
  morpho: z.array(scanMorphoPositionSchema),
  trove: scanTroveSchema.nullable(),
  enclave: z.array(scanEnclavePositionSchema),
  /** USD per BTC the health figures used; null without a live price. */
  btc_usd: z.string().nullable(),
})

// ---------------------------------------------------------------------------
// Series

export const scanSeriesPointSchema = z.object({
  day: scanDaySchema,
  value: signedIntegerStringSchema,
  /** Today's value so far, or a day the jobs Worker has yet to recompute. */
  partial: z.boolean(),
})

export const scanSeriesSchema = z.object({
  metric: scanDailyRowSchema.shape.metric,
  dimension: z.string(),
  from: scanDaySchema,
  to: scanDaySchema,
  /** What the metric measures, its source and first day (series.ts). */
  note: z
    .object({
      definition: z.string(),
      source: z.string(),
      firstDay: z.string(),
    })
    .nullable()
    .default(null),
  /** From the registry (series.ts). */
  unit: z.enum(["amount", "count"]),
  decimals: z.union([z.number().int(), z.literal("token")]).nullable(),
  /**
   * `decimals` resolved for this series: the registry's number, or for
   * `token` the decimals of the dimension's token (a Morpho market's loan
   * token, or its collateral token for collateral metrics) when it is a
   * known token. Null for counts, an unknown token, or a total across
   * tokens or markets (summed in different units: not one amount). Always
   * sent; optional for older fixtures.
   */
  resolvedDecimals: z.number().int().min(0).max(36).nullable().optional(),
  /** The token `resolvedDecimals` are of (`token` decimals only). */
  token: z
    .object({ address: addressSchema, symbol: z.string().nullable() })
    .nullable()
    .optional(),
  kind: z.enum(["flow", "level"]),
  signed: z.boolean(),
  points: z.array(scanSeriesPointSchema),
  /** The first and last day the series has anywhere, null when empty. */
  firstDay: scanDaySchema.nullable(),
  lastDay: scanDaySchema.nullable(),
  /** The last day of a series with no live writer (backfill only). */
  endsOn: scanDaySchema.nullable(),
})

export type ScanSeries = z.infer<typeof scanSeriesSchema>

/**
 * `/series/split`: every dimension of one metric over a range, from one
 * range scan (Network's TVL and DEX volume, MUSD in DEX pools). Token
 * metrics take up to `scanSeriesMaxDays`; pool-token metrics a week (a
 * day's rows are two per pool). Each series has its own token and
 * decimals and is never added to another here.
 */
export const scanSeriesSplitSchema = z.object({
  metric: scanDailyRowSchema.shape.metric,
  /**
   * The first day served: `from` as asked, or the day after the row limit
   * cut the range's oldest days (`truncated`), so every day served is
   * whole and the newest days are always there.
   */
  from: scanDaySchema,
  to: scanDaySchema,
  truncated: z.boolean(),
  note: scanSeriesSchema.shape.note,
  unit: scanSeriesSchema.shape.unit,
  decimals: scanSeriesSchema.shape.decimals,
  kind: scanSeriesSchema.shape.kind,
  signed: z.boolean(),
  series: z.array(
    z.object({
      dimension: z.string(),
      /** The dimension's token (a pool-token's token); null for others. */
      token: z
        .object({ address: addressSchema, symbol: z.string().nullable() })
        .nullable(),
      /** That token's decimals when known; null otherwise. */
      resolvedDecimals: z.number().int().min(0).max(36).nullable(),
      points: z.array(scanSeriesPointSchema),
    }),
  ),
})

export type ScanSeriesSplit = z.infer<typeof scanSeriesSplitSchema>

export const scanPriceSeriesSchema = z.object({
  token: z.enum(["btc", "mezo"]),
  from: scanDaySchema,
  to: scanDaySchema,
  points: z.array(
    z.object({ day: scanDaySchema, price: z.string(), partial: z.boolean() }),
  ),
  firstDay: scanDaySchema.nullable(),
  lastDay: scanDaySchema.nullable(),
})

/**
 * `/markets?days=`: Network's TVL and DEX volume in one read. Every
 * pool's balances per token over `days`, their swap volume per token over
 * at least 31 days, each pool's volume in over the last three days, and
 * BTC's and MEZO's daily closes over the longer range, all to today.
 */
export const scanMarketsSchema = z.object({
  days: z.number().int().min(1),
  balances: scanSeriesSplitSchema,
  volume: scanSeriesSplitSchema,
  pools: scanSeriesSplitSchema,
  prices: z.object({
    btc: scanPriceSeriesSchema.shape.points,
    mezo: scanPriceSeriesSchema.shape.points,
  }),
})

export type ScanMarkets = z.infer<typeof scanMarketsSchema>

// ---------------------------------------------------------------------------
// Search

/** What the client's shape detection decided a query is. */
export const scanSearchKindSchema = z.enum([
  "name",
  "address",
  "address-prefix",
  "epoch",
  "lock",
])

export const scanSearchHitSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("label"), label: scanLabelItemSchema }),
  z.object({
    type: z.literal("gauge"),
    address: addressSchema,
    name: z.string(),
  }),
  z.object({ type: z.literal("epoch"), epoch_start: unixSecondsSchema }),
  z.object({
    type: z.literal("lock"),
    escrow: addressSchema,
    token_id: decimalStringSchema,
  }),
])

export const scanSearchResultSchema = z.object({
  kind: scanSearchKindSchema,
  hits: z.array(scanSearchHitSchema),
})

// ---------------------------------------------------------------------------
// Mezo IDs

/**
 * `/mezo-ids/{key}`: a Mezo ID ("alice.mezo"), an address or a mainnet
 * Bitcoin address, from Mezo's accounts API. For an ID or an address,
 * `wallets` is the account's own wallet (its one linked account of type
 * `wallet`) and `btc_address` that wallet's linked Bitcoin address. For a
 * Bitcoin address, `wallets` is the EVM address linked with it and
 * `btc_address` the key; `mezo_id` is the account's ID only when that EVM
 * address is the account's own wallet. `mezo_id` is null for an address
 * with no ID. `btc_address` is missing from answers stored before it
 * existed. `unavailable` is Mezo's API down or late (answered `no-store`).
 */
export const scanMezoIdLookupSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("found"),
    mezo_id: z.string().min(1).nullable(),
    wallets: z.array(addressSchema),
    btc_address: z.string().min(1).nullable().optional(),
  }),
  z.object({ status: z.literal("not-found") }),
  z.object({ status: z.literal("unavailable") }),
])

export type ScanMezoIdLookup = z.infer<typeof scanMezoIdLookupSchema>

/** Most addresses one `/mezo-ids?addresses=` read takes: a page's worth. */
export const scanMezoIdNamesMax = 100

/**
 * `/mezo-ids?addresses=a,b`: the Mezo IDs already cached for those
 * addresses, lower-case address to ID. Addresses with no cached ID are
 * left out; the route never asks Mezo, so a list can call it per page.
 */
export const scanMezoIdNamesSchema = z.record(addressSchema, z.string().min(1))

export type ScanMezoIdNames = z.infer<typeof scanMezoIdNamesSchema>

// ---------------------------------------------------------------------------
// Composed entity documents

/** Why one part of a composed document is missing. */
export const scanPartReasonSchema = z.enum([
  "not_found",
  "rate_limited",
  "upstream",
  "schema",
  "invalid",
  "disabled",
])

export type ScanPartReason = z.infer<typeof scanPartReasonSchema>

export function scanPartSchema<Data extends z.ZodType>(data: Data) {
  return z.discriminatedUnion("status", [
    z.object({ status: z.literal("ok"), data }),
    z.object({
      status: z.literal("unavailable"),
      reason: scanPartReasonSchema,
    }),
  ])
}

export const scanTransactionDocumentSchema = z.object({
  hash: z.string().regex(/^0x[0-9a-f]{64}$/),
  transaction: scanPartSchema(blockscoutTransactionSchema),
  logs: scanPartSchema(logsPageSchema),
  tokenTransfers: scanPartSchema(tokenTransfersPageSchema),
  activity: scanPartSchema(z.array(scanActivityItemSchema)),
  labels: scanLabelMapSchema,
  /**
   * `labels` covers at most `labelLimit` (50) distinct addresses, the first
   * in document order (transaction, logs, transfers, our rows);
   * `labelsTruncated` says the document named more. Always sent; optional
   * for older fixtures.
   */
  labelLimit: z.number().int().positive().optional(),
  labelsTruncated: z.boolean().optional(),
  /** True when every part is final: the document will not change. */
  final: z.boolean(),
})

// ---------------------------------------------------------------------------
// Tokens

/**
 * What a USD value rests on, from the API's token registry: `btc` or
 * `mezo` (that token's price), `usd` (taken as $1), null (not valued). A
 * client that will not value a stablecoin at $1, or a wrapped BTC at BTC's
 * price, leaves those out.
 */
export const scanPricedAsSchema = z.enum(["usd", "btc", "mezo"]).nullable()
export type ScanPricedAs = z.infer<typeof scanPricedAsSchema>

/**
 * A token-list row's basis: `priced_as` above, or `market`: the token's
 * own market price (MUSD: the liquidity-weighted median of its venues on
 * Ethereum, Base and Mezo, else CoinGecko), instead of an assumed $1.
 */
export const scanTokenListPricedAsSchema = z
  .enum(["usd", "btc", "mezo", "market"])
  .nullable()
export type ScanTokenListPricedAs = z.infer<typeof scanTokenListPricedAsSchema>

/**
 * Where a token row's `price_usd` comes from: `mezo-oracle` (BTC's Skip
 * oracle on Mezo), `coingecko` (MEZO's market price, and MUSD's fallback)
 * or `aerodrome-cl` (MEZO's thin Base pool, its fallback), `venues`
 * (MUSD's venue median, /internal/scan/crosschain/prices), `registry`
 * (taken as $1), null when unpriced. Name it next to the price.
 */
export const scanPriceSourceSchema = z
  .enum(["mezo-oracle", "coingecko", "aerodrome-cl", "venues", "registry"])
  .nullable()
export type ScanPriceSource = z.infer<typeof scanPriceSourceSchema>

const usdDecimalSchema = z.string().regex(/^(0|[1-9][0-9]*)(\.[0-9]+)?$/)

/** One ERC-20 balance of an address. */
export const scanAddressTokenSchema = z.object({
  token: z.object({
    address: addressSchema,
    symbol: z.string().nullable(),
    name: z.string().nullable(),
    /** The registry's, else Blockscout's; null when neither says. */
    decimals: z.number().int().min(0).max(36).nullable(),
  }),
  /** Base units. */
  value: decimalStringSchema,
  /** Null when unpriced (`priced_as` null), a price is missing, or no decimals. */
  value_usd: usdDecimalSchema.nullable(),
  priced_as: scanPricedAsSchema,
})

/**
 * The address document's `tokens` part: the first page (50) of the
 * address's ERC-20 balances. `next_page_params` continues them through the
 * Blockscout proxy (`/addresses/{address}/tokens?type=ERC-20&...`).
 */
export const scanAddressTokensSchema = z.object({
  items: z.array(scanAddressTokenSchema),
  next_page_params: nextPageParamsSchema,
  /** The KV prices the values used; null where there was none. */
  prices: z.object({
    btc_usd: usdDecimalSchema.nullable(),
    mezo_usd: usdDecimalSchema.nullable(),
  }),
})
export type ScanAddressTokens = z.infer<typeof scanAddressTokensSchema>

/** A token figure: the latest closing value and the day it closed. */
export const scanTokenFigureSchema = z.object({
  value: decimalStringSchema,
  day: scanDaySchema,
  /** The day can still change (the jobs Worker's own mark). */
  partial: z.boolean(),
})

/**
 * `/tokens`: one row per registered token or token with a supply series.
 * `supply` is `totalSupply()` at the latest close (`token.total_supply`;
 * BTC's native supply), never summed transfers (bridge-minted tokens have
 * no mint events); `holders` Blockscout's holder count at the latest close
 * (`token.holders`). Each is null when there is no row for the token: not
 * a token the jobs read, or none read yet. Never zero for unknown.
 */
export const scanTokenListItemSchema = z.object({
  address: addressSchema,
  symbol: z.string().nullable(),
  name: z.string().nullable(),
  decimals: z.number().int().min(0).max(36).nullable(),
  priced_as: scanTokenListPricedAsSchema,
  /** USD per whole token by `priced_as`; null when unpriced. */
  price_usd: usdDecimalSchema.nullable(),
  price_source: scanPriceSourceSchema,
  supply: scanTokenFigureSchema.nullable(),
  supply_usd: usdDecimalSchema.nullable(),
  holders: scanTokenFigureSchema.nullable(),
})
export type ScanTokenListItem = z.infer<typeof scanTokenListItemSchema>

export const scanTokenListSchema = z.object({
  data: z.array(scanTokenListItemSchema),
  prices: z.object({
    btc_usd: usdDecimalSchema.nullable(),
    mezo_usd: usdDecimalSchema.nullable(),
  }),
  meta: scanAggregateMetaSchema,
})

// ---------------------------------------------------------------------------
// Validators

/** One validator on `/validators`. */
export const scanValidatorRowSchema = z.object({
  /** The block proposer (Blockscout's miner), lower case. */
  address: addressSchema,
  /** Pro's directory name (profile, else ValidatorPool moniker). */
  name: z.string().nullable(),
  /** Scan's label for the address, where one exists. */
  label: z.string().nullable(),
  /** The ValidatorPool operator, when it is this same address. */
  operator: addressSchema.nullable(),
  /** Its validator gauge. */
  gauge: addressSchema.nullable(),
  pool_status: z.enum(["active", "left"]).nullable(),
  /** Blocks proposed on `day`; null without a count for it. */
  blocks: decimalStringSchema.nullable(),
  /**
   * Share of every block the chain produced on `day` (`blocks_in_day`),
   * basis points; null without that count or without this validator's.
   */
  share_bps: z.number().int().min(0).max(10_000).nullable(),
  /** Every block it has proposed (Blockscout), at that read's day. */
  blocks_total: z
    .object({ value: decimalStringSchema, day: scanDaySchema })
    .nullable(),
})
export type ScanValidatorRow = z.infer<typeof scanValidatorRowSchema>

/**
 * `/validators`. `available` is false, with `reason`, until the jobs Worker
 * has two daily reads of the counters (a day's count is their
 * difference): never zero for unknown. `shares_complete` is false when a
 * validator with a running total has no count for `day` (listed in
 * `missing_counts`); shares are then null.
 */
export const scanValidatorsSchema = z.object({
  data: z.object({
    available: z.boolean(),
    reason: z.string().nullable(),
    day: scanDaySchema.nullable(),
    /** The validators' counted blocks on `day`, summed. */
    day_total: decimalStringSchema.nullable(),
    /** Shares were computed and every known validator has a count. */
    shares_complete: z.boolean(),
    /**
     * The shares' denominator: `all_blocks`, every block the chain produced
     * that day (`chain.blocks`); null when there is no such count and the
     * shares are unknown. Always sent; optional for older fixtures.
     */
    share_of: z.literal("all_blocks").nullable().optional(),
    /** Blocks the chain produced on `day`; null without two height reads. */
    blocks_in_day: decimalStringSchema.nullable().optional(),
    /**
     * `blocks_in_day` minus `day_total`, at least 0 (reads minutes apart
     * can overshoot by a few): blocks no known validator was counted for.
     */
    unattributed_blocks: decimalStringSchema.nullable().optional(),
    missing_counts: z.array(addressSchema),
    validators: z.array(scanValidatorRowSchema),
    /** Validator gauges whose operator left the set: no address to match. */
    pool_without_operator: z.array(
      z.object({
        gauge: addressSchema,
        name: z.string(),
        pool_status: z.enum(["active", "left"]),
      }),
    ),
  }),
  meta: scanAggregateMetaSchema,
})

export const scanAddressDocumentSchema = z.object({
  address: addressSchema,
  summary: scanPartSchema(blockscoutAddressSchema),
  counters: scanPartSchema(addressCountersSchema),
  /** The address's own label (also in `labels`). */
  label: scanLabelItemSchema.nullable(),
  locks: scanPartSchema(scanPageSchema(scanLockItemSchema)),
  /**
   * The owner's loans, from READ_DB's live snapshot. When `ok`, `snapshot`
   * says how far behind the head that snapshot is, as on every live Borrow
   * answer. Always sent with `ok`; optional for older fixtures.
   */
  borrow: z.discriminatedUnion("status", [
    z.object({
      status: z.literal("ok"),
      data: scanBorrowPositionsSchema,
      snapshot: scanLiveSnapshotSchema.optional(),
    }),
    z.object({
      status: z.literal("unavailable"),
      reason: scanPartReasonSchema,
    }),
  ]),
  activity: scanPartSchema(scanPageSchema(scanActivityItemSchema)),
  /**
   * Labels for the addresses the document names, as on the transaction
   * document: at most `labelLimit` (50) distinct ones, the address itself
   * first, then in document order (summary, locks, borrow, activity);
   * `labelsTruncated` when it named more. Always sent; optional for older
   * fixtures.
   */
  labels: scanLabelMapSchema.optional(),
  labelLimit: z.number().int().positive().optional(),
  labelsTruncated: z.boolean().optional(),
  /** ERC-20 balances, first page. Always sent; optional for older fixtures. */
  tokens: scanPartSchema(scanAddressTokensSchema).optional(),
})

export const scanBlockDocumentSchema = z.object({
  id: z.string(),
  block: scanPartSchema(blockscoutBlockSchema),
  transactions: scanPartSchema(transactionsPageSchema),
  labels: scanLabelMapSchema,
  /** As on the transaction document: the proposer first. */
  labelLimit: z.number().int().positive().optional(),
  labelsTruncated: z.boolean().optional(),
  final: z.boolean(),
})

export type ScanTransactionDocument = z.infer<
  typeof scanTransactionDocumentSchema
>
export type ScanAddressDocument = z.infer<typeof scanAddressDocumentSchema>
export type ScanBlockDocument = z.infer<typeof scanBlockDocumentSchema>

/** Re-exported so callers of the composed documents need one import. */
export type {
  BlockscoutAddress,
  BlockscoutBlock,
  BlockscoutTokenTransfer,
  BlockscoutTransaction,
}
