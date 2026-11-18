import type { Logger } from "@matchbox/logger"
import { z } from "zod"
import { chunkRows, type JsonRow, type SqlStatement } from "../scan/statements"
import { nextDay } from "../scan/transform"
import type { CometNode, CometReader, NodeStatus, PoaValidator } from "./comet"
import { maxBatch } from "./comet"
import {
  addBlock,
  blockRow,
  type CountRow,
  type Counts,
  countRows,
  dayOfTime,
  hourOf,
  type StoredMember,
} from "./counts"
import {
  type BlockRecord,
  type Commit,
  consensusAddressOf,
  decodeCommit,
  SetMismatchError,
  type Weighted,
} from "./decode"

// The uptime poller (README "Validator uptime"): once a minute, the commits
// of the heights since the last run, from a community CometBFT node, into
// SCAN_DB: one compact row a height (uptime_blocks), counts per validator
// and hour (uptime_hourly), rolled into days (uptime_daily) once a day is
// over. Every write of a run is one D1 batch guarded on the height it
// started from, so a height is never counted twice.

/** A node this many blocks behind the EVM head is behind. */
export const nodeMaxBehind = 40
/** The data this many blocks behind the EVM head is behind. */
export const dataMaxBehind = 150
/** Heights read on the first run, back from the node's head. */
const bootstrapHeights = 20
export const blockRetentionSeconds = 7 * 86_400
export const hourlyRetentionSeconds = 14 * 86_400
/** Days rolled up per run (more after an outage, a few a run). */
const finalizePerRun = 3

export type UptimePollInput = {
  db: D1Database
  reader: CometReader
  primary: CometNode
  fallback: CometNode | null
  /** The EVM head (eth_blockNumber); null when it could not be read. */
  evmHeight: () => Promise<number | null>
  nowSeconds: number
  /** Most heights a run reads. */
  maxHeights: number
  /** Milliseconds of reads before the run stops reading and writes. */
  readBudgetMs: number
  clock?: () => number
  logger: Logger
}

export type UptimePollResult =
  | { status: "skipped"; reason: string }
  | { status: "down"; error: string }
  | {
      status: "ok"
      source: string
      from: number | null
      to: number | null
      heights: number
      health: "ok" | "behind"
      error: string | null
    }

const decimal = z.string().regex(/^-?[0-9]+$/)

const statusRowSchema = z.object({
  height: z.number().int().nullable(),
  block_time: z.number().int().nullable(),
  set_id: z.number().int().nullable(),
  priorities: z.string().nullable(),
  started_time: z.number().int().nullable(),
  finalized_day: z.string().nullable(),
})
type StatusRow = z.infer<typeof statusRowSchema>

export const storedMemberSchema = z.object({
  c: z.string().regex(/^[0-9A-F]{40}$/),
  o: z
    .string()
    .regex(/^0x[0-9a-f]{40}$/)
    .nullable(),
  n: z.string().nullable(),
  /** Voting power (1 for every PoA validator). */
  p: decimal.default("1"),
})
export const storedMembersSchema = z.array(storedMemberSchema)

const setRowSchema = z.object({
  id: z.number().int(),
  hash: z.string(),
  members: z.string(),
})

/** A set in force: its stored row and what proposer selection needs. */
type LiveSet = {
  id: number
  hash: string
  members: StoredMember[]
  weighted: Weighted[]
}

function parseJsonText<T>(schema: z.ZodType<T>, text: string): T {
  return schema.parse(JSON.parse(text) as unknown)
}

function liveSet(row: z.infer<typeof setRowSchema>): LiveSet {
  const members = parseJsonText(storedMembersSchema, row.members)
  return {
    id: row.id,
    hash: row.hash,
    members: members.map(({ c, o, n }) => ({ c, o, n })),
    weighted: members.map((member) => ({
      address: member.c,
      power: BigInt(member.p),
      priority: 0n,
    })),
  }
}

