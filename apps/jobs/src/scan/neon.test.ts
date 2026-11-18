import type { PGlite } from "@electric-sql/pglite"
import { activityExtraSchema } from "@matchbox/contracts/scan"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { z } from "zod"
import {
  createScanWarehouseReader,
  type ScanCheckpoints,
  type ScanReadPlan,
  type ScanRows,
  type ScanTable,
  scanTables,
} from "./neon"
import {
  activityFixture,
  fixtureReader,
  gaugeG,
  poolP,
} from "./testing/fixture"
import { fixtureWarehouse, pgliteRunner } from "./testing/pglite"
import { parseJson } from "./transform"

// The copy step's Neon SQL on PGlite (Postgres in WebAssembly, in process)
// with the indexer's own migrations: the fixture's rows go into the
// warehouse tables, and the reader must return exactly what the in-memory
// fixture reader returns, for full and capped windows. Nothing here talks
// to Neon.

let db: PGlite

beforeAll(async () => {
  db = await fixtureWarehouse()
}, 60_000)

afterAll(async () => {
  await db.close()
})

const initial: ScanCheckpoints = {
  activity: "0",
  deposits: "0",
  troves: "0",
  morpho: "0",
  enclave: "0",
  contracts: "",
}

function plan(
  checkpoints: ScanCheckpoints,
  cap: number,
  tables: readonly ScanTable[] = scanTables,
): ScanReadPlan {
  return {
    checkpoints,
    caps: {
      activity: cap,
      deposits: cap,
      troves: cap,
      morpho: cap,
      enclave: cap,
      contracts: cap,
    },
    tables: new Set(tables),
    lockSweep: null,
    fullContracts: false,
  }
}

/** Activity extra compared as objects (Postgres formats JSON its own way). */
function normalized(rows: ScanRows) {
  return {
    ...rows,
    activity: rows.activity.map((row) => {
      const extra = parseJson(activityExtraSchema, row.extra)
      const { boost_context: _context, ...rest } = extra
      return { ...row, extra: rest }
    }),
    locks: [...rows.locks].sort((a, b) => a.token_id.localeCompare(b.token_id)),
  }
}

