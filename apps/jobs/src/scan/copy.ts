import {
  scanActivityRowSchema,
  scanEnclaveEventRowSchema,
  scanIncentiveDepositRowSchema,
  scanLabelRowSchema,
  scanLockRowSchema,
  scanMorphoEventRowSchema,
  scanPoolRowSchema,
  scanTroveEventRowSchema,
} from "@matchbox/contracts/scan"
import type { Logger } from "@matchbox/logger"
import { z } from "zod"
import type { RunTrigger } from "../cursors"
import { type AggregateResult, runAggregates } from "./aggregates"
import {
  derivedLabelRows,
  derivedLabelSpec,
  labelSeedVersion,
  labelSpec,
  seedLabelRows,
} from "./labels"
import {
  type DayCount,
  enclaveSweepRows,
  type NeonEnclaveRow,
  type ScanCheckpoints,
  type ScanReadPlan,
  type ScanRows,
  type ScanTable,
  type ScanWarehouseReader,
  scanTables,
} from "./neon"
import {
  cursorStatement,
  dirtyStatement,
  type JsonRow,
  monotonicCursorStatement,
  runBatch,
  type SqlStatement,
  servedBatch,
  type UpsertSpec,
  upsertStatements,
} from "./statements"
import { type TickSummary, tablesToRead } from "./summary"
import {
  activityRows,
  activitySpec,
  dayOf,
  dayStart,
  depositRows,
  depositSpec,
  dirtyFrom,
  enclaveRows,
  enclaveSpec,
  lockRows,
  lockSpec,
  morphoRows,
  morphoSpec,
  parseJson,
  planLockVotes,
  poolRows,
  poolSpec,
  Quarantine,
  quarantineCap,
  quarantineStatements,
  troveRows,
  troveSpec,
} from "./transform"

// The scan copy step: Neon rows past each table's checkpoint into SCAN_DB.
// It runs inside the warehouse snapshot's invocation (chained after the
// indexer's tick, so Neon is already awake) and makes one read-only Neon
// round trip, timed right after the Pro snapshot's last Neon query
// (`read()`), before either step's D1 work (`finish()`).
//
// - Bounded: each table reads at most its cap (completing the last block or
//   second), so a large gap catches up over several ticks.
// - Atomic and resumable: the copied rows, lock votes, dirty markers,
//   quarantined rows and new checkpoints commit in one D1 batch. A failure
//   before it leaves every checkpoint where it was; the next run reads the
//   same rows. A failure after it is recorded on an ok run (last_error).
// - Repairing: every upsert rewrites a row whose copied values changed and
//   writes nothing for an unchanged one, so re-reads and re-fills repair.
//   Small or unmarked state is re-read on its own schedule: the whole of
//   rotating diffs over enclave_events (1,000 a run) and lock_positions
//   (500 a run), and every contract once a day.
// - Recorded: every run, skipped ones included, leaves a scan_runs row, and
//   scan_status says how complete the data is (README, "Scan status").
// - Aggregates (epoch_totals, gauge_epoch, copy-derived `daily`) run after
//   the copy, and on skipped runs too, for dirty epochs and days only.

export const scanJob = "scan-copy"

/** Rows per table per run; ~10x a busy tick, so a gap clears quickly. */
export const defaultCaps: Record<ScanTable, number> = {
  activity: 2_000,
  deposits: 1_000,
  troves: 1_000,
  morpho: 1_000,
  enclave: 500,
  contracts: 1_000,
}

/** Lock positions the rotating sweep re-reads per run. */
export const lockSweepRows = 500

/** A cron run is skipped when a scan run started this recently. */
export const scanFallbackQuietSeconds = 10 * 60

/** D1 calls the aggregates may make per run (a batch counts once). */
export const aggregateQueryBudget = 200

const cursorNames: Record<ScanTable, string> = {
  activity: "copy:activity",
  deposits: "copy:deposits",
  troves: "copy:troves",
  morpho: "copy:morpho",
  enclave: "copy:enclave",
  contracts: "copy:contracts",
}
const lockVotesCursor = "lock-votes:epoch"
const labelSeedCursor = "labels:seed"
const lockSweepCursor = "copy:lock-sweep"
const contractsFullCursor = "copy:contracts-full"
const enclaveSweepCursor = "copy:enclave-sweep"
/** The last Enclave read's mode: "full" when one run diffs the table. */
const enclaveModeCursor = "copy:enclave-mode"
/** `verify:counts:<table>`: the UTC day the table's counts were last checked. */
const countCheckCursor = (table: string) => `verify:counts:${table}`
const decoderCursors = {
  projection: "decoder:projection",
  borrow: "decoder:borrow",
} as const
export const refillCursor = "refill:required"
export const fillCursor = "fill:neon"

const initialCheckpoints: ScanCheckpoints = {
  activity: "0",
  deposits: "0",
  troves: "0",
  morpho: "0",
  enclave: "0",
  contracts: "",
}

export type ScanCopyDeps = {
  db: D1Database
  warehouse: ScanWarehouseReader
  trigger: RunTrigger
  /** The indexer's tick summary; null for the cron fallback. */
  summary: TickSummary | null
  nowSeconds: number
  logger: Logger
  caps?: Partial<Record<ScanTable, number>>
  /** D1 calls the aggregates may make this run. */
  aggregateBudget?: number
  /** Milliseconds before the Neon read is given up; default 10 s. */
  readTimeoutMs?: number
  /** Milliseconds, for the Neon timing; defaults to `Date.now`. */
  clock?: () => number
  /** The aggregate step (a fake in tests); defaults to runAggregates. */
  aggregates?: typeof runAggregates
}

