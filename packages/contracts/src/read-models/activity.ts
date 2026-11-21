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

/** A UTC day, `YYYY-MM-DD`. */
export const utcDaySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a YYYY-MM-DD day")

/**
 * Where a claim-time price came from: a registry stablecoin's $1, or
 * CoinGecko's daily history (the price at 00:00 UTC that day).
 */
export const claimPriceSourceSchema = z.enum(["usd-peg", "coingecko"])

export type ClaimPriceSource = z.infer<typeof claimPriceSourceSchema>

/** One claimed token's value on the day it was claimed. */
export const claimTokenValueSchema = z.object({
  /** The token's lower-case registry address. */
  token: addressSchema,
  /** USD per whole token used; null when no price existed that day. */
  price: fixedDecimalSchema.nullable(),
  /** The amount at that price, rounded to cents; null with no price. */
  usd: amountSchema.nullable(),
  /** The claim's UTC day, whose 00:00 UTC price was used. */
  day: utcDaySchema,
  /** Null with no price. */
  source: claimPriceSourceSchema.nullable(),
  /**
   * What the token was priced as, by registry address: a stablecoin at
   * $1, a BTC wrapper at BTC's price. Null when it has no price.
   */
  pricedAs: z.enum(["usd", "btc", "mezo"]).nullable(),
})

export type ClaimTokenValue = z.infer<typeof claimTokenValueSchema>

/**
 * What a claim was worth when it was claimed, fixed once known: each
 * token of `rewards` at the price of the claim's UTC day.
 */
export const claimValueSchema = z.object({
  /** Sum of the priced tokens. */
  usd: amountSchema,
  /** One a token of `rewards.tokens`, in the same order. */
  tokens: z.array(claimTokenValueSchema),
})

export type ClaimValue = z.infer<typeof claimValueSchema>

/**
 * A claim's provisional value while its day's price settles (3 days):
 * each token by registry address at the best price known that day, the
 * nearest stored sample before the claim, else the latest price. Not in
 * Earned, and replaced by `atClaim` once the day is priced.
 */
export const claimEstimateSchema = z.object({
  /** Sum of the priced tokens. */
  usd: amountSchema,
  /** One a token of `rewards.tokens`, in the same order. */
  tokens: z.array(
    z.object({
      /** The token's lower-case registry address. */
      token: addressSchema,
      /** Null when nothing prices it. */
      price: fixedDecimalSchema.nullable(),
      usd: amountSchema.nullable(),
    }),
  ),
  /** The UTC day its value when claimed is due to be final. */
  finalOn: utcDaySchema,
})

export type ClaimEstimate = z.infer<typeof claimEstimateSchema>

export const claimRowSchema = z.object({
  type: z.literal("claim"),
  ...rowFields,
  /** The epoch whose rewards were claimed, when one epoch is known. */
  epoch: epochRefSchema.nullable(),
  /** USD at the price when the row was written, not when claimed. */
  rewards: valueBreakdownSchema,
  /**
   * The value when claimed. Absent until the claim's day has a settled
   * price (a few days), or in rows written before it was recorded.
   */
  atClaim: claimValueSchema.optional(),
  /** Without `atClaim`, inside the 3 settling days: an estimate. */
  estimate: claimEstimateSchema.optional(),
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
  /**
   * On the internal route's last page: the wallet has older rows the API
   * does not hold yet (its history is still being stored). Absent or false
   * otherwise. Never in a stored document.
   */
  pending: z.boolean().optional(),
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
