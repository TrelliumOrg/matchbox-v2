import { z } from "zod"
import { addressSchema } from "../common"
import {
  amountSchema,
  tokenAmountSchema,
  tokenIdSchema,
  tokenRefSchema,
  unixSecondsSchema,
} from "./primitives"

// What each kind of gauge is, beyond votes and incentives. Every kind has
// its own metadata, a discriminated union on `kind`: a compact form on gauge
// cards (the paged list) and the full form on the gauge profile. Built by the
// API's gauge publish from chain reads, never on a request.

/** How a pool gauge's pool works. */
export const poolKindSchema = z.enum(["vamm", "samm", "cl", "vault"])

export type PoolKind = z.infer<typeof poolKindSchema>

/** A validator in the PoA set, or one that left it. */
export const validatorStatusSchema = z.enum(["active", "left"])

/**
 * A veBTC lock's state: `active` until it unlocks, `auto-max` when
 * permanent (always at the maximum duration), `expired` when its end has
 * passed but the BTC was never withdrawn (no voting power, weight 0), and
 * `withdrawn` when the lock no longer holds anything.
 */
export const lockStateSchema = z.enum([
  "active",
  "auto-max",
  "expired",
  "withdrawn",
])

export type LockState = z.infer<typeof lockStateSchema>

/** The boosted veBTC lock behind a veBTC gauge (`locked(tokenId)`). */
export const vebtcLockSchema = z.object({
  state: lockStateSchema,
  /** When the lock ends; null for auto-max and withdrawn locks. */
  unlocksAt: unixSecondsSchema.nullable(),
  /** BTC still locked, whole BTC. */
  amount: amountSchema,
})

export type VebtcLock = z.infer<typeof vebtcLockSchema>

/** Expired and withdrawn locks earn nothing: list them last, never optimize. */
export function isRetiredLock(lock: VebtcLock | null): boolean {
  return lock?.state === "expired" || lock?.state === "withdrawn"
}

/** Where a MEZO gauge's facts came from. */
export const mezoGaugeSourceSchema = z.enum(["chain", "curated", "metadata"])

// ---------------------------------------------------------------------------
// Compact, on gauge cards
// ---------------------------------------------------------------------------

export const vebtcCardMetaSchema = z.object({
  kind: z.literal("vebtc"),
  /** The boosted veBTC lock. */
  tokenId: tokenIdSchema.nullable(),
  /** The lock's owner now (`ownerOf`). */
  owner: addressSchema.nullable(),
  /** Receives the gauge's incentives. */
  beneficiary: addressSchema.nullable(),
  /** The lock's state; null when the read failed. */
  lock: vebtcLockSchema.nullable(),
})

export const validatorCardMetaSchema = z.object({
  kind: z.literal("validator"),
  operator: addressSchema.nullable(),
  status: validatorStatusSchema,
})

export const poolCardMetaSchema = z.object({
  kind: z.literal("pool"),
  poolKind: poolKindSchema.nullable(),
  /** The pool, or the vault token for vault gauges. */
  pool: addressSchema,
  /** Pool value in USD; null when a side is unpriced. */
  tvlUsd: amountSchema.nullable(),
  /** MEZO emissions to stakers, percent a year; null when not computable. */
  emissionApr: amountSchema.nullable(),
})

export const mezoCardMetaSchema = z.object({
  kind: z.literal("mezo"),
  /** Destination chain ("Base"); null when nobody has recorded it. */
  chain: z.string().min(1).nullable(),
  /** Protocol the MEZO goes to ("Aerodrome"). */
  protocol: z.string().min(1).nullable(),
})

export const gaugeCardMetaSchema = z.discriminatedUnion("kind", [
  vebtcCardMetaSchema,
  validatorCardMetaSchema,
  poolCardMetaSchema,
  mezoCardMetaSchema,
])

export type GaugeCardMeta = z.infer<typeof gaugeCardMetaSchema>

// ---------------------------------------------------------------------------
// Full, on the gauge profile
// ---------------------------------------------------------------------------

export const vebtcGaugeDetailsSchema = vebtcCardMetaSchema.extend({
  /** The lock's unboosted veBTC voting power. */
  vebtcWeight: amountSchema.nullable(),
  /** Boost multiplier, "1" to "5". */
  boost: amountSchema.nullable(),
  /** veMEZO votes at which the boost reaches 5x. */
  optimalVotes: amountSchema.nullable(),
  /** BTC locked in the boosted lock, priced. */
  locked: tokenAmountSchema.nullable(),
})

export const validatorGaugeDetailsSchema = validatorCardMetaSchema.extend({
  /** From the curated profile, else the chain's ValidatorPool moniker. */
  moniker: z.string().nullable(),
  beneficiary: addressSchema.nullable(),
  /**
   * Stake or voting power; null on Mezo's PoA set, where every validator
   * has the same power.
   */
  votingPower: amountSchema.nullable(),
  /** Commission in percent; null where the chain does not expose one. */
  commission: amountSchema.nullable(),
})

export const poolGaugeDetailsSchema = poolCardMetaSchema.extend({
  /** The pair, or the one vault token. */
  tokens: z.array(tokenRefSchema).min(1).max(2),
  /** Concentrated liquidity only. */
  tickSpacing: z.number().int().positive().nullable(),
  /** Swap fee in percent. */
  feePercent: amountSchema.nullable(),
  /** Each side's balance in the pool (vaults: the vault's supply). */
  reserves: z.array(tokenAmountSchema),
  /** Share of the pool's liquidity staked in the gauge, percent. */
  stakedPercent: amountSchema.nullable(),
  /** Vaults: the savings rate paid to holders, percent a year. */
  savingsApr: amountSchema.nullable(),
})

export const mezoGaugeDetailsSchema = mezoCardMetaSchema.extend({
  /** Wormhole chain id of the destination (30 is Base). */
  wormholeChainId: z.number().int().nonnegative().nullable(),
  /** Pool or program the MEZO funds ("MEZO/MUSD CL200"). */
  destination: z.string().nullable(),
  /** The gauge's rewards beneficiary on Mezo. */
  recipient: addressSchema.nullable(),
  /** The allocator on the destination chain that receives the MEZO. */
  allocator: addressSchema.nullable(),
  /** "Wormhole NTT" for bridged gauges; null otherwise. */
  bridge: z.string().nullable(),
  /** ThirdPartyGaugeCreated metadata, verbatim. */
  metadata: z.string().nullable(),
  source: mezoGaugeSourceSchema,
  /** A link the owner recorded (pool page, docs). */
  url: z.url().nullable(),
})

export const gaugeDetailsSchema = z.discriminatedUnion("kind", [
  vebtcGaugeDetailsSchema,
  validatorGaugeDetailsSchema,
  poolGaugeDetailsSchema,
  mezoGaugeDetailsSchema,
])

export type GaugeDetails = z.infer<typeof gaugeDetailsSchema>

/** The card's compact form of full details. */
export function cardMetaOf(details: GaugeDetails): GaugeCardMeta {
  switch (details.kind) {
    case "vebtc":
      return vebtcCardMetaSchema.parse(details)
    case "validator":
      return validatorCardMetaSchema.parse(details)
    case "pool":
      return poolCardMetaSchema.parse(details)
    case "mezo":
      return mezoCardMetaSchema.parse(details)
  }
}
