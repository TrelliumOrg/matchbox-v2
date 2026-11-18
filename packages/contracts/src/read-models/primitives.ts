import { z } from "zod"
import { addressSchema, decimalStringSchema } from "../common"
import { fixedDecimalSchema, voterKindSchema } from "../market"
import { networkSlugSchema } from "../network"

// Read models are what the Pro screens render, already joined and priced.
// Conventions:
// - Money and token amounts are decimal strings in whole units ("0.000412"
//   BTC, "212.48" USD), never JS numbers and never base units. Formatting
//   (compact votes, 2 or 4 decimals) is the UI's job.
// - Block numbers and unix-second timestamps are integers (both stay far
//   below 2^53). Token ids are decimal strings (they are uint256).
// - Percentages are decimal strings in percent units ("2.56" is 2.56%).

/** Non-negative decimal in whole units (USD, token amounts, votes). */
export const amountSchema = fixedDecimalSchema

/** Decimal that may be negative (changes, deltas). */
export const signedAmountSchema = z
  .string()
  .regex(/^-?(0|[1-9][0-9]*)(\.[0-9]+)?$/, "Expected a decimal")

export const tokenIdSchema = decimalStringSchema

export const blockNumberSchema = z.number().int().nonnegative()

/** Unix seconds. */
export const unixSecondsSchema = z.number().int().nonnegative()

export const txHashSchema = z
  .string()
  .regex(/^0x[0-9a-f]{64}$/, "Expected a lower-case transaction hash")

/** A token as the UI needs it: the icon is resolved from the address. */
export const tokenRefSchema = z.object({
  address: addressSchema,
  symbol: z.string().min(1),
  /** CoinGecko-style display name ("Bitcoin", "Mezo USD"). */
  name: z.string().min(1),
  decimals: z.number().int().min(0).max(36),
})

export type TokenRef = z.infer<typeof tokenRefSchema>

/** An amount of one token, with its USD value when the token is priced. */
export const tokenAmountSchema = z.object({
  token: tokenRefSchema,
  amount: amountSchema,
  usd: amountSchema.nullable(),
})

export type TokenAmount = z.infer<typeof tokenAmountSchema>

/** A USD total with its per-token breakdown (coin stacks, ledgers). */
export const valueBreakdownSchema = z.object({
  /** Sum of the priced tokens. */
  usd: amountSchema,
  tokens: z.array(tokenAmountSchema),
})

export type ValueBreakdown = z.infer<typeof valueBreakdownSchema>

export const escrowSchema = z.enum(["vebtc", "vemezo"])

export type Escrow = z.infer<typeof escrowSchema>

/** A lock named in a row or a split (`#4120`). */
export const lockRefSchema = z.object({
  escrow: escrowSchema,
  tokenId: tokenIdSchema,
})

export type LockRef = z.infer<typeof lockRefSchema>

/**
 * How a gauge is drawn: a profile picture, a token pair (pool gauges), or an
 * initials circle when the gauge has no profile.
 */
export const gaugePictureSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("image"), url: z.url() }),
  z.object({
    type: z.literal("pair"),
    tokens: z.tuple([tokenRefSchema, tokenRefSchema]),
  }),
  z.object({
    type: z.literal("initials"),
    text: z.string().min(1).max(3),
  }),
])

export type GaugePicture = z.infer<typeof gaugePictureSchema>

/** Pool gauges: a classic volatile or stable pair, or concentrated liquidity. */
export const poolTypeSchema = z.enum(["volatile", "stable", "cl"])

/**
 * What a gauge is, from its voter: veBTC boost gauges (BoostVoter), validator
 * gauges (ValidatorsVoter), pool gauges (PoolsVoter: DEX pools and vaults)
 * and MEZO gauges (ThirdPartyVoter `NonStakingGauge`s, shown as
 * cross-chain: they direct MEZO incentives to pools on other chains or to a
 * recipient).
 */
export const gaugeKindSchema = z.enum(["vebtc", "validator", "pool", "mezo"])

export type GaugeKind = z.infer<typeof gaugeKindSchema>

export const gaugeKinds = gaugeKindSchema.options

const kindByVoter = {
  boost: "vebtc",
  validators: "validator",
  pools: "pool",
  "third-party": "mezo",
} as const satisfies Record<z.infer<typeof voterKindSchema>, GaugeKind>

/** A gauge's kind from its voter. */
export function gaugeKindFor(
  voter: z.infer<typeof voterKindSchema>,
): GaugeKind {
  return kindByVoter[voter]
}

