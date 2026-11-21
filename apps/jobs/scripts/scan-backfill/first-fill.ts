import { scanLockRowSchema } from "@matchbox/contracts/scan"
import { z } from "zod"
import {
  decoderCursors,
  defaultCaps,
  fillCursor,
  planCopy,
  refillCursor,
} from "../../src/scan/copy"
import {
  createScanWarehouseReader,
  type NeonLockRow,
  neonLockRowSchema,
  type ScanCheckpoints,
  type ScanTable,
  scanTables,
} from "../../src/scan/neon"
import {
  cursorStatement,
  type SqlStatement,
  upsertStatements,
} from "../../src/scan/statements"
import {
  lockRows,
  lockSpec,
  Quarantine,
  quarantineCap,
  quarantineStatements,
} from "../../src/scan/transform"
import type { QueryRunner } from "../../src/warehouse/reader"

// The first fill of the scan tables from Neon, as SQL. It replays the copy
// step's own plan (src/scan/copy.ts planCopy) chunk by chunk with large
// caps, so the result is exactly what the Worker would have built tick by
// tick, then adds every lock position (the Worker only re-reads locks that
// activity touches). The checkpoints it writes into scan_cursors let the
// Worker's copy step continue from where the fill stopped. Aggregates are
// left to the Worker: the fill marks every epoch and day dirty, and the copy
// step recomputes 24 of them per tick.

export const fillStateSchema = z.object({
  checkpoints: z.object({
    activity: z.string(),
    deposits: z.string(),
    troves: z.string(),
    morpho: z.string(),
    enclave: z.string(),
    contracts: z.string(),
  }),
  lockVotesEpoch: z.number().int().nullable(),
  /** Last lock position written, "<escrow>|<token id>"; null when done. */
  locksAfter: z.string().nullable(),
  locksDone: z.boolean(),
  seeded: z.boolean(),
  chunks: z.number().int(),
  rows: z.record(z.string(), z.number().int()),
  done: z.boolean(),
})

export type FillState = z.infer<typeof fillStateSchema>

export function initialFillState(): FillState {
  return {
    checkpoints: {
      activity: "0",
      deposits: "0",
      troves: "0",
      morpho: "0",
      enclave: "0",
      contracts: "",
    },
    lockVotesEpoch: null,
    locksAfter: "",
    locksDone: false,
    seeded: false,
    chunks: 0,
    rows: {},
    done: false,
  }
}

/** Rows per table per chunk: 10x the Worker's caps. */
export const fillCaps: Record<ScanTable, number> = {
  activity: defaultCaps.activity * 10,
  deposits: defaultCaps.deposits * 10,
  troves: defaultCaps.troves * 10,
  morpho: defaultCaps.morpho * 10,
  enclave: defaultCaps.enclave * 10,
  contracts: defaultCaps.contracts * 10,
}

/**
 * Quarantined rows of one source that halt a fill chunk: the Worker's 50 a
 * run scaled with the 10x chunk, so a few bad rows are quarantined and a
 * systematic failure stops the fill.
 */
export const fillHaltAt = quarantineCap * 10

const lockPageSize = 5_000

export function allLocksQuery(after: string) {
  const [escrow = "", tokenId = "-1"] = after.split("|")
  return {
    text: `SELECT contract_address, token_id::text, owner, amount::text,
             unlock_at::text, created_at::text, last_extended_at::text,
             withdrawn_at::text, is_permanent, is_withdrawn, is_merged,
             merged_into_token_id::text, merged_at::text, boost::text,
             activity_count::text
           FROM matchbox.lock_positions
           WHERE network = 'mezo'
             AND (contract_address, token_id) > ($1, $2::numeric)
           ORDER BY contract_address, token_id
           LIMIT ${lockPageSize}`,
    params: [escrow, tokenId],
  }
}

export const countsQuery = {
  text: `SELECT
    (SELECT count(*) FROM matchbox.activity_events WHERE network = 'mezo')::int AS activity,
    (SELECT count(*) FROM matchbox.lock_positions WHERE network = 'mezo')::int AS locks,
    (SELECT count(*) FROM matchbox.reward_deposits WHERE network = 'mezo')::int AS deposits,
    (SELECT count(*) FROM matchbox.trove_updates WHERE network = 'mezo')::int AS troves,
    (SELECT count(*) FROM matchbox.morpho_events WHERE network = 'mezo')::int AS morpho,
    (SELECT count(*) FROM matchbox.enclave_events WHERE network = 'mezo')::int AS enclave,
    (SELECT count(*) FROM matchbox.contracts WHERE network = 'mezo')::int AS contracts`,
  params: [],
}

