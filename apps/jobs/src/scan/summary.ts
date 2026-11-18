import { z } from "zod"
import type { ScanTable } from "./neon"

// The indexer's post-tick summary (apps/indexer/src/hook.ts,
// IndexerTickSummary), validated at the service-binding boundary. Only the
// fields the scan step reads are checked; the rest pass through.

const streamStatusSchema = z.enum(["advanced", "at-head", "failed", "halted"])

export const tickSummarySchema = z.looseObject({
  kind: z.literal("matchbox-indexer-tick"),
  version: z.literal(1),
  network: z.enum(["mezo", "mezo-testnet"]),
  projection: z.looseObject({
    status: streamStatusSchema,
    /** A change means the projection was rebuilt (a replay). */
    decoderVersion: z.number().int().optional(),
  }),
  borrow: z.looseObject({
    status: streamStatusSchema,
    decoderVersion: z.number().int().optional(),
  }),
})

export type TickSummary = z.infer<typeof tickSummarySchema>

/**
 * A summary, null when none was sent (the cron fallback, or an older
 * indexer), or "invalid" when one was sent but does not parse.
 */
export function parseTickSummary(raw: unknown): TickSummary | null | "invalid" {
  if (raw === undefined || raw === null) return null
  const parsed = tickSummarySchema.safeParse(raw)
  return parsed.success ? parsed.data : "invalid"
}

/** Projection-stream tables (activity, deposits, troves, contracts). */
const projectionTables: readonly ScanTable[] = [
  "activity",
  "deposits",
  "troves",
  "contracts",
]
/** Borrow-stream tables. */
const borrowTables: readonly ScanTable[] = ["morpho", "enclave"]

/**
 * Tables worth reading this run. With no summary every table is read (the
 * run is a fallback and the checkpoints keep it cheap). With one, only the
 * streams that advanced: on a tick where none did, nothing is read and
 * Neon is not queried at all.
 */
export function tablesToRead(
  summary: TickSummary | null,
): ReadonlySet<ScanTable> {
  if (summary === null) return new Set([...projectionTables, ...borrowTables])
  const tables = new Set<ScanTable>()
  if (summary.projection.status === "advanced") {
    for (const table of projectionTables) tables.add(table)
  }
  if (summary.borrow.status === "advanced") {
    for (const table of borrowTables) tables.add(table)
  }
  return tables
}
