import {
  type BenchEntry,
  type BenchFailureTypeId,
  type BenchKindId,
  type BenchPublicQuestion,
  type BenchRejectionReasonId,
  type BenchResults,
  benchFailureTypes,
  benchKinds,
  benchRejectionReasons,
  benchResultsSchema,
} from "@matchbox/contracts/bench"
import { CLAUDE_BUDGET_MS, MAX_TOKENS } from "../../src/query/claude"
import { type BenchCase, kindOf } from "../cases"
import { publicChecks } from "../describe"
import { findLeaks, heldLiterals, LeakError } from "../leaks"
import { allEntries, type MatrixEntry, PRODUCTION } from "./models"
import {
  isComplete,
  type MatrixStore,
  type QuestionRecord,
  type RunFile,
  spendTotal,
} from "./store"

// Builds the one published results file (@matchbox/contracts/bench) from
// every complete run on disk, so entries added to a matrix later are
// published beside the earlier ones without running those again.
//
// Only public questions carry text, checks and answers. Held-back
// questions appear only inside aggregates: never their id, text, expected
// values or answers. API errors and rate limits never reach a record, so
// they stay out of every figure but the matrix's total spend; timeouts are
// graded failures and count at their elapsed time.

/** Stored answers graded before scoreIgnoringLength: run --regrade. */
export class RegradeNeededError extends Error {
  override name = "RegradeNeededError"
}

/** Runs made under different fingerprints: never published side by side. */
export class MixedFingerprintError extends Error {
  override name = "MixedFingerprintError"
}

export type PublishInput = {
  store: MatrixStore
  cases: readonly BenchCase[]
  /** Public case ids and their checks in plain words (public.ts). */
  publicChecks: Readonly<Record<string, readonly string[] | null>>
  id: string
  limits: { answerBudgetMs: number; maxTokens: number }
  /** Entries in display order (default: every supported pair). */
  entries?: readonly MatrixEntry[]
}

/** Stuart's production limits, for scoreWithinStuartLimit. */
export const STUART_LIMITS = {
  stuartBudgetMs: CLAUDE_BUDGET_MS,
  stuartMaxTokens: MAX_TOKENS,
}

function share(part: number, whole: number): number {
  return whole === 0 ? 0 : Number((part / whole).toFixed(4))
}

function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
  )
  return sorted[index] ?? 0
}

const round = (value: number, places: number) => Number(value.toFixed(places))

/** Some attempt took longer than Stuart's budget (a timed-out one too). */
export function overStuartBudget(
  record: Pick<QuestionRecord, "ms" | "attemptMs">,
): boolean {
  const times = record.attemptMs?.length ? record.attemptMs : [record.ms]
  return times.some((ms) => ms > STUART_LIMITS.stuartBudgetMs)
}

/** Passed, and within Stuart's own time budget and max_tokens. */
export function withinStuartLimit(record: QuestionRecord): boolean {
  return (
    record.passed &&
    !overStuartBudget(record) &&
    record.maxRequestOutput <= STUART_LIMITS.stuartMaxTokens
  )
}

const STUART_REASONS: ReadonlySet<string> = new Set([
  "too_many_sentences",
  "too_long",
  "unsourced",
  "claim",
  "greeting",
  "instruction",
  "empty",
])

const REPLY_REASONS: Readonly<Record<string, BenchRejectionReasonId>> = {
  unsourced: "reply_unsourced",
  claim: "reply_claim",
}

/**
 * Why the answer's own words were not credited, or null when they were:
 * one reason per answer that failed the grader's "answer accepted" check,
 * so the reasons always add up to rejectedAnswers.
 */
export function rejectionOf(
  record: Pick<QuestionRecord, "failures" | "answerSource" | "rejectedReason">,
): BenchRejectionReasonId | null {
  const failure = record.failures.find(
    (each) => each.type === "answer_rejected",
  )
  if (failure === undefined) return null
  if (record.answerSource === "rejected") {
    // A response Stuart withdrew as a whole is recorded as unsourced.
    const reason = record.rejectedReason ?? "unsourced"
    return STUART_REASONS.has(reason)
      ? (reason as BenchRejectionReasonId)
      : "unsourced"
  }
  // A reply with no tool run, graded on the model's whole text.
  return REPLY_REASONS[failure.detail] ?? "reply_empty"
}

function passedIgnoringLength(record: QuestionRecord): boolean {
  if (record.passedIgnoringLength === undefined) {
    throw new RegradeNeededError(
      `${record.id} was graded before scoreIgnoringLength: run --regrade first`,
    )
  }
  return record.passedIgnoringLength
}

/** Every model attempt behind an answer, cut-offs at their worst case. */
function answerCost(record: QuestionRecord): number {
  return record.costUsd + (record.unmeteredUsd ?? 0)
}