export type ScanCopyResult =
  | {
      status: "skipped"
      reason: string
      aggregates: AggregateResult | null
    }
  | {
      status: "ok"
      rowsRead: number
      rowsWritten: number
      /** Tables that hit their cap and have more to copy. */
      capped: ScanTable[]
      neonMs: number
      quarantined: number
      /** Tables stopped for the run: {table: reason}. */
      halted: Record<string, string>
      /** Null when the aggregate step failed after the copy committed. */
      aggregates: AggregateResult | null
    }

const cursorRowSchema = z.object({ name: z.string(), value: z.string() })

async function readCursors(db: D1Database): Promise<Map<string, string>> {
  const result = await db.prepare("SELECT name, value FROM scan_cursors").all()
  return new Map(
    z
      .array(cursorRowSchema)
      .parse(result.results)
      .map((row) => [row.name, row.value]),
  )
}

/**
 * Whether a scan run started in the quiet window and did not fail: a
 * finished, skipped or still running one. The cron fallback then stays
 * away from Neon (a skipped chained run means nothing advanced).
 */
async function recentRun(db: D1Database, nowSeconds: number): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT count(*) AS n FROM scan_runs
       WHERE job = ?1 AND started_at >= ?2
         AND status IN ('ok', 'skipped', 'running')`,
    )
    .bind(scanJob, nowSeconds - scanFallbackQuietSeconds)
    .first()
  return z.object({ n: z.number().int() }).parse(row).n > 0
}

async function startRun(
  db: D1Database,
  trigger: RunTrigger,
  nowSeconds: number,
  status: "running" | "skipped",
  detail: string | null,
): Promise<number> {
  const row = await db
    .prepare(
      `INSERT INTO scan_runs (job, trigger, started_at, status, detail,
         finished_at)
       VALUES (?1, ?2, ?3, ?4, ?5, CASE WHEN ?4 = 'skipped' THEN ?3 END)
       RETURNING id`,
    )
    .bind(scanJob, trigger, nowSeconds, status, detail)
    .first()
  return z.object({ id: z.number().int() }).parse(row).id
}

function finishRunStatement(
  id: number,
  result: {
    status: "ok" | "failed"
    rowsRead: number | null
    rowsWritten: number | null
    detail: string
    nowSeconds: number
  },
): SqlStatement {
  return {
    sql: `UPDATE scan_runs SET status = ?2, rows_read = ?3, rows_written = ?4,
  detail = ?5, finished_at = ?6
