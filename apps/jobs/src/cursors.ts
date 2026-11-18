// Progress markers in READ_DB (`job_cursors`) and the run log
// (`snapshot_runs`).

export async function readCursor(
  db: D1Database,
  job: string,
  network: string,
): Promise<string | null> {
  const row = await db
    .prepare("SELECT value FROM job_cursors WHERE job = ?1 AND network = ?2")
    .bind(job, network)
    .first<{ value: string }>()
  return row?.value ?? null
}

export async function writeCursor(
  db: D1Database,
  job: string,
  network: string,
  value: string,
  nowSeconds: number,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO job_cursors (job, network, value, updated_at)
       VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT (job, network) DO UPDATE SET
         value = excluded.value, updated_at = excluded.updated_at
       WHERE job_cursors.value <> excluded.value`,
    )
    .bind(job, network, value, nowSeconds)
    .run()
}

export type RunTrigger = "chained" | "cron"

export async function startRun(
  db: D1Database,
  job: string,
  network: string,
  trigger: RunTrigger,
  nowSeconds: number,
): Promise<number> {
  const row = await db
    .prepare(
      `INSERT INTO snapshot_runs (job, network, trigger, started_at, status)
       VALUES (?1, ?2, ?3, ?4, 'running') RETURNING id`,
    )
    .bind(job, network, trigger, nowSeconds)
    .first<{ id: number }>()
  if (row === null) throw new Error("snapshot_runs insert returned no id")
  return row.id
}

export async function finishRun(
  db: D1Database,
  id: number,
  result: {
    status: "ok" | "failed" | "skipped"
    block: number | null
    rowsWritten: number | null
    detail: string | null
    nowSeconds: number
  },
): Promise<void> {
  await db
    .prepare(
      `UPDATE snapshot_runs
       SET status = ?2, block = ?3, rows_written = ?4, detail = ?5,
           finished_at = ?6
       WHERE id = ?1`,
    )
    .bind(
      id,
      result.status,
      result.block,
      result.rowsWritten,
      result.detail,
      result.nowSeconds,
    )
    .run()
}

/** Seconds since the job last finished successfully; null if never. */
export async function secondsSinceLastOk(
  db: D1Database,
  job: string,
  network: string,
  nowSeconds: number,
): Promise<number | null> {
  const row = await db
    .prepare(
      `SELECT max(finished_at) AS finished FROM snapshot_runs
       WHERE job = ?1 AND network = ?2 AND status = 'ok'`,
    )
    .bind(job, network)
    .first<{ finished: number | null }>()
  if (row === null || row.finished === null) return null
  return nowSeconds - row.finished
}
