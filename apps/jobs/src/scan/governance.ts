import { EPOCH_SECONDS, EPOCH_ZERO_START, epochStartOf } from "@matchbox/domain"
import type { Logger } from "@matchbox/logger"
import { z } from "zod"
import {
  cursorStatement,
  type JsonRow,
  runBatch,
  type SqlStatement,
  servedBatch,
  type UpsertSpec,
  upsertStatements,
} from "./statements"

// Per-epoch governance summaries from rows the copy step already holds
// (README "Governance summaries"):
//
// - gauge_emissions: the MEZO each voter distributed to each gauge in an
//   epoch, from the DistributeReward rows of `activity`;
// - epoch_sources: each voter's totals for the epoch: those emissions, and
//   the incentives, fees, vote weight and gauge count of its gauge_epoch
//   rows.
//
// Every run (the 5-minute live trigger) recomputes the current and the
// previous epoch and a few older ones in rotation, so a re-filled epoch
// heals within hours and the first fill needs no script. Each epoch is
// two indexed reads; the run is one batch that writes only rows that
// changed.

/** The voters' sources: DistributeReward rows from a pool gauge's own
 * ClaimRewards (source GAUGE) are LP claims, not emissions. */
export const voterSources = [
  "POOLS_VOTER",
  "VALIDATORS_VOTER",
  "BOOST_VOTER",
  "THIRD_PARTY_VOTER",
] as const

const integer = z.string().regex(/^[0-9]+$/)
const tokenMap = z.record(z.string(), integer)

const emissionRowSchema = z.object({
  gauge: z.string().nullable(),
  source: z.string(),
  amount: integer.nullable(),
})

const gaugeRowSchema = z.object({
  source: z.string(),
  vote_weight: integer,
  incentives: z.string(),
  fees: z.string(),
})

export const gaugeEmissionsSpec: UpsertSpec = {
  table: "gauge_emissions",
  columns: ["gauge", "epoch_start", "source", "amount", "events", "updated_at"],
  key: ["gauge", "epoch_start"],
  update: ["source", "amount", "events", "updated_at"],
}

export const epochSourcesSpec: UpsertSpec = {
  table: "epoch_sources",
  columns: [
    "epoch_start",
    "source",
    "emissions",
    "incentives",
    "fees",
    "vote_weight",
    "gauges",
    "emission_gauges",
    "updated_at",
  ],
  key: ["epoch_start", "source"],
  update: [
    "emissions",
    "incentives",
    "fees",
    "vote_weight",
    "gauges",
    "emission_gauges",
    "updated_at",
  ],
}

/** DistributeReward rows in [start, end): the activity_action range. */
export const epochDistributionsSql = `SELECT gauge, source, amount FROM activity
WHERE action_type = 'REWARD_DISTRIBUTED' AND timestamp >= ?1 AND timestamp < ?2`

/**
 * The oldest DistributeReward row the copy holds: where the warehouse's
 * history starts (9 Apr 2026 when written), not the first distribution.
 * One row of `activity_action`, read from its end.
 */
export const firstDistributionSql = `SELECT timestamp AS first FROM activity
WHERE action_type = 'REWARD_DISTRIBUTED' ORDER BY timestamp ASC LIMIT 1`

/**
 * The first epoch whose emissions are whole: the one the history starts
 * at, or the next when it starts mid-epoch. null with no history.
 */
export function emissionsFrom(first: number | null): number | null {
  if (first === null) return null
  const start = epochStartOf(first)
  return start === first ? start : start + EPOCH_SECONDS
}

/** An epoch's gauge rows: a prefix of gauge_epoch_rank. */
export const epochGaugeRowsSql = `SELECT source, vote_weight, incentives, fees
FROM gauge_epoch WHERE epoch_start = ?1`

async function all<Schema extends z.ZodType>(
  db: D1Database,
  schema: Schema,
  sql: string,
  ...params: (string | number)[]
): Promise<z.output<Schema>[]> {
  const result = await db
    .prepare(sql)
    .bind(...params)
    .all()
  return z.array(schema).parse(result.results)
}

function addTo(map: Map<string, bigint>, key: string, value: bigint): void {
  map.set(key, (map.get(key) ?? 0n) + value)
}

