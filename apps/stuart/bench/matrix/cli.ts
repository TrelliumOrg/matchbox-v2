import { execFileSync, spawnSync } from "node:child_process"
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { parseArgs } from "node:util"
import { sdkMessageCreator } from "../../src/query/claude"
import { CASES } from "../cases"
import { PUBLIC } from "../public"
import { estimateUsd, MATRIX_CACHE_WRITE_SHARE } from "./estimate"
import { allEntries, selectEntries } from "./models"
import { buildResults } from "./publish"
import {
  formatPlan,
  MATRIX_BUDGET_MS,
  MATRIX_MAX_TOKENS,
  planMatrix,
  regradeMatrix,
  replayMatrix,
  runMatrix,
} from "./runner"
import { MatrixLockedError, MatrixStore, spendTotal } from "./store"

// Matchbench matrix command:
//
//   pnpm --filter @matchbox/stuart bench:matrix --estimate
//   pnpm --filter @matchbox/stuart bench:matrix --only "<=high" --max-usd 60
//   pnpm --filter @matchbox/stuart bench:matrix --publish-only
//
// --only     entries: "sonnet-5-5.high", a model ("opus-5-5"), an effort
//            ("xhigh"), or "<=high" (every level up to high); comma list.
//            Default: every model at every effort level it accepts.
// --runs     runs per entry (default 3)
// --max-usd  required to run: a cap on the whole matrix's spend
//            (bench/results/matrix/<name>/spend.json), across invocations
// --concurrency  answers in flight at once (default 4)
// --name     matrix name: raw results in bench/results/matrix/<name>
// --out      published file (default bench/published/results.json)
// --budget-ms, --max-tokens  per-answer time budget and per-request
//            max_tokens (default 120,000 ms and 64,000 tokens)
// --estimate     print the plan and the full matrix estimate, run nothing
// --publish-only rebuild the published file from finished runs
// --regrade      re-grade every stored answer with the checks as they are
//                now, offline, then publish; questions whose text or
//                fixtures changed are left to the next run
// --retry-abandoned  try answers set aside after API errors again
// --replay-from <name>  replay every stored answer of another matrix (its
//                tool calls and the model's own text) through Stuart and
//                the grader as they are now, into --name, offline. Equal
//                to a fresh run only if Stuart's prompt is unchanged.
//
// Running needs ANTHROPIC_API_KEY. Every finished run is kept: running
// again resumes, and adding entries later republishes one file with all.

const here = dirname(fileURLToPath(import.meta.url))
const bench = resolve(here, "..")

/** A whole number within bounds, or a clear error before any call. */
function wholeNumber(
  name: string,
  raw: string,
  min: number,
  max: number,
): number {
  const value = Number(raw)
  if (!/^\d+$/.test(raw.trim()) || !Number.isSafeInteger(value)) {
    throw new Error(`--${name} must be a whole number, not "${raw}"`)
  }
  if (value < min || value > max) {
    throw new Error(`--${name} must be between ${min} and ${max}`)
  }
  return value
}