WHERE id = ?1`,
    params: [
      id,
      result.status,
      result.rowsRead,
      result.rowsWritten,
      result.detail.slice(0, 300),
      result.nowSeconds,
    ],
  }
}

/** Run rows are kept a week. */
function pruneRunsStatement(nowSeconds: number): SqlStatement {
  return {
    sql: "DELETE FROM scan_runs WHERE job = ?1 AND started_at < ?2",
    params: [scanJob, nowSeconds - 7 * 86_400],
  }
}

function maxOf(values: readonly string[], fallback: string): string {
  let best = BigInt(fallback)
  for (const value of values) {
    const parsed = BigInt(value)
    if (parsed > best) best = parsed
  }
  return best.toString()
}

/** Checkpoints after a read: the newest position each table returned. */
export function nextCheckpoints(
  current: ScanCheckpoints,
  rows: ScanRows,
): ScanCheckpoints {
  // A rejected row still moves its table past it, so one bad newest row
  // cannot pin the checkpoint (it is in scan_quarantine).
  const rejected = (source: string) =>
    rows.rejected.flatMap((row) =>
      row.source === source && row.position !== null ? [row.position] : [],
    )
  const lastContract = rows.contracts.at(-1)
  const contract =
    lastContract === undefined
      ? current.contracts
      : `${lastContract.discovered_at}|${lastContract.address.toLowerCase()}`
  return {
    activity: maxOf(
      [...rows.activity.map((row) => row.timestamp), ...rejected("activity")],
      current.activity,
    ),
    deposits: maxOf(
      [
        ...rows.deposits.map((row) => row.block_number),
        ...rejected("deposits"),
      ],
      current.deposits,
    ),
    troves: maxOf(
      [...rows.troves.map((row) => row.block_number), ...rejected("troves")],
      current.troves,
    ),
    morpho: maxOf(
      [...rows.morpho.map((row) => row.block_number), ...rejected("morpho")],
      current.morpho,
    ),
    enclave: maxOf(
      [...rows.enclave.map((row) => row.block_number), ...rejected("enclave")],
      current.enclave,
    ),
    // A lookback or full read can end before the checkpoint: keep the max.
    contracts: contract > current.contracts ? contract : current.contracts,
  }
}

export type CopyPlan = {
  statements: SqlStatement[]
  checkpoints: ScanCheckpoints
  lockVotesEpoch: number | null
  rowsRead: number
  capped: ScanTable[]
  quarantined: number
  /** Quarantined rows per source (activity, locks, deposits, ...). */
  quarantinedBySource: Record<string, number>
  /** Tables stopped for this run: {table: reason}. */
  halted: Record<string, string>
}

/** scan_cursors prefix of a halted table's marker: `halt:<table>` = reason. */
export const haltCursorPrefix = "halt:"

/** Tables halted now, from their markers in scan_cursors. */
export function haltedTables(
  cursors: ReadonlyMap<string, string>,
): Record<string, string> {
  const halted: Record<string, string> = {}
  for (const [name, value] of cursors) {
    if (name.startsWith(haltCursorPrefix)) {
      halted[name.slice(haltCursorPrefix.length)] = value
    }
  }
  return halted
}

/** Enclave window rows plus the rotating diff's, each key once. */
function sweptAndWindow(rows: ScanRows): NeonEnclaveRow[] {
  const byKey = new Map<string, NeonEnclaveRow>()
  for (const row of [...rows.sweptEnclave, ...rows.enclave]) {
    byKey.set(`${row.tx_hash}-${row.log_index}-${row.ve_btc_token_id}`, row)
  }
  return [...byKey.values()]
}

/** Quarantine sources, and the checkpointed table each one stops. */
const haltedTable: Record<string, ScanTable | null> = {
  activity: "activity",
  locks: "activity",
  deposits: "deposits",
  troves: "troves",
  morpho: "morpho",
  enclave: "enclave",
  contracts: "contracts",
}

/**
 * Everything one run writes for a set of Neon rows, as statements: the
 * rows, lock votes, dirty markers, quarantined rows, label seed and the new
 * checkpoints. Shared with the first-fill script, which renders it to SQL.
 *
 * Rows that failed their Neon schema, their transform or the API's row
 * schema are quarantined and the rest are copied. A table with
 * `quarantineCap` or more quarantined rows in one run is a systematic
 * failure: it is halted for the run (nothing of it written, its checkpoint
 * kept) and reported, so it is loud instead of quarantined forever.
 */
export function planCopy(input: {
  rows: ScanRows
  checkpoints: ScanCheckpoints
  lockVotesEpoch: number | null
  seedLabels: boolean
  caps: Record<ScanTable, number>
  nowSeconds: number
  /** Extra cursor writes committed with the rows (daily markers). */
  cursors?: Readonly<Record<string, string>>
  /**
   * Rotating-read cursors, written only when their table is not halted (a
   * halted table discards what the sweep read, so it is read again).
   */
  sweeps?: readonly { table: ScanTable; name: string; value: string }[]
  /**
   * Tables this run read. Each one not halted clears its `halt:` marker;
   * the markers of tables not read are left as they are.
   */
  readTables?: ReadonlySet<ScanTable>
  /** Quarantined rows of one source that halt its table (and are kept). */
  haltAt?: number
}): CopyPlan {
  const haltAt = input.haltAt ?? quarantineCap
  const { rows, nowSeconds } = input
  const quarantine = new Quarantine()
  for (const row of rows.rejected) {
    quarantine.add({
      source: row.source,
      rowKey: row.rowKey,
      reason: `Neon schema: ${row.reason}`,
      payload: row.payload,
      day: row.timestamp === null ? null : dayOf(row.timestamp),
    })
  }
  const key = (fields: string[]) => (row: JsonRow) =>
    fields.map((field) => String(row[field])).join("-")
  let activity = quarantine.conform(
    activityRows(rows.activity, quarantine),
    scanActivityRowSchema,
    "activity",
    key(["id"]),
  )
  let deposits = quarantine.conform(
    depositRows(rows.deposits, quarantine),
    scanIncentiveDepositRowSchema,
    "deposits",
    key(["tx_hash", "log_index"]),
  )
  let troves = quarantine.conform(
    troveRows(rows.troves, quarantine),
    scanTroveEventRowSchema,
    "troves",
    key(["tx_hash", "log_index"]),
  )
  let morpho = quarantine.conform(
    morphoRows(rows.morpho, quarantine),
    scanMorphoEventRowSchema,
    "morpho",
    key(["tx_hash", "log_index"]),
  )
  let enclave = quarantine.conform(
    enclaveRows(sweptAndWindow(rows), quarantine),
    scanEnclaveEventRowSchema,
    "enclave",
    key(["tx_hash", "log_index", "ve_btc_token_id"]),
  )
  let locks = quarantine.conform(
    lockRows([...rows.locks, ...rows.sweptLocks], nowSeconds, quarantine),
    scanLockRowSchema,
    "locks",
    key(["escrow", "token_id"]),
  )
  let labels = quarantine.conform(
    derivedLabelRows(
      [...rows.contracts, ...rows.recheckedContracts],
      nowSeconds,
    ),
    scanLabelRowSchema,
    "contracts",
    key(["address"]),
  )

  // A systematic failure stops its table for the run.
  const halted: Record<string, string> = {}
  for (const [source, count] of quarantine.counts()) {
    if (count < haltAt) continue
    const table = haltedTable[source] ?? null
    if (table === null) continue
    const first = quarantine.rows.find((row) => row.source === source)
    halted[table] =
      `${count} ${source} rows quarantined in one run (cap ${haltAt}): ${first?.reason ?? ""}`.slice(
        0,
        300,
      )
  }
  if (halted.activity !== undefined) {
    activity = []
    locks = []
  }
  if (halted.deposits !== undefined) deposits = []
  if (halted.troves !== undefined) troves = []
  if (halted.morpho !== undefined) morpho = []
  if (halted.enclave !== undefined) enclave = []
  if (halted.contracts !== undefined) labels = []

  const read = nextCheckpoints(input.checkpoints, rows)
  const checkpoints: ScanCheckpoints = { ...read }
  for (const table of scanTables) {
    if (halted[table] !== undefined) {
      checkpoints[table] = input.checkpoints[table]
    }
  }
  const copiedThrough =
    activity.length === 0 ? null : Number(checkpoints.activity)
  const votes = planLockVotes(activity, input.lockVotesEpoch, copiedThrough)
  const dirty = dirtyFrom({
    activity,
    deposits,
    troves,
    morpho,
    voteEpochs: votes.epochs,
  })
  const pools = quarantine.conform(
    poolRows(activity, nowSeconds),
    scanPoolRowSchema,
    "activity",
    key(["pool"]),
  )
  const served: SqlStatement[] = [
    ...(input.seedLabels
      ? upsertStatements(labelSpec, seedLabelRows(nowSeconds))
      : []),
    ...upsertStatements(activitySpec, activity),
    ...upsertStatements(poolSpec, pools),
    ...upsertStatements(lockSpec, locks),
    ...votes.statements,
    ...upsertStatements(depositSpec, deposits),
    ...upsertStatements(troveSpec, troves),
    ...upsertStatements(morphoSpec, morpho),
    ...upsertStatements(enclaveSpec, enclave),
    ...upsertStatements(derivedLabelSpec, labels),
  ]
  const rest: SqlStatement[] = [
    ...(input.seedLabels
      ? [cursorStatement(labelSeedCursor, labelSeedVersion, nowSeconds)]
      : []),
    ...quarantineStatements(quarantine.rows, nowSeconds, haltAt),
    // A halted table's marker stays until a run copies it cleanly.
    ...scanTables.flatMap((table) => {
      const reason = halted[table]
      if (reason !== undefined) {
        return [cursorStatement(haltCursorPrefix + table, reason, nowSeconds)]
      }
      return input.readTables?.has(table) === true
        ? [
            {
              sql: "DELETE FROM scan_cursors WHERE name = ?1",
              params: [haltCursorPrefix + table],
            },
          ]
        : []
    }),
    ...(input.sweeps ?? []).flatMap((sweep) =>
      halted[sweep.table] === undefined
        ? [cursorStatement(sweep.name, sweep.value, nowSeconds)]
        : [],
    ),
    ...dirtyStatement("epoch", dirty.epochs),
    ...dirtyStatement("day", dirty.days),
    ...scanTables.map((table) =>
      monotonicCursorStatement(
        cursorNames[table],
        checkpoints[table],
        nowSeconds,
      ),
    ),
    ...(votes.materialized === null
      ? []
      : [
          monotonicCursorStatement(
            lockVotesCursor,
            String(votes.materialized),
            nowSeconds,
          ),
        ]),
    ...Object.entries(input.cursors ?? {}).map(([name, value]) =>
      cursorStatement(name, value, nowSeconds),
    ),
  ]
  const counts = rows.windowCounts
  return {
    statements: servedBatch(served, rest),
    checkpoints,
    lockVotesEpoch: votes.materialized,
    rowsRead:
      rows.locks.length +
      rows.sweptLocks.length +
      rows.activity.length +
      rows.deposits.length +
      rows.troves.length +
      rows.morpho.length +
      rows.enclave.length +
      rows.sweptEnclave.length +
      rows.contracts.length +
      rows.recheckedContracts.length +
      rows.rejected.length,
    capped: scanTables.filter(
      (table) =>
        halted[table] === undefined && counts[table] >= input.caps[table],
    ),
    quarantined: quarantine.rows.length,
    quarantinedBySource: Object.fromEntries(quarantine.counts()),
    halted,
  }
}

// ---- status ------------------------------------------------------------

const statusColumns = [
  "last_run_status",
  "last_run_at",
  "last_ok_at",
  "consecutive_failures",
  "last_error",
  "copied_through",
  "dirty_epochs",
  "dirty_days",
  "aggregates_complete",
  "history_filled",
  "refill_required",
  "refill_reason",
  "quarantined_rows",
  "halted_tables",
  "failed_runs_24h",
  "enclave_full_diff",
  "updated_at",
]

/** data_version and change_mark are never written here. */
export const statusSpec: UpsertSpec = {
  table: "scan_status",
  columns: ["id", ...statusColumns],
  key: ["id"],
  update: statusColumns,
}

const statusReadSchema = z.object({
  dirty_epochs: z.number().int(),
  dirty_days: z.number().int(),
  quarantined: z.number().int(),
  failures: z.number().int().nullable(),
  last_ok_at: z.number().int().nullable(),
  failed_24h: z.number().int(),
})

/** The status row after a run, from the database's own counts. */
async function writeStatus(
  db: D1Database,
  input: {
    status: "ok" | "skipped" | "failed"
    error: string | null
    nowSeconds: number
    /** Cursors after the run, `halt:` markers included. */
    cursors: ReadonlyMap<string, string>
    /** Runs found crashed (left running) when this one started. */
    crashed?: number
  },
): Promise<void> {
  const row = statusReadSchema.parse(
    await db
      .prepare(
        `SELECT
           (SELECT count(*) FROM scan_dirty WHERE kind = 'epoch') AS dirty_epochs,
           (SELECT count(*) FROM scan_dirty WHERE kind = 'day') AS dirty_days,
           (SELECT count(*) FROM scan_quarantine) AS quarantined,
           (SELECT consecutive_failures FROM scan_status WHERE id = 1) AS failures,
           (SELECT last_ok_at FROM scan_status WHERE id = 1) AS last_ok_at,
           (SELECT count(*) FROM scan_runs WHERE job = ?1 AND status = 'failed'
              AND started_at >= ?2) AS failed_24h`,
      )
      .bind(scanJob, input.nowSeconds - 86_400)
      .first(),
  )
  const refill = input.cursors.get(refillCursor) ?? null
  const activity = input.cursors.get(cursorNames.activity)
  const halted = haltedTables(input.cursors)
  const anyHalted = Object.keys(halted).length > 0
  const crashed = input.crashed ?? 0
  await runBatch(
    db,
    upsertStatements(statusSpec, [
      {
        id: 1,
        last_run_status: input.status,
        last_run_at: input.nowSeconds,
        // The last ok run that left no table halted: a halted table's rows
        // stop at its checkpoint, so the data is not current.
        last_ok_at:
          input.status === "ok" && !anyHalted
            ? input.nowSeconds
            : row.last_ok_at,
        // Crashed runs found at start count as failures too.
        consecutive_failures:
          input.status === "failed" ? (row.failures ?? 0) + 1 + crashed : 0,
        last_error: input.error?.slice(0, 300) ?? null,
        copied_through:
          activity === undefined || activity === "0"
            ? null
            : Number.parseInt(activity, 10),
        dirty_epochs: row.dirty_epochs,
        dirty_days: row.dirty_days,
        aggregates_complete:
          row.dirty_epochs === 0 && row.dirty_days === 0 ? 1 : 0,
        history_filled: input.cursors.has(fillCursor) ? 1 : 0,
        refill_required: refill === null ? 0 : 1,
        refill_reason: refill,
        quarantined_rows: row.quarantined,
        halted_tables: anyHalted ? JSON.stringify(halted) : null,
        failed_runs_24h: row.failed_24h,
        enclave_full_diff:
          input.cursors.get(enclaveModeCursor) === "sweep" ? 0 : 1,
        updated_at: input.nowSeconds,
      },
    ]),
  )
}

/**
 * A rebuilt warehouse (a replay under a new decoder version) deletes and
 * re-creates projected rows, which a checkpointed copy cannot follow. The
 * copy keeps going but flags a re-fill (README, "Re-fill runbook").
 */
function decoderChanges(
  summary: TickSummary | null,
  cursors: ReadonlyMap<string, string>,
): { writes: Record<string, string>; reason: string | null } {
  const writes: Record<string, string> = {}
  const reasons: string[] = []
  for (const stream of ["projection", "borrow"] as const) {
    const version = summary?.[stream].decoderVersion
    if (version === undefined) continue
    const stored = cursors.get(decoderCursors[stream])
    if (stored !== undefined && stored !== String(version)) {
      reasons.push(`${stream} decoder ${stored} -> ${version}`)
    }
    writes[decoderCursors[stream]] = String(version)
  }
  return { writes, reason: reasons.length === 0 ? null : reasons.join(", ") }
}

/** SCAN_DB tables of the daily count check, by Neon table key. */
const countedScanTables = {
  activity: "activity",
  deposits: "incentive_deposits",
  troves: "trove_events",
  morpho: "morpho_events",
  enclave: "enclave_events",
} as const

type CountMismatch = { table: string; day: string; text: string }

/**
 * `verify:pending:<table>`: the days whose counts differed at the table's
 * last check (JSON array). A difference sets refill_required only when the
 * next daily check finds it again.
 */
const countPendingCursor = (table: string) => `verify:pending:${table}`

const pendingDaysSchema = z.array(z.string())

/** Days the daily count check covers (complete UTC days only). */
export const countCheckDays = 7

/** Counted Neon tables (keys of countedScanTables). */
export const countedTables = Object.keys(countedScanTables)

const dayCountRowSchema = z.object({
  day_start: z.number().int(),
  n: z.number().int(),
})

/**
 * Per-day row counts, Neon against SCAN_DB, for `tables`: only tables this
 * run read to their end (not capped, not halted), so SCAN_DB holds every
 * row Neon had at the read's snapshot, and only days before `before`
 * (today's start). A day where Neon's count is not SCAN_DB's plus the rows
 * quarantined for it means rows went missing (or were deleted in Neon):
 * the run sets refill_required naming them.
 */
async function countMismatches(
  db: D1Database,
  neon: readonly DayCount[],
  tables: readonly string[],
  before: number,
): Promise<CountMismatch[]> {
  const mismatches: CountMismatch[] = []
  for (const [name, table] of Object.entries(countedScanTables)) {
    if (!tables.includes(name)) continue
    const from = Math.min(
      ...neon.filter((row) => row.table === name).map((row) => row.dayStart),
      before,
    )
    const [scan, quarantined] = await Promise.all([
      db
        .prepare(
          `SELECT (timestamp / 86400) * 86400 AS day_start, count(*) AS n
           FROM ${table} WHERE timestamp >= ?1 GROUP BY 1`,
        )
        .bind(from)
        .all(),
      db
        .prepare(
          `SELECT day, count(*) AS n FROM scan_quarantine
           WHERE source = ?1 AND day IS NOT NULL GROUP BY day`,
        )
        .bind(name)
        .all(),
    ])
    const scanByDay = new Map(
      z
        .array(dayCountRowSchema)
        .parse(scan.results)
        .map((row) => [row.day_start, row.n]),
    )
    const quarantinedByDay = new Map(
      z
        .array(z.object({ day: z.string(), n: z.number().int() }))
        .parse(quarantined.results)
        .map((row) => [row.day, row.n]),
    )
    for (const row of neon.filter((count) => count.table === name)) {
      // Complete UTC days only.
      if (row.dayStart + 86_400 > before) continue
      const day = dayOf(row.dayStart)
      const copied = scanByDay.get(row.dayStart) ?? 0
      const set = quarantinedByDay.get(day) ?? 0
      if (row.rows !== copied + set) {
        mismatches.push({
          table: name,
          day,
          text: `${name} ${day}: warehouse ${row.rows}, scan ${copied}, quarantined ${set}`,
        })
      }
    }
  }
  return mismatches
}

// ---- the run -------------------------------------------------------------

/** A started copy: its Neon read, then its D1 writes. */
export type ScanCopyRun = {
  /**
   * The one Neon round trip; runs once, never throws, and gives up after
   * the read timeout (finish reports it), so it can never hold up the
   * Pro snapshot that awaits it.
   */
  read(): Promise<void>
  /** D1 writes and aggregates (reads first if read() was not called). */
  finish(): Promise<ScanCopyResult>
}

/** Milliseconds the scan's Neon read may take before the run gives up. */
export const scanReadTimeoutMs = 10_000

/** A run still `running` after this long has crashed. */
export const staleRunSeconds = 15 * 60

/** Marks crashed runs failed; returns how many there were. */
async function markCrashedRuns(
  db: D1Database,
  nowSeconds: number,
): Promise<number> {
  const result = await db
    .prepare(
      `UPDATE scan_runs SET status = 'failed', finished_at = ?3,
         detail = 'Did not finish: the invocation ended'
       WHERE job = ?1 AND status = 'running' AND started_at < ?2`,
    )
    .bind(scanJob, nowSeconds - staleRunSeconds, nowSeconds)
    .run()
  return result.meta.changes ?? 0
}

/** Tables with a `halt:` marker in scan_cursors. */
async function haltMarkers(db: D1Database): Promise<ReadonlySet<string>> {
  const result = await db
    .prepare("SELECT name FROM scan_cursors WHERE name LIKE 'halt:%'")
    .all()
  return new Set(
    z
      .array(z.object({ name: z.string() }))
      .parse(result.results)
      .map((row) => row.name.slice(haltCursorPrefix.length)),
  )
}

/** Whether a run that has not crashed is still running. */
async function stillRunning(
  db: D1Database,
  nowSeconds: number,
): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT count(*) AS n FROM scan_runs
       WHERE job = ?1 AND status = 'running' AND started_at >= ?2`,
    )
    .bind(scanJob, nowSeconds - scanFallbackQuietSeconds)
    .first()
  return z.object({ n: z.number().int() }).parse(row).n > 0
}

