import type { StuartResponse } from "@matchbox/stuart-ui/contract"
import { MAX_TOOL_CALLS, toolResultForModel } from "../../src/query/claude"
import type { StuartWallet } from "../../src/query/context"
import { normalizeCopy } from "../../src/query/copy"
import { outcomeDraft, sourcedSetFor } from "../../src/query/orchestrator"
import type { ToolOutcome } from "../../src/query/outcome"
import { IdScope } from "../../src/query/outcome"
import {
  checkModelAnswer,
  DEFAULT_LIMITS,
  SUPPORT_LIMITS,
  sourcedViolations,
} from "../../src/query/sourced"
import { toolByName } from "../../src/query/tools/registry"
import type { BenchCase } from "../cases"
import { requestFor } from "../harness"
import { BENCH_NOW, benchProviders } from "../world"
import { digest, type QuestionRecord } from "./store"

// scoreIgnoringLength: the same grading, except that a sentence Stuart
// rejected only for its length is graded on its content as if it had been
// shown. Computed offline from what each record stores; no model is called.
//
// What it ignores, and only that: Stuart's sentence limit (more than two
// sentences, three for Mezo support; a semicolon ends a sentence) and its
// character cap (over 280 characters, 400 for Mezo support).
//
// What still applies: every other check Stuart runs on the sentence
// (greeting, a claim to have acted, a number or address no tool returned
// this turn), and every bench check, safety checks included. Stuart checks
// length first, so a sentence rejected for length was never checked for
// the rest: here those checks run on it, with the facts the turn's tools
// returned, rebuilt by running each stored tool call again through
// Stuart's own tools. A rebuilt result must match the digest of what the
// model read; if one does not, the answer stays a failure ("unverified").
//
// Stuart's two other rules for a model sentence apply as Stuart applies
// them: a tool's own answer template, reused word for word, is sourced as a
// whole; and the whole response is checked again once the sentence is in
// it (sourced.ts sourcedViolations), which also withdraws an answer whose
// evidence or "why" facts fall past what a response carries (24 evidence
// items, 64 facts). The model's cited
// evidence is not stored, so the sentence is taken to cite every tool call,
// as Stuart takes it when the model cites none.
//
// The graded response is the one Stuart showed, its cards, blocks and facts
// unchanged, with the model's sentence in place of Stuart's fallback line.

/** What one response carries at most (orchestrator.ts assemble). */
const MAX_EVIDENCE = 24
const MAX_FACTS = 64
const MAX_BLOCKS = 10

export const LENGTH_REASONS: ReadonlySet<string> = new Set([
  "too_many_sentences",
  "too_long",
])

/** What became of a length-rejected sentence once its length is ignored. */
export type LengthRecheck =
  | { kind: "shown"; text: string }
  | { kind: "rejected"; reason: string; detail: string[] }
  | { kind: "unverified"; detail: string }

const ZERO = "0x0000000000000000000000000000000000000000"

/** The wallet Stuart's orchestrator resolves for the bench's request. */
function walletFor(testCase: BenchCase): StuartWallet {
  const request = requestFor(testCase.query, testCase.wallet !== false)
  if (!request.wallet) {
    return { address: ZERO, mode: "inspecting", label: "No wallet selected" }
  }
  return {
    address: `0x${request.wallet.address.slice(2)}`,
    mode: request.wallet.mode,
    label:
      request.wallet.label ??
      (request.wallet.mode === "connected"
        ? "Connected wallet"
        : request.wallet.mode === "watching"
          ? "Watched wallet"
          : "Inspected wallet"),
  }
}