function liveMembers(set: LiveSet): { id: number; members: Weighted[] } {
  return { id: set.id, members: set.weighted }
}

function isMissingTable(error: unknown): boolean {
  return /no such table: uptime_/i.test(String(error))
}

function message(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 300)
}

async function bindRun(db: D1Database, statement: SqlStatement) {
  return db
    .prepare(statement.sql)
    .bind(...statement.params)
    .run()
}

function prepared(db: D1Database, statements: readonly SqlStatement[]) {
  return statements.map((statement) =>
    db.prepare(statement.sql).bind(...statement.params),
  )
}

// -- statements ---------------------------------------------------------------

const guard =
  "EXISTS (SELECT 1 FROM uptime_status WHERE id = 1 AND height IS ?2)"

function blockStatements(
  records: readonly BlockRecord[],
  from: number | null,
): SqlStatement[] {
  const rows: JsonRow[] = records.map(blockRow)
  return chunkRows(rows).map((chunk) => ({
    sql: `INSERT OR IGNORE INTO uptime_blocks
  (height, time, round, set_id, proposer, missed, signed, signers)
SELECT json_extract(value, '$.height'), json_extract(value, '$.time'),
  json_extract(value, '$.round'), json_extract(value, '$.set_id'),
  json_extract(value, '$.proposer'), json_extract(value, '$.missed'),
  json_extract(value, '$.signed'), json_extract(value, '$.signers')
FROM json_each(?1) WHERE ${guard}`,
    params: [JSON.stringify(chunk), from],
  }))
}

const countColumns = [
  "blocks",
  "signed",
  "missed",
  "proposed",
  "proposals_missed",
  "expected_micro",
  "unattributed",
] as const

function countJson(row: CountRow, bucket: string, value: string | number) {
  const json: JsonRow = { validator: row.validator, [bucket]: value }
  for (const column of countColumns) json[column] = row.counts[column]
  json.first_height = row.counts.first_height
  json.last_height = row.counts.last_height
  return json
}

/** Adds a run's counts to uptime_hourly, guarded like the blocks. */
export function hourlyStatements(
  rows: readonly CountRow[],
  from: number | null,
): SqlStatement[] {
  const json = rows.map((row) => countJson(row, "hour", Number(row.bucket)))
  return chunkRows(json).map((chunk) => ({
    sql: `INSERT INTO uptime_hourly
  (validator, hour, ${countColumns.join(", ")}, first_height, last_height)
SELECT json_extract(value, '$.validator'), json_extract(value, '$.hour'),
  ${countColumns.map((column) => `json_extract(value, '$.${column}')`).join(", ")},
  json_extract(value, '$.first_height'), json_extract(value, '$.last_height')
FROM json_each(?1) WHERE ${guard}
ON CONFLICT (validator, hour) DO UPDATE SET
  ${countColumns.map((column) => `${column} = uptime_hourly.${column} + excluded.${column}`).join(",\n  ")},
  first_height = coalesce(min(uptime_hourly.first_height, excluded.first_height), excluded.first_height),
  last_height = coalesce(max(uptime_hourly.last_height, excluded.last_height), excluded.last_height)`,
    params: [JSON.stringify(chunk), from],
  }))
}

/**
 * uptime_daily rows for counts already summed per day (the backfill), or
 * from the backfill script: inserted where absent, and replacing only an
 * incomplete row (the poller's first, partial day), so a complete day is
 * never changed.
 */
export function dailyStatements(
  rows: readonly CountRow[],
  options: { complete: boolean; source: string; nowSeconds: number },
): SqlStatement[] {
  const json = rows.map((row) => ({
    ...countJson(row, "day", row.bucket),
    complete: options.complete ? 1 : 0,
    source: options.source,
    updated_at: options.nowSeconds,
  }))
  const columns = [
    ...countColumns,
    "first_height",
    "last_height",
    "complete",
    "source",
    "updated_at",
  ]
  return chunkRows(json).map((chunk) => ({
    sql: `INSERT INTO uptime_daily (validator, day, ${columns.join(", ")})
SELECT json_extract(value, '$.validator'), json_extract(value, '$.day'),
  ${columns.map((column) => `json_extract(value, '$.${column}')`).join(", ")}
FROM json_each(?1) WHERE true
ON CONFLICT (validator, day) DO UPDATE SET
  ${columns.map((column) => `${column} = excluded.${column}`).join(",\n  ")}
WHERE uptime_daily.complete = 0`,
    params: [JSON.stringify(chunk)],
  }))
}