function skippedRun(
  deps: ScanCopyDeps,
  reason: string,
  record: boolean,
  crashed: number,
): ScanCopyRun {
  return {
    async read() {},
    async finish() {
      if (!record) {
        return { status: "skipped", reason, aggregates: null }
      }
      // Recorded, so the cron fallback knows this tick was handled, and
      // the aggregates (D1 only) still make progress, unless a copy run is
      // still running: its batch and its aggregates come next, and two
      // aggregate passes at once could write an epoch from older rows.
      const busy = await stillRunning(deps.db, deps.nowSeconds)
      await startRun(deps.db, deps.trigger, deps.nowSeconds, "skipped", reason)
      const cursors = await readCursors(deps.db)
      const copied = cursors.get(cursorNames.activity)
      const aggregates = busy
        ? null
        : await (deps.aggregates ?? runAggregates)(deps.db, deps.nowSeconds, {
            queryBudget: deps.aggregateBudget ?? aggregateQueryBudget,
            copiedThrough:
              copied === undefined || copied === "0"
                ? null
                : Number.parseInt(copied, 10),
          })
      await writeStatus(deps.db, {
        status: "skipped",
        error: null,
        nowSeconds: deps.nowSeconds,
        cursors,
        crashed,
      })
      deps.logger.info({
        message: "Scan copy skipped",
        trigger: deps.trigger,
        reason,
        aggregates:
          aggregates === null ? "skipped: a run is in progress" : "run",
        epochs: aggregates?.epochs,
        days: aggregates?.days,
        dirtyRemaining: aggregates?.remaining,
      })
      return { status: "skipped", reason, aggregates }
    },
  }
}

