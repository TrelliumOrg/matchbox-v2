import { z } from "zod"
import { addressSchema, decimalStringSchema } from "../common"
import { fixedDecimalSchema } from "../market"
import { unixSecondsSchema } from "../read-models/primitives"
import { scanAggregateMetaSchema } from "./api"
import { scanDaySchema, tokenAmountMapSchema } from "./rows"

// Governance summaries in matchbox-scan (scan-migrations 0007), written by
// the jobs Worker (apps/jobs README "Governance summaries") and served by
// /internal/scan: emissions per gauge per epoch, each voter's epoch totals,
// and the escrows' lock distribution read from the chain once a day. Voting
// APR per epoch comes from the API's own market store (MARKET_DB).

/** A voter contract's source name, as on activity and gauge_epoch rows. */
export const scanVoterSourceSchema = z.string().regex(/^[A-Z][A-Z_]{1,40}$/)

/**
 * `gauge_emissions`: the MEZO a voter distributed to one gauge in one
 * epoch (Voter `DistributeReward`, summed over the epoch's events). The
 * epoch is the one the distribution happened in: emissions for the votes
 * of the epoch before, streamed to the gauge over this one.
 */
export const scanGaugeEmissionRowSchema = z.object({
  gauge: addressSchema,
  epoch_start: unixSecondsSchema,
  source: scanVoterSourceSchema,
  /** MEZO, 18 decimals, base units. */
  amount: decimalStringSchema,
  /** Distribution events summed. */
  events: z.number().int().min(0),
  updated_at: unixSecondsSchema,
})
export type ScanGaugeEmissionRow = z.infer<typeof scanGaugeEmissionRowSchema>

/**
 * `epoch_sources`: one voter's totals for one epoch: the emissions it
 * distributed (null before the copied DistributeReward history, 9 Apr
 * 2026, and for the epoch it starts in), the incentives and fees deposited
 * for its gauges (from `gauge_epoch`), its gauges' vote weight and how many
 * gauges hold votes.
 */
export const scanEpochSourceRowSchema = z.object({
  epoch_start: unixSecondsSchema,
  source: scanVoterSourceSchema,
  emissions: decimalStringSchema.nullable(),
  incentives: tokenAmountMapSchema,
  fees: tokenAmountMapSchema,
  vote_weight: decimalStringSchema,
  gauges: z.number().int().min(0),
  /** Gauges the voter distributed emissions to. */
  emission_gauges: z.number().int().min(0),
  updated_at: unixSecondsSchema,
})
export type ScanEpochSourceRow = z.infer<typeof scanEpochSourceRowSchema>

/** `/internal/scan/epochs/sources`: every voter's totals, oldest first. */
export const scanEpochSourcesSchema = z.object({
  data: z.array(
    scanEpochSourceRowSchema.extend({
      /** The epoch is not waiting for its aggregates. */
      complete: z.boolean(),
    }),
  ),
  meta: scanAggregateMetaSchema,
})
export type ScanEpochSources = z.infer<typeof scanEpochSourcesSchema>

/** `/internal/scan/gauges/{gauge}/emissions`: newest epoch first. */
export const scanGaugeEmissionsSchema = z.object({
  data: z.array(scanGaugeEmissionRowSchema),
  meta: scanAggregateMetaSchema,
})
export type ScanGaugeEmissions = z.infer<typeof scanGaugeEmissionsSchema>

// -- lock distribution --------------------------------------------------------

export const scanLockEscrowSchema = z.enum(["vebtc", "vemezo"])
export type ScanLockEscrow = z.infer<typeof scanLockEscrowSchema>

const count = z.number().int().min(0)

/** Locks, their amount and their voting power (base units, 18 decimals). */
export const scanLockGroupSchema = z.object({
  count,
  amount: decimalStringSchema,
  voting_power: decimalStringSchema,
})
export type ScanLockGroup = z.infer<typeof scanLockGroupSchema>

/** Live locks with an amount in [min, max); max null is open. */
export const scanLockSizeBucketSchema = scanLockGroupSchema.extend({
  min: decimalStringSchema,
  max: decimalStringSchema.nullable(),
})
export type ScanLockSizeBucket = z.infer<typeof scanLockSizeBucketSchema>

/** Timed locks with (min, max] seconds left until they unlock. */
export const scanLockTimeBucketSchema = scanLockGroupSchema.extend({
  min_seconds: count,
  max_seconds: count,
})
export type ScanLockTimeBucket = z.infer<typeof scanLockTimeBucketSchema>

/** Timed locks unlocking at `at` (their end: an epoch boundary). */
export const scanLockUnlockSchema = z.object({
  at: unixSecondsSchema,
  count,
  amount: decimalStringSchema,
})
export type ScanLockUnlock = z.infer<typeof scanLockUnlockSchema>

/**
 * One escrow's live locks as the chain has them at one block, read once a
 * day: every token id from 1 to `tokenId()`, its `locked()` and the live
 * ones' `votingPowerOfNFT()`. Not the warehouse's lock rows, which miss
 * early deposits and splits. A live lock holds an amount; permanent locks
 * never unlock; timed locks unlock at `end`; expired ones are past their
 * end but not withdrawn yet (still locked, no voting power).
 */
