import { z } from "zod"

/**
 * D1 queries and their zod schemas. Only server function handlers import this
 * module, so Start's compiler strips it (and zod) from the client bundle.
 */

const gaugeSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  kind: z.enum(["pool", "vebtc", "validator"]),
  tagline: z.string(),
  apy: z.string(),
  votes: z.number().int(),
  incentivesUsd: z.string(),
})

export type Gauge = z.infer<typeof gaugeSchema>

const epochStatsSchema = z.object({
  epoch: z.number().int(),
  totalVotes: z.number().int(),
  gauges: z.number().int(),
})

export type EpochStats = z.infer<typeof epochStatsSchema>

const gaugeIdSchema = z.object({ id: z.coerce.number().int().positive() })

export type GaugeId = z.infer<typeof gaugeIdSchema>

const columns =
  "id, name, kind, tagline, apy, votes, incentives_usd AS incentivesUsd"

export function parseGaugeId(input: unknown): GaugeId {
  return gaugeIdSchema.parse(input)
}

export async function queryGauges(db: D1Database): Promise<Gauge[]> {
  const { results } = await db
    .prepare(`SELECT ${columns} FROM gauges ORDER BY votes DESC`)
    .all()
  return z.array(gaugeSchema).parse(results)
}

export async function queryGauge(
  db: D1Database,
  id: number,
): Promise<Gauge | null> {
  const row = await db
    .prepare(`SELECT ${columns} FROM gauges WHERE id = ?`)
    .bind(id)
    .first()
  return row === null ? null : gaugeSchema.parse(row)
}

export async function queryEpochStats(db: D1Database): Promise<EpochStats> {
  const row = await db
    .prepare("SELECT COUNT(*) AS gauges, SUM(votes) AS totalVotes FROM gauges")
    .first()
  return epochStatsSchema.parse({ epoch: 47, ...row })
}