function entrySummary(
  entry: MatrixEntry,
  runs: readonly RunFile[],
  cases: readonly BenchCase[],
): BenchEntry {
  const records = (run: RunFile) =>
    cases.map((testCase) => run.records[testCase.id] as QuestionRecord)
  const all = runs.flatMap(records)
  const meanOver = (perRun: number[]) =>
    round(perRun.reduce((sum, each) => sum + each, 0) / perRun.length, 4)
  const scoreRuns = runs.map((run) =>
    share(records(run).filter((each) => each.passed).length, cases.length),
  )
  const ignoringLengthRuns = runs.map((run) =>
    share(records(run).filter(passedIgnoringLength).length, cases.length),
  )
  const withinRuns = runs.map((run) =>
    share(records(run).filter(withinStuartLimit).length, cases.length),
  )
  const costUsd = all.reduce((sum, each) => sum + answerCost(each), 0)
  const byKind = benchKinds.flatMap((kind) => {
    const ids = cases
      .filter((testCase) => kindOf(testCase) === kind.id)
      .map((testCase) => testCase.id)
    if (ids.length === 0) return []
    const kindScore = (passed: (record: QuestionRecord) => boolean) =>
      meanOver(
        runs.map((run) =>
          share(
            ids.filter((id) => passed(run.records[id] as QuestionRecord))
              .length,
            ids.length,
          ),
        ),
      )
    return [
      {
        kind: kind.id,
        score: kindScore((record) => record.passed),
        scoreIgnoringLength: kindScore(passedIgnoringLength),
      },
    ]
  })
  const failureCounts = new Map<BenchFailureTypeId, number>()
  for (const record of all) {
    for (const failure of record.failures) {
      failureCounts.set(
        failure.type,
        (failureCounts.get(failure.type) ?? 0) + 1,
      )
    }
  }
  let always = 0
  let never = 0
  for (const testCase of cases) {
    const passes = runs.filter((run) => run.records[testCase.id]?.passed).length
    if (passes === runs.length) always += 1
    else if (passes === 0) never += 1
  }
  const mean = (pick: (record: QuestionRecord) => number) =>
    all.length === 0
      ? 0
      : round(all.reduce((sum, each) => sum + pick(each), 0) / all.length, 1)
  const outcomes = (outcome: QuestionRecord["outcome"]) =>
    all.filter((each) => each.outcome === outcome).length
  // Every model attempt's time: a timed-out first try counts too.
  const times = all.flatMap((each) =>
    each.attemptMs?.length ? each.attemptMs : [each.ms],
  )
  const reasons = new Map<BenchRejectionReasonId, number>()
  for (const record of all) {
    const reason = rejectionOf(record)
    if (reason !== null) reasons.set(reason, (reasons.get(reason) ?? 0) + 1)
  }
  const rejectedAnswers = [...reasons.values()].reduce(
    (sum, each) => sum + each,
    0,
  )
  return {
    id: entry.id,
    model: entry.model,
    modelLabel: entry.label,
    effort: entry.effort,
    runsStuart:
      entry.model === PRODUCTION.model && entry.effort === PRODUCTION.effort,
    score: meanOver(scoreRuns),
    scoreRuns,
    scoreIgnoringLength: meanOver(ignoringLengthRuns),
    scoreWithinStuartLimit: meanOver(withinRuns),
    overStuartBudgetShare: share(
      all.filter(overStuartBudget).length,
      all.length,
    ),
    runs: runs.length,
    safetyFails: all.filter((each) => each.safety).length,
    timeouts: outcomes("timeout"),
    refusals: outcomes("refusal"),
    tokenLimitStops: outcomes("token_limit"),
    answers: all.length,
    rejectedAnswers,
    rejectedShare: share(rejectedAnswers, all.length),
    rejectionReasons: [...reasons]
      .map(([reason, count]) => ({
        reason,
        count,
        share: share(count, all.length),
      }))
      .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason)),
    costUsd: round(costUsd, 4),
    costPer100Usd: round(
      all.length === 0 ? 0 : (costUsd / all.length) * 100,
      4,
    ),
    medianAnswerMs: percentile(times, 50),
    p90AnswerMs: percentile(times, 90),
    tokensPerAnswer: {
      input: mean(
        (each) =>
          each.usage.input + each.usage.cacheRead + each.usage.cacheWrite,
      ),
      output: mean((each) => each.usage.output),
    },
    byKind,
    failures: [...failureCounts]
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type)),
    // One run cannot tell a steady answer from a lucky one.
    agreement:
      runs.length < 2
        ? null
        : {
            always: share(always, cases.length),
            sometimes: share(cases.length - always - never, cases.length),
            never: share(never, cases.length),
          },
  }
}

/** The run whose outcome matches most runs of this question. */
function representative(
  runs: readonly RunFile[],
  id: string,
): QuestionRecord | null {
  const records = runs.flatMap((run) => {
    const record = run.records[id]
    return record === undefined ? [] : [record]
  })
  const passes = records.filter((each) => each.passed).length
  const majority = passes * 2 >= records.length
  return records.find((each) => each.passed === majority) ?? null
}

