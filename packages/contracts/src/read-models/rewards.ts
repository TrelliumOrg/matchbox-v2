import { z } from "zod"
import { addressSchema } from "../common"
import { claimEstimateSchema, claimValueSchema } from "./activity"
import {
  amountSchema,
  blockNumberSchema,
  claimableAsOfSchema,
  epochRefSchema,
  gaugeRefSchema,
  lockRefSchema,
  readModelResponseSchema,
  tokenAmountSchema,
  txHashSchema,
  unixSecondsSchema,
  valueBreakdownSchema,
} from "./primitives"

// Rewards: what is ready to claim (per token and per lock, split by gauge)
// and what was claimed before, per epoch.

export const lockRewardsSchema = z.object({
  lock: lockRefSchema,
  rewards: valueBreakdownSchema,
  /** Where this lock's rewards come from. */
  gauges: z.array(
    z.object({
      gauge: gaugeRefSchema,
      usd: amountSchema,
      tokens: z.array(tokenAmountSchema),
    }),
  ),
})

export type LockRewards = z.infer<typeof lockRewardsSchema>

export const rewardClaimSchema = z.object({
  epoch: epochRefSchema,
  claimedAt: unixSecondsSchema,
  rewards: valueBreakdownSchema,
  /** The value when claimed; absent until its day's price is settled. */
  atClaim: claimValueSchema.optional(),
  /** Without `atClaim`, inside the 3 settling days: an estimate. */
  estimate: claimEstimateSchema.optional(),
  txHash: txHashSchema,
  block: blockNumberSchema,
})

export type RewardClaim = z.infer<typeof rewardClaimSchema>

export const walletRewardsSchema = z.object({
  address: addressSchema,
  /** The epoch these rewards were earned in; null with nothing to claim. */
  epoch: epochRefSchema.nullable(),
  /** The per-token ledger. */
  readyToClaim: valueBreakdownSchema,
  /** Where the claimable figures come from; set by the API. */
  claimableAsOf: claimableAsOfSchema.optional(),
  byLock: z.array(lockRewardsSchema),
  /** Claimed so far, over the epochs the history covers. */
  earned: z.object({
    /**
     * With `whenClaimed`, the sum of every claim's value when claimed.
     * Without it (a document written before), USD near when it was written.
     */
    usd: amountSchema,
    fromEpoch: z.number().int().nullable(),
    toEpoch: z.number().int().nullable(),
    /**
     * Claims `usd` leaves out: some token had no price that day
     * (`unpriced`, counted with the tokens that had one), or the day's
     * price is not settled yet (`pending`, not counted at all, even with
     * an estimate: Earned never drops when an estimate settles lower).
     */
    whenClaimed: z
      .object({
        unpriced: z.number().int().nonnegative(),
        pending: z.number().int().nonnegative(),
        /**
         * Of `pending`, the claims whose day is still settling (the last
         * 3 days). The rest wait for a price past their day. Absent in
         * documents written before it.
         */
        settling: z.number().int().nonnegative().optional(),
      })
      .optional(),
  }),
  /** Newest first. */
  history: z.array(rewardClaimSchema),
})

export type WalletRewards = z.infer<typeof walletRewardsSchema>

export const walletRewardsResponseSchema =
  readModelResponseSchema(walletRewardsSchema)

export type WalletRewardsResponse = z.infer<typeof walletRewardsResponseSchema>
