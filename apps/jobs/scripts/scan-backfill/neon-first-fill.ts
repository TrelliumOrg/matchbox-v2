import path from "node:path"
import { z } from "zod"
import { neonQueryRunner } from "../../src/warehouse/reader"
import {
  countsQuery,
  countsSchema,
  type FillState,
  fillFinished,
  fillHaltAt,
  fillMarker,
  fillStateSchema,
  fillStep,
  initialFillState,
  replaceStatements,
} from "./first-fill"
import {
  logger,
  nowSeconds,
  parseCommon,
  StateFile,
  writeSqlFiles,
} from "./lib"

// (a) First fill of the scan tables from Neon. READ ONLY queries only.
//
//   DATABASE_URL=postgresql://matchbox_api_ro:...  (never a writable role)
//   pnpm --filter @matchbox/jobs exec tsx scripts/scan-backfill/neon-first-fill.ts \
//     [--write] [--fresh] [--replace] [--max-requests 200] [--out <dir>]
//
// --replace (a re-fill, README "Re-fill runbook"): the first file starts by
// emptying the tables the copy writes, its checkpoints and the re-fill flag.
//
// Dry run (default): prints the warehouse row counts and the chunks it
// would write. --write writes <out>/neon/neon-NNNN.sql per chunk; apply them
// in order with
//   pnpm exec wrangler d1 execute matchbox-scan --remote --file <file>
// before the Worker's copy step first runs (or with the copy paused). Every
// chunk ends with its checkpoints, so applying a prefix of the files is a
// consistent state the Worker continues from.

const { values, common } = parseCommon({ replace: { type: "boolean" } })
const replace = values.replace === true
const url = z
  .string()
  .min(1, "DATABASE_URL is required (the read-only matchbox_api_ro role)")
  .parse(process.env.DATABASE_URL)
if (/matchbox_indexer|neondb_owner/.test(url)) {
  throw new Error("Use the read-only matchbox_api_ro role, not a writer")
}

const run = neonQueryRunner(url)
const store = new StateFile<FillState>(
  path.join(common.out, "neon"),
  fillStateSchema,
  initialFillState,
)
let state = store.load(common.fresh)
const started = Date.now()

const [countRows] = await run([countsQuery])
const counts = countsSchema.parse(z.array(z.unknown()).parse(countRows)[0])
logger.info({ message: "Warehouse row counts", ...counts })

let requests = 1
let neonMs = 0
let halted: Record<string, string> | null = null
while (!fillFinished(state) && requests < common.maxRequests) {
  const stepStarted = Date.now()
  const step = await fillStep(run, state, nowSeconds())
  neonMs += Date.now() - stepStarted
  requests += 1
  if (Object.keys(step.quarantined).length > 0) {
    logger.warn({
      message: "Chunk quarantined rows",
      chunk: step.state.chunks,
      quarantined: step.quarantined,
    })
  }
  if (Object.keys(step.halted).length > 0) {
    // A halted table keeps its checkpoint, so every later chunk would read
    // the same rows: stop before writing this chunk, so a rerun after the
    // warehouse is fixed resumes from the last good one.
    halted = step.halted
    break
  }
  const first = replace && state.chunks === 0 ? replaceStatements() : []
  const statements = fillFinished(step.state)
    ? [...first, ...step.statements, fillMarker(nowSeconds())]
    : [...first, ...step.statements]
  if (common.write && statements.length > 0) {
    const files = writeSqlFiles(
      path.join(common.out, "neon"),
      `neon-${String(step.state.chunks).padStart(4, "0")}`,
      statements,
    )
    store.save(step.state)
    logger.info({ message: "Chunk written", files, rows: step.rowsRead })
  } else {
    logger.info({
      message: "Chunk (dry run, nothing written)",
      rows: step.rowsRead,
      statements: statements.length,
    })
  }
  state = step.state
}

if (halted !== null) {
  logger.error({
    message: `FIRST FILL HALTED: a table had ${fillHaltAt} or more rows it could not take in one chunk; nothing of that chunk was written. Fix the warehouse rows (README pre-check 2), then rerun without --fresh.`,
    halted,
    checkpoints: state.checkpoints,
  })
  process.exit(1)
}

logger.info({
  message: fillFinished(state)
    ? "First fill complete"
    : `Stopped early: --max-requests ${common.maxRequests} reached; rerun to continue`,
  write: common.write,
  requests,
  neonMs,
  elapsedMs: Date.now() - started,
  rows: state.rows,
  checkpoints: state.checkpoints,
})
