import type Anthropic from "@anthropic-ai/sdk"
import { APIError } from "@anthropic-ai/sdk"
import type { StuartResponse } from "@matchbox/stuart-ui/contract"
import {
  claudeTools,
  emptyUsage,
  estimateCostMicroUsd,
  MAX_ROUNDS,
  MAX_TOOL_CALLS,
  type MessageCreator,
  resetClaudeBreaker,
  SYSTEM_PROMPT,
  type UsageTotals,
} from "../../src/query/claude"
import { runStuart } from "../../src/query/orchestrator"
import type { BenchCase } from "../cases"
import { type Graded, grade, type ModelOutcome, shownText } from "../grade"
import { knownAddresses, requestFor } from "../harness"
import { BENCH_NOW, benchProviders } from "../world"
import {
  estimateUsd,
  MATRIX_CACHE_WRITE_SHARE,
  worstAnswerUsd,
  worstRequestUsd,
} from "./estimate"
import { matrixFingerprint } from "./fingerprint"
import { recheckIgnoringLength, shownIgnoringLength } from "./length"
import type { MatrixEntry } from "./models"
import {
  type AnswerOutcome,
  checksHash,
  digest,
  isComplete,
  isCurrent,
  MatrixStore,
  type PendingLedger,
  pendingKey,
  type QuestionRecord,
  questionHash,
  type RunFile,
  type RunSettings,
  type StoredResponse,
  spendTotal,
  type ToolCallRecord,
} from "./store"

// Matchbench's matrix runner: every entry (a model at one effort level)
// answers every question `runs` times, with Stuart's router off so each
// question reaches the model, and with no refusal fallback, so the model
// named is the model that answered.
//
// - It plans first and refuses to start when the matrix's spend so far
//   plus the estimate is above --max-usd, a cap on the whole matrix
//   directory's spend (spend.json), not one invocation.
// - Each answer in flight reserves its worst case against the cap; a
//   request cut off before the API reported usage counts at a worst case.
// - Rate limits, overloads and API errors are retried and never graded: an
//   answer that keeps failing that way stays pending for the next run, the
//   run stops when such failures persist, and after three invocations the
//   answer is set aside and reported (--retry-abandoned tries it again).
//   A timeout is retried once, then graded as a timeout. Refusals and
//   max_tokens stops are graded as their own failures.
// - Tasks are interleaved across entries and runs, so API load is spread
//   evenly and no entry gets a quieter hour than another.
// - Stored answers whose checks changed are re-graded offline first.

/** Matrix defaults: generous, so a model is ranked on answers, not cut-offs. */
export const MATRIX_BUDGET_MS = 120_000
/**
 * Per request. Anthropic's effort docs suggest starting at 64k max_tokens
 * at xhigh or max so thinking is not truncated; it is far above what an
 * answer here uses, so a stop at it is the model's own runaway.
 */
export const MATRIX_MAX_TOKENS = 64_000

/** Invocations an answer may stay pending on API errors before it is set aside. */
export const MAX_PENDING_INVOCATIONS = 3

export type MatrixOptions = {
  store: MatrixStore
  entries: readonly MatrixEntry[]
  cases: readonly BenchCase[]
  runs: number
  /** Cap on the matrix directory's total spend, in USD. */
  maxUsd: number
  /** Answers in flight at once, across entries. */
  concurrency: number
  createFor: (entry: MatrixEntry) => MessageCreator
  budgetMs?: number
  maxTokens?: number
  /** The commit the run starts on (recorded in new run files). */
  commit?: string
  /** Consecutive answers lost to API errors before the run stops. */
  maxInfraFailures?: number
  /** Try answers set aside after repeated API errors again. */
  retryAbandoned?: boolean
  log?: (line: string) => void
  /** Waits between retries (tests pass a no-op). */
  sleep?: (ms: number) => Promise<void>
  now?: () => Date
}

export type EntryPlan = {
  entry: MatrixEntry
  /** Runs already complete for these questions. */
  doneRuns: number
  /** Answers still to make. */
  pending: number
  estimateUsd: number
  /** The estimate uses this entry's metered cost so far. */
  measured: boolean
}

export class MatrixCapError extends Error {
  override name = "MatrixCapError"
}
/** The API served a model other than the one requested. */
export class ModelMismatchError extends Error {
  override name = "ModelMismatchError"
}
/** API errors persisted: the run stopped, answers stay pending. */
export class InfrastructureError extends Error {
  override name = "InfrastructureError"
}
/** A run file was made with other limits, prompt, tools or settings. */
export class MatrixSettingsError extends Error {
  override name = "MatrixSettingsError"
}

