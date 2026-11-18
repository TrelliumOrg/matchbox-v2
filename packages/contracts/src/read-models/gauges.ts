import { z } from "zod"
import { addressSchema, httpsUrlSchema } from "../common"
import { voterKindSchema } from "../market"
import {
  type GaugeCardMeta,
  gaugeCardMetaSchema,
  gaugeDetailsSchema,
  isRetiredLock,
} from "./gauge-kinds"
import {
  amountSchema,
  epochRefSchema,
  type GaugeKind,
  gaugeKindFor,
  gaugeKindSchema,
  gaugeRefSchema,
  readModelResponseSchema,
  signedAmountSchema,
  tokenAmountSchema,
  unixSecondsSchema,
  valueBreakdownSchema,
} from "./primitives"

// Vote's gauge directory and the gauge profile.

/** What a gauge's votes are counted in. */
export const voteUnitSchema = z.enum(["veMEZO", "veBTC"])

export type VoteUnit = z.infer<typeof voteUnitSchema>

/** veMEZO votes veBTC and MEZO gauges; veBTC votes validators and pools. */
export function voteUnitFor(kind: GaugeKind): VoteUnit {
  return kind === "vebtc" || kind === "mezo" ? "veMEZO" : "veBTC"
}

/** Cards documents wrote before `votesUnit` get it from their gauge. */
function withVotesUnit(value: unknown): unknown {
  if (typeof value !== "object" || value === null || "votesUnit" in value) {
    return value
  }
  const parsed = z
    .object({ gauge: z.object({ voter: voterKindSchema }) })
    .safeParse(value)
  return parsed.success
    ? {
        ...value,
        votesUnit: voteUnitFor(gaugeKindFor(parsed.data.gauge.voter)),
      }
    : value
}

/** True for veBTC gauges whose lock expired or was withdrawn. */
export function isRetiredGauge(card: { meta: GaugeCardMeta | null }): boolean {
  return card.meta?.kind === "vebtc" && isRetiredLock(card.meta.lock)
}

/** Gauge card on Vote. */
export const gaugeCardSchema = z.preprocess(
  withVotesUnit,
  z.object({
    gauge: gaugeRefSchema,
    /** One line from the profile, or the short beneficiary address. */
    tagline: z.string().nullable(),
    isAlive: z.boolean(),
    /** Voter APY in percent; null when the gauge has no incentives. */
    apy: amountSchema.nullable(),
    /** This epoch's incentives, per token. */
    incentives: valueBreakdownSchema,
    /** veBTC locked behind a boost gauge (boost gauges only). */
    vebtcWeight: amountSchema.nullable(),
    /**
     * Votes on the gauge this epoch, whole units of `votesUnit`: veMEZO on
     * veBTC and MEZO gauges, veBTC on validator and pool gauges.
     */
    votes: amountSchema,
    votesUnit: voteUnitSchema,
    /** Votes at which the boost reaches 5x; null when not a boost gauge. */
    optimalVotes: amountSchema.nullable(),
    /** Boost multiplier, "1" to "5"; null when not a boost gauge. */
    boost: amountSchema.nullable(),
    /** The kind's compact metadata; null in documents written before it. */
    meta: gaugeCardMetaSchema.nullable().default(null),
  }),
)

export type GaugeCard = z.infer<typeof gaugeCardSchema>

/** Gauges per kind, for tabs with counts. */
export const gaugeKindTotalsSchema = z.object({
  vebtc: z.number().int().nonnegative(),
  validator: z.number().int().nonnegative(),
  pool: z.number().int().nonnegative(),
  mezo: z.number().int().nonnegative(),
})

export type GaugeKindTotals = z.infer<typeof gaugeKindTotalsSchema>

export const gaugeDirectorySchema = z.object({
  epoch: epochRefSchema,
  /**
   * One page of gauges in the requested order (votes descending by
   * default). The stored document holds every gauge; the route pages it.
   */
  gauges: z.array(gaugeCardSchema),
  /** Total veMEZO votes this epoch (for shares). */
  totalVotes: amountSchema,
  /** Gauges matching the query, across every page. */
  total: z.number().int().nonnegative().default(0),
  /**
   * Gauges per kind across the whole directory (every other filter
   * applied, `kind` itself ignored), so tabs can show their counts.
   */
  kinds: gaugeKindTotalsSchema.default({
    vebtc: 0,
    validator: 0,
    pool: 0,
    mezo: 0,
  }),
  /** Pass as `cursor` for the next page; null on the last page. */
  nextCursor: z.string().nullable().default(null),
})

export type GaugeDirectory = z.infer<typeof gaugeDirectorySchema>

export const gaugeDirectoryResponseSchema =
  readModelResponseSchema(gaugeDirectorySchema)

export type GaugeDirectoryResponse = z.infer<
  typeof gaugeDirectoryResponseSchema
>

export const gaugeLinkKindSchema = z.enum(["website", "x", "discord", "other"])

export const gaugeIncentiveEpochSchema = z.object({
  epoch: epochRefSchema,
  /** `upcoming` pays at `paysAt`; `paid` paid then. */
  status: z.enum(["upcoming", "paid"]),
  paysAt: unixSecondsSchema,
  incentives: valueBreakdownSchema,
})

export type GaugeIncentiveEpoch = z.infer<typeof gaugeIncentiveEpochSchema>