/**
 * Decides whether this run copies, reads the checkpoints, and returns the
 * run. Nothing here queries Neon.
 */
export async function startScanCopy(deps: ScanCopyDeps): Promise<ScanCopyRun> {
  const { db, logger } = deps
  const clock = deps.clock ?? Date.now
  const timeoutMs = deps.readTimeoutMs ?? scanReadTimeoutMs
  const crashed = await markCrashedRuns(db, deps.nowSeconds)
  if (crashed > 0) {
    logger.error({
      message: "Scan copy runs crashed without finishing",
      crashed,
    })
  }
  // A halted table is read on every run until it copies cleanly, whether
  // or not its stream advanced: a fix in the warehouse must clear the halt
  // even on a quiet stream.
  const halts = await haltMarkers(db)
  const tables = new Set<ScanTable>([
    ...tablesToRead(deps.summary),
    ...scanTables.filter((table) => halts.has(table)),
  ])
  if (tables.size === 0) {
    return skippedRun(deps, "No stream advanced", true, crashed)
  }
  if (deps.trigger === "cron" && (await recentRun(db, deps.nowSeconds))) {
    return skippedRun(deps, "A scan run started recently", false, crashed)
  }
  // A chained run never overlaps one still running: two runs committing
  // out of order could restore older lock or aggregate state.
  if (deps.trigger === "chained" && (await stillRunning(db, deps.nowSeconds))) {
    return skippedRun(deps, "A scan run is still running", true, crashed)
  }
  const caps = { ...defaultCaps, ...deps.caps }
  const runId = await startRun(
    db,
    deps.trigger,
    deps.nowSeconds,
    "running",
    null,
  )
  const stored = await readCursors(db)
  const checkpoints: ScanCheckpoints = { ...initialCheckpoints }
  for (const table of scanTables) {
    checkpoints[table] = stored.get(cursorNames[table]) ?? checkpoints[table]
  }
  const today = dayOf(deps.nowSeconds)
  // The count check, once a day per table, on tables this run reads.
  const countTables = countedTables.filter(
    (name) =>
      tables.has(name as ScanTable) &&
      stored.get(countCheckCursor(name)) !== today &&
      // Enclave only on a run whose sweep starts at the beginning, the one
      // run that can read the whole table.
      (name !== "enclave" || (stored.get(enclaveSweepCursor) ?? "") === ""),
  )
  const plan: ScanReadPlan = {
    checkpoints,
    caps,
    tables,
    lockSweep: tables.has("activity")
      ? { after: stored.get(lockSweepCursor) ?? "", rows: lockSweepRows }
      : null,
    fullContracts:
      tables.has("contracts") && stored.get(contractsFullCursor) !== today,
    enclaveSweep: tables.has("enclave")
      ? {
          after: stored.get(enclaveSweepCursor) ?? "",
          rows: enclaveSweepRows,
        }
      : null,
    countsFrom:
      countTables.length > 0 ? dayStart(today) - countCheckDays * 86_400 : null,
    countTables,
  }
  let rows: ScanRows | null = null
  let readError: unknown = null
  let neonMs = 0
  let reading: Promise<void> | null = null

  function read(): Promise<void> {
    reading ??= (async () => {
      const started = clock()
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        const timeout = new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () =>
              reject(
                new Error(`Scan Neon read timed out after ${timeoutMs} ms`),
              ),
            timeoutMs,
          )
        })
        rows = await Promise.race([deps.warehouse.read(plan), timeout])
      } catch (error) {
        readError = error
      } finally {
        if (timer !== undefined) clearTimeout(timer)
        neonMs = clock() - started
      }
    })()
    return reading
  }

  /** A failure before the copy batch committed: nothing was written. */
  async function fail(error: unknown): Promise<never> {
    const message = error instanceof Error ? error.message : String(error)
    logger.error({
      message: "Scan copy failed; checkpoints unchanged",
      trigger: deps.trigger,
      error: message,
    })
    await runBatch(db, [
      finishRunStatement(runId, {
        status: "failed",
        rowsRead: null,
        rowsWritten: null,
        detail: message,
        nowSeconds: deps.nowSeconds,
      }),
    ]).catch(() => undefined)
    await writeStatus(db, {
      status: "failed",
      error: message,
      nowSeconds: deps.nowSeconds,
      cursors: stored,
      crashed,
    }).catch(() => undefined)
    throw error
  }

  async function finish(): Promise<ScanCopyResult> {
    await read()
    if (readError !== null) return fail(readError)
    const read_: ScanRows | null = rows
    if (read_ === null) return fail(new Error("Neon read returned nothing"))
    const cursors: Record<string, string> = {}
    let planned: CopyPlan
    let copied: number
    try {
      const storedEpoch = stored.get(lockVotesCursor)
      const decoders = decoderChanges(deps.summary, stored)
      Object.assign(cursors, decoders.writes)
      if (decoders.reason !== null) {
        cursors[refillCursor] = `${decoders.reason} at ${deps.nowSeconds}`
        logger.error({
          message: "WAREHOUSE REBUILT: the scan tables need a re-fill",
          reason: decoders.reason,
        })
      }
      if (read_.enclaveMode !== "none") {
        cursors[enclaveModeCursor] = read_.enclaveMode
      }
      // Rotating reads move on only when their table was not halted.
      const sweeps: { table: ScanTable; name: string; value: string }[] = []
      if (plan.lockSweep !== null) {
        sweeps.push({
          table: "activity",
          name: lockSweepCursor,
          value: read_.sweepAfter ?? "",
        })
      }
      // The daily full contracts re-read is done only if it was copied: a
      // halted one is done again on the next run.
      if (plan.fullContracts) {
        sweeps.push({
          table: "contracts",
          name: contractsFullCursor,
          value: today,
        })
      }
      if (plan.enclaveSweep !== null && plan.enclaveSweep !== undefined) {
        sweeps.push({
          table: "enclave",
          name: enclaveSweepCursor,
          value: read_.enclaveSweepAfter ?? "",
        })
      }
      planned = planCopy({
        rows: read_,
        checkpoints,
        lockVotesEpoch:
          storedEpoch === undefined ? null : Number.parseInt(storedEpoch, 10),
        seedLabels: stored.get(labelSeedCursor) !== labelSeedVersion,
        caps,
        nowSeconds: deps.nowSeconds,
        cursors,
        sweeps,
        readTables: tables,
      })
      copied = await runBatch(db, planned.statements)
    } catch (error) {
      return fail(error)
    }

    // The copy batch committed: checkpoints, rows and halt markers moved.
    // Anything failing from here on is reported as such, never as
    // "checkpoints unchanged".
    const after = new Map(stored)
    for (const [name, value] of Object.entries(cursors)) after.set(name, value)
    after.set(cursorNames.activity, planned.checkpoints.activity)
    for (const table of scanTables) {
      const reason = planned.halted[table]
      if (reason !== undefined) after.set(haltCursorPrefix + table, reason)
      else if (tables.has(table)) after.delete(haltCursorPrefix + table)
    }
    const halted = Object.keys(planned.halted).length > 0
    if (halted) {
      logger.error({
        message: "SCAN COPY HALTED for some tables: systematic row failures",
        halted: planned.halted,
      })
    }
    const errors: string[] = []
    const checkCursors: SqlStatement[] = []
    // The count check, on the due tables this run read to their end.
    // Enclave is compared only when this run's rotating diff read the
    // whole table: past one page, a row back-filled behind the checkpoint
    // is copied when the sweep reaches it, so a count taken before then
    // would differ without anything being lost.
    const enclaveWhole = read_.enclaveMode === "full"
    const checkable = countTables.filter(
      (name) =>
        !planned.capped.includes(name as ScanTable) &&
        planned.halted[name] === undefined &&
        (name !== "enclave" || enclaveWhole),
    )
    if (countTables.includes("enclave") && !enclaveWhole) {
      // Not checkable today (the table is larger than one sweep page): the
      // rotating diff repairs back-filled rows instead. Done for the day.
      checkCursors.push(
        cursorStatement(countCheckCursor("enclave"), today, deps.nowSeconds),
      )
    }
    if (checkable.length > 0) {
      try {
        const mismatches = await countMismatches(
          db,
          read_.dayCounts,
          checkable,
          dayStart(today),
        )
        // A difference must show on two consecutive daily checks: the flag
        // can only be cleared by an operator's re-fill, while a real loss
        // never heals itself and is still there a day later.
        const confirmed: CountMismatch[] = []
        for (const name of checkable) {
          const previous = new Set(
            parseJson(
              pendingDaysSchema.catch([]),
              stored.get(countPendingCursor(name)) ?? "[]",
            ),
          )
          const now_ = mismatches.filter((row) => row.table === name)
          confirmed.push(...now_.filter((row) => previous.has(row.day)))
          checkCursors.push(
            now_.length === 0
              ? {
                  sql: "DELETE FROM scan_cursors WHERE name = ?1",
                  params: [countPendingCursor(name)],
                }
              : cursorStatement(
                  countPendingCursor(name),
                  JSON.stringify(now_.map((row) => row.day)),
                  deps.nowSeconds,
                ),
          )
        }
        const unconfirmed = mismatches.filter((row) => !confirmed.includes(row))
        if (unconfirmed.length > 0) {
          logger.warn({
            message:
              "Scan count check differs; flagged for a re-fill if the next daily check agrees",
            mismatches: unconfirmed.map((row) => row.text),
          })
        }
        if (confirmed.length > 0) {
          const reason = `count check: ${confirmed
            .slice(0, 3)
            .map((row) => row.text)
            .join("; ")}`
          after.set(refillCursor, reason)
          checkCursors.push(
            cursorStatement(refillCursor, reason, deps.nowSeconds),
          )
          logger.error({
            message: "SCAN COUNT CHECK FAILED: rows are missing; re-fill",
            mismatches: confirmed.map((row) => row.text),
          })
        }
        for (const name of checkable) {
          checkCursors.push(
            cursorStatement(countCheckCursor(name), today, deps.nowSeconds),
          )
        }
      } catch (error) {
        errors.push(
          `count check: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }
    const copiedThrough = Number.parseInt(planned.checkpoints.activity, 10)
    let aggregates: AggregateResult | null = null
    try {
      aggregates = await (deps.aggregates ?? runAggregates)(
        db,
        deps.nowSeconds,
        {
          queryBudget: deps.aggregateBudget ?? aggregateQueryBudget,
          copiedThrough: copiedThrough > 0 ? copiedThrough : null,
        },
      )
    } catch (error) {
      errors.push(
        `aggregates: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
    if (errors.length > 0) {
      logger.error({
        message:
          "Scan copy committed, but a later step failed; it is retried next run",
        errors,
      })
    }
    const rowsWritten = copied + (aggregates?.rowsWritten ?? 0)
    const detail = [
      `neon ${neonMs} ms`,
      `capped ${planned.capped.join(",") || "none"}`,
      `quarantined ${planned.quarantined}`,
      ...(halted ? [`halted ${Object.keys(planned.halted).join(",")}`] : []),
      ...errors,
    ].join(", ")
    // Bookkeeping after a committed copy: a failure here is logged, the
    // copy stands, and the next run starts from the new checkpoints.
    try {
      await runBatch(db, [
        ...checkCursors,
        finishRunStatement(runId, {
          status: "ok",
          rowsRead: planned.rowsRead,
          rowsWritten,
          detail: detail.slice(0, 500),
          nowSeconds: deps.nowSeconds,
        }),
        pruneRunsStatement(deps.nowSeconds),
      ])
      await writeStatus(db, {
        status: "ok",
        error: errors.length === 0 ? null : errors.join("; "),
        nowSeconds: deps.nowSeconds,
        cursors: after,
        crashed,
      })
    } catch (error) {
      logger.error({
        message: "Scan copy committed; recording the run failed",
        error: error instanceof Error ? error.message : String(error),
      })
    }
    if (planned.quarantined > 0) {
      logger.error({
        message: "Scan copy quarantined rows it could not take",
        quarantined: planned.quarantined,
        bySource: planned.quarantinedBySource,
      })
    }
    logger.info({
      message: "Scan copy written",
      trigger: deps.trigger,
      tables: [...tables],
      rowsRead: planned.rowsRead,
      rowsWritten,
      capped: planned.capped,
      neonMs,
      enclave: read_.enclaveMode,
      checkpoints: planned.checkpoints,
      epochs: aggregates?.epochs,
      days: aggregates?.days,
      dirtyRemaining: aggregates?.remaining,
      d1Calls: (aggregates?.queries ?? 0) + 10,
    })
    return {
      status: "ok",
      rowsRead: planned.rowsRead,
      rowsWritten,
      capped: planned.capped,
      neonMs,
      quarantined: planned.quarantined,
      halted: planned.halted,
      aggregates,
    }
  }

  return { read, finish }
}

/** A whole run: read, then write. */
export async function runScanCopy(deps: ScanCopyDeps): Promise<ScanCopyResult> {
  const run = await startScanCopy(deps)
  await run.read()
  return run.finish()
}
