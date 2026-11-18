import { z } from "zod"
import { addressSchema, decimalStringSchema } from "../common"
import { chainHeadSchema } from "../read-models/live"
import { unixSecondsSchema } from "../read-models/primitives"

// BlockHub's head, with the fields an explorer "Latest blocks" row needs.
// A superset of `chainHeadSchema` / `headMessageSchema` in read-models:
// every field Pro reads (`type`, `block`, `timestamp`) is unchanged, and
// the extras are additive, so Pro's parsers (which strip unknown keys)
// keep working. An extra is null when the RPC block did not carry it.

export const blockHashSchema = z
  .string()
  .regex(/^0x[0-9a-f]{64}$/, "Expected a lower-case block hash")

export const blockHeadSchema = chainHeadSchema.extend({
  hash: blockHashSchema.nullable(),
  /** Transactions in the block. */
  transactionCount: z.number().int().nonnegative().nullable(),
  /** Gas used, a base-10 integer string. */
  gasUsed: decimalStringSchema.nullable(),
  /** The proposer (`miner`), lower case. */
  miner: addressSchema.nullable(),
})

export type BlockHead = z.infer<typeof blockHeadSchema>

/** Messages BlockHub sends over `/internal/heads`, with the extras. */
export const blockHeadMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("head"), ...blockHeadSchema.shape }),
  /** The upstream RPC has failed for a while; fall back to polling. */
  z.object({ type: z.literal("stale"), since: unixSecondsSchema }),
])

export type BlockHeadMessage = z.infer<typeof blockHeadMessageSchema>