/** One epoch of a gauge's history: its votes and the incentives on it. */
export const gaugeEpochSchema = z.object({
  epoch: epochRefSchema,
  /**
   * Votes on the gauge as of the epoch's last vote event (veMEZO for veBTC
   * gauges, veBTC elsewhere), whole votes.
   */
  votes: amountSchema,
  /** Incentives deposited for the epoch, priced at today's prices. */
  incentives: valueBreakdownSchema,
})

export type GaugeEpoch = z.infer<typeof gaugeEpochSchema>

/**
 * A gauge's full history, every epoch from its first vote or deposit to the
 * current one, oldest first. Written by matchbox-jobs from the warehouse
 * (read model `gauge-history`, keyed by gauge address).
 */
export const gaugeHistorySchema = z.object({
  address: addressSchema,
  /** What `votes` is counted in. */
  votesUnit: voteUnitSchema,
  epochs: z.array(gaugeEpochSchema),
})

export type GaugeHistory = z.infer<typeof gaugeHistorySchema>

/**
 * How consistently each gauge is funded, for rankings (Stuart's "most
 * consistently funded"): per gauge, finished epochs with incentives among
 * the last `window`, and every finished epoch it was ever funded. Read model
 * `gauge-funding` (key `current`), written by matchbox-jobs; gauges never
 * funded are left out. Not on gauge cards or the paged list.
 */
export const gaugeFundingSchema = z.object({
  /** The window, in finished epochs. */
  window: z.number().int().positive(),
  /** The last finished epoch counted. */
  throughEpoch: z.number().int().nonnegative(),
  gauges: z.record(
    z.string(),
    z.object({
      /** Funded epochs among the last `window`. */
      recent: z.number().int().nonnegative(),
      /** Funded epochs ever. */
      total: z.number().int().nonnegative(),
      /** Consecutive funded epochs up to `throughEpoch`. */
      streak: z.number().int().nonnegative(),
    }),
  ),
})

export type GaugeFunding = z.infer<typeof gaugeFundingSchema>

/** One gauge in the consistency ranking. */
export const gaugeConsistencySchema = z.object({
  gauge: gaugeRefSchema,
  recent: z.number().int().nonnegative(),
  window: z.number().int().positive(),
  total: z.number().int().nonnegative(),
  streak: z.number().int().nonnegative(),
})

/** `/internal/pro/gauges/consistency`: most consistently funded first. */
export const gaugeConsistencyRankingSchema = z.object({
  throughEpoch: z.number().int().nonnegative(),
  window: z.number().int().positive(),
  gauges: z.array(gaugeConsistencySchema),
})

export type GaugeConsistencyRanking = z.infer<
  typeof gaugeConsistencyRankingSchema
>

export const gaugeConsistencyQuerySchema = z.object({
  kind: gaugeKindSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
})

export const gaugeProfileReadModelSchema = z.object({
  card: gaugeCardSchema,
  description: z.string().nullable(),
  tags: z.array(z.string()),
  links: z.array(z.object({ kind: gaugeLinkKindSchema, url: httpsUrlSchema })),
  /** Who receives the gauge's incentives (the veBTC owner). */
  owner: addressSchema.nullable(),
  /** The boosted lock's locked BTC (boost gauges only). */
  locked: tokenAmountSchema.nullable(),
  votingStrategy: z.string().nullable(),
  incentiveStrategy: z.string().nullable(),
  /** APY change against the previous epoch, in percentage points. */
  apyChange: signedAmountSchema.nullable(),
  /** Oldest first, up to 12 epochs. */
  votesHistory: z.array(
    z.object({ epoch: epochRefSchema, votes: amountSchema }),
  ),
  /** Newest first. */
  incentivesHistory: z.array(gaugeIncentiveEpochSchema),
  /**
   * Every epoch with votes or incentives, oldest first (from
   * `gauge-history`); the profile route always sets it, empty until the
   * warehouse has written it.
   */
  history: z.array(gaugeEpochSchema).optional(),
  /** The kind's full metadata; null when unread, absent in old documents. */
  details: gaugeDetailsSchema.nullable().optional(),
})

export type GaugeProfileReadModel = z.infer<typeof gaugeProfileReadModelSchema>

export const gaugeProfileResponseSchema = readModelResponseSchema(
  gaugeProfileReadModelSchema,
)

export type GaugeProfileResponse = z.infer<typeof gaugeProfileResponseSchema>

export const gaugeSortSchema = z.enum(["votes", "apy", "incentives"])

export type GaugeSort = z.infer<typeof gaugeSortSchema>

/** `/internal/pro/gauges` query: filters, order and one page. */
export const gaugeQuerySchema = z.object({
  voter: z.enum(["boost", "pools", "validators", "third-party"]).optional(),
  /** Gauge kind; the directory's `kinds` totals ignore this filter. */
  kind: gaugeKindSchema.optional(),
  sort: gaugeSortSchema.default("votes"),
  /** Case-insensitive match on the name or an address prefix. */
  q: z.string().trim().min(1).max(64).optional(),
  /** Comma-separated gauge addresses (ballots, watch lists), at most 50. */
  addresses: z
    .string()
    .max(50 * 43)
    .transform((value) =>
      value
        .split(",")
        .map((address) => address.trim().toLowerCase())
        .filter((address) => address.length > 0),
    )
    .pipe(z.array(z.string().regex(/^0x[0-9a-f]{40}$/)).max(50))
    .optional(),
  /** Only live gauges with incentives this epoch. */
  funded: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
  cursor: z
    .string()
    .regex(/^[0-9]{1,6}$/)
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
})

export type GaugeQuery = z.output<typeof gaugeQuerySchema>