/** Stuart's prompt and tools, and how the bench calls the model. */
export function runSettings(
  entry: MatrixEntry,
  budgetMs: number,
  maxTokens: number,
): RunSettings {
  return {
    settingsHash: digest({
      prompt: SYSTEM_PROMPT,
      tools: claudeTools(),
      model: entry.model,
      effort: entry.effort,
      routerOff: true,
      fallbacks: false,
      maxRounds: MAX_ROUNDS,
      maxToolCalls: MAX_TOOL_CALLS,
    }),
    budgetMs,
    maxTokens,
  }
}

function sameSettings(a: RunSettings, b: RunSettings): boolean {
  return (
    a.settingsHash === b.settingsHash &&
    a.budgetMs === b.budgetMs &&
    a.maxTokens === b.maxTokens
  )
}

/** What is left to run, and its estimated cost. */
export function planMatrix(
  options: Pick<MatrixOptions, "store" | "entries" | "cases" | "runs">,
): EntryPlan[] {
  const onDisk = options.store.all()
  return options.entries.map((entry) => {
    let doneRuns = 0
    let pending = 0
    const costs = (onDisk.get(entry.id) ?? []).flatMap((file) =>
      Object.values(file.records).map(
        (record) => record.costUsd + (record.unmeteredUsd ?? 0),
      ),
    )
    for (let run = 1; run <= options.runs; run += 1) {
      const file = options.store.read(entry.id, run)
      if (isComplete(file, options.cases)) {
        doneRuns += 1
        continue
      }
      pending += options.cases.filter(
        (testCase) => !isCurrent(file?.records[testCase.id], testCase),
      ).length
    }
    // After a few metered answers, their mean cost beats planning figures.
    const measured = costs.length >= 10
    const perAnswer = measured
      ? costs.reduce((sum, each) => sum + each, 0) / costs.length
      : estimateUsd(entry.model, 1, entry.effort, MATRIX_CACHE_WRITE_SHARE)
    return {
      entry,
      doneRuns,
      pending,
      estimateUsd: perAnswer * pending,
      measured,
    }
  })
}

export function formatPlan(
  plans: readonly EntryPlan[],
  maxUsd: number,
  spentUsd: number,
) {
  const total = plans.reduce((sum, plan) => sum + plan.estimateUsd, 0)
  return [
    "Entry                 runs done  answers left  estimate USD",
    ...plans.map(
      (plan) =>
        `${plan.entry.id.padEnd(22)}${String(plan.doneRuns).padStart(9)}${String(
          plan.pending,
        ).padStart(
          14,
        )}${plan.estimateUsd.toFixed(2).padStart(14)}${plan.measured ? " (metered)" : ""}`,
    ),
    `Spent so far ${spentUsd.toFixed(2)} USD, left to run about ${total.toFixed(2)} USD, cap ${maxUsd.toFixed(2)} USD for the whole matrix`,
  ].join("\n")
}

/** Grades a stored answer with the case's checks as they are now. */
export function gradeRecord(
  testCase: BenchCase,
  record: Pick<
    QuestionRecord,
    "response" | "tools" | "answerSource" | "rejectedReason" | "rawText"
  > & { outcome: AnswerOutcome },
): Graded {
  const failed = record.outcome === "graded" ? null : record.outcome
  const model: ModelOutcome = {
    answer: record.answerSource,
    rejectedReason: record.rejectedReason,
    failed,
    rawText: record.rawText,
  }
  return grade({
    testCase,
    response:
      record.response === null
        ? null
        : ({ ...record.response, evidence: [] } as StuartResponse),
    tools: record.tools,
    known: knownAddresses(),
    deterministic: false,
    model,
  })
}

function applyGrade(record: QuestionRecord, graded: Graded): void {
  record.passed = graded.pass
  record.safety = graded.safety
  record.failures = graded.checks.flatMap((check) =>
    check.ok || check.type === undefined
      ? []
      : [{ check: check.name, type: check.type, detail: check.detail }],
  )
}

/** Grades a record, and again with Stuart's length limits ignored. */
export async function gradeInto(
  testCase: BenchCase,
  record: QuestionRecord,
): Promise<void> {
  applyGrade(record, gradeRecord(testCase, record))
  const recheck = await recheckIgnoringLength(testCase, record)
  record.lengthRecheck =
    recheck === null
      ? null
      : recheck.kind === "rejected"
        ? recheck.reason
        : recheck.kind
  record.passedIgnoringLength =
    recheck?.kind === "shown"
      ? gradeRecord(testCase, shownIgnoringLength(record, recheck.text)).pass
      : record.passed
}

