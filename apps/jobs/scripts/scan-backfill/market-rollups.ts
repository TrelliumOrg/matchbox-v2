import { mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import { z } from "zod"
import {
  incompleteBalanceDays,
  rollupDays,
  type StoredDailyRow,
  tokenRollups,
  troveDaysDirtySql,
} from "../../src/scan/market-rollups"
import { dayOf } from "../../src/scan/transform"
import { historyChunks, historyStatements } from "./closes"
import { inlineStatementsOf, logger, nowSeconds, selectRemote } from "./lib"

// Matchscan batch 2 history: rollups from rows SCAN_DB already holds, and
// the trove days to re-aggregate. Nothing is read from a chain, subgraph or
// Neon, and nothing writes to a database.
//
//   pnpm exec tsx scripts/scan-backfill/market-rollups.ts \
//     --source matchbox-scan [--from 2025-05-19] [--write]
//
// --source names the D1 database to read the stored pool.balance and
// dex.volume_in rows from (SELECTs through wrangler, READ ONLY, one month a
// query). The rollups (pool.token_balance, dex.token_volume_in) are summed
// per token per day in bigint, exactly as the live writers sum them
// (src/scan/market-rollups.ts), for the days before today. With --write it
// emits out/market-rollups/rollups-NNNN.sql, inserts that never touch a
// present row (source backfill:market-rollups; each file is its own served
// batch, so data_version moves with any file that inserted a row, applied
// in its own wrangler session), and troves-dirty.sql, which
// marks every day with a trove event dirty so the copy step's aggregates
// write musd.borrowed, repaid, redeemed and liquidated for it over the next
// runs (about 28 days a run). Apply both with
// `wrangler d1 execute matchbox-scan --remote --file <file>`.

const args = (() => {
  const values: Record<string, string | boolean> = {}
  const list = process.argv.slice(2)
  for (let index = 0; index < list.length; index += 1) {
    const name = list[index]
    if (name === "--write") values.write = true
    else if (name === "--source" || name === "--from" || name === "--out") {
      values[name.slice(2)] = list[index + 1] ?? ""
      index += 1
    } else throw new Error(`Unknown argument ${name}`)
  }
  return z
    .object({
      source: z.string().regex(/^[a-z0-9-]+$/),
      from: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .default("2025-05-19"),
      out: z.string().default(path.join(import.meta.dirname, "out")),
      write: z.boolean().default(false),
    })
    .parse(values)
})()

function nextMonth(day: string): string {
  const date = new Date(`${day.slice(0, 7)}-01T00:00:00Z`)
  date.setUTCMonth(date.getUTCMonth() + 1)
  return date.toISOString().slice(0, 10)
}

const now = nowSeconds()
const today = dayOf(now)
const metrics = Object.keys(tokenRollups)
  .map((metric) => `'${metric}'`)
  .join(", ")
const rows: StoredDailyRow[] = []
for (let start = args.from; start < today; start = nextMonth(start)) {
  const end = nextMonth(start)
  const page = selectRemote(
    args.source,
    `SELECT metric, dimension, day, value FROM daily WHERE metric IN (${metrics}) AND day >= '${start}' AND day < '${end}'`,
    z.object({
      metric: z.string(),
      dimension: z.string(),
      day: z.string(),
      value: z.string(),
    }),
  )
  rows.push(...page)
  logger.info({ message: "Read stored rows", from: start, rows: page.length })
}
const incomplete = incompleteBalanceDays(rows)
if (incomplete.length > 0) {
  // Left without a balance rollup: re-run archive-reads for these days,
  // then this script, to fill them.
  logger.warn({ message: "Days with a pool balance missing", days: incomplete })
}
const days = rollupDays(rows, today)
const points = [...days.values()].reduce((sum, list) => sum + list.length, 0)
logger.info({
  message: "Rollups",
  days: days.size,
  points,
  first: [...days.keys()][0] ?? null,
  last: [...days.keys()].at(-1) ?? null,
})
if (args.write) {
  const dir = path.join(args.out, "market-rollups")
  // About 2,500 rows a file (5,000 row writes with the day index), so a
  // person can spread the files over days within D1's daily writes. Each
  // file is its own served batch: a file's data_version bump sees only the
  // inserts of its own session.
  mkdirSync(dir, { recursive: true })
  const files = historyChunks(days, 2_500).map((chunk, index) => {
    const file = path.join(
      dir,
      `rollups-${String(index + 1).padStart(4, "0")}.sql`,
    )
    writeFileSync(
      file,
      inlineStatementsOf(
        historyStatements(chunk, now, "backfill:market-rollups"),
      ),
    )
    return file
  })
  const dirty = path.join(dir, "troves-dirty.sql")
  writeFileSync(dirty, troveDaysDirtySql)
  logger.info({ message: "SQL written", files: [...files, dirty] })
}
