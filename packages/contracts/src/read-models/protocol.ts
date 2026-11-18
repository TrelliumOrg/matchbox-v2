import { z } from "zod"
import { activityRowSchema } from "./activity"
import { gaugeCardSchema } from "./gauges"
import {
  amountSchema,
  epochRefSchema,
  gaugeRefSchema,
  readModelResponseSchema,
  signedAmountSchema,
  valueBreakdownSchema,
} from "./primitives"

// Protocol: Mezo Earn for one epoch, incentives across epochs, the funded
// gauges and the live feed.

export const protocolStatsSchema = z.object({
  vemezoLocked: amountSchema,
  vemezoLockers: z.number().int().nonnegative(),
  /** BTC locked in veBTC. */
  vebtcLocked: amountSchema,
  vebtcLockedUsd: amountSchema.nullable(),
  /** veBTC voting power cast this epoch. */
  vebtcVoteWeight: amountSchema,
  vebtcVotes: z.number().int().nonnegative(),
  /** Median voter APY across funded gauges, percent. */
  medianApy: amountSchema.nullable(),
})

export type ProtocolStats = z.infer<typeof protocolStatsSchema>

/** One bar of "Incentives by epoch", split by voter for the segment filter. */
export const epochIncentivesSchema = z.object({
  epoch: epochRefSchema,
  totalUsd: amountSchema,
  vebtcUsd: amountSchema,
  validatorsUsd: amountSchema,
  poolsUsd: amountSchema,
})

export type EpochIncentives = z.infer<typeof epochIncentivesSchema>

export const fundedGaugeSchema = z.object({
  gauge: gaugeRefSchema,
  incentives: valueBreakdownSchema,
  /**
   * Deposits the indexer decoded for the gauge this epoch. Null when it has
   * none for a gauge whose reward contracts hold incentives: the count is
   * unknown then, not zero.
   */
  deposits: z.number().int().nonnegative().nullable(),
})

export type FundedGauge = z.infer<typeof fundedGaugeSchema>

export const protocolSchema = z.object({
  epoch: epochRefSchema,
  incentives: z.object({
    usd: amountSchema,
    previousUsd: amountSchema.nullable(),
    /** `usd - previousUsd`; null without a previous epoch. */
    changeUsd: signedAmountSchema.nullable(),
  }),
  stats: protocolStatsSchema,
  /** Oldest first, every epoch from launch (epoch 0) to `epoch`. */
  incentivesByEpoch: z.array(epochIncentivesSchema),
  /** Funded this epoch, by USD descending. */
  funded: z.object({
    count: z.number().int().nonnegative(),
    gauges: z.array(fundedGaugeSchema),
  }),
  /** Newest first: everyone's activity plus system rows. */
  feed: z.object({
    total: z.number().int().nonnegative(),
    rows: z.array(activityRowSchema),
  }),
})

export type Protocol = z.infer<typeof protocolSchema>

export const protocolResponseSchema = readModelResponseSchema(protocolSchema)

export type ProtocolResponse = z.infer<typeof protocolResponseSchema>

/**
 * Everyone's latest activity plus system rows, newest first: the rows
 * behind the Protocol page's "Load more" and filters. The protocol
 * document carries only the first 20, which is what the page paints with.
 */
export const protocolActivitySchema = z.object({
  rows: z.array(activityRowSchema),
})

export type ProtocolActivity = z.infer<typeof protocolActivitySchema>

/** One page of it, as the API serves it. */
export const protocolActivityPageSchema = z.object({
  rows: z.array(activityRowSchema),
  /** The id of the last row, to ask for the next page; null at the end. */
  nextCursor: z.string().nullable(),
})

export type ProtocolActivityPage = z.infer<typeof protocolActivityPageSchema>

export const protocolActivityResponseSchema = readModelResponseSchema(
  protocolActivityPageSchema,
)

export type ProtocolActivityResponse = z.infer<
  typeof protocolActivityResponseSchema
>

/** One epoch of Protocol history: what was funded and where. */
export const protocolEpochSchema = z.object({
  epoch: epochRefSchema,
  incentives: z.object({
    usd: amountSchema,
    previousUsd: amountSchema.nullable(),
    changeUsd: signedAmountSchema.nullable(),
  }),
  /** The same split as the chart's bar. */
  byVoter: epochIncentivesSchema,
  /** Funded that epoch, by USD descending. */
  funded: z.object({
    count: z.number().int().nonnegative(),
    gauges: z.array(fundedGaugeSchema),
  }),
  deposits: z.number().int().nonnegative(),
  /**
   * Stats as they stood when the epoch ended (or now, for the current
   * epoch). Null for epochs that ended before snapshots were kept.
   */
  stats: protocolStatsSchema.nullable(),
})

export type ProtocolEpoch = z.infer<typeof protocolEpochSchema>

export const protocolEpochResponseSchema =
  readModelResponseSchema(protocolEpochSchema)

export type ProtocolEpochResponse = z.infer<typeof protocolEpochResponseSchema>

/** Every epoch since launch, oldest first: the epoch picker and the chart. */
export const protocolHistorySchema = z.object({
  epochs: z.array(
    z.object({
      ...epochIncentivesSchema.shape,
      fundedGauges: z.number().int().nonnegative(),
      deposits: z.number().int().nonnegative(),
    }),
  ),
})

export type ProtocolHistory = z.infer<typeof protocolHistorySchema>

export const protocolHistoryResponseSchema = readModelResponseSchema(
  protocolHistorySchema,
)

export type ProtocolHistoryResponse = z.infer<
  typeof protocolHistoryResponseSchema
>

/** What a signed-out visitor sees: the epoch, the stats and top gauges. */
export const proSummarySchema = z.object({
  epoch: epochRefSchema,
  incentives: protocolSchema.shape.incentives,
  stats: protocolStatsSchema,
  /** Live gauges with incentives, by APY descending, at most five. */
  topGauges: z.array(gaugeCardSchema).max(5),
  gaugeCount: z.number().int().nonnegative(),
  fundedCount: z.number().int().nonnegative(),
  /** Total veMEZO votes this epoch. */
  totalVotes: amountSchema,
})

export type ProSummary = z.infer<typeof proSummarySchema>

export const proSummaryResponseSchema =
  readModelResponseSchema(proSummarySchema)

export type ProSummaryResponse = z.infer<typeof proSummaryResponseSchema>