export type RegradeReport = { regraded: number; dropped: number }

/**
 * Re-grades stored answers whose checks changed, offline; drops answers to
 * a question that changed (its text, wallet or the fixtures), so the next
 * run asks it again.
 */
export async function regradeMatrix(options: {
  store: MatrixStore
  cases: readonly BenchCase[]
  all?: boolean
}): Promise<RegradeReport> {
  const byId = new Map(options.cases.map((each) => [each.id, each]))
  let regraded = 0
  let dropped = 0
  for (const files of options.store.all().values()) {
    for (const file of files) {
      let changed = false
      for (const [id, record] of Object.entries(file.records)) {
        const testCase = byId.get(id)
        if (testCase === undefined) continue
        if (!isCurrent(record, testCase)) {
          delete file.records[id]
          file.finishedAt = null
          dropped += 1
          changed = true
          continue
        }
        const checks = checksHash(testCase)
        if (
          !options.all &&
          record.checksHash === checks &&
          record.passedIgnoringLength !== undefined
        ) {
          continue
        }
        await gradeInto(testCase, record)
        record.checksHash = checks
        regraded += 1
        changed = true
      }
      if (changed) options.store.write(file)
    }
  }
  return { regraded, dropped }
}

type Task = { entry: MatrixEntry; file: RunFile; testCase: BenchCase }

/** Spend reserved for answers in flight, against the matrix cap. */
class Budget {
  private reserved = 0

  constructor(
    private readonly store: MatrixStore,
    private readonly cap: number,
  ) {}

  spent(): number {
    return spendTotal(this.store.spend())
  }

  tryReserve(usd: number): boolean {
    if (this.spent() + this.reserved + usd > this.cap) return false
    this.reserved += usd
    return true
  }

  release(usd: number): void {
    this.reserved = Math.max(0, this.reserved - usd)
  }
}

type Attempt = {
  response: StuartResponse | null
  busy: boolean
  logs: Array<Record<string, unknown>>
  usage: UsageTotals
  meteredUsd: number
  unmeteredUsd: number
  ms: number
  servedBy: string[]
  maxRequestOutput: number
  rawText: string | null
  toolCalls: ToolCallRecord[]
}

type AnswerResult =
  | { kind: "record"; record: QuestionRecord }
  | { kind: "pending"; reason: string }
  | { kind: "capped" }

const MAX_BUSY_ATTEMPTS = 4
const MAX_ERROR_ATTEMPTS = 3

/** What the model wrote last: its respond sentence, card, or plain text. */
function rawTextOf(message: Anthropic.Beta.BetaMessage | null): string | null {
  if (message === null) return null
  for (const block of message.content) {
    if (block.type !== "tool_use") continue
    const input = block.input as Record<string, unknown> | null
    if (block.name === "respond" && typeof input?.answer === "string") {
      return input.answer
    }
    if (block.name === "ask_clarification") {
      return `[asks with the ${String(input?.cardId)} card]`
    }
  }
  const text = message.content
    .flatMap((block) => (block.type === "text" ? [block.text] : []))
    .join(" ")
    .trim()
  return text === "" ? null : text
}