function sortedJson(map: ReadonlyMap<string, bigint>): string {
  return JSON.stringify(
    Object.fromEntries(
      [...map.entries()]
        .filter(([, value]) => value > 0n)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, value]) => [key, value.toString()]),
    ),
  )
}

function parsedMap(text: string): Record<string, string> {
  try {
    const parsed = tokenMap.safeParse(JSON.parse(text))
    return parsed.success ? parsed.data : {}
  } catch {
    return {}
  }
}

type SourceTotals = {
  emissions: bigint
  emissionGauges: Set<string>
  incentives: Map<string, bigint>
  fees: Map<string, bigint>
  weight: bigint
  gauges: number
}

/**
 * The rows one epoch's summaries hold (pure, for tests). Before
 * `emissionsFrom` an epoch has no gauge emission rows and its voters'
 * emissions are null (unknown, not 0); incentives, fees and votes come
 * from `gauge_epoch`, which goes back to Epoch 0.
 */
export function epochGovernanceRows(input: {
  epoch: number
  distributions: readonly z.output<typeof emissionRowSchema>[]
  gauges: readonly z.output<typeof gaugeRowSchema>[]
  nowSeconds: number
  emissionsFrom: number | null
}): { emissions: JsonRow[]; sources: JsonRow[] } {
  const known =
    input.emissionsFrom !== null && input.epoch >= input.emissionsFrom
  const sources = new Map<string, SourceTotals>()
  function totalsOf(source: string): SourceTotals {
    const existing = sources.get(source)
    if (existing !== undefined) return existing
    const created: SourceTotals = {
      emissions: 0n,
      emissionGauges: new Set(),
      incentives: new Map(),
      fees: new Map(),
      weight: 0n,
      gauges: 0,
    }
    sources.set(source, created)
    return created
  }
  const voters = new Set<string>(voterSources)
  const byGauge = new Map<
    string,
    { source: string; amount: bigint; n: number }
  >()
  for (const row of known ? input.distributions : []) {
    if (!voters.has(row.source) || row.gauge === null) continue
    const amount = BigInt(row.amount ?? "0")
    const entry = byGauge.get(row.gauge) ?? {
      source: row.source,
      amount: 0n,
      n: 0,
    }
    entry.amount += amount
    entry.n += 1
    byGauge.set(row.gauge, entry)
    const totals = totalsOf(row.source)
    totals.emissions += amount
    if (amount > 0n) totals.emissionGauges.add(row.gauge)
  }
  for (const row of input.gauges) {
    const totals = totalsOf(row.source)
    const weight = BigInt(row.vote_weight)
    totals.weight += weight
    if (weight > 0n) totals.gauges += 1
    for (const [token, amount] of Object.entries(parsedMap(row.incentives))) {
      addTo(totals.incentives, token, BigInt(amount))
    }
    for (const [token, amount] of Object.entries(parsedMap(row.fees))) {
      addTo(totals.fees, token, BigInt(amount))
    }
  }
  const emissions: JsonRow[] = [...byGauge.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([gauge, entry]) => ({
      gauge,
      epoch_start: input.epoch,
      source: entry.source,
      amount: entry.amount.toString(),
      events: entry.n,
      updated_at: input.nowSeconds,
    }))
  const sourceRows: JsonRow[] = [...sources.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([source, totals]) => ({
      epoch_start: input.epoch,
      source,
      emissions: known ? totals.emissions.toString() : null,
      incentives: sortedJson(totals.incentives),
      fees: sortedJson(totals.fees),
      vote_weight: totals.weight.toString(),
      gauges: totals.gauges,
      emission_gauges: totals.emissionGauges.size,
      updated_at: input.nowSeconds,
    }))
  return { emissions, sources: sourceRows }
}