function rollUpStatements(
  day: string,
  previous: string | null,
  complete: boolean,
  nowSeconds: number,
): SqlStatement[] {
  const start = Date.parse(`${day}T00:00:00Z`) / 1000
  const sums = countColumns.map((column) => `sum(${column})`).join(", ")
  return [
    {
      sql: `INSERT INTO uptime_daily (validator, day, ${countColumns.join(", ")},
  first_height, last_height, complete, source, updated_at)
SELECT validator, ?1, ${sums}, min(first_height), max(last_height), ?4,
  'live', ?5
FROM uptime_hourly
WHERE hour >= ?2 AND hour < ?3
  AND EXISTS (SELECT 1 FROM uptime_status WHERE id = 1 AND finalized_day IS ?6)
GROUP BY validator
ON CONFLICT (validator, day) DO UPDATE SET
  ${countColumns.map((column) => `${column} = excluded.${column}`).join(",\n  ")},
  first_height = excluded.first_height, last_height = excluded.last_height,
  complete = excluded.complete, source = excluded.source,
  updated_at = excluded.updated_at
WHERE excluded.complete = 1 OR uptime_daily.complete = 0`,
      params: [
        day,
        start,
        start + 86_400,
        complete ? 1 : 0,
        nowSeconds,
        previous,
      ],
    },
    {
      sql: `UPDATE uptime_status SET finalized_day = ?1
WHERE id = 1 AND finalized_day IS ?2`,
      params: [day, previous],
    },
  ]
}

// -- the run ------------------------------------------------------------------

type NodeChoice = {
  node: CometNode
  status: NodeStatus
  healthy: boolean
}

async function nodeStatus(
  reader: CometReader,
  node: CometNode,
  log: Logger,
): Promise<NodeStatus | null> {
  try {
    return await reader.status(node)
  } catch (error) {
    log.warn({
      message: "Uptime node did not answer",
      node: node.label,
      error: message(error),
    })
    return null
  }
}

/**
 * The node to read: the primary when it is healthy (not catching up,
 * within nodeMaxBehind of the EVM head) and still holds the next height,
 * else the fallback on the same terms, else whichever answered and holds
 * the next height, furthest ahead (its data is right, only late).
 */
export async function chooseNode(
  reader: CometReader,
  primary: CometNode,
  fallback: CometNode | null,
  next: number | null,
  evm: number | null,
  log: Logger,
): Promise<{ chosen: NodeChoice | null; other: NodeChoice | null }> {
  const healthy = (status: NodeStatus) =>
    !status.catchingUp && (evm === null || evm - status.height <= nodeMaxBehind)
  const holds = (status: NodeStatus) => next === null || status.earliest <= next
  const choices: NodeChoice[] = []
  const first = await nodeStatus(reader, primary, log)
  if (first !== null) {
    choices.push({ node: primary, status: first, healthy: healthy(first) })
  }
  if (
    fallback !== null &&
    (first === null || !healthy(first) || !holds(first))
  ) {
    const second = await nodeStatus(reader, fallback, log)
    if (second !== null) {
      choices.push({ node: fallback, status: second, healthy: healthy(second) })
    }
  }
  const usable = choices.filter((choice) => holds(choice.status))
  const chosen =
    usable.find((choice) => choice.healthy) ??
    [...usable].sort((a, b) => b.status.height - a.status.height)[0] ??
    null
  const other = usable.find((choice) => choice !== chosen) ?? null
  return { chosen, other }
}

