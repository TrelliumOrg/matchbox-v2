import { z } from "zod"
import { addressSchema } from "../common"
import { voterKindSchema } from "../market"
import { activityRowSchema } from "./activity"
import {
  allocationSchema,
  amountSchema,
  claimableAsOfSchema,
  epochRefSchema,
  escrowSchema,
  gaugeRefSchema,
  lockRefSchema,
  locksAsOfSchema,
  readModelResponseSchema,
  tokenAmountSchema,
  tokenIdSchema,
  unixSecondsSchema,
  valueBreakdownSchema,
} from "./primitives"

// Overview: the wallet's claimable total, one card per lock, and the latest
// activity.

/** The lock card's coloured tab: veBTC orange, veMEZO pink, expired grey. */
export const lockTabSchema = z.enum(["vebtc", "vemezo", "expired"])

export type LockTab = z.infer<typeof lockTabSchema>

/**
 * A lock's votes through one voter contract. A lock votes through two
 * (veMEZO: BoostVoter and ThirdPartyVoter; veBTC: ValidatorsVoter and
 * PoolsVoter) and each spends the lock's full voting power, with its own
 * once-an-epoch rule. So shares and the last vote are per voter.
 */
export const voterVoteSchema = z.object({
  voter: voterKindSchema,
  /** Votes cast through this voter, in whole votes. */
  votes: amountSchema,
  /** Shares of this voter's votes; they add up to 10000. */
  allocations: z.array(allocationSchema),
  /** When the lock last voted through this voter. */
  votedAt: unixSecondsSchema,
})

export type VoterVote = z.infer<typeof voterVoteSchema>

/** Vote state for the current epoch. */
export const lockVoteSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("voted"),
    epoch: epochRefSchema,
    /**
     * Votes cast through both of the lock's voters, added together: up to
     * twice its voting power. Prefer `byVoter`.
     */
    votes: amountSchema,
    /**
     * Shares of `votes`, so of both voters together: a lock voting 100%
     * on each of its voters shows 50% and 50% here. Prefer `byVoter`.
     */
    allocations: z.array(allocationSchema),
    /** The latest vote through either voter. Prefer `byVoter`. */
    votedAt: unixSecondsSchema,
    /**
     * The same votes per voter. Empty in documents written before
     * 12 Nov 2026; readers then fall back to the three fields above.
     */
    byVoter: z.array(voterVoteSchema).default([]),
  }),
  z.object({ status: z.literal("not-voted"), epoch: epochRefSchema }),
])

export type LockVote = z.infer<typeof lockVoteSchema>

export const walletLockSchema = z.object({
  escrow: escrowSchema,
  tokenId: tokenIdSchema,
  tab: lockTabSchema,
  /** Locked BTC or MEZO, with its USD value. */
  locked: tokenAmountSchema,
  /** Current voting power in whole units (veBTC or veMEZO). */
  votingPower: amountSchema,
  /** `null` for a permanent lock. */
  unlocksAt: unixSecondsSchema.nullable(),
  isPermanent: z.boolean(),
  /** Can be withdrawn now (expired, not permanent). */
  isWithdrawable: z.boolean(),
  vote: lockVoteSchema,
  /** Rewards this lock can claim now, per token. */
  claimable: valueBreakdownSchema,
  /**
   * What this lock's current votes earn when the current epoch ends, at the
   * incentives and votes known now (each gauge's tokens times the lock's
   * share of the gauge's votes). Null when the lock has not voted.
   */
  projected: valueBreakdownSchema.nullable().default(null),
  /** Boost multiplier for a veBTC lock with a boost gauge ("4.4"). */
  boost: amountSchema.nullable(),
  createdAt: unixSecondsSchema.nullable(),
})

export type WalletLock = z.infer<typeof walletLockSchema>

/**
 * The one actionable suggestion on Overview, most urgent first: withdraw an
 * expired lock, vote with a lock that has power but no vote this epoch,
 * top up a boost gauge the wallet votes for that is close to 5x, or claim.
 */
export const suggestionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("withdraw"),
    lock: lockRefSchema,
    amount: tokenAmountSchema,
  }),
  z.object({
    type: z.literal("vote"),
    lock: lockRefSchema,
    epoch: epochRefSchema,
    /** Unused voting power, whole units. */
    votingPower: amountSchema,
  }),
  z.object({
    type: z.literal("boost"),
    gauge: gaugeRefSchema,
    /** The wallet's veMEZO lock that votes for it. */
    lock: lockRefSchema,
    boost: amountSchema,
    /** Votes the gauge has and the votes at which it reaches 5x. */
    votes: amountSchema,
    optimalVotes: amountSchema,
    /** `optimalVotes - votes`. */
    missingVotes: amountSchema,
  }),
  z.object({
    type: z.literal("claim"),
    epoch: epochRefSchema,
    claimable: valueBreakdownSchema,
  }),
])

export type Suggestion = z.infer<typeof suggestionSchema>

export const walletOverviewSchema = z.object({
  address: addressSchema,
  /** The epoch whose rewards are claimable. */
  claimableEpoch: epochRefSchema.nullable(),
  /** Sum over every lock, per token. */
  claimable: valueBreakdownSchema,
  /** Where the claimable figures come from; set by the API. */
  claimableAsOf: claimableAsOfSchema.optional(),
  /** Where the locks and their votes come from; set by the API. */
  locksAsOf: locksAsOfSchema.optional(),
  locks: z.array(walletLockSchema),
  /** Sum of every lock's `projected`, per token; null with no votes. */
  projected: valueBreakdownSchema.nullable().default(null),
  suggestion: suggestionSchema.nullable().default(null),
  /** The three latest rows; the full list is the activity read model. */
  recentActivity: z.array(activityRowSchema).max(10),
})

export type WalletOverview = z.infer<typeof walletOverviewSchema>

export const walletOverviewResponseSchema =
  readModelResponseSchema(walletOverviewSchema)

export type WalletOverviewResponse = z.infer<
  typeof walletOverviewResponseSchema
>