async function attemptOnce(
  task: Task,
  options: MatrixOptions,
  create: MessageCreator,
  now: () => Date,
): Promise<Attempt> {
  const { entry, testCase } = task
  const maxTokens = options.maxTokens ?? MATRIX_MAX_TOKENS
  const budgetMs = options.budgetMs ?? MATRIX_BUDGET_MS
  const usage = emptyUsage()
  const servedBy: string[] = []
  let maxRequestOutput = 0
  let meteredUsd = 0
  let unmeteredUsd = 0
  let last: Anthropic.Beta.BetaMessage | null = null
  const calls = new Map<string, ToolCallRecord>()
  const metered: MessageCreator = async (params, signal) => {
    // Tool results the model is about to read: digest each call's result.
    for (const message of params.messages) {
      if (message.role !== "user" || typeof message.content === "string") {
        continue
      }
      for (const block of message.content) {
        if (block.type !== "tool_result") continue
        const call = calls.get(block.tool_use_id)
        if (call && call.resultDigest === null) {
          call.resultDigest = digest(block.content ?? "")
        }
      }
    }
    let response: Anthropic.Beta.BetaMessage
    try {
      response = await create(params, signal)
    } catch (error) {
      // The API answered with an error status: nothing billed. Cut off
      // (timeout, dropped connection): billed but unknown, so a worst case.
      const answered = error instanceof APIError && error.status !== undefined
      const worst = answered
        ? 0
        : worstRequestUsd(entry.model, maxTokens, budgetMs)
      unmeteredUsd += worst
      options.store.addSpend(
        entry.id,
        { meteredUsd: 0, unmeteredUsd: worst },
        now(),
      )
      throw error
    }
    const one = {
      input: response.usage.input_tokens,
      output: response.usage.output_tokens,
      cacheWrite: response.usage.cache_creation_input_tokens ?? 0,
      cacheRead: response.usage.cache_read_input_tokens ?? 0,
      calls: 1,
    }
    usage.input += one.input
    usage.output += one.output
    usage.cacheWrite += one.cacheWrite
    usage.cacheRead += one.cacheRead
    usage.calls += 1
    maxRequestOutput = Math.max(maxRequestOutput, one.output)
    servedBy.push(response.model)
    last = response
    for (const block of response.content) {
      if (
        block.type === "tool_use" &&
        block.name !== "respond" &&
        block.name !== "ask_clarification"
      ) {
        calls.set(block.id, {
          name: block.name,
          input: block.input,
          resultDigest: null,
        })
      }
    }
    const cost =
      Number(estimateCostMicroUsd(response.model || entry.model, one)) / 1e6
    meteredUsd += cost
    options.store.addSpend(
      entry.id,
      { meteredUsd: cost, unmeteredUsd: 0 },
      now(),
    )
    const fallback = response.content.some(
      (block) => (block as { type: string }).type === "fallback",
    )
    if (response.model !== entry.model || fallback) {
      throw new ModelMismatchError(
        `${entry.id}: asked for ${entry.model}, served by ${response.model}${fallback ? " after a fallback" : ""}`,
      )
    }
    return response
  }
  const logs: Array<Record<string, unknown>> = []
  // The breaker is module state shared by every answer in flight; a busy
  // answer is retried after a wait, never graded.
  resetClaudeBreaker()
  const started = performance.now()
  const run = await runStuart(
    requestFor(testCase.query, testCase.wallet !== false),
    {
      providers: benchProviders(),
      secret: "bench-secret-bench-secret-bench-secret",
      now: () => BENCH_NOW,
      claude: {
        create: metered,
        model: entry.model,
        effort: entry.effort,
        budgetMs,
        maxTokens,
        fallbacks: false,
      },
      log: (event) => logs.push(event),
      routerOff: true,
    },
  )
  // A mismatch inside the turn is caught by Stuart as a model error.
  if (servedBy.some((model) => model !== entry.model)) {
    throw new ModelMismatchError(
      `${entry.id}: asked for ${entry.model}, served by ${servedBy.join(", ")}`,
    )
  }
  return {
    response: run.kind === "answer" ? run.response : null,
    busy: run.kind === "busy",
    logs,
    usage,
    meteredUsd,
    unmeteredUsd,
    ms: Math.round(performance.now() - started),
    servedBy,
    maxRequestOutput,
    rawText: rawTextOf(last),
    toolCalls: [...calls.values()],
  }
}

function failedReason(attempt: Attempt): string | null {
  const failed = attempt.logs.find(
    (event) => event.message === "stuart.model_failed",
  )
  return typeof failed?.reason === "string" ? failed.reason : null
}

function stored(response: StuartResponse | null): StoredResponse | null {
  if (response === null) return null
  const { evidence: _evidence, ...rest } = response
  return rest
}

