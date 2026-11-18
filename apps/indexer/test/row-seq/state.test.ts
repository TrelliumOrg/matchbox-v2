import { PGlite } from "@electric-sql/pglite"
import { describe, expect, it } from "vitest"
import { rowSeqState } from "../../src/row-seq"
import { applyMigrations, pgClient } from "./pglite"

// What verify:warehouse reports for the change markers at each rollout step,
// and that it refuses a row_seq sequence whose cache would break commit
// order (RUNBOOK-scan-changes.md, "Three rules").
//
// Starting PGlite is most of the cost here (initdb in WebAssembly, about 3 s
// on the laptop runner and four times that under CI load), so the rollout is
// walked on one database, a step at a time, as production applies it.

describe("row_seq state", { timeout: 60_000 }, () => {
  it("is absent before 0013, stamping after it, complete after 0014", async () => {
    const db = new PGlite()
    let applied = ""
    async function through(last: string | null): Promise<void> {
      const from = applied
      await applyMigrations(
        db,
        (name) => name > from && (last === null || name <= last),
      )
      applied = last ?? "~"
    }

    await through("0012_borrow.sql")
    expect(await rowSeqState(pgClient(db))).toBe("absent")
    await through("0013_row_seq.sql")
    expect(await rowSeqState(pgClient(db))).toBe("stamping")
    await through(null)
    expect(await rowSeqState(pgClient(db))).toBe("complete")
  })

  it("fails when the sequence caches stamps", async () => {
    const db = new PGlite()
    await applyMigrations(db, () => true)
    await db.exec("ALTER SEQUENCE matchbox.row_seq CACHE 10")
    await expect(rowSeqState(pgClient(db))).rejects.toThrow(/cache 10/)
  })
})