export const countsSchema = z.object({
  activity: z.number().int(),
  locks: z.number().int(),
  deposits: z.number().int(),
  troves: z.number().int(),
  morpho: z.number().int(),
  enclave: z.number().int(),
  contracts: z.number().int(),
})

/**
 * The decoder versions the warehouse tables were built with. The fill
 * records them as the copy's decoder cursors, so the copy run after a
 * re-fill compares the indexer's version with the one the copied rows came
 * from, not with the one before the replay.
 */
export const decoderVersionsQuery = {
  text: `SELECT
    (SELECT decoder_version FROM matchbox.projection_state WHERE network = 'mezo') AS projection,
    (SELECT decoder_version FROM matchbox.borrow_state WHERE network = 'mezo') AS borrow`,
  params: [],
}

const decoderVersionsSchema = z.object({
  projection: z.number().int().nullable(),
  borrow: z.number().int().nullable(),
})

/**
 * The decoder cursors, from the warehouse at the fill's first chunk. A
 * stream with no state row (never built) writes nothing: the copy then
 * records the indexer's version on its next run without flagging.
 */
export async function decoderStatements(
  run: QueryRunner,
  nowSeconds: number,
): Promise<SqlStatement[]> {
  let versions: z.infer<typeof decoderVersionsSchema>
  try {
    const [result] = await run([decoderVersionsQuery])
    versions = decoderVersionsSchema.parse(
      z.array(z.unknown()).parse(result)[0],
    )
  } catch (error) {
    throw new Error(
      `Could not read the warehouse decoder versions (matchbox.projection_state, matchbox.borrow_state): ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  return (["projection", "borrow"] as const).flatMap((stream) => {
    const version = versions[stream]
    return version === null
      ? []
      : [cursorStatement(decoderCursors[stream], String(version), nowSeconds)]
  })
}

export type FillStep = {
  statements: SqlStatement[]
  state: FillState
  rowsRead: number
  /** Quarantined rows this chunk, per source. */
  quarantined: Record<string, number>
  /**
   * Tables this chunk halted ({table: reason}). The fill must stop: a
   * halted table keeps its checkpoint, so the next chunk would read the
   * same rows again forever.
   */
  halted: Record<string, string>
}

/** One chunk: the next window of every table, or the next lock page. */
export async function fillStep(
  run: QueryRunner,
  state: FillState,
  nowSeconds: number,
): Promise<FillStep> {
  if (!state.done) {
    // Read before the rows: a replay during the fill then shows as a
    // version change on the next copy run, which flags a re-fill.
    const decoders =
      state.chunks === 0 ? await decoderStatements(run, nowSeconds) : []
    const reader = createScanWarehouseReader(run)
    const rows = await reader.read({
      checkpoints: state.checkpoints,
      caps: fillCaps,
      tables: new Set(scanTables),
      // Every lock is written by the lock pages after the windows.
      lockSweep: null,
      fullContracts: false,
    })
    const plan = planCopy({
      rows,
      checkpoints: state.checkpoints,
      lockVotesEpoch: state.lockVotesEpoch,
      seedLabels: !state.seeded,
      caps: fillCaps,
      nowSeconds,
      haltAt: fillHaltAt,
      readTables: new Set(scanTables),
    })
    // Rows past the checkpoints; the Enclave diff and the contracts
    // recheck re-read rows on every chunk and are not counted.
    // Window rows only: the overlap re-reads return rows on every chunk.
    const forward = {
      activity: rows.windowCounts.activity,
      locks: rows.locks.length,
      deposits: rows.windowCounts.deposits,
      troves: rows.windowCounts.troves,
      morpho: rows.windowCounts.morpho,
      contracts: rows.windowCounts.contracts,
    }
    const counts = { ...state.rows }
    for (const [table, count] of Object.entries(forward)) {
      counts[table] = (counts[table] ?? 0) + count
    }
    counts.enclave = (counts.enclave ?? 0) + rows.windowCounts.enclave
    const read =
      Object.values(forward).reduce((total, n) => total + n, 0) +
      rows.windowCounts.enclave
    return {
      statements: [...plan.statements, ...decoders],
      rowsRead: read,
      quarantined: plan.quarantinedBySource,
      halted: plan.halted,
      state: {
        ...state,
        checkpoints: plan.checkpoints satisfies ScanCheckpoints,
        lockVotesEpoch: plan.lockVotesEpoch,
        seeded: true,
        chunks: state.chunks + 1,
        rows: counts,
        done: read === 0,
      },
    }
  }
  if (!state.locksDone && state.locksAfter !== null) {
    const [result] = await run([allLocksQuery(state.locksAfter)])
    const page = z.array(z.record(z.string(), z.unknown())).parse(result ?? [])
    // Per row, like the Worker: a bad lock is quarantined, not fatal.
    const quarantine = new Quarantine()
    const locks: NeonLockRow[] = []
    for (const raw of page) {
      const parsed = neonLockRowSchema.safeParse(raw)
      if (parsed.success) {
        locks.push(parsed.data)
        continue
      }
      quarantine.add({
        source: "locks",
        rowKey: `${String(raw.contract_address)}-${String(raw.token_id)}`,
        reason: `Neon schema: ${parsed.error.issues
          .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
          .join("; ")}`,
        payload: JSON.stringify(raw),
        day: null,
      })
    }
    const rows = quarantine.conform(
      lockRows(locks, nowSeconds, quarantine),
      scanLockRowSchema,
      "locks",
      (row) => `${String(row.escrow)}-${String(row.token_id)}`,
    )
    const quarantined = quarantine.rows.length
    const halted: Record<string, string> =
      quarantined >= fillHaltAt
        ? {
            locks: `${quarantined} lock positions quarantined in one page (cap ${fillHaltAt}): ${quarantine.rows[0]?.reason ?? ""}`,
          }
        : {}
    // The page's last key, from the raw rows: a bad row is passed too.
    const lastRaw = page.at(-1)
    const last =
      lastRaw === undefined
        ? undefined
        : {
            contract_address: String(lastRaw.contract_address),
            token_id: String(lastRaw.token_id),
          }
    return {
      statements: [
        ...upsertStatements(lockSpec, rows),
        ...quarantineStatements(quarantine.rows, nowSeconds, fillHaltAt),
      ],
      rowsRead: page.length,
      quarantined: quarantined === 0 ? {} : { locks: quarantined },
      halted,
      state: {
        ...state,
        locksAfter:
          last === undefined
            ? null
            : `${last.contract_address}|${last.token_id}`,
        locksDone: page.length < lockPageSize,
        chunks: state.chunks + 1,
        rows: {
          ...state.rows,
          allLocks: (state.rows.allLocks ?? 0) + page.length,
        },
      },
    }
  }
  return { statements: [], rowsRead: 0, state, quarantined: {}, halted: {} }
}

export function fillFinished(state: FillState): boolean {
  return state.done && state.locksDone
}

/** Marks the fill in scan_cursors so the Worker can tell it happened. */
export function fillMarker(nowSeconds: number): SqlStatement {
  return cursorStatement(fillCursor, String(nowSeconds), nowSeconds)
}

/**
 * --replace: empties every table the copy writes (and the copy's
 * checkpoints and the re-fill flag) before the first chunk, so a re-fill
 * after a warehouse replay also drops rows the new decoder no longer
 * produces. Values the daily writers and backfills wrote stay.
 *
 * The decoder versions stay too: the end of the first chunk overwrites
 * them with the warehouse's, and that chunk may be split over several
 * files. Until its last file is applied the old version is still there,
 * so a copy run in between (or a replay then) still flags a re-fill
 * rather than finding no version and recording the new one.
 */
export function replaceStatements(): SqlStatement[] {
  const tables = [
    "activity",
    "locks",
    "lock_votes",
    "incentive_deposits",
    "trove_events",
    "morpho_events",
    "enclave_events",
    "labels",
    "epoch_totals",
    "gauge_epoch",
    "scan_dirty",
    "scan_quarantine",
  ]
  return [
    ...tables.map((table) => ({ sql: `DELETE FROM ${table}`, params: [] })),
    { sql: "DELETE FROM pools WHERE source = 'warehouse'", params: [] },
    { sql: "DELETE FROM daily WHERE source = 'warehouse'", params: [] },
    {
      sql: `DELETE FROM scan_cursors WHERE name LIKE 'copy:%'
  OR name IN ('lock-votes:epoch', 'labels:seed', ?1, ?2)`,
      params: [refillCursor, fillCursor],
    },
  ]
}
