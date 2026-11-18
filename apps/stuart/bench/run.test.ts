import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import type { StuartResponse } from "@matchbox/stuart-ui/contract"
import { expect, it } from "vitest"
import {
  emptyUsage,
  estimateCostMicroUsd,
  type MessageCreator,
  resetClaudeBreaker,
  sdkMessageCreator,
} from "../src/query/claude"
import type { StuartEffort } from "../src/query/env"
import { isDeterministicRequest, runStuart } from "../src/query/orchestrator"
import { CASES } from "./cases"
import { type Graded, grade } from "./grade"
import { knownAddresses, requestFor } from "./harness"
import { estimateUsd } from "./matrix/estimate"
import { BENCH_NOW, benchProviders } from "./world"

// Stuart's benchmark runner. Every case runs through the real orchestrator
// (router, tools, model loop, sourcing checks) against the fixture world.
//
//   pnpm --filter @matchbox/stuart bench                  router and tools only, no model, free
//   STUART_BENCH_MODEL=claude-haiku-5-5 ANTHROPIC_API_KEY=... pnpm --filter @matchbox/stuart bench
//
// Options (env): STUART_BENCH_MODEL (default "none"), STUART_BENCH_EFFORT
// (default "low"), STUART_BENCH_ONLY (comma list of id or category
// prefixes), STUART_BENCH_ROUTER ("off" sends every case to the model, to
// compare models on all of them), STUART_BENCH_LABEL (results file name),
// STUART_BENCH_MIN_PASS (fail below this many passes), STUART_BENCH_MAX_USD
// (default 1: the run stops before it starts when the estimate is above).
// Results land in bench/results/<label>.json (gitignored). To compare
// models at several effort levels, run the matrix (matrix/cli.ts).

const here = dirname(fileURLToPath(import.meta.url))
const MODEL = process.env.STUART_BENCH_MODEL ?? "none"
const EFFORT = (process.env.STUART_BENCH_EFFORT ?? "low") as StuartEffort
const ONLY = (process.env.STUART_BENCH_ONLY ?? "")
  .split(",")
  .map((each) => each.trim())
  .filter(Boolean)
const MAX_USD = Number(process.env.STUART_BENCH_MAX_USD ?? "1")
// Fails the run below this many passing cases (default 0: report only).
const MIN_PASS = Number(process.env.STUART_BENCH_MIN_PASS ?? "0")
const SAFETY_CHECKS = /^(?:unsigned|unsafe: |no invented address|copy: )/
// "off": every case goes to the model (compares models on all of them).
const ROUTER_OFF = process.env.STUART_BENCH_ROUTER === "off"
const LABEL =
  process.env.STUART_BENCH_LABEL ??
  `${MODEL}-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "")}`

function selected() {
  if (ONLY.length === 0) return CASES
  return CASES.filter((each) =>
    ONLY.some(
      (prefix) => each.id.startsWith(prefix) || each.category === prefix,
    ),
  )
}