async function answerOne(
  task: Task,
  options: MatrixOptions,
  create: MessageCreator,
  budget: Budget,
  now: () => Date,
): Promise<AnswerResult> {
  const { entry, testCase } = task
  const log = options.log ?? (() => {})
  const sleep =
    options.sleep ??
    ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)))
  const reserve = worstAnswerUsd(
    entry.model,
    options.maxTokens ?? MATRIX_MAX_TOKENS,
    options.budgetMs ?? MATRIX_BUDGET_MS,
  )
  let attempts = 0
  let busyAttempts = 0
  let errorAttempts = 0
  let timeouts = 0
  // Model attempts (not API errors): their time, tokens and cost belong
  // to the answer.
  const attemptMs: number[] = []
  const usage = emptyUsage()
  let costUsd = 0
  let unmeteredUsd = 0
  while (true) {
    if (!budget.tryReserve(reserve)) return { kind: "capped" }
    let attempt: Attempt
    try {
      attempts += 1
      attempt = await attemptOnce(task, options, create, now)
    } finally {
      budget.release(reserve)
    }
    const reason = failedReason(attempt)
    if (attempt.busy) {
      busyAttempts += 1
      if (busyAttempts >= MAX_BUSY_ATTEMPTS) {
        return { kind: "pending", reason: "rate limited or overloaded" }
      }
      const wait = 10_000 * busyAttempts
      log(`  ${entry.id} ${testCase.id}: busy, retry in ${wait / 1000}s`)
      await sleep(wait)
      continue
    }
    if (reason === "error") {
      errorAttempts += 1
      const detail = attempt.logs
        .filter((event) => event.message === "stuart.model_error")
        .map((event) => String(event.detail).slice(0, 120))
        .join("; ")
      if (errorAttempts >= MAX_ERROR_ATTEMPTS) {
        return { kind: "pending", reason: `API error: ${detail}` }
      }
      log(`  ${entry.id} ${testCase.id}: API error (${detail}), retrying`)
      await sleep(5_000 * errorAttempts)
      continue
    }
    attemptMs.push(attempt.ms)
    costUsd += attempt.meteredUsd
    unmeteredUsd += attempt.unmeteredUsd
    usage.input += attempt.usage.input
    usage.output += attempt.usage.output
    usage.cacheWrite += attempt.usage.cacheWrite
    usage.cacheRead += attempt.usage.cacheRead
    usage.calls += attempt.usage.calls
    let outcome: AnswerOutcome | null = null
    if (reason === "timeout") {
      timeouts += 1
      // A slow API and a model thinking too long look alike: one retry.
      if (timeouts < 2) {
        log(`  ${entry.id} ${testCase.id}: timed out, retrying once`)
        continue
      }
      outcome = "timeout"
    } else if (reason === "refusal") {
      outcome = "refusal"
    } else if (reason === "max_tokens") {
      outcome = "token_limit"
    }
    const query = attempt.logs.find((event) => event.message === "stuart.query")
    const tools = Array.isArray(query?.tools)
      ? query.tools.filter((each): each is string => typeof each === "string")
      : []
    const logged =
      typeof query?.modelAnswer === "string" ? query.modelAnswer : "failed"
    // No tool, no respond call, just text: graded as the model's own reply.
    const answerSource =
      logged === "failed" &&
      reason === "no_tool" &&
      tools.length === 0 &&
      (attempt.rawText ?? "").trim() !== ""
        ? "plain_text"
        : logged
    const rejected = attempt.logs.find(
      (event) => event.message === "stuart.model_answer_rejected",
    )
    const rejectedReason =
      answerSource === "rejected"
        ? typeof rejected?.reason === "string"
          ? rejected.reason
          : attempt.logs.some(
                (event) => event.message === "stuart.unsourced_answer",
              )
            ? "unsourced"
            : "rejected"
        : null
    if (outcome === null && answerSource === "failed") outcome = "no_answer"
    const rejectedDetail =
      answerSource === "rejected" && Array.isArray(rejected?.detail)
        ? rejected.detail.map((each) => String(each)).slice(0, 10)
        : []
    const response = attempt.response
    const record: QuestionRecord = {
      id: testCase.id,
      questionHash: questionHash(testCase),
      checksHash: checksHash(testCase),
      passed: false,
      safety: false,
      outcome: outcome ?? "graded",
      answerSource,
      rejectedReason,
      rejectedDetail,
      onCard:
        response?.uiBlocks.some(
          (block) => block.type === "clarification_card",
        ) ?? false,
      rawText: attempt.rawText,
      failures: [],
      ms: attempt.ms,
      attemptMs,
      maxRequestOutput: attempt.maxRequestOutput,
      usage,
      costUsd,
      unmeteredUsd,
      tools,
      toolCalls: attempt.toolCalls,
      shown: response === null ? "" : shownText(response),
      response: stored(response),
      runtime: response?.service.runtime ?? "busy",
      servedBy: [...new Set(attempt.servedBy)],
      attempts,
    }
    await gradeInto(testCase, record)
    return { kind: "record", record }
  }
}

/** Pending answers, interleaved across entries and runs. */
function interleave(queues: readonly Task[][]): Task[] {
  const tasks: Task[] = []
  const longest = Math.max(0, ...queues.map((queue) => queue.length))
  for (let index = 0; index < longest; index += 1) {
    for (const queue of queues) {
      const task = queue[index]
      if (task) tasks.push(task)
    }
  }
  return tasks
}

export type MatrixReport = {
  answered: number
  /** This invocation's spend and the matrix's total. */
  spentUsd: number
  totalSpentUsd: number
  /** Stopped at the spend cap before finishing. */
  capped: boolean
  /** Answers left pending after API errors or rate limits. */
  pending: number
  /** Answers set aside after API errors in several invocations. */
  abandoned: string[]
  regrade: RegradeReport
  plans: EntryPlan[]
}