/** Reads one epoch and returns the statements that bring it up to date. */
export async function epochGovernanceStatements(
  db: D1Database,
  epoch: number,
  nowSeconds: number,
  emissionsStart: number | null,
): Promise<SqlStatement[]> {
  const [distributions, gauges] = await Promise.all([
    all(
      db,
      emissionRowSchema,
      epochDistributionsSql,
      epoch,
      epoch + EPOCH_SECONDS,
    ),
    all(db, gaugeRowSchema, epochGaugeRowsSql, epoch),
  ])
  const rows = epochGovernanceRows({
    epoch,
    distributions,
    gauges,
    nowSeconds,
    emissionsFrom: emissionsStart,
  })
  return [
    ...upsertStatements(gaugeEmissionsSpec, rows.emissions),
    {
      sql: `DELETE FROM gauge_emissions WHERE epoch_start = ?1
AND gauge NOT IN (SELECT value FROM json_each(?2))`,
      params: [
        epoch,
        JSON.stringify(rows.emissions.map((row) => String(row.gauge))),
      ],
    },
    ...upsertStatements(epochSourcesSpec, rows.sources),
    {
      sql: `DELETE FROM epoch_sources WHERE epoch_start = ?1
AND source NOT IN (SELECT value FROM json_each(?2))`,
      params: [
        epoch,
        JSON.stringify(rows.sources.map((row) => String(row.source))),
      ],
    },
  ]
}

/** Older epochs re-checked per run, in rotation. */
export const governanceSweepPerRun = 3

const sweepCursor = "governance:sweep"

/**
 * The epochs a run recomputes: the current and the previous one, then
 * `governanceSweepPerRun` older ones going back from the sweep cursor,
 * wrapping to the newest once Epoch 0 is passed.
 */
export function governanceEpochs(
  nowSeconds: number,
  cursor: number | null,
): { epochs: number[]; next: number } {
  const current = epochStartOf(nowSeconds)
  const previous = current - EPOCH_SECONDS
  const epochs = [current, previous].filter((each) => each >= EPOCH_ZERO_START)
  const newestOld = previous - EPOCH_SECONDS
  let at =
    cursor === null || cursor > newestOld || cursor < EPOCH_ZERO_START
      ? newestOld
      : cursor
  for (let index = 0; index < governanceSweepPerRun; index += 1) {
    if (at < EPOCH_ZERO_START) break
    if (!epochs.includes(at)) epochs.push(at)
    at -= EPOCH_SECONDS
    if (at < EPOCH_ZERO_START) at = newestOld
  }
  return { epochs, next: at }
}

export type GovernanceRunResult = {
  epochs: number[]
  rowsWritten: number
  status: "ok" | "skipped" | "failed"
  reason?: string
}

/**
 * The run: every epoch's statements and the sweep cursor in one served
 * batch, so a run writes one change_mark and bumps data_version at most
 * once (only if a row changed). A failure is logged and left for the next
 * run; nothing else in the live trigger waits on it.
 */
export async function runGovernance(deps: {
  db: D1Database
  nowSeconds: number
  logger: Logger
}): Promise<GovernanceRunResult> {
  const { db, nowSeconds, logger } = deps
  try {
    const cursorRow = await db
      .prepare("SELECT value FROM scan_cursors WHERE name = ?1")
      .bind(sweepCursor)
      .first<{ value: string }>()
    const cursor =
      cursorRow === null || !/^[0-9]+$/.test(cursorRow.value)
        ? null
        : Number.parseInt(cursorRow.value, 10)
    const plan = governanceEpochs(nowSeconds, cursor)
    const first = await db
      .prepare(firstDistributionSql)
      .first<{ first: number | null }>()
    const from = emissionsFrom(first?.first ?? null)
    const statements: SqlStatement[] = []
    for (const epoch of plan.epochs) {
      statements.push(
        ...(await epochGovernanceStatements(db, epoch, nowSeconds, from)),
      )
    }
    const rowsWritten = await runBatch(
      db,
      servedBatch(statements, [
        cursorStatement(sweepCursor, String(plan.next), nowSeconds),
      ]),
    )
    logger.info({
      message: "Governance summaries written",
      epochs: plan.epochs.length,
      rowsWritten,
    })
    return { epochs: plan.epochs, rowsWritten, status: "ok" }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    // Before scan-migrations 0007 is applied the tables do not exist.
    const missing = /no such table/i.test(reason)
    logger.warn({
      message: missing
        ? "GOVERNANCE TABLES MISSING; apply scan-migrations 0007"
        : "Governance summaries failed; retrying next run",
      reason,
    })
    return {
      epochs: [],
      rowsWritten: 0,
      status: missing ? "skipped" : "failed",
      reason,
    }
  }
}
