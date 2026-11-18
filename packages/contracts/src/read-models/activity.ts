import { z } from "zod"
import { addressSchema } from "../common"
import { fixedDecimalSchema } from "../market"
import {
  allocationSchema,
  amountSchema,
  blockNumberSchema,
  epochRefSchema,
  gaugeRefSchema,
  lockRefSchema,
  readModelResponseSchema,
  tokenAmountSchema,
  txHashSchema,
  unixSecondsSchema,
  valueBreakdownSchema,
} from "./primitives"

// One row per thing a person (or the system) did, typed so each screen can
// draw it without parsing: the Overview and Activity lists, the activity
// detail sheet, and the Protocol live feed.

/**
 * Indexed rows are always `confirmed`. `pending` and `reverted` exist so the
 * app can merge its own unconfirmed or failed transactions into the list.
 */
export const activityStatusSchema = z.enum(["confirmed", "pending", "reverted"])

export type ActivityStatus = z.infer<typeof activityStatusSchema>

const rowFields = {
  /** `{txHash}-{logIndex}`, stable across snapshots. */
  id: z.string().min(1),
  txHash: txHashSchema,
  /** `null` while pending. */
  block: blockNumberSchema.nullable(),
  timestamp: unixSecondsSchema,
  status: activityStatusSchema,
  /** Who signed or acted. */
  actor: addressSchema,
}

export const voteRowSchema = z.object({
  type: z.literal("vote"),
  ...rowFields,
  lock: lockRefSchema,
  epoch: epochRefSchema,
  /** Voting power spent, in votes (veMEZO) or veBTC. */
  votes: amountSchema,
  allocations: z.array(allocationSchema),
})

export const claimRowSchema = z.object({
  type: z.literal("claim"),
  ...rowFields,
  /** The epoch whose rewards were claimed, when one epoch is known. */
  epoch: epochRefSchema.nullable(),
  rewards: valueBreakdownSchema,
  locks: z.array(lockRefSchema),
  gauges: z.array(gaugeRefSchema),
})

export const lockCreateRowSchema = z.object({
  type: z.literal("lock-create"),
  ...rowFields,
  lock: lockRefSchema,
  amount: tokenAmountSchema,
  /** `null` for a permanent lock. */
  unlocksAt: unixSecondsSchema.nullable(),
})

export const lockAddRowSchema = z.object({
  type: z.literal("lock-add"),
  ...rowFields,
  lock: lockRefSchema,
  amount: tokenAmountSchema,
  unlocksAt: unixSecondsSchema.nullable(),
})

export const lockExtendRowSchema = z.object({
  type: z.literal("lock-extend"),
  ...rowFields,
  lock: lockRefSchema,
  previousUnlocksAt: unixSecondsSchema.nullable(),
  /** `null` when the lock became permanent. */
  unlocksAt: unixSecondsSchema.nullable(),
})

export const lockMergeRowSchema = z.object({
  type: z.literal("lock-merge"),
  ...rowFields,
  /** The lock that was merged away. */
  from: lockRefSchema,
  /** The lock that received it. */
  into: lockRefSchema,
  amount: tokenAmountSchema,
})

export const lockWithdrawRowSchema = z.object({
  type: z.literal("lock-withdraw"),
  ...rowFields,
  lock: lockRefSchema,
  amount: tokenAmountSchema,
})

export const incentiveRowSchema = z.object({
  type: z.literal("incentive"),
  ...rowFields,
  gauge: gaugeRefSchema,
  /** The epoch the incentive pays out for. */
  epoch: epochRefSchema,
  amount: tokenAmountSchema,
})

export const boostRowSchema = z.object({
  type: z.literal("boost"),
  ...rowFields,
  gauge: gaugeRefSchema,
  /** The veBTC lock whose boost changed. */
  lock: lockRefSchema,
  /** Multipliers, "3.6" to "3.9". */
  previousBoost: fixedDecimalSchema,
  boost: fixedDecimalSchema,
})

/** Keeper pokes that refresh many boosts at once (the "System" segment). */
export const boostRefreshRowSchema = z.object({
  type: z.literal("boost-refresh"),
  ...rowFields,
  /** Known keeper name ("Tigris maintainer"); null when unknown. */
  actorName: z.string().nullable(),
  positions: z.number().int().nonnegative(),
})

export const activityRowSchema = z.discriminatedUnion("type", [
  voteRowSchema,
  claimRowSchema,
  lockCreateRowSchema,
  lockAddRowSchema,
  lockExtendRowSchema,
  lockMergeRowSchema,
  lockWithdrawRowSchema,
  incentiveRowSchema,
  boostRowSchema,
  boostRefreshRowSchema,
])

export type ActivityRow = z.infer<typeof activityRowSchema>

export type ActivityType = ActivityRow["type"]

/** The Activity screen's tabs (All is no filter). */
export const activityCategorySchema = z.enum([
  "votes",
  "claims",
  "locks",
  "incentives",
  "system",
])

export type ActivityCategory = z.infer<typeof activityCategorySchema>

const categoryByType = {
  vote: "votes",
  claim: "claims",
  "lock-create": "locks",
  "lock-add": "locks",
  "lock-extend": "locks",
  "lock-merge": "locks",
  "lock-withdraw": "locks",
  incentive: "incentives",
  boost: "votes",
  "boost-refresh": "system",
} as const satisfies Record<ActivityType, ActivityCategory>

export function activityCategory(type: ActivityType): ActivityCategory {
  return categoryByType[type]
}

export function activityTypesIn(category: ActivityCategory): ActivityType[] {
  return (Object.keys(categoryByType) as ActivityType[]).filter(
    (type) => categoryByType[type] === category,
  )
}

/** A wallet's activity, newest first. */
export const walletActivitySchema = z.object({
  address: addressSchema,
  rows: z.array(activityRowSchema),
  nextCursor: z.string().nullable(),
})

export type WalletActivity = z.infer<typeof walletActivitySchema>

export const walletActivityResponseSchema =
  readModelResponseSchema(walletActivitySchema)

export type WalletActivityResponse = z.infer<
  typeof walletActivityResponseSchema
>

export const activityQuerySchema = z.object({
  category: activityCategorySchema.optional(),
  cursor: z.string().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
})

export type ActivityQuery = z.infer<typeof activityQuerySchema>
