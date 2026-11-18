import path from "node:path"
import { upsertStatements } from "../../src/scan/statements"
import { quarantineSpec } from "../../src/scan/transform"
import { logger, writeSqlFiles } from "./lib"

// A staging check of D1's limits for the copy's largest quarantine write,
// well past what a run can produce (50 rows a source, payloads cut to
// 1,000 characters): 600 rows of 4 KB through the same chunked upsert the
// copy uses. It writes SQL files for a STAGING database only, plus one that
// deletes the rows again; it never touches a database itself.
//
//   pnpm exec tsx scripts/scan-backfill/quarantine-batch-check.ts
//   for f in scripts/scan-backfill/out/quarantine-check/*.sql; do
//     pnpm exec wrangler d1 execute <staging database> --remote --file "$f"
//   done

const rows = 600
const payloadBytes = 4_096
const source = "staging-check"
const now = Math.floor(Date.now() / 1000)

const statements = upsertStatements(
  quarantineSpec,
  Array.from({ length: rows }, (_, index) => ({
    source,
    row_key: `row-${index}`,
    reason: "staging batch check",
    payload: "x".repeat(payloadBytes),
    day: null,
    first_seen: now,
    last_seen: now,
  })),
)
const largest = Math.max(
  ...statements.map(
    (statement) =>
      statement.sql.length + JSON.stringify(statement.params).length,
  ),
)
const dir = path.join(import.meta.dirname, "out", "quarantine-check")
const files = writeSqlFiles(dir, "1-insert", statements)
files.push(
  ...writeSqlFiles(dir, "2-cleanup", [
    {
      sql: "DELETE FROM scan_quarantine WHERE source = ?1",
      params: [source],
    },
  ]),
)
logger.info({
  message: "Quarantine batch check written",
  rows,
  payloadBytes,
  statements: statements.length,
  largestStatementBytes: largest,
  files,
})
