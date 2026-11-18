import { z } from "zod"
import { addressSchema } from "../common"
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
    usd: amountSchema,
    fromEpoch: z.number().int().nullable(),
    toEpoch: z.number().int().nullable(),
  }),
  /** Newest first. */
  history: z.array(rewardClaimSchema),
})

export type WalletRewards = z.infer<typeof walletRewardsSchema>

export const walletRewardsResponseSchema =
  readModelResponseSchema(walletRewardsSchema)

export type WalletRewardsResponse = z.infer<typeof walletRewardsResponseSchema>