export async function runMatrix(options: MatrixOptions): Promise<MatrixReport> {
  const log = options.log ?? (() => {})
  const now = options.now ?? (() => new Date())
  const release = options.store.lock()
  try {
    return await runLocked(options, log, now)
  } finally {
    release()
  }
}

async function runLocked(
  options: MatrixOptions,
  log: (line: string) => void,
  now: () => Date,
): Promise<MatrixReport> {
  const budgetMs = options.budgetMs ?? MATRIX_BUDGET_MS
  const maxTokens = options.maxTokens ?? MATRIX_MAX_TOKENS
  // One fingerprint per matrix: answers made under other code, prompt,
  // world or limits are never resumed.
  const fingerprint = checkFingerprint(options.store, {
    budgetMs,
    maxTokens,
    commit: options.commit ?? "0000000",
    now,
    write: false,
  })
  // Settings next: a run file made otherwise is never resumed.
  for (const entry of options.entries) {
    const wanted = runSettings(entry, budgetMs, maxTokens)
    for (let run = 1; run <= options.runs; run += 1) {
      const file = options.store.read(entry.id, run)
      if (file !== null && !sameSettings(file.settings, wanted)) {
        throw new MatrixSettingsError(
          `${entry.id} run ${run} was made with other settings (time budget ${file.settings.budgetMs} ms, max_tokens ${file.settings.maxTokens}, prompt and tools ${file.settings.settingsHash}; now ${wanted.budgetMs} ms, ${wanted.maxTokens}, ${wanted.settingsHash}). Use a new --name for a new matrix: nothing was run.`,
        )
      }
    }
  }
  const regrade = await regradeMatrix(options)
  if (regrade.regraded || regrade.dropped) {
    log(
      `Re-graded ${regrade.regraded} stored answers offline; ${regrade.dropped} asked again (their question changed)`,
    )
  }
  const budget = new Budget(options.store, options.maxUsd)
  const spentBefore = budget.spent()
  const plans = planMatrix(options)
  log(formatPlan(plans, options.maxUsd, spentBefore))
  const estimate = plans.reduce((sum, plan) => sum + plan.estimateUsd, 0)
  if (spentBefore + estimate > options.maxUsd) {
    throw new MatrixCapError(
      `Spent ${spentBefore.toFixed(2)} USD so far plus an estimate of ${estimate.toFixed(2)} USD is above the cap of ${options.maxUsd.toFixed(2)} USD for this matrix: nothing was run`,
    )
  }
  if (options.store.readFingerprint() === null) {
    options.store.writeFingerprint(fingerprint)
  }
  const pendingLedger: PendingLedger = options.store.pending()
  const abandoned: string[] = []
  const queues: Task[][] = []
  for (let run = 1; run <= options.runs; run += 1) {
    for (const entry of options.entries) {
      const existing = options.store.read(entry.id, run)
      if (isComplete(existing, options.cases)) continue
      const file: RunFile = existing ?? {
        fingerprint: fingerprint.fingerprint,
        entry: entry.id,
        model: entry.model,
        effort: entry.effort,
        run,
        settings: runSettings(entry, budgetMs, maxTokens),
        commit: fingerprint.commit,
        startedAt: now().toISOString(),
        finishedAt: null,
        records: {},
      }
      queues.push(
        options.cases
          .filter((testCase) => {
            if (isCurrent(file.records[testCase.id], testCase)) return false
            const key = pendingKey(entry.id, run, testCase.id)
            const lost = pendingLedger[key]
            if (
              lost !== undefined &&
              lost.invocations >= MAX_PENDING_INVOCATIONS &&
              !options.retryAbandoned
            ) {
              abandoned.push(`${key} (${lost.lastReason})`)
              return false
            }
            return true
          })
          .map((testCase) => ({ entry, file, testCase })),
      )
    }
  }
  if (abandoned.length) {
    log(
      `Set aside after API errors in ${MAX_PENDING_INVOCATIONS} invocations (--retry-abandoned tries them again):\n  ${abandoned.join("\n  ")}`,
    )
  }
  const tasks = interleave(queues)
  const creators = new Map<string, MessageCreator>()
  const creatorFor = (entry: MatrixEntry) => {
    const found = creators.get(entry.id)
    if (found) return found
    const made = options.createFor(entry)
    creators.set(entry.id, made)
    return made
  }
  const maxInfra = options.maxInfraFailures ?? 6
  let answered = 0
  let capped = false
  let pending = 0
  let infraStreak = 0
  let stopped: Error | null = null
  let next = 0
  const worker = async () => {
    while (next < tasks.length && stopped === null && !capped) {
      const task = tasks[next]
      next += 1
      if (task === undefined) return
      const key = pendingKey(task.entry.id, task.file.run, task.testCase.id)
      let result: AnswerResult
      try {
        result = await answerOne(
          task,
          options,
          creatorFor(task.entry),
          budget,
          now,
        )
      } catch (error) {
        stopped = error instanceof Error ? error : new Error(String(error))
        return
      }
      if (result.kind === "capped") {
        capped = true
        return
      }
      if (result.kind === "pending") {
        pending += 1
        infraStreak += 1
        const before = pendingLedger[key]?.invocations ?? 0
        pendingLedger[key] = {
          invocations: before + 1,
          lastReason: result.reason.slice(0, 200),
        }
        options.store.writePending(pendingLedger)
        log(
          `  ${task.entry.id} ${task.testCase.id}: left pending, ${result.reason}`,
        )
        if (infraStreak >= maxInfra) {
          stopped = new InfrastructureError(
            `${infraStreak} answers in a row failed on API errors or rate limits (last: ${result.reason}). Stopped; they stay pending. Run again later to resume.`,
          )
        }
        continue
      }
      infraStreak = 0
      if (pendingLedger[key] !== undefined) {
        delete pendingLedger[key]
        options.store.writePending(pendingLedger)
      }
      answered += 1
      task.file.records[result.record.id] = result.record
      if (isComplete(task.file, options.cases)) {
        task.file.finishedAt = now().toISOString()
        const passed = Object.values(task.file.records).filter(
          (each) => each.passed,
        ).length
        log(
          `${task.entry.id} run ${task.file.run}: ${passed}/${options.cases.length} passed`,
        )
      }
      options.store.write(task.file)
    }
  }
  await Promise.all(
    Array.from({ length: Math.max(1, options.concurrency) }, worker),
  )
  const totalSpent = budget.spent()
  if (capped) {
    log(
      `Stopped at the cap: ${totalSpent.toFixed(2)} USD spent on this matrix. Raise --max-usd to resume.`,
    )
  }
  const failure = stopped as Error | null
  if (failure !== null) throw failure
  return {
    answered,
    spentUsd: totalSpent - spentBefore,
    totalSpentUsd: totalSpent,
    capped,
    pending,
    abandoned,
    regrade,
    plans,
  }
}