/** Documents written before `kind` existed get it from their voter. */
function withKind(value: unknown): unknown {
  if (typeof value !== "object" || value === null || "kind" in value) {
    return value
  }
  const parsed = z.object({ voter: voterKindSchema }).safeParse(value)
  return parsed.success
    ? { ...value, kind: gaugeKindFor(parsed.data.voter) }
    : value
}

/** `#RRGGBB`, upper case. */
export const hexColorSchema = z
  .string()
  .regex(/^#[0-9A-F]{6}$/, "Expected an upper-case #RRGGBB colour")

/** Enough of a gauge to draw it in a row, a split or a card header. */
export const gaugeRefSchema = z.preprocess(
  withKind,
  z.object({
    address: addressSchema,
    voter: voterKindSchema,
    kind: gaugeKindSchema,
    /** Profile name, pool symbol, validator moniker, or "veBTC #604". */
    name: z.string().min(1),
    /** The boosted veBTC lock (boost gauges only). */
    vebtcTokenId: tokenIdSchema.nullable(),
    picture: gaugePictureSchema,
    /** Pool gauges only. */
    poolType: poolTypeSchema.nullable(),
    /**
     * The gauge's brand colour for allocation marks and split bars: the
     * profile's colour when it has one, the dominant token's colour for pool
     * gauges, otherwise a stable pick from the address. Null only in documents
     * written before the field existed.
     */
    color: hexColorSchema.nullable().default(null),
    /** Concentrated-liquidity pools only: the pool's tick spacing. */
    tickSpacing: z.number().int().positive().nullable().default(null),
    /**
     * The one coin a single-token gauge stands for (vault gauges such as
     * sMUSD); null otherwise.
     */
    coin: tokenRefSchema.nullable().default(null),
  }),
)

export type GaugeRef = z.infer<typeof gaugeRefSchema>

/** One gauge's share of a lock's votes or of a reward split. */
export const allocationSchema = z.object({
  gauge: gaugeRefSchema,
  /** 0 to 10000. */
  basisPoints: z.number().int().min(0).max(10_000),
})

export type Allocation = z.infer<typeof allocationSchema>

/** An epoch as Pro labels it. */
export const epochRefSchema = z.object({
  number: z.number().int(),
  start: unixSecondsSchema,
  end: unixSecondsSchema,
})

export type EpochRef = z.infer<typeof epochRefSchema>

export const readModelSourceSchema = z.enum([
  /** Neon projections, copied into D1 on the indexer's 15-minute tick. */
  "warehouse",
  /** Mezo RPC multicall snapshot (every 1 to 5 minutes). */
  "live",
  /** Shared demo data; development and tests only. */
  "fixture",
])

export type ReadModelSource = z.infer<typeof readModelSourceSchema>

/** Where and when a read model was built. */
export const readModelMetaSchema = z.object({
  network: networkSlugSchema,
  source: readModelSourceSchema,
  /** Last block the data reflects. */
  block: blockNumberSchema,
  /** When the snapshot was written. */
  updatedAt: unixSecondsSchema,
})

export type ReadModelMeta = z.infer<typeof readModelMetaSchema>

/** `{ data, meta }`, the envelope of every `/internal/pro` response. */
export function readModelResponseSchema<Data extends z.ZodType>(data: Data) {
  return z.object({ data, meta: readModelMetaSchema })
}

/**
 * Where a wallet document's claimable figures come from. The API reads
 * claimable from the chain for the wallet being asked for and lays it over
 * the stored document ("live", at that block). When that read fails or is
 * too slow the stored figures are served instead ("stored", at the block
 * the document was built), and a screen says "as of block N" beside them.
 * Absent in a stored document: only the API sets it.
 */
export const claimableAsOfSchema = z.object({
  block: z.number().int().nonnegative(),
  source: z.enum(["live", "stored"]),
  /**
   * Live for the wallet's largest locks only; the rest are stored figures
   * (a wallet with very many locks, past what one view may cost).
   */
  partial: z.boolean().default(false),
})

export type ClaimableAsOf = z.infer<typeof claimableAsOfSchema>

/**
 * Where a wallet document's locks come from: which locks the wallet owns
 * and each one's amount, unlock, voting power and votes. The API reads them
 * from the chain for the wallet being asked for ("live", at that block) and
 * keeps the stored document's history. When that read fails the stored
 * locks are served ("stored", at the block the document was built), which
 * can be behind a transaction the wallet just made. Absent from an API
 * older than 13 Nov 2026 and in a stored document: only the API sets it.
 */
export const locksAsOfSchema = z.object({
  block: z.number().int().nonnegative(),
  source: z.enum(["live", "stored"]),
  /**
   * The wallet holds more locks than one read lists: those past the cut
   * are the stored ones.
   */
  partial: z.boolean().default(false),
})

export type LocksAsOf = z.infer<typeof locksAsOfSchema>
