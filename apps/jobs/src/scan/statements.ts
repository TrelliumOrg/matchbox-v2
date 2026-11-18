// SQL for the scan database as plain values, so the same statements run in
// the Worker (a D1 batch) and in the backfill scripts (an SQL file a human
// applies with `wrangler d1 execute --file`).
//
// Rows travel as one JSON parameter per statement and are expanded with
// json_each, so a chunk of hundreds of rows is one statement with one bound
// value (D1 allows 100 bound parameters per statement).

export type SqlValue = string | number | null

export type SqlStatement = { sql: string; params: SqlValue[] }

/** A row bound for json_each: strings, integers, booleans or null. */
export type JsonRow = Record<string, string | number | boolean | null>

/** D1 statements stay well under 100 KB; JSON chunks are cut at this size. */
export const maxChunkBytes = 90_000

/** Splits rows into chunks whose JSON stays under `maxBytes`. */
export function chunkRows<Row extends JsonRow>(
  rows: readonly Row[],
  maxBytes = maxChunkBytes,
): Row[][] {
  const chunks: Row[][] = []
  let current: Row[] = []
  let size = 2
  for (const row of rows) {
    const rowSize = JSON.stringify(row).length + 1
    if (current.length > 0 && size + rowSize > maxBytes) {
      chunks.push(current)
      current = []
      size = 2
    }
    current.push(row)
    size += rowSize
  }
  if (current.length > 0) chunks.push(current)
  return chunks
}

export type UpsertSpec = {
  table: string
  columns: readonly string[]
  /** Conflict target; omitted for a plain INSERT OR IGNORE. */
  key: readonly string[]
  /**
   * Columns rewritten on conflict, only when one of them changed. Empty:
   * existing rows are left alone (immutable events).
   */
  update: readonly string[]
  /** Extra condition an update must also meet (SQL over the old row). */
  guard?: string
}

/**
 * INSERT ... SELECT FROM json_each(?1) with an ON CONFLICT that rewrites a
 * row only when a value changed, so a re-run writes nothing.
 */
export function upsertStatements(
  spec: UpsertSpec,
  rows: readonly JsonRow[],
  maxBytes = maxChunkBytes,
): SqlStatement[] {
  if (rows.length === 0) return []
  const select = spec.columns
    .map((column) => `json_extract(value, '$.${column}')`)
    .join(", ")
  const conflict =
    spec.update.length === 0
      ? `ON CONFLICT (${spec.key.join(", ")}) DO NOTHING`
      : `ON CONFLICT (${spec.key.join(", ")}) DO UPDATE SET ${spec.update
          .map((column) => `${column} = excluded.${column}`)
          .join(", ")} WHERE (${spec.update
          .filter((column) => column !== "updated_at")
          .map((column) => `${spec.table}.${column} IS NOT excluded.${column}`)
          .join(
            " OR ",
          )})${spec.guard === undefined ? "" : ` AND (${spec.guard})`}`
  const sql = `INSERT INTO ${spec.table} (${spec.columns.join(", ")})
SELECT ${select} FROM json_each(?1) WHERE true
${conflict}`
  return chunkRows(rows, maxBytes).map((chunk) => ({
    sql,
    params: [JSON.stringify(chunk)],
  }))
}

export function cursorStatement(
  name: string,
  value: string,
  nowSeconds: number,
): SqlStatement {
  return {
    sql: `INSERT INTO scan_cursors (name, value, updated_at) VALUES (?1, ?2, ?3)
ON CONFLICT (name) DO UPDATE SET value = excluded.value,
  updated_at = excluded.updated_at
WHERE scan_cursors.value IS NOT excluded.value`,
    params: [name, value, nowSeconds],
  }
}

export type DirtyKind = "epoch" | "day"

/**
 * Marks epochs or days dirty. Re-marking bumps the generation, so an
 * aggregate computed while the marker was re-set does not clear it.
 */
