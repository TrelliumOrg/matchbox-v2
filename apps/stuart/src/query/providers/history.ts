import { z } from "zod"

// The two history shapes Stuart's tools read (wallet earnings and one boost
// gauge's recent epochs). They keep the old Pro history Worker's wire format
// (`features/history/schema.ts` on feat/pro-rebuild) so the tools did not
// change; `readModelProviders.ts` now fills them from the API read models.
// Big integers travel as decimal strings, USD as decimal strings with up to
// 6 fraction digits, or null when unpriced.

const uint = z.string().regex(/^\d+$/)
const usd = z.string().regex(/^\d+(\.\d{1,6})?$/)
const hexAddress = z.string().regex(/^0x[0-9a-f]{40}$/)

export const historyTokenAmountSchema = z.object({
  token: hexAddress,
  symbol: z.string(),
  decimals: z.number().int().min(0).max(36),
  amount: uint,
  usdAtEarn: usd.nullable(),
  usdNow: usd.nullable(),
  /** In aggregates: this token's lines left out of the USD sums. */
  unpriced: z.number().int().nonnegative().optional(),
})

export type WireTokenAmount = z.infer<typeof historyTokenAmountSchema>

const epochRef = { epochStart: uint, epochEnd: uint }

const totalsSchema = z.object({
  tokens: z.array(historyTokenAmountSchema),
  usdAtEarn: usd.nullable(),
  usdNow: usd.nullable(),
  unpriced: z.number().int().nonnegative(),
})

export const earningsSchema = z.object({
  /** veMEZO locks included. */
  tokenIds: z.array(uint),
  current: z.object({
    ...epochRef,
    status: z.literal("projected"),
    tokens: z.array(historyTokenAmountSchema),
    usdNow: usd.nullable(),
  }),
  /** Sealed epochs, oldest first. */
  epochs: z.array(
    z.object({
      ...epochRef,
      status: z.literal("sealed"),
      tokens: z.array(historyTokenAmountSchema),
      usdAtEarn: usd.nullable(),
      usdNow: usd.nullable(),
      unpriced: z.number().int().nonnegative(),
    }),
  ),
  totals: z.object({
    realized: totalsSchema,
    claimed: totalsSchema,
    claimable: totalsSchema,
    projected: totalsSchema,
  }),
  /** Σ claimable per (lock, bribe, token) equals the contract's `earned()`. */
  verified: z.boolean(),
  /** Some token lines are unpriced: USD sums are lower bounds. */
  partial: z.boolean(),
})

export type WireEarnings = z.infer<typeof earningsSchema>

export const gaugeEpochsSchema = z.object({
  rows: z.array(
    z.object({
      ...epochRef,
      status: z.enum(["sealed", "current"]),
      /** Votes on the gauge that epoch, 18 decimals. */
      veMezo: uint,
      /** 1e18 = 1×; null when unknown. */
      boostWad: uint.nullable(),
      incentives: z.array(historyTokenAmountSchema),
      incentivesUsd: usd.nullable(),
      apyBps: uint.nullable(),
    }),
  ),
})

export type WireGaugeEpochs = z.infer<typeof gaugeEpochsSchema>