/**
 * The matrix's fingerprint: written on the first run, then every run must
 * match it. A folder with answers but no fingerprint was made by an older
 * runner: never resumed.
 */
export function checkFingerprint(
  store: MatrixStore,
  input: {
    budgetMs: number
    maxTokens: number
    commit: string
    now: () => Date
    /** False: check only; the caller writes it once the run goes ahead. */
    write?: boolean
  },
) {
  const current = matrixFingerprint(input)
  const stored = store.readFingerprint()
  if (stored === null) {
    if (store.all().size > 0) {
      throw new MatrixSettingsError(
        `${store.dir} holds answers made before matrix fingerprints: use a new --name, or --replay-from to replay them: nothing was run.`,
      )
    }
    const made = {
      ...current,
      commit: input.commit,
      createdAt: input.now().toISOString(),
    }
    if (input.write !== false) store.writeFingerprint(made)
    return made
  }
  if (stored.fingerprint !== current.fingerprint) {
    const changed = Object.keys(current.parts).filter(
      (part) => stored.parts[part] !== current.parts[part],
    )
    throw new MatrixSettingsError(
      `${store.dir} was made under another fingerprint (changed: ${changed.join(", ")}). Use a new --name for a new matrix: nothing was run.`,
    )
  }
  return stored
}

/** A store that meters no spend: a replay calls no model. */
class ReplayStore extends MatrixStore {
  override addSpend(): void {}
}