/**
 * Sentences the user saw that were the model's own words. A card, the
 * out-of-scope line and a rejected sentence's template are Stuart's text.
 */
const MODEL_WORDS = new Set(["accepted", "question"])

export function buildResults(input: PublishInput): BenchResults {
  const { cases } = input
  const onDisk = input.store.all()
  const fingerprint = input.store.readFingerprint()
  if (fingerprint === null) {
    throw new MixedFingerprintError(
      `${input.store.dir} has no fingerprint.json: its answers were made by an older runner`,
    )
  }
  const order = input.entries ?? allEntries()
  const published: Array<{ entry: MatrixEntry; runs: RunFile[] }> = []
  for (const entry of order) {
    const runs = (onDisk.get(entry.id) ?? []).filter((run) =>
      isComplete(run, cases),
    )
    const other = runs.find(
      (run) => run.fingerprint !== fingerprint.fingerprint,
    )
    if (other !== undefined) {
      throw new MixedFingerprintError(
        `${entry.id} run ${other.run} was made under fingerprint ${other.fingerprint ?? "none"}, the matrix under ${fingerprint.fingerprint}: not published`,
      )
    }
    if (runs.length > 0) published.push({ entry, runs })
  }
  const entries = published.map(({ entry, runs }) =>
    entrySummary(entry, runs, cases),
  )
  const allRuns = published.flatMap(({ runs }) => runs)
  const publicCases = cases.filter(
    (testCase) => testCase.id in input.publicChecks,
  )
  const publicQuestions: BenchPublicQuestion[] = publicCases.map(
    (testCase) => ({
      id: testCase.id,
      kind: kindOf(testCase),
      question: testCase.query,
      checks: publicChecks(testCase, input.publicChecks[testCase.id] ?? null),
      answers: published.flatMap(({ entry, runs }) => {
        const record = representative(runs, testCase.id)
        if (record === null) return []
        const fromModel = MODEL_WORDS.has(record.answerSource)
        return [
          {
            entry: entry.id,
            passed: record.passed,
            passedIgnoringLength: passedIgnoringLength(record),
            shown: record.shown.slice(0, 4_000),
            answerFrom: fromModel ? ("model" as const) : ("template" as const),
            rejectedReason: rejectionOf(record),
            onCard: record.onCard ?? false,
            modelText: fromModel
              ? null
              : (record.rawText?.slice(0, 1_000) ?? null),
            failures: record.failures.map((failure) => failure.type),
          },
        ]
      }),
    }),
  )
  const times = allRuns
    .flatMap((run) => [run.startedAt, run.finishedAt])
    .filter((each): each is string => each !== null)
    .sort()
  const fallback = new Date().toISOString()
  const kindCount = (kind: BenchKindId, list: readonly BenchCase[]) =>
    list.filter((testCase) => kindOf(testCase) === kind).length
  const spend = input.store.spend()
  const results: BenchResults = {
    version: 1,
    run: {
      id: input.id,
      startedAt: times[0] ?? fallback,
      finishedAt: times.at(-1) ?? fallback,
      // The commit and fingerprint every published answer was made under.
      commit: fingerprint.commit,
      fingerprint: fingerprint.fingerprint,
      questions: cases.length,
      publicQuestions: publicQuestions.length,
      // What ran: the most runs any published entry finished.
      runsPerEntry: Math.max(0, ...entries.map((entry) => entry.runs)),
      routing: "model",
      // Everything the matrix spent, failed and retried requests included.
      totalCostUsd: round(spendTotal(spend), 2),
      unmeteredCostUsd: round(spend.unmeteredUsd, 2),
      timeoutsInTimes: true,
      limits: { ...input.limits, ...STUART_LIMITS },
    },
    kinds: benchKinds.map((kind) => ({
      id: kind.id,
      label: kind.label,
      questions: kindCount(kind.id, cases),
      publicQuestions: kindCount(kind.id, publicCases),
    })),
    failureTypes: benchFailureTypes.map((type) => ({ ...type })),
    rejectionTypes: benchRejectionReasons.map((type) => ({ ...type })),
    entries,
    publicQuestions,
  }
  // A public question never shows a held-back question's values.
  const leaks = findLeaks(
    publicQuestions.map((question) => ({
      id: question.id,
      text: [
        question.question,
        ...question.checks,
        ...question.answers.flatMap((answer) => [
          answer.shown,
          answer.modelText ?? "",
        ]),
      ].join("\n"),
    })),
    heldLiterals(cases, new Set(publicCases.map((each) => each.id))),
  )
  if (leaks.length > 0) {
    throw new LeakError(
      `Public questions show held-back values: ${leaks
        .slice(0, 10)
        .map(
          (leak) =>
            `${leak.publicId} shows ${leak.literal} (held: ${leak.heldIds.join(", ")})`,
        )
        .join(
          "; ",
        )}. Regroup the split, or add a reviewed exception in bench/leaks.ts.`,
    )
  }
  return benchResultsSchema.parse(results)
}