/** The turn's tool outcomes, rebuilt from the stored calls. */
async function rebuildOutcomes(
  testCase: BenchCase,
  record: Pick<QuestionRecord, "toolCalls">,
  wallet: StuartWallet,
): Promise<ToolOutcome[] | string> {
  const context = {
    providers: benchProviders(),
    wallet,
    query: testCase.query,
    choice: null,
    now: () => BENCH_NOW,
    secret: "bench-secret-bench-secret-bench-secret",
  }
  const outcomes: ToolOutcome[] = []
  let calls = 0
  // As claude.ts runs them: a known tool under the call limit counts.
  for (const call of record.toolCalls) {
    const tool = toolByName(call.name)
    if (tool === null || calls >= MAX_TOOL_CALLS) continue
    calls += 1
    const callId = `c${calls}`
    const executed = await tool.execute(
      { ...context, scope: new IdScope(callId) },
      call.input,
    )
    if ("invalid" in executed) continue
    if (
      call.resultDigest !== null &&
      digest(toolResultForModel(executed, callId)) !== call.resultDigest
    ) {
      return `${call.name} returned something other than what the model read`
    }
    outcomes.push(executed)
  }
  return outcomes
}

/**
 * Stuart's checks on a length-rejected sentence, length aside. Null when
 * the record's sentence was not rejected for length.
 */
export async function recheckIgnoringLength(
  testCase: BenchCase,
  record: Pick<
    QuestionRecord,
    "answerSource" | "rejectedReason" | "rawText" | "toolCalls" | "response"
  >,
): Promise<LengthRecheck | null> {
  if (
    record.answerSource !== "rejected" ||
    record.rejectedReason === null ||
    !LENGTH_REASONS.has(record.rejectedReason) ||
    record.rawText === null ||
    record.response === null
  ) {
    return null
  }
  const wallet = walletFor(testCase)
  const outcomes = await rebuildOutcomes(testCase, record, wallet)
  if (typeof outcomes === "string") {
    return { kind: "unverified", detail: outcomes }
  }
  const sourced = sourcedSetFor(
    outcomes,
    wallet.address,
    testCase.query,
    BENCH_NOW,
  )
  const draft = outcomeDraft(outcomes)
  const text = normalizeCopy(record.rawText)
  // Stuart's template, reused verbatim, is sourced as a whole.
  if (draft !== null && text === normalizeCopy(draft.answer.text)) {
    sourced.names.add(text)
  }
  const check = checkModelAnswer(
    text,
    sourced,
    record.response.intent === "mezo_help" ? SUPPORT_LIMITS : DEFAULT_LIMITS,
    { written: record.rawText, lengthExempt: true },
  )
  if (!check.ok) {
    return { kind: "rejected", reason: check.reason, detail: check.detail }
  }
  // The parts of the response Stuart's last check reads, as orchestrator.ts
  // assembles them with the sentence in.
  const evidence = [
    ...new Map(
      outcomes
        .flatMap((outcome) => outcome.evidence)
        .map((item) => [item.id, item]),
    ).values(),
  ]
  const response: StuartResponse = {
    ...record.response,
    evidence: evidence.slice(0, MAX_EVIDENCE),
    facts: outcomes.flatMap((outcome) => outcome.facts).slice(0, MAX_FACTS),
    uiBlocks: outcomes
      .flatMap((outcome) => outcome.blocks)
      .filter((block) => block.type !== "source_cluster")
      .slice(0, MAX_BLOCKS),
    why: draft?.why ?? record.response.why,
    answer: {
      ...record.response.answer,
      origin: "model",
      templateId: "claude.respond.v1",
      text,
      evidenceRefs: evidence.map((item) => item.id),
    },
  }
  const violations = sourcedViolations(response, sourced)
  // Stuart records a response it had to withdraw as unsourced.
  return violations.length > 0
    ? {
        kind: "rejected",
        reason: "unsourced",
        detail: violations.map((each) => `${each.kind}:${each.detail}`),
      }
    : { kind: "shown", text }
}

/** The record as if Stuart had shown the model's sentence. */
export function shownIgnoringLength<
  T extends Pick<
    QuestionRecord,
    "answerSource" | "rejectedReason" | "rawText" | "response"
  >,
>(record: T, text: string): T {
  if (record.response === null) return record
  const answer: StuartResponse["answer"] = {
    ...record.response.answer,
    origin: "model",
    templateId: "claude.respond.v1",
    text,
  }
  return {
    ...record,
    answerSource: "accepted",
    rejectedReason: null,
    response: { ...record.response, answer },
  }
}
