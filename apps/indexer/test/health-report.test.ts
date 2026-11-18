import type { PGlite } from "@electric-sql/pglite"
import { describe, expect, it } from "vitest"
import { PgBorrowStore } from "../src/borrow/pg-store"
import { healthReport } from "../src/health-report"
import { PgIngestStore } from "../src/ingest/store"
import { PgScanStore } from "../src/scan-stream/pg-store"
import { CONFIG, fakeRpc, migratedThrough } from "./fake-rpc"
import { pgPool } from "./row-seq/pglite"

// /health must answer at every step of the rollout in
// RUNBOOK-scan-changes.md: a stream whose tables are not there yet reports
// null fields, never a 503 for the whole check.

async function report(db: PGlite, rpc = fakeRpc()) {
  const pool = pgPool(db)
  return healthReport(
    "mezo",
    { config: CONFIG, rpc, store: new PgIngestStore(pool) },
    pool,
    { config: CONFIG, rpc, store: new PgBorrowStore(pool) },
    { config: CONFIG, rpc, store: new PgScanStore(pool) },
  )
}

const nullStream = {
  lastBlock: null,
  lag: null,
  builtWithDecoderVersion: null,
  replayRequired: false,
}

describe("/health through the rollout", { timeout: 60_000 }, () => {
  it("answers before the borrow tables (through 0011)", async () => {
    const health = await report(
      await migratedThrough("0011_trove_interest_comment.sql"),
    )
    expect(health.status).toBe(200)
    expect(health.body).toMatchObject({ borrow: nullStream, scan: nullStream })
  })

  it("answers after the borrow tables, before 0013 (through 0012)", async () => {
    const health = await report(await migratedThrough("0012_borrow.sql"))
    expect(health.status).toBe(200)
    expect(health.body).toMatchObject({ scan: nullStream })
  })

  it("answers after the change markers, before the scan tables (through 0014)", async () => {
    const health = await report(
      await migratedThrough("0014_row_seq_finish.sql"),
    )
    expect(health.status).toBe(200)
    expect(health.body).toMatchObject({
      scan: nullStream,
      escrowMaxTime: { ok: true, drift: [] },
    })
  })

  it("reports the scan stream once 0015 is applied", async () => {
    const db = await migratedThrough(null)
    await db.query(
      `INSERT INTO matchbox.scan_stream_state (network, decoder_version)
       VALUES ('mezo', 1)`,
    )
    const health = await report(db)
    expect(health.status).toBe(200)
    expect(health.body).toMatchObject({
      scan: { builtWithDecoderVersion: 1, replayRequired: false },
    })
  })

  it("shows an escrow MAXTIME that changed on chain", async () => {
    const veBtc = "0x3d4b1b884a7a1e59fe8589a3296ec8f8cbb6f279"
    const health = await report(
      await migratedThrough(null),
      fakeRpc({ [veBtc]: 7n * 86_400n }),
    )
    expect(health.body).toMatchObject({
      escrowMaxTime: {
        ok: false,
        drift: [{ escrow: veBtc, expected: "2419200", onChain: "604800" }],
      },
    })
  })
})