describe("scan warehouse SQL (PGlite)", () => {
  it("reads every table past its checkpoint, matching the fixture", async () => {
    const reader = createScanWarehouseReader(pgliteRunner(db))
    const read = await reader.read(plan(initial, 10_000))
    const expected = await fixtureReader().read(plan(initial, 10_000))
    expect(normalized(read)).toEqual(normalized(expected))
    // PoolsVoter names the pool; the SQL maps it to the gauge.
    const vote = read.activity.find((row) => row.action_type === "BOOST_VOTE")
    expect(vote).toMatchObject({ raw_gauge: poolP, gauge: gaugeG, pool: poolP })
  })

  // One walk per table group and cap, each in its own test: a walk reads
  // only its group's tables and stops once they are exhausted, so each
  // test runs a handful of PGlite queries, not hundreds.
  const groups: { name: string; tables: ScanTable[] }[] = [
    { name: "activity and touched locks", tables: ["activity"] },
    {
      name: "deposits, troves, Morpho, Enclave and contracts",
      tables: ["deposits", "troves", "morpho", "enclave", "contracts"],
    },
  ]
  for (const group of groups) {
    for (const cap of [1, 2, 5]) {
      it(`bounds ${group.name} to whole blocks at cap ${cap}`, async () => {
        const reader = createScanWarehouseReader(pgliteRunner(db))
        const fixture = fixtureReader()
        let checkpoints = initial
        let steps = 0
        for (;;) {
          const request = plan(checkpoints, cap, group.tables)
          const [read, expected] = await Promise.all([
            reader.read(request),
            fixture.read(request),
          ])
          expect(normalized(read)).toEqual(normalized(expected))
          steps += 1
          expect(steps).toBeLessThan(20)
          const last = read.contracts.at(-1)
          const before = JSON.stringify(checkpoints)
          checkpoints = {
            activity: read.activity.at(-1)?.timestamp ?? checkpoints.activity,
            deposits:
              read.deposits.at(-1)?.block_number ?? checkpoints.deposits,
            troves: read.troves.at(-1)?.block_number ?? checkpoints.troves,
            morpho: read.morpho.at(-1)?.block_number ?? checkpoints.morpho,
            enclave: read.enclave.at(-1)?.block_number ?? checkpoints.enclave,
            contracts:
              last === undefined
                ? checkpoints.contracts
                : `${last.discovered_at}|${last.address}`,
          }
          // Done when no checkpoint moves (the Enclave diff and the
          // contracts lookback re-read rows by design).
          if (JSON.stringify(checkpoints) === before) break
        }
        if (group.tables.includes("activity")) {
          expect(checkpoints.activity).toBe(activityFixture.at(-1)?.timestamp)
        } else {
          expect(checkpoints.troves).toBe("210")
          expect(checkpoints.contracts).toContain("2026-11-05T00:01:41")
        }
      })
    }
  }

  it("sweeps lock positions in primary key order, wrapping at the end", async () => {
    const reader = createScanWarehouseReader(pgliteRunner(db))
    const fixture = fixtureReader()
    let after = ""
    const seen: string[] = []
    for (let step = 0; step < 4; step += 1) {
      const request = {
        ...plan(initial, 10, []),
        lockSweep: { after, rows: 1 },
      }
      const [read, expected] = await Promise.all([
        reader.read(request),
        fixture.read(request),
      ])
      expect(read.sweptLocks).toEqual(expected.sweptLocks)
      expect(read.sweepAfter).toEqual(expected.sweepAfter)
      seen.push(...read.sweptLocks.map((lock) => lock.token_id))
      after = read.sweepAfter ?? ""
    }
    expect(seen.slice(0, 2)).toEqual(["100", "101"])
  })

  it("diffs Enclave by a rotating sweep, whatever the checkpoint", async () => {
    const reader = createScanWarehouseReader(pgliteRunner(db))
    const fixture = fixtureReader()
    const ahead = { ...initial, enclave: "999999999" }
    // A table under the page size is diffed whole in one run.
    const whole = {
      ...plan(ahead, 10, ["enclave"]),
      enclaveSweep: { after: "", rows: 1_000 },
    }
    const read = await reader.read(whole)
    expect(read.enclaveMode).toBe("full")
    expect(read.enclave).toEqual([])
    expect(read.sweptEnclave).toHaveLength(1)
    expect(read.sweptEnclave).toEqual((await fixture.read(whole)).sweptEnclave)
    expect(read.enclaveSweepAfter).toBeNull()
    // A page of one: the sweep stops at its key, then wraps.
    const paged = { ...whole, enclaveSweep: { after: "", rows: 1 } }
    const page = await reader.read(paged)
    expect(page.enclaveMode).toBe("sweep")
    expect(page.enclaveSweepAfter).toBe(
      (await fixture.read(paged)).enclaveSweepAfter,
    )
    expect(page.enclaveSweepAfter).not.toBeNull()
    const next = {
      ...whole,
      enclaveSweep: { after: page.enclaveSweepAfter ?? "", rows: 1 },
    }
    const wrapped = await reader.read(next)
    expect(wrapped.sweptEnclave).toEqual([])
    expect(wrapped.enclaveSweepAfter).toBeNull()
  })

  it("re-reads the 100 blocks behind a block table's checkpoint", async () => {
    const reader = createScanWarehouseReader(pgliteRunner(db))
    // Deposits sit at blocks 102, 150 and 202; the checkpoint is past all.
    const request = plan({ ...initial, deposits: "202" }, 10, ["deposits"])
    const read = await reader.read(request)
    expect(read.windowCounts.deposits).toBe(0)
    // (102, 202]: a row that committed late behind the checkpoint is read
    // again; one more than 100 blocks back is not.
    expect(read.deposits.map((row) => row.block_number)).toEqual(["150", "202"])
    expect(read.deposits).toEqual(
      (await fixtureReader().read(request)).deposits,
    )
  })

  it("re-reads contracts an hour behind the checkpoint, and all once a day", async () => {
    const reader = createScanWarehouseReader(pgliteRunner(db))
    const fixture = fixtureReader()
    const latest = {
      ...initial,
      contracts: `2026-11-05T00:01:41.000000Z|0x${"5".repeat(40)}`,
    }
    const lookback = plan(latest, 10, ["contracts"])
    const daily = { ...lookback, fullContracts: true }
    for (const request of [lookback, daily]) {
      const [read, expected] = await Promise.all([
        reader.read(request),
        fixture.read(request),
      ])
      expect(read.contracts).toEqual(expected.contracts)
      expect(read.recheckedContracts).toEqual(expected.recheckedContracts)
      expect([...read.contracts, ...read.recheckedContracts]).toHaveLength(3)
    }
  })

  it("sets a malformed row aside instead of failing the whole read", async () => {
    const runner = pgliteRunner(db)
    // The warehouse hands back one deposit with no tx_from and one with an
    // amount printed "12.0".
    const reader = createScanWarehouseReader(async (list) => {
      const results = await runner(list)
      return results.map((answer) => {
        const rows = z.array(z.record(z.string(), z.unknown())).parse(answer)
        const deposits = rows.filter((row) => "depositor" in row)
        const [first, second] = deposits
        if (first === undefined || second === undefined) return rows
        return rows.map((row) =>
          row === first
            ? { ...row, tx_from: null }
            : row === second
              ? { ...row, amount: "12.0" }
              : row,
        )
      })
    })
    const request = plan(initial, 10_000, ["deposits"])
    const [read, expected] = await Promise.all([
      reader.read(request),
      fixtureReader().read(request),
    ])
    expect(read.rejected.map((row) => row.source)).toEqual([
      "deposits",
      "deposits",
    ])
    expect(read.rejected[0]?.reason).toContain("tx_from")
    expect(read.rejected[1]?.reason).toContain("amount")
    // Every other row is still read, and each rejected row keeps its block
    // so the checkpoint can move past it.
    expect(read.deposits).toHaveLength(expected.deposits.length - 2)
    expect(
      read.rejected.every(
        (row) => row.position !== null && /^\d+$/.test(row.position),
      ),
    ).toBe(true)
  })

  it("counts each table's rows per UTC day for the count check", async () => {
    const reader = createScanWarehouseReader(pgliteRunner(db))
    const request = { ...plan(initial, 10_000), countsFrom: 0 }
    const [read, expected] = await Promise.all([
      reader.read(request),
      fixtureReader().read(request),
    ])
    expect(read.dayCounts.length).toBeGreaterThan(0)
    expect(
      [...read.dayCounts].sort(
        (a, b) => a.table.localeCompare(b.table) || a.dayStart - b.dayStart,
      ),
    ).toEqual(
      [...expected.dayCounts].sort(
        (a, b) => a.table.localeCompare(b.table) || a.dayStart - b.dayStart,
      ),
    )
  })

  it("sends no query for tables that are skipped", async () => {
    let queries = 0
    const runner = pgliteRunner(db)
    const reader = createScanWarehouseReader(async (list) => {
      queries += list.length
      return runner(list)
    })
    const read = await reader.read(plan(initial, 100, []))
    expect(queries).toBe(0)
    expect(read.activity).toEqual([])
    await reader.read(plan(initial, 100, ["morpho", "enclave"]))
    // Morpho's window and overlap, Enclave's window (no sweep planned).
    expect(queries).toBe(3)
  })
})
