import { z } from "zod"
import { addressSchema } from "../common"
import { unixSecondsSchema } from "../read-models/primitives"

// Validator uptime (`/internal/scan/uptime`,
// `/internal/scan/validators/{address}/uptime`): signing and proposals
// counted from CometBFT commit signatures read from a community node by
// the jobs Worker (apps/jobs README "Validator uptime").

/**
 * Where the data stands, judged when the answer was made:
 * - `live`: the last run read a node within 5 minutes and the counted
 *   heights are within 150 blocks (about 10 minutes) of the chain's head;
 * - `behind`: the node we read, or the counting, trails the chain;
 * - `down`: no run has read a node for over 5 minutes;
 * - `not_started`: nothing counted yet (or the tables do not exist).
 * Figures are never current unless `live`; pages say so.
 */
export const scanUptimeStateSchema = z.enum([
  "live",
  "behind",
  "down",
  "not_started",
])
export type ScanUptimeState = z.infer<typeof scanUptimeStateSchema>

export const scanUptimeStatusSchema = z.object({
  state: scanUptimeStateSchema,
  /** The node that answered last: 'pathrock', 'lavender' or a host. */
  source: z.string().nullable(),
  /** The last height counted and its block time. */
  height: z.number().int().nullable(),
  block_time: unixSecondsSchema.nullable(),
  /** The last run that read a node. */
  read_at: unixSecondsSchema.nullable(),
  /** The chain's head minus `height`, at the last run. */
  behind_blocks: z.number().int().nullable(),
})
export type ScanUptimeStatus = z.infer<typeof scanUptimeStatusSchema>

/** One validator's counts over a window. */
export const scanUptimeWindowSchema = z.object({
  /** Blocks it was in the set for: signed plus missed. */
  blocks: z.number().int().min(0),
  signed: z.number().int().min(0),
  missed: z.number().int().min(0),
  proposed: z.number().int().min(0),
  /** Rounds it was the proposer of that committed no block. */
  proposals_missed: z.number().int().min(0),
  /** Proposals it would make at 1/N of the blocks, in millionths. */
  expected_micro: z.number().int().min(0),
  /** `signed` over `blocks` in basis points; null without blocks. */
  uptime_bps: z.number().int().min(0).max(10_000).nullable(),
  /** Where the counts start: the window's start or, later, the data's. */
  from: unixSecondsSchema.nullable(),
  /** The counts cover the whole window. */
  complete: z.boolean(),
})
export type ScanUptimeWindow = z.infer<typeof scanUptimeWindowSchema>

export const scanUptimeWindowsSchema = z.object({
  d1: scanUptimeWindowSchema,
  d7: scanUptimeWindowSchema,
  d30: scanUptimeWindowSchema,
})
export type ScanUptimeWindows = z.infer<typeof scanUptimeWindowsSchema>

export const scanUptimeValidatorSchema = z.object({
  /** The operator address (the blocks' miner), lower case. */
  address: addressSchema.nullable(),
  /**
   * The consensus address, upper-case hex; null for a validator that left
   * the set before the newest counted block.
   */
  consensus: z
    .string()
    .regex(/^[0-9A-F]{40}$/)
    .nullable(),
  /** The PoA moniker (untrusted). */
  moniker: z.string().nullable(),
  /** In the set at the last counted height. */
  in_set: z.boolean(),
  windows: scanUptimeWindowsSchema,
})
export type ScanUptimeValidator = z.infer<typeof scanUptimeValidatorSchema>

/** `/uptime`: every validator, and the newest block's signers. */
export const scanUptimeSchema = z.object({
  data: z.object({
    status: scanUptimeStatusSchema,
    /** The newest counted block: who signed it, of the set. */
    latest: z
      .object({
        height: z.number().int(),
        time: unixSecondsSchema,
        round: z.number().int().min(0),
        signing: z.number().int().min(0),
        of: z.number().int().min(0),
      })
      .nullable(),
    validators: z.array(scanUptimeValidatorSchema),
  }),
})
export type ScanUptime = z.infer<typeof scanUptimeSchema>

/** One recent block on a validator's strip. */
export const scanUptimeStripBlockSchema = z.object({
  height: z.number().int(),
  time: unixSecondsSchema,
  /** `out` when it was not in the set at this height. */
  state: z.enum(["signed", "missed", "out"]),
  proposed: z.boolean(),
  /** It was the proposer of a round that committed no block. */
  missed_proposal: z.boolean(),
})
export type ScanUptimeStripBlock = z.infer<typeof scanUptimeStripBlockSchema>

/** `/validators/{address}/uptime`: one validator, by operator address. */
export const scanValidatorUptimeSchema = z.object({
  data: z.object({
    status: scanUptimeStatusSchema,
    address: addressSchema,
    consensus: z
      .string()
      .regex(/^[0-9A-F]{40}$/)
      .nullable(),
    moniker: z.string().nullable(),
    in_set: z.boolean(),
    windows: scanUptimeWindowsSchema.nullable(),
    /** The newest blocks, newest first (up to 100). */
    strip: z.array(scanUptimeStripBlockSchema),
    /**
     * The start of the newest UTC hour (kept 14 days) or else day it
     * signed in; null when it signed in neither.
     */
    last_signed: z
      .object({ at: unixSecondsSchema, precision: z.enum(["hour", "day"]) })
      .nullable(),
  }),
})
export type ScanValidatorUptime = z.infer<typeof scanValidatorUptimeSchema>