function usdCap(raw: string): number {
  const value = Number(raw)
  if (!/^\d+(?:\.\d+)?$/.test(raw.trim()) || !(value > 0)) {
    throw new Error(`--max-usd must be a positive number, not "${raw}"`)
  }
  return value
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      only: { type: "string" },
      runs: { type: "string", default: "3" },
      "max-usd": { type: "string" },
      concurrency: { type: "string", default: "4" },
      name: { type: "string", default: "main" },
      out: { type: "string" },
      "budget-ms": { type: "string", default: String(MATRIX_BUDGET_MS) },
      "max-tokens": { type: "string", default: String(MATRIX_MAX_TOKENS) },
      estimate: { type: "boolean", default: false },
      "publish-only": { type: "boolean", default: false },
      regrade: { type: "boolean", default: false },
      "replay-from": { type: "string" },
      "retry-abandoned": { type: "boolean", default: false },
    },
  })
  const runs = wholeNumber("runs", values.runs, 1, 20)
  const concurrency = wholeNumber("concurrency", values.concurrency, 1, 16)
  const budgetMs = wholeNumber("budget-ms", values["budget-ms"], 1_000, 600_000)
  const maxTokens = wholeNumber(
    "max-tokens",
    values["max-tokens"],
    1_000,
    128_000,
  )
  if (!/^[\w.-]{1,40}$/.test(values.name)) {
    throw new Error("--name takes letters, digits, dots and dashes")
  }
  const only = (values.only ?? "")
    .split(",")
    .map((each) => each.trim())
    .filter(Boolean)
  const { entries, skipped } = selectEntries(only)
  for (const reason of skipped) console.log(`Skipped: ${reason}`)
  const store = new MatrixStore(join(bench, "results", "matrix", values.name))
  const out = resolve(values.out ?? join(bench, "published", "results.json"))
  const spent = spendTotal(store.spend())

  if (values.estimate) {
    const cap = values["max-usd"] === undefined ? 0 : usdCap(values["max-usd"])
    console.log(
      `Left to run for this selection (${CASES.length} questions, ${runs} runs):`,
    )
    console.log(
      formatPlan(
        planMatrix({ store, entries, cases: CASES, runs }),
        cap,
        spent,
      ),
    )
    console.log(`\nWhole matrix from scratch, ${runs} runs per entry:`)
    let total = 0
    for (const entry of allEntries()) {
      const usd = estimateUsd(
        entry.model,
        CASES.length * runs,
        entry.effort,
        MATRIX_CACHE_WRITE_SHARE,
      )
      total += usd
      console.log(`${entry.id.padEnd(22)}${usd.toFixed(2).padStart(10)} USD`)
    }
    console.log(`${"Total".padEnd(22)}${total.toFixed(2).padStart(10)} USD`)
    return
  }

  let commit = "0000000"
  try {
    commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: bench })
      .toString()
      .trim()
  } catch {
    // Not a git checkout: the commit stays unknown.
  }

  const publish = () => {
    const results = buildResults({
      store,
      cases: CASES,
      publicChecks: PUBLIC,
      id: values.name,
      limits: { answerBudgetMs: budgetMs, maxTokens },
    })
    mkdirSync(dirname(out), { recursive: true })
    writeFileSync(out, `${JSON.stringify(results, null, 2)}\n`)
    // Keep the file in the repository's format; harmless if Biome is absent.
    spawnSync(`pnpm exec biome format --write "${out}"`, {
      cwd: bench,
      shell: true,
      stdio: "ignore",
    })
    console.log(
      `Published ${results.entries.length} entries, ${results.publicQuestions.length} public questions, ${results.run.totalCostUsd} USD spent: ${out}`,
    )
  }

  if (values["publish-only"]) {
    publish()
    return
  }

  const replayFrom = values["replay-from"]
  if (replayFrom !== undefined) {
    if (!/^[\w.-]{1,40}$/.test(replayFrom) || replayFrom === values.name) {
      throw new Error("--replay-from names another matrix")
    }
    const report = await replayMatrix({
      from: new MatrixStore(join(bench, "results", "matrix", replayFrom)),
      to: store,
      cases: CASES,
      budgetMs,
      maxTokens,
      commit,
    })
    console.log(
      `Replayed ${report.replayed} stored answers, kept ${report.kept} timeouts, refusals and token-limit stops, skipped ${report.skipped} whose question changed`,
    )
    publish()
    return
  }

  if (values.regrade) {
    const release = store.lock()
    try {
      const report = await regradeMatrix({ store, cases: CASES, all: true })
      console.log(
        `Re-graded ${report.regraded} stored answers offline; ${report.dropped} dropped because their question changed (the next run asks them again)`,
      )
      publish()
    } finally {
      release()
    }
    return
  }

  if (values["max-usd"] === undefined) {
    throw new Error(
      "--max-usd is required to run: a cap on this matrix's total spend (see --estimate)",
    )
  }
  const maxUsd = usdCap(values["max-usd"])
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) throw new Error("Running the matrix needs ANTHROPIC_API_KEY")
  try {
    const report = await runMatrix({
      store,
      entries,
      cases: CASES,
      runs,
      maxUsd,
      concurrency,
      // The client's own timeout leaves the turn budget in charge.
      createFor: () => sdkMessageCreator(key, budgetMs + 5_000),
      budgetMs,
      maxTokens,
      commit,
      retryAbandoned: values["retry-abandoned"],
      log: (line) => console.log(line),
    })
    console.log(
      `Answered ${report.answered}, ${report.pending} left pending after API errors, ${report.abandoned.length} set aside, spent ${report.spentUsd.toFixed(2)} USD now and ${report.totalSpentUsd.toFixed(2)} USD on this matrix`,
    )
  } catch (error) {
    // Whatever stopped the run, publish what finished, unless another
    // invocation holds the matrix.
    if (!(error instanceof MatrixLockedError)) publish()
    throw error
  }
  publish()
}

try {
  await main()
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
}