async function readStatus(db: D1Database): Promise<StatusRow> {
  const row = await db
    .prepare(
      `SELECT height, block_time, set_id, priorities, started_time, finalized_day
FROM uptime_status WHERE id = 1`,
    )
    .first()
  return statusRowSchema.parse(row)
}

async function readSet(
  db: D1Database,
  where: { id: number } | { hash: string },
) {
  const row = await db
    .prepare(
      "id" in where
        ? "SELECT id, hash, members FROM uptime_sets WHERE id = ?1"
        : "SELECT id, hash, members FROM uptime_sets WHERE hash = ?1",
    )
    .bind("id" in where ? where.id : where.hash)
    .first()
  return row === null ? null : liveSet(setRowSchema.parse(row))
}

const prioritiesSchema = z.array(decimal)

export async function runUptimePoll(
  input: UptimePollInput,
): Promise<UptimePollResult> {
  const { db, reader, logger: log } = input
  const clock = input.clock ?? Date.now
  const now = input.nowSeconds
  try {
    const lease = await db
      .prepare(
        "UPDATE uptime_status SET lease_until = ?1 WHERE id = 1 AND lease_until <= ?2",
      )
      .bind(now + 55, now)
      .run()
    if (lease.meta.changes === 0) {
      return { status: "skipped", reason: "Another uptime run holds the lease" }
    }
  } catch (error) {
    if (isMissingTable(error)) {
      log.warn({
        message:
          "UPTIME TABLES MISSING: apply scan-migrations 0005 to SCAN_DB; uptime skipped",
      })
      return { status: "skipped", reason: "Migration 0005 not applied" }
    }
    throw error
  }
  const started = clock()
  let evm: number | null = null
  let nodeHeight: number | null = null
  try {
    const status = await readStatus(db)
    evm = await input.evmHeight().catch(() => null)
    const next = status.height === null ? null : status.height + 1
    const { chosen, other } = await chooseNode(
      reader,
      input.primary,
      input.fallback,
      next,
      evm,
      log,
    )
    if (chosen === null) {
      const error = "No uptime node answered or held the next height"
      await bindRun(db, {
        sql: `UPDATE uptime_status SET health = 'down', last_error = ?1,
  failures = failures + 1, evm_height = coalesce(?2, evm_height),
  updated_at = ?3, lease_until = 0 WHERE id = 1`,
        params: [error, evm, now],
      })
      log.warn({ message: "Uptime paused: no node", error })
      return { status: "down", error }
    }
    let node = chosen
    nodeHeight = node.status.height
    const first = next ?? node.status.height - bootstrapHeights
    // The head's commit is not canonical yet: read to the head minus one.
    const last = Math.min(node.status.height - 1, first + input.maxHeights - 1)

    let set =
      status.set_id === null ? null : await readSet(db, { id: status.set_id })
    let priorities: bigint[] | null =
      status.priorities === null || set === null
        ? null
        : parseJsonText(prioritiesSchema, status.priorities).map(BigInt)
    if (priorities !== null && set !== null) {
      if (priorities.length !== set.members.length) priorities = null
    }
    let poa: PoaValidator[] | null = null
    const records: BlockRecord[] = []
    const membersBySet = new Map<number, StoredMember[]>()
    let readError: string | null = null

    async function freshSet(commit: Commit): Promise<{
      set: LiveSet
      current: bigint[]
    }> {
      const entries = await reader.validators(node.node, commit.height)
      for (const entry of entries) {
        if (consensusAddressOf(entry.pubKey) !== entry.address) {
          throw new Error(`Validator ${entry.address} does not match its key`)
        }
      }
      let stored = await readSet(db, { hash: commit.validatorsHash })
      const unmapped =
        stored === null || stored.members.some((member) => member.o === null)
      if (unmapped) {
        poa ??= await reader.poaValidators(node.node).catch((error) => {
          log.warn({
            message: "PoA validators unread; members unnamed",
            error: message(error),
          })
          return []
        })
        const byConsensus = new Map(poa.map((each) => [each.consensus, each]))
        const members = entries.map((entry) => ({
          c: entry.address,
          o: byConsensus.get(entry.address)?.operator ?? null,
          n: byConsensus.get(entry.address)?.moniker ?? null,
          p: entry.power.toString(),
        }))
        await db.batch(
          prepared(db, [
            {
              sql: `INSERT INTO uptime_sets (hash, first_height, members, created_at)
VALUES (?1, ?2, ?3, ?4)
ON CONFLICT (hash) DO UPDATE SET members = excluded.members
WHERE uptime_sets.members IS NOT excluded.members
  AND instr(excluded.members, '"o":null') = 0`,
              params: [
                commit.validatorsHash,
                commit.height,
                JSON.stringify(members),
                now,
              ],
            },
          ]),
        )
        stored = await readSet(db, { hash: commit.validatorsHash })
      }
      if (stored === null) throw new Error("Validator set not stored")
      if (
        stored.members.length !== entries.length ||
        stored.members.some(
          (member, index) => member.c !== entries[index]?.address,
        )
      ) {
        throw new SetMismatchError(
          `Stored set ${stored.id} differs from the node's at ${commit.height}`,
        )
      }
      return { set: stored, current: entries.map((entry) => entry.priority) }
    }

    async function decodeOne(commit: Commit): Promise<BlockRecord> {
      if (
        set !== null &&
        set.hash === commit.validatorsHash &&
        priorities !== null
      ) {
        try {
          const decoded = decodeCommit(commit, liveMembers(set), {
            previous: priorities,
            current: null,
          })
          if ("record" in decoded) return decoded.record
          log.info({
            message: "Uptime proposer order re-read",
            height: commit.height,
          })
        } catch (error) {
          if (!(error instanceof SetMismatchError)) throw error
          log.warn({ message: "Uptime set re-read", error: error.message })
        }
      }
      const fresh = await freshSet(commit)
      set = fresh.set
      const decoded = decodeCommit(commit, liveMembers(fresh.set), {
        previous: null,
        current: fresh.current,
      })
      if (!("record" in decoded)) throw new Error("Unreachable resync")
      return decoded.record
    }

    let height = first
    while (height <= last) {
      if (clock() - started > input.readBudgetMs) break
      const batch = Array.from(
        { length: Math.min(maxBatch, last - height + 1) },
        (_, index) => height + index,
      )
      let commits: Commit[]
      try {
        commits = await reader.commits(node.node, batch)
      } catch (error) {
        const end = batch.at(-1) ?? height
        if (other === null || other.status.height - 1 < end || other === node) {
          readError = message(error)
          break
        }
        log.warn({
          message: "Uptime node failed; trying the other",
          node: node.node.label,
          error: message(error),
        })
        node = other
        nodeHeight = node.status.height
        try {
          commits = await reader.commits(node.node, batch)
        } catch (retry) {
          readError = message(retry)
          break
        }
      }
      let stop = false
      for (const commit of commits) {
        try {
          const record = await decodeOne(commit)
          records.push(record)
          priorities = record.priorities
          if (set !== null) membersBySet.set(set.id, set.members)
        } catch (error) {
          readError = message(error)
          stop = true
          break
        }
      }
      if (stop) break
      height += batch.length
    }

    const lastRecord = records.at(-1) ?? null
    const lastHeight = lastRecord?.height ?? status.height
    const behindBlocks =
      lastHeight === null ? null : (evm ?? node.status.height) - lastHeight
    const health: "ok" | "behind" =
      node.healthy && behindBlocks !== null && behindBlocks <= dataMaxBehind
        ? "ok"
        : "behind"

    if (lastRecord === null) {
      await bindRun(db, {
        sql: `UPDATE uptime_status SET read_at = ?1, source = ?2, node_height = ?3,
  evm_height = ?4, health = ?5, last_error = ?6,
  failures = CASE WHEN ?6 IS NULL THEN 0 ELSE failures + 1 END,
  updated_at = ?1, lease_until = 0
WHERE id = 1`,
        params: [now, node.node.label, nodeHeight, evm, health, readError],
      })
    } else {
      const hourly = new Map<string, Map<string, Counts>>()
      for (const record of records) {
        const members = membersBySet.get(record.setId) ?? []
        addBlock(hourly, String(hourOf(record.time)), record, members)
      }
      const firstRecord = records[0]
      const statements: SqlStatement[] = [
        ...blockStatements(records, status.height),
        ...hourlyStatements(countRows(hourly), status.height),
        {
          sql: `UPDATE uptime_status SET height = ?1, block_time = ?3,
  set_id = ?4, priorities = ?5,
  started_height = coalesce(started_height, ?6),
  started_time = coalesce(started_time, ?7),
  read_at = ?8, source = ?9, node_height = ?10, evm_height = ?11,
  health = ?12, last_error = ?13,
  failures = CASE WHEN ?13 IS NULL THEN 0 ELSE failures + 1 END,
  updated_at = ?8, lease_until = 0
WHERE id = 1 AND height IS ?2`,
          params: [
            lastRecord.height,
            status.height,
            lastRecord.time,
            lastRecord.setId,
            lastRecord.priorities === null
              ? null
              : JSON.stringify(
                  lastRecord.priorities.map((priority) => priority.toString()),
                ),
            firstRecord?.height ?? null,
            firstRecord?.time ?? null,
            now,
            node.node.label,
            nodeHeight,
            evm,
            health,
            readError,
          ],
        },
        {
          sql: `DELETE FROM uptime_blocks WHERE height < (SELECT min(first_height)
  FROM uptime_hourly WHERE validator = '' AND hour >= ?1)`,
          params: [now - blockRetentionSeconds],
        },
        {
          sql: "DELETE FROM uptime_hourly WHERE hour < ?1",
          params: [now - hourlyRetentionSeconds],
        },
      ]
      const results = await db.batch(prepared(db, statements))
      const statusResult = results[statements.length - 3]
      if (statusResult?.meta.changes !== 1) {
        log.warn({
          message: "Uptime heights already counted by another run",
          from: firstRecord?.height,
        })
      }
      await finalizeDays(db, now, log)
    }
    const result: UptimePollResult = {
      status: "ok",
      source: node.node.label,
      from: records[0]?.height ?? null,
      to: lastRecord?.height ?? null,
      heights: records.length,
      health,
      error: readError,
    }
    log.info({ message: "Uptime read", ...result })
    return result
  } catch (error) {
    await bindRun(db, {
      sql: `UPDATE uptime_status SET last_error = ?1, failures = failures + 1,
  node_height = coalesce(?2, node_height), evm_height = coalesce(?3, evm_height),
  updated_at = ?4, lease_until = 0 WHERE id = 1`,
      params: [message(error), nodeHeight, evm, now],
    }).catch(() => undefined)
    throw error
  }
}

/** Rolls finished days from uptime_hourly into uptime_daily. */
export async function finalizeDays(
  db: D1Database,
  now: number,
  log: Logger,
): Promise<string[]> {
  const status = await readStatus(db)
  if (status.block_time === null || status.started_time === null) return []
  const today = dayOfTime(status.block_time)
  const done: string[] = []
  let previous = status.finalized_day
  let day =
    previous === null ? dayOfTime(status.started_time) : nextDay(previous)
  while (day < today && done.length < finalizePerRun) {
    const start = Date.parse(`${day}T00:00:00Z`) / 1000
    const complete = status.started_time <= start
    await db.batch(prepared(db, rollUpStatements(day, previous, complete, now)))
    done.push(day)
    previous = day
    day = nextDay(day)
  }
  if (done.length > 0)
    log.info({ message: "Uptime days rolled up", days: done })
  return done
}
