import { applyD1Migrations } from "cloudflare:test"
import { env } from "cloudflare:workers"
import type { ActivityCategory } from "@matchbox/contracts/read-models"
import { beforeAll, describe, expect, it } from "vitest"
import {
  type HistoryCursor,
  historyClaims,
  historyClaimsSql,
  historyPageQuery,
  readHistoryPage,
} from "./wallet-history"

// What the stored history costs in D1 at the size of the busiest wallets:
// a voter with 4,500 rows, 218 of them claims, and a wallet whose 4,500
// rows are all lock top-ups, among 133 wallets. Production READ_DB has no
// `sqlite_stat1` (nobody runs ANALYZE), so the planner chooses without
// statistics, as here.

const voter = `0x${"5a".repeat(20)}`
const locker = `0x${"6b".repeat(20)}`
const total = 4_500
const claimRows = 218
const others = 131
const otherRows = 280

type Mix = (index: number) => ActivityCategory

const voterMix: Mix = (index) =>
  index % 20 === 0 && index / 20 < claimRows
    ? "claims"
    : index % 4 === 1
      ? "locks"
      : index % 225 === 7
        ? "incentives"
        : "votes"

function body(wallet: string, id: string, ts: number, claim: boolean) {
  return JSON.stringify(
    claim
      ? {
          type: "claim",
          id,
          txHash: id.slice(0, 66),
          block: 1,
          timestamp: ts,
          status: "confirmed",
          actor: wallet,
          epoch: null,
          rewards: { usd: "0", tokens: [] },
          locks: [],
          gauges: [],
        }
      : { type: "boost-refresh" },
  )
}

async function fill(wallet: string, count: number, mix: Mix) {
  const statements: D1PreparedStatement[] = []
  for (let index = 0; index < count; index += 1) {
    const ts = 1_770_000_000 + index * 600
    const id = `0x${index.toString(16).padStart(64, "0")}-1`
    const category = mix(index)
    statements.push(
      env.READ_DB.prepare(
        `INSERT INTO wallet_activity_rows
           (network, wallet, sort_ts, row_id, tx_hash, epoch, category, body,
            etag, updated_at)
         VALUES ('mezo', ?1, ?2, ?3, ?4, ?7, ?5, ?6, 'e', 1)`,
      ).bind(
        wallet,
        ts,
        id,
        id.slice(0, 66),
        category,
        body(wallet, id, ts, category === "claims"),
        Math.floor(index / 50),
      ),
    )
  }
  let written = 0
  for (let start = 0; start < statements.length; start += 500) {
    for (const result of await env.READ_DB.batch(
      statements.slice(start, start + 500),
    )) {
      written += result.meta.rows_written
    }
  }
  return written
}

let voterWritten = 0
let lockerWritten = 0

beforeAll(async () => {
  await applyD1Migrations(env.READ_DB, env.TEST_MIGRATIONS)
  await env.READ_DB.prepare("DELETE FROM wallet_activity_rows").run()
  voterWritten = await fill(voter, total, voterMix)
  lockerWritten = await fill(locker, total, () => "locks")
  for (let index = 0; index < others; index += 1) {
    await fill(`0x${index.toString(16).padStart(40, "0")}`, otherRows, (i) =>
      i % 8 === 0 ? "claims" : i % 3 === 1 ? "locks" : "votes",
    )
  }
})

async function plan(sql: string, params: unknown[]): Promise<string> {
  const { results } = await env.READ_DB.prepare(`EXPLAIN QUERY PLAN ${sql}`)
    .bind(...params)
    .all<{ detail: string }>()
  return results.map((row) => row.detail).join(" | ")
}

const state = {
  low: { ts: 0, tx: "0x" },
  high: { ts: 2_000_000_000, tx: "0x" },
  complete: true,
  updatedAt: 1,
}

/** Rows read by the first two pages of a filter. */
async function pagesRead(wallet: string, category: ActivityCategory) {
  const reads: number[] = []
  let cursor: HistoryCursor | null = { ts: 2_000_000_000, id: null }
  for (let page = 0; page < 2 && cursor !== null; page += 1) {
    const input = { network: "mezo", wallet, category, cursor, limit: 100 }
    const query = historyPageQuery({ ...input, state, backfill: false })
    const result = await env.READ_DB.prepare(query.sql)
      .bind(...query.params)
      .all<{ sort_ts: number; row_id: string }>()
    reads.push(result.meta.rows_read)
    const last = result.results.at(-2)
    cursor =
      result.results.length > 100 && last !== undefined
        ? { ts: last.sort_ts, id: last.row_id }
        : null
  }
  return reads
}

describe("stored history cost", () => {
  it("writes one row per stored row, and one more per claim", () => {
    // 4,500 table rows plus the 218 claims' entries in the claims index.
    expect(voterWritten).toBe(total + claimRows)
    expect(lockerWritten).toBe(total)
  })

  it("reads a wallet's claims through the claims index", async () => {
    const claims = await historyClaims(env.READ_DB, "mezo", voter)
    expect(claims).toHaveLength(claimRows)
    const result = await env.READ_DB.prepare(historyClaimsSql)
      .bind("mezo", voter)
      .all()
    // Each claim once, not the wallet's 4,500 rows.
    expect(result.meta.rows_read).toBeLessThanOrEqual(claimRows + 1)
    expect(await plan(historyClaimsSql, ["mezo", voter])).toContain(
      "USING INDEX wallet_activity_rows_claims",
    )
    const none = await env.READ_DB.prepare(historyClaimsSql)
      .bind("mezo", locker)
      .all()
    expect(none.meta.rows_read).toBeLessThanOrEqual(1)
  })

  it("pages the claims filter through the claims index", async () => {
    const page = await readHistoryPage(env.READ_DB, {
      network: "mezo",
      wallet: voter,
      category: "claims",
      cursor: { ts: 2_000_000_000, id: null },
      limit: 25,
      state,
      backfill: false,
    })
    expect(page.rows).toHaveLength(25)
    expect(page.rows.every((row) => row.type === "claim")).toBe(true)
    // Page 2 read 2,160 rows by the primary key before the index.
    const [first, second] = await pagesRead(voter, "claims")
    expect(first).toBeLessThanOrEqual(102)
    expect(second).toBeLessThanOrEqual(102)
  })

  it("reads at most the wallet's rows for the other filters", async () => {
    // By the primary key from the cursor until the page is full: about a
    // page over the filter's share of the wallet, never past its rows.
    for (const category of ["votes", "locks", "incentives"] as const) {
      for (const wallet of [voter, locker]) {
        for (const read of await pagesRead(wallet, category)) {
          expect(read).toBeLessThanOrEqual(total + 1)
        }
      }
    }
    const [votes] = await pagesRead(voter, "votes")
    expect(votes).toBeLessThan(200)
    const [locks] = await pagesRead(voter, "locks")
    expect(locks).toBeLessThan(500)
  })
})