/** The model's turn rebuilt from a stored answer, for a replay. */
function storedModel(record: QuestionRecord): MessageCreator {
  const calls = record.toolCalls
  const raw = record.rawText ?? ""
  const card = /^\[asks with the (.+) card\]$/.exec(raw)?.[1]
  let round = 0
  return async (params) => {
    round += 1
    const content: unknown[] = []
    if (round === 1 && calls.length > 0) {
      calls.forEach((call, index) => {
        content.push({
          type: "tool_use",
          id: `toolu_replay_${index}`,
          name: call.name,
          input: call.input,
        })
      })
    } else if (card !== undefined) {
      content.push({
        type: "tool_use",
        id: "toolu_replay_card",
        name: "ask_clarification",
        input: { cardId: card },
      })
    } else if (
      record.answerSource === "missing" ||
      record.answerSource === "plain_text" ||
      record.answerSource === "failed"
    ) {
      if (raw !== "") content.push({ type: "text", text: raw })
    } else {
      content.push({
        type: "tool_use",
        id: "toolu_replay_respond",
        name: "respond",
        input: { answer: raw, blocks: [], evidence: [], followups: [] },
      })
    }
    return {
      id: `msg_replay_${round}`,
      type: "message",
      role: "assistant",
      model: params.model,
      content,
      stop_reason: content.length ? "tool_use" : "end_turn",
      stop_sequence: null,
      usage: {
        input_tokens: 0,
        output_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    } as unknown as Anthropic.Beta.BetaMessage
  }
}

export type ReplayReport = {
  replayed: number
  /** Copied as they were: timeouts, refusals, max_tokens stops. */
  kept: number
  /** Stored answers to questions that changed since: left for a run. */
  skipped: number
}

/**
 * Replays every stored answer of one matrix into a fresh one: the stored
 * tool calls and the model's own text go through Stuart (its tools are
 * deterministic fakes over the frozen world) and the grader as they are
 * now. Equal to a fresh run only while Stuart's prompt is unchanged: the
 * model answered the old one. Time, tokens and cost are the stored ones.
 */
export async function replayMatrix(input: {
  from: MatrixStore
  to: MatrixStore
  cases: readonly BenchCase[]
  budgetMs?: number
  maxTokens?: number
  commit?: string
  now?: () => Date
}): Promise<ReplayReport> {
  const now = input.now ?? (() => new Date())
  const budgetMs = input.budgetMs ?? MATRIX_BUDGET_MS
  const maxTokens = input.maxTokens ?? MATRIX_MAX_TOKENS
  const release = input.to.lock()
  try {
    const fingerprint = checkFingerprint(input.to, {
      budgetMs,
      maxTokens,
      commit: input.commit ?? "0000000",
      now,
    })
    // The replayed answers' cost was paid by the matrix they came from.
    input.to.carrySpend(input.from.spend())
    const byId = new Map(input.cases.map((each) => [each.id, each]))
    let replayed = 0
    let kept = 0
    let skipped = 0
    for (const [entryId, files] of input.from.all()) {
      for (const source of files) {
        const entry: MatrixEntry = {
          id: entryId,
          model: source.model,
          slug: entryId.split(".")[0] ?? entryId,
          label: source.model,
          effort: source.effort as MatrixEntry["effort"],
        }
        const file: RunFile = input.to.read(entryId, source.run) ?? {
          fingerprint: fingerprint.fingerprint,
          entry: entryId,
          model: source.model,
          effort: source.effort,
          run: source.run,
          settings: runSettings(entry, budgetMs, maxTokens),
          commit: fingerprint.commit,
          startedAt: source.startedAt,
          finishedAt: null,
          records: {},
        }
        for (const record of Object.values(source.records)) {
          const testCase = byId.get(record.id)
          if (testCase === undefined || !isCurrent(record, testCase)) {
            skipped += 1
            continue
          }
          if (["timeout", "refusal", "token_limit"].includes(record.outcome)) {
            const copy = { ...record, checksHash: checksHash(testCase) }
            await gradeInto(testCase, copy)
            file.records[record.id] = copy
            kept += 1
            continue
          }
          // A replay spends nothing: its store meters no spend.
          const scratch = new ReplayStore(input.to.dir)
          const result = await answerOne(
            { entry, file, testCase },
            {
              store: scratch,
              entries: [entry],
              cases: input.cases,
              runs: 1,
              maxUsd: Number.POSITIVE_INFINITY,
              concurrency: 1,
              createFor: () => storedModel(record),
              budgetMs,
              maxTokens,
            },
            storedModel(record),
            new Budget(scratch, Number.POSITIVE_INFINITY),
            now,
          )
          if (result.kind !== "record") {
            skipped += 1
            continue
          }
          // What the model spent and how long it took: the stored figures.
          file.records[record.id] = {
            ...result.record,
            ms: record.ms,
            attemptMs: record.attemptMs,
            maxRequestOutput: record.maxRequestOutput,
            usage: record.usage,
            costUsd: record.costUsd,
            unmeteredUsd: record.unmeteredUsd,
            servedBy: record.servedBy,
            attempts: record.attempts,
          }
          replayed += 1
        }
        if (isComplete(file, input.cases)) {
          file.finishedAt = source.finishedAt ?? now().toISOString()
        }
        input.to.write(file)
      }
    }
    return { replayed, kept, skipped }
  } finally {
    release()
  }
}