export const scanLockDistributionSchema = z.object({
  escrow: scanLockEscrowSchema,
  day: scanDaySchema,
  block: z.number().int().nonnegative(),
  /** The block's time. */
  read_at: unixSecondsSchema,
  /** The longest lock the escrow takes, in seconds. */
  max_lock_seconds: count,
  /** Token ids read: 1 to the escrow's `tokenId()` at the block. */
  ids_read: count,
  /** The escrow's `supply()` at the block. */
  supply: decimalStringSchema,
  live: scanLockGroupSchema,
  permanent: scanLockGroupSchema,
  timed: scanLockGroupSchema,
  expired: scanLockGroupSchema,
  /** The largest and the median live lock; null with none. */
  largest: decimalStringSchema.nullable(),
  median: decimalStringSchema.nullable(),
  /** Timed locks' time left, weighted by amount; null with none. */
  mean_remaining_seconds: count.nullable(),
  by_size: z.array(scanLockSizeBucketSchema),
  by_remaining: z.array(scanLockTimeBucketSchema),
  /** Timed locks by unlock time, soonest first. */
  unlocks: z.array(scanLockUnlockSchema),
})
export type ScanLockDistribution = z.infer<typeof scanLockDistributionSchema>

/** `lock_distribution` rows: one document per escrow per UTC day. */
export const scanLockDistributionRowSchema = z.object({
  escrow: scanLockEscrowSchema,
  day: scanDaySchema,
  block: z.number().int().nonnegative(),
  data: z.string(),
  /** `live` (the daily read) or `backfill:lock-distribution`. */
  source: z.string(),
  updated_at: unixSecondsSchema,
})

/** A day's headline figures, for history (without the buckets). */
export const scanLockDistributionPointSchema = z.object({
  day: scanDaySchema,
  live: scanLockGroupSchema,
  permanent: scanLockGroupSchema,
  timed: scanLockGroupSchema,
})
export type ScanLockDistributionPoint = z.infer<
  typeof scanLockDistributionPointSchema
>

/**
 * `/internal/scan/locks/distribution?escrow=`: the newest day's document,
 * the documents nearest 30 and 90 days before it, and every stored day's
 * headline figures (oldest first, at most a year). `latest` is null until
 * the first daily read.
 */
export const scanLockDistributionDocumentSchema = z.object({
  data: z.object({
    latest: scanLockDistributionSchema.nullable(),
    ago30: scanLockDistributionSchema.nullable(),
    ago90: scanLockDistributionSchema.nullable(),
    history: z.array(scanLockDistributionPointSchema),
  }),
})
export type ScanLockDistributionDocument = z.infer<
  typeof scanLockDistributionDocumentSchema
>

// -- voting APR per epoch (MARKET_DB) ----------------------------------------

/** veBTC votes on pool and validator gauges; veMEZO on boost and third-party. */
export const scanAprVoterSchema = z.enum([
  "pools",
  "validators",
  "boost",
  "third-party",
])
export type ScanAprVoter = z.infer<typeof scanAprVoterSchema>

/** A voter, or an escrow's voters together (`vebtc`, `vemezo`). */
export const scanAprVoterKeySchema = z.enum([
  ...scanAprVoterSchema.options,
  "vebtc",
  "vemezo",
])
export type ScanAprVoterKey = z.infer<typeof scanAprVoterKeySchema>

/**
 * One voter's epoch, as the market cron stored it: the rewards on its
 * gauges priced at the snapshot's prices, its total vote weight, and the
 * voting APR those give, by the same formula as each gauge's projected APR
 * (`aprPercent`: totalUsd * 52 / (weight / 1e18 * votingTokenUsd) * 100).
 * `vebtc` and `vemezo` sum the escrow's voters (their rewards and weights).
 */
export const scanVoterEpochSchema = z.object({
  epoch_start: unixSecondsSchema,
  voter: scanAprVoterKeySchema,
  /** Sum of the gauges' priced rewards; null when none is priced. */
  total_usd: fixedDecimalSchema.nullable(),
  /** The voter's total weight, base units; null when unread. */
  weight: decimalStringSchema.nullable(),
  /** BTC for veBTC voters, MEZO for veMEZO voters; null without a price. */
  voting_token_usd: fixedDecimalSchema.nullable(),
  apr_percent: fixedDecimalSchema.nullable(),
  /** Gauges with at least one reward this epoch. */
  funded_gauges: count,
  /** Rewards left out of `total_usd` for want of a price. */
  unpriced_rewards: count,
  /** The epoch was still running when the row was last written. */
  open: z.boolean(),
  updated_at: unixSecondsSchema,
})
export type ScanVoterEpoch = z.infer<typeof scanVoterEpochSchema>

/** `/internal/scan/apr`: every voter's epochs, oldest first. */
export const scanAprHistorySchema = z.object({
  data: z.array(scanVoterEpochSchema),
})
export type ScanAprHistory = z.infer<typeof scanAprHistorySchema>

/** One gauge's stored epoch: its projected APR as the cron computed it. */
export const scanGaugeAprPointSchema = z.object({
  epoch_start: unixSecondsSchema,
  voter: scanAprVoterSchema,
  weight: decimalStringSchema.nullable(),
  total_usd: fixedDecimalSchema.nullable(),
  apr_percent: fixedDecimalSchema.nullable(),
  unpriced_rewards: count,
})
export type ScanGaugeAprPoint = z.infer<typeof scanGaugeAprPointSchema>

/** `/internal/scan/gauges/{gauge}/apr`: oldest first, up to 52 epochs. */
export const scanGaugeAprHistorySchema = z.object({
  data: z.array(scanGaugeAprPointSchema),
})
export type ScanGaugeAprHistory = z.infer<typeof scanGaugeAprHistorySchema>