it("Stuart benchmark", async () => {
  const cases = selected()
  const modelCases = cases.filter(
    (each) =>
      ROUTER_OFF ||
      !isDeterministicRequest(
        requestFor(each.query, each.wallet !== false),
        BENCH_NOW,
      ),
  ).length
  let create: MessageCreator | null = null
  const usage = emptyUsage()
  if (MODEL !== "none") {
    const key = process.env.ANTHROPIC_API_KEY
    if (!key) throw new Error("STUART_BENCH_MODEL needs ANTHROPIC_API_KEY")
    const estimate = estimateUsd(MODEL, modelCases, EFFORT, 1)
    console.log(
      `Estimate: ${modelCases} model answers on ${MODEL}, about ${estimate.toFixed(3)} USD (cap ${MAX_USD})`,
    )
    if (estimate > MAX_USD) {
      throw new Error(`Estimate ${estimate.toFixed(3)} USD is over the cap`)
    }
    const sdk = sdkMessageCreator(key)
    create = async (params, options) => {
      const response = await sdk(params, options)
      usage.input += response.usage.input_tokens
      usage.output += response.usage.output_tokens
      usage.cacheWrite += response.usage.cache_creation_input_tokens ?? 0
      usage.cacheRead += response.usage.cache_read_input_tokens ?? 0
      usage.calls += 1
      return response
    }
  }
  const known = knownAddresses()
  const results: Array<
    Graded & { query: string; answer: string; tools: string[]; runtime: string }
  > = []
  const modelErrors: string[] = []
  for (const testCase of cases) {
    resetClaudeBreaker()
    const logs: Array<Record<string, unknown>> = []
    const run = await runStuart(
      requestFor(testCase.query, testCase.wallet !== false),
      {
        providers: benchProviders(),
        secret: "bench-secret-bench-secret-bench-secret",
        now: () => BENCH_NOW,
        claude:
          create === null ? null : { create, model: MODEL, effort: EFFORT },
        log: (event) => logs.push(event),
        routerOff: ROUTER_OFF,
      },
    )
    const response: StuartResponse | null =
      run.kind === "answer" ? run.response : null
    for (const event of logs) {
      if (event.message === "stuart.model_error") {
        modelErrors.push(`${testCase.id}: ${String(event.detail)}`)
      }
    }
    const query = logs.find((event) => event.message === "stuart.query")
    const tools = Array.isArray(query?.tools)
      ? query.tools.filter((each): each is string => typeof each === "string")
      : []
    const graded = grade({
      testCase,
      response,
      tools,
      known,
      deterministic: isDeterministicRequest(
        requestFor(testCase.query, testCase.wallet !== false),
        BENCH_NOW,
      ),
    })
    results.push({
      ...graded,
      query: testCase.query.slice(0, 120),
      answer: response?.answer.text ?? "",
      tools,
      runtime: response?.service.runtime ?? "busy",
    })
  }

  const categories = [...new Set(results.map((each) => each.category))]
  const table = categories.map((category) => {
    const rows = results.filter((each) => each.category === category)
    const passed = rows.filter((each) => each.pass).length
    return { category, passed, total: rows.length }
  })
  const passed = results.filter((each) => each.pass).length
  const costUsd = Number(estimateCostMicroUsd(MODEL, usage)) / 1e6
  const summary = {
    label: LABEL,
    model: MODEL,
    effort: EFFORT,
    passed,
    total: results.length,
    modelCases,
    usage,
    // Model calls the API refused; a run with many has not measured the model.
    modelErrors,
    costUsd: MODEL === "none" ? 0 : costUsd,
    costPer100Usd:
      MODEL === "none" || results.length === 0
        ? 0
        : (costUsd / results.length) * 100,
    categories: table,
    // Planning estimates (USD) for the model comparison: this run's
    // model-routed cases, and 100 questions that all reach the model.
    estimates: Object.fromEntries(
      ["claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5"].map(
        (model) => [
          model,
          {
            thisRun: Number(
              estimateUsd(model, modelCases, EFFORT, 1).toFixed(4),
            ),
            per100ModelAnswers: Number(
              estimateUsd(model, 100, EFFORT, 1).toFixed(3),
            ),
          },
        ],
      ),
    ),
  }
  console.log(
    [
      `Stuart bench ${LABEL}: ${passed}/${results.length} passed (model ${MODEL}, ${modelCases} cases need the model)`,
      ...table.map(
        (row) => `  ${row.category.padEnd(14)} ${row.passed}/${row.total}`,
      ),
      MODEL === "none"
        ? "  cost 0 USD (no model calls)"
        : `  cost ${costUsd.toFixed(4)} USD, ${summary.costPer100Usd.toFixed(3)} USD per 100 questions`,
      ...(modelErrors.length
        ? [
            `Model errors (${modelErrors.length}):`,
            ...modelErrors.map((each) => `  ${each}`),
          ]
        : []),
      "Failures:",
      ...results
        .filter((each) => !each.pass)
        .map(
          (each) =>
            `  ${each.id}: ${each.checks
              .filter((check) => !check.ok)
              .map(
                (check) =>
                  `${check.name} [${check.detail.replace(/\s+/g, " ").slice(0, 120)}]`,
              )
              .join("; ")}`,
        ),
    ].join("\n"),
  )
  mkdirSync(join(here, "results"), { recursive: true })
  writeFileSync(
    join(here, "results", `${LABEL}.json`),
    `${JSON.stringify({ summary, results }, null, 2)}\n`,
  )
  // The run fails on any safety check, whatever the model: a proposal that
  // is not unsigned or points at an unknown address, or copy that breaks
  // the rules. Scores below STUART_BENCH_MIN_PASS fail it too.
  const unsafe = results.flatMap((each) =>
    each.checks
      .filter((check) => !check.ok && SAFETY_CHECKS.test(check.name))
      .map((check) => `${each.id}: ${check.name} [${check.detail}]`),
  )
  expect(unsafe).toEqual([])
  expect(passed).toBeGreaterThanOrEqual(MIN_PASS)
}, 600_000)
