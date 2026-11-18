import { applyD1Migrations } from "cloudflare:test"
import { env } from "cloudflare:workers"
import { beforeAll, describe, expect, it } from "vitest"
import { z } from "zod"
import { labelsByAddresses, type ScanQuery, scanQueries } from "./queries"

// Every /internal/scan statement against the real schemas: one primary-key
// lookup or one range scan of the named index, never a full scan or a
// temporary sort.

const planRowSchema = z.object({ detail: z.string() })

function database(query: ScanQuery): D1Database {
  return query.db === "scan" ? env.SCAN_DB : env.READ_DB
}

function placeholders(sql: string): number {
  const numbers = [...sql.matchAll(/\?(\d+)/g)].map((match) => Number(match[1]))
  return Math.max(0, ...numbers)
}

async function queryPlan(query: ScanQuery): Promise<string[]> {
  const binds = Array.from({ length: placeholders(query.sql) }, () => 1)
  const result = await database(query)
    .prepare(`EXPLAIN QUERY PLAN ${query.sql}`)
    .bind(...binds)
    .all()
  return result.results.map((row) => planRowSchema.parse(row).detail)
}

/** The plan uses the named index (or the table's primary key). */
function usesIndex(plan: string[], query: ScanQuery): boolean {
  const [table, ...rest] = query.index.split(" ")
  if (rest.join(" ") === "primary key") {
    return plan.some(
      (line) =>
        line.startsWith("SEARCH") &&
        (line.includes("PRIMARY KEY") ||
          line.includes("INTEGER PRIMARY KEY") ||
          line.includes(`sqlite_autoindex_${table}`)),
    )
  }
  return plan.some(
    (line) => line.startsWith("SEARCH") && line.includes(query.index),
  )
}

beforeAll(async () => {
  await applyD1Migrations(env.READ_DB, env.TEST_MIGRATIONS)
  await applyD1Migrations(env.SCAN_DB, env.SCAN_MIGRATIONS)
})

describe("query plans", () => {
  const all: [string, ScanQuery][] = [
    ...Object.entries(scanQueries),
    ["labelsByAddresses(3)", labelsByAddresses(3)],
  ]

  for (const [name, query] of all) {
    it(`${name} searches ${query.index}`, async () => {
      const plan = await queryPlan(query)
      // Visible in the test output for the README's plan table.
      console.log(`${name}: ${plan.join(" | ")}`)
      for (const line of plan) {
        expect(line, name).not.toMatch(/^SCAN /)
        if (query.pendingIndex === undefined) {
          expect(line, name).not.toMatch(/TEMP B-TREE/)
        } else {
          // Only a partial sort (a group at a time) until the index lands.
          expect(line, name).not.toMatch(/TEMP B-TREE FOR ORDER BY/)
        }
      }
      expect(usesIndex(plan, query), `${name}: ${plan.join(" | ")}`).toBe(true)
    })
  }

  // The index the jobs schema is asked for, applied here: with it, these
  // plans sort nothing at all.
  const pending = all.filter(([, query]) => query.pendingIndex !== undefined)
  for (const [name, query] of pending) {
    it(`${name} sorts nothing once ${query.pendingIndex?.name} exists`, async () => {
      await env.SCAN_DB.prepare(query.pendingIndex?.sql ?? "").run()
      const plan = await queryPlan(query)
      for (const line of plan) {
        expect(line, name).not.toMatch(/^SCAN /)
        expect(line, name).not.toMatch(/TEMP B-TREE/)
      }
      expect(
        plan.some((line) => line.includes(query.pendingIndex?.name ?? "")),
        plan.join(" | "),
      ).toBe(true)
    })
  }
})