export function dirtyStatement(
  kind: DirtyKind,
  keys: readonly string[],
): SqlStatement[] {
  if (keys.length === 0) return []
  // Chunked like every JSON parameter: the fill inlines it into its SQL.
  return chunkRows([...new Set(keys)].sort().map((key) => ({ key }))).map(
    (chunk) => ({
      sql: `INSERT INTO scan_dirty (kind, key, generation)
SELECT ?1, value, 0 FROM json_each(?2) WHERE true
ON CONFLICT (kind, key) DO UPDATE SET generation = scan_dirty.generation + 1`,
      params: [kind, JSON.stringify(chunk.map((row) => row.key))],
    }),
  )
}

/** Runs statements as one D1 batch (one transaction). */
export async function runBatch(
  db: D1Database,
  statements: readonly SqlStatement[],
): Promise<number> {
  if (statements.length === 0) return 0
  const results = await db.batch(
    statements.map((statement) =>
      db.prepare(statement.sql).bind(...statement.params),
    ),
  )
  return results.reduce(
    (total, result) => total + (result.meta.rows_written ?? 0),
    0,
  )
}

/** An SQL string literal. */
export function sqlLiteral(value: SqlValue): string {
  if (value === null) return "NULL"
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw new Error(`Refusing a non-integer SQL number: ${value}`)
    }
    return String(value)
  }
  return `'${value.replaceAll("'", "''")}'`
}

/**
 * Inlines parameters (?1, ?2, ...) for an SQL file. Parameters are only
 * ever numbered placeholders in this module, never inside string literals.
 */
export function inlineStatement(statement: SqlStatement): string {
  const sql = statement.sql.replace(/\?(\d+)/g, (_match, index: string) => {
    const value = statement.params[Number.parseInt(index, 10) - 1]
    if (value === undefined) throw new Error(`Missing SQL parameter ?${index}`)
    return sqlLiteral(value)
  })
  return `${sql.trim()};\n`
}

/** Base-unit integer left-padded to 40 digits (numeric TEXT order). */
export function sortKey(value: string): string {
  if (!/^[0-9]+$/.test(value) || value.length > 40) {
    throw new Error(`Not a sortable base-unit integer: ${value}`)
  }
  return value.padStart(40, "0")
}

/**
 * A checkpoint cursor that never moves backward: an older run committing
 * after a newer one cannot restore its stale position. Numeric cursors
 * compare as integers, composite ones (contracts) as text, which orders
 * their fixed-width ISO times. A re-fill with --replace deletes cursors
 * first, so it can still start over.
 */
export function monotonicCursorStatement(
  name: string,
  value: string,
  nowSeconds: number,
): SqlStatement {
  const numeric = /^[0-9]+$/.test(value)
  const newer = numeric
    ? "CAST(excluded.value AS INTEGER) > CAST(scan_cursors.value AS INTEGER)"
    : "excluded.value > scan_cursors.value"
  return {
    sql: `INSERT INTO scan_cursors (name, value, updated_at) VALUES (?1, ?2, ?3)
ON CONFLICT (name) DO UPDATE SET value = excluded.value,
  updated_at = excluded.updated_at
WHERE ${newer}`,
    params: [name, value, nowSeconds],
  }
}

/**
 * A batch that writes rows the API serves: it notes total_changes() first,
 * runs the served statements, then bumps scan_status.data_version only if
 * one of them changed a row, then runs the rest (cursors, markers), which
 * never bump it. The API keys its caches on data_version.
 */
export function servedBatch(
  served: readonly SqlStatement[],
  rest: readonly SqlStatement[] = [],
): SqlStatement[] {
  if (served.length === 0) return [...rest]
  return [
    {
      sql: "UPDATE scan_status SET change_mark = total_changes() WHERE id = 1",
      params: [],
    },
    ...served,
    {
      sql: `UPDATE scan_status SET data_version = data_version + 1
WHERE id = 1 AND total_changes() > change_mark + 1`,
      params: [],
    },
    ...rest,
  ]
}
