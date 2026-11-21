import {
  type Answer,
  type BusyReason,
  type Evidence,
  type Followup,
  type ParsedStuartRequest,
  type StuartResponse,
  stuartResponseSchema,
  type TraceItem,
  type UiBlock,
} from "@matchbox/stuart-ui/contract"
import type { Address } from "viem"
import { clarificationCard, resolveCard } from "./cards"
import {
  breakerRetryAfterSeconds,
  claudeBreakerOpen,
  estimateCostMicroUsd,
  type MessageCreator,
  type RespondInput,
  runClaudeTurn,
} from "./claude"
import type { StuartContext, StuartProviders, StuartWallet } from "./context"
import { normalizeCopy } from "./copy"
import { sha256Hex } from "./crypto"
import type { StuartEffort } from "./env"
import { displayBlock, listWithAnd } from "./format"
import {
  isSafetyQuestion,
  requiredSafetyNote,
  searchMezoKnowledge,
} from "./knowledge/mezo"
import { IdScope, type ToolOutcome, verifiedIdsOf } from "./outcome"
import { redactAndClip, redactingLog } from "./redact"
import { extractSlots, type RouterDecision, routeQuery } from "./router"
import { primePhraseChecksums } from "./secretShapes"
import {
  addAddresses,
  addEvidence,
  addFacts,
  addModelView,
  addProposalIds,
  addSymbols,
  addToday,
  argumentFigures,
  checkModelAnswer,
  DEFAULT_LIMITS,
  emptySourcedSet,
  numberTokens,
  type SourcedSet,
  SUPPORT_LIMITS,
  sourcedViolations,
} from "./sourced"
import { sentencesOf } from "./sourcedClaims"
import { isWarningAnswer } from "./sourcedWarnings"
import type { SpendMeter } from "./spend"
import { knowledgeOutcome } from "./tools/knowledge"
import { toolByName } from "./tools/registry"

export type StuartRuntime = {
  providers: StuartProviders
  secret: string
  now: () => Date
  // null = deterministic only (no key, kill switch, or tests).
  claude: {
    create: MessageCreator
    model: string
    effort: StuartEffort
    // Benchmark only: the turn's time budget, max_tokens per request, and
    // false to send no refusal fallback (the requested model answers).
    budgetMs?: number
    maxTokens?: number
    fallbacks?: boolean
  } | null
  // Daily model spend cap; null = unmetered (tests, local dev).
  spend?: SpendMeter | null
  // Operational progress for the SSE stream ("Reading 34 gauges").
  onStatus?: (text: string) => void
  log: (event: Record<string, unknown>) => void
  // Benchmark only: send every question to the model, as if the router had
  // recognised none, to compare models on the whole question set.
  routerOff?: boolean
}

/** A finished request: the validated answer, or "busy, try again". */
export type StuartRun =
  | {
      kind: "answer"
      response: StuartResponse
      // Resolved by the router without the model (cacheable per block).
      deterministic: boolean
    }
  | { kind: "busy"; reason: BusyReason; retryAfterSeconds: number | null }

export class StuartBusyError extends Error {
  readonly reason: BusyReason
  readonly retryAfterSeconds: number | null

  constructor(reason: BusyReason, retryAfterSeconds: number | null) {
    super(`Stuart is busy: ${reason}`)
    this.reason = reason
    this.retryAfterSeconds = retryAfterSeconds
  }
}

const ZERO = "0x0000000000000000000000000000000000000000"

const NOTICES = {
  unavailable: "Stuart reasoning is unavailable. Matchbox tools answered.",
  failed: "Stuart reasoning failed. Matchbox tools answered.",
} as const

export const UNSUPPORTED_TEXT =
  "Stuart covers Mezo Earn voting, rewards, loans and Mezo support."

function busy(
  runtime: StuartRuntime,
  reason: BusyReason,
  retryAfterSeconds: number | null,
): StuartRun {
  runtime.log({ message: "stuart.busy", reason, retryAfterSeconds })
  return { kind: "busy", reason, retryAfterSeconds }
}

type ServiceState = StuartResponse["service"]

function resolveWallet(request: ParsedStuartRequest): StuartWallet {
  if (!request.wallet) {
    return { address: ZERO, mode: "inspecting", label: "No wallet selected" }
  }
  const address = request.wallet.address
  const checksummed: Address = `0x${address.slice(2)}`
  return {
    address: checksummed,
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

function suggestions(scope: IdScope): Followup[] {
  return [
    {
      id: scope.id("f.optimize"),
      label: "Optimize my votes",
      action: { kind: "query", query: "optimize my votes" },
    },
    {
      id: scope.id("f.rewards"),
      label: "Claimable rewards",
      action: { kind: "query", query: "show my claimable rewards" },
    },
    {
      id: scope.id("f.trove"),
      label: "My mUSD trove",
      action: { kind: "query", query: "how healthy is my mUSD trove?" },
    },
  ]
}

type Draft = {
  intent: StuartResponse["intent"]
  title: string
  snapshot: { blockNumber: bigint | null; epoch: number | null; label: string }
  answer: Answer
  why: StuartResponse["why"]
  outcomes: ToolOutcome[]
  extraBlocks: UiBlock[]
  followups: Followup[]
  extraTrace: TraceItem[]
  surface: "rail" | "canvas"
  // Block ids in the order Claude asked for; empty = tool order.
  blockOrder: string[]
  // The model reused this draft's own template verbatim: sourced whole.
  reusedTemplate?: string
}

/**
 * The question the model asks back when it called no tool: its first
 * sentence ending in "?", at most 200 characters, with no digits and no
 * address. Only that question is shown, never a sentence around it, so
 * nothing states a fact the tools did not give.
 */
export function modelQuestion(respond: RespondInput | null): string | null {
  const text = respond?.answer.trim() ?? ""
  const question =
    text
      .split(/(?<=[.!?])\s+/)
      .find((sentence) => sentence.trim().endsWith("?"))
      ?.trim() ?? ""
  if (question === "" || question.length > 200) return null
  if (/\d/.test(question) || /0x/i.test(question)) return null
  // No link or domain, and a real question back: it opens with a question
  // word ("Which address...?", "Do you mean...?"), not a claim in a question.
  if (/:\/\/|www\.|\b[a-z0-9-]+\.[a-z]{2,}\b/i.test(question)) return null
  if (!QUESTION_START.test(question)) return null
  return question
}

const QUESTION_START =
  /^(?:which|who|whose|do you mean|did you mean|are you asking|could you|can you)\b/i

function unsupportedDraft(
  scope: IdScope,
  text: string,
  templateId: string,
): Draft {
  return {
    intent: "unsupported",
    title: "Stuart",
    snapshot: {
      blockNumber: null,
      epoch: null,
      label: "No financial tool called",
    },
    answer: {
      kind: "unsupported",
      origin: "template",
      templateId,
      text,
      factRefs: [],
      evidenceRefs: [],
    },
    why: null,
    outcomes: [],
    extraBlocks: [],
    followups: suggestions(scope),
    extraTrace: [],
    surface: "rail",
    blockOrder: [],
  }
}

function clarifyDraft(
  scope: IdScope,
  cardId: Parameters<typeof clarificationCard>[1],
  query: string,
): Draft {
  const card = clarificationCard(scope, cardId, extractSlots(query))
  if (!card) {
    return unsupportedDraft(
      scope,
      "Stuart needs a more specific question.",
      "clarify.unknown.v1",
    )
  }
  return {
    intent: "clarify",
    title: card.prompt,
    snapshot: {
      blockNumber: null,
      epoch: null,
      label: "No financial tool called yet",
    },
    answer: {
      kind: "clarification",
      origin: "template",
      templateId: `clarify.${cardId}.v1`,
      text: card.prompt,
      factRefs: [],
      evidenceRefs: [],
    },
    why: null,
    outcomes: [],
    extraBlocks: [card],
    followups: [],
    extraTrace: [],
    surface: "rail",
    blockOrder: [],
  }
}

function meaningfulOf(outcomes: readonly ToolOutcome[]): ToolOutcome[] {
  return outcomes.filter(
    (outcome) =>
      outcome.tool !== "resolve_entity" &&
      outcome.tool !== "get_wallet_context",
  )
}

/**
 * The outcome the answer is built on: the last tool called. When the
 * model called that tool for several subjects ("SNF and Acme"), the first
 * one that found something leads (title, why lines), as the text does,
 * not a later "nothing is labelled".
 */
function primaryOf(outcomes: readonly ToolOutcome[]): ToolOutcome | null {
  const last = meaningfulOf(outcomes).at(-1)
  if (last === undefined) return outcomes.at(-1) ?? null
  return (
    shownSiblings(outcomes, last).find((outcome) => outcome.status === "ok") ??
    last
  )
}

/** Every call of `primary`'s tool, in call order (one per subject). */
function siblingsOf(
  outcomes: readonly ToolOutcome[],
  primary: ToolOutcome,
): ToolOutcome[] {
  return meaningfulOf(outcomes).filter(
    (outcome) => outcome.tool === primary.tool && outcome.status !== "clarify",
  )
}

/** A call that read nothing: a period it could not read, or a failure. */
function unread(outcome: ToolOutcome): boolean {
  return (
    outcome.status === "error" ||
    outcome.status === "unavailable" ||
    outcome.answer.templateId.endsWith(".bad_period.v1")
  )
}

/**
 * The calls the answer shows: no can't-read call once one found
 * something (a retry after a bad period), and one per subject, the last
 * call in the place of the first (a second period for SNF replaces the
 * first, it is not shown beside it).
 */
function shownSiblings(
  outcomes: readonly ToolOutcome[],
  primary: ToolOutcome,
): ToolOutcome[] {
  const all = siblingsOf(outcomes, primary)
  const subjectKey = (outcome: ToolOutcome) =>
    outcome.subject?.trim().toLowerCase()
  const found = new Set(
    all.filter((each) => each.status === "ok").map(subjectKey),
  )
  // A can't-read call drops out beside a found one for its own subject (a
  // retry), and a period it could not read beside any found one. Another
  // subject that failed stays, so the answer still says it was asked.
  const kept =
    found.size === 0
      ? all
      : all.filter(
          (outcome) =>
            !unread(outcome) ||
            (!outcome.answer.templateId.endsWith(".bad_period.v1") &&
              outcome.subject !== undefined &&
              !found.has(subjectKey(outcome))),
        )
  const bySubject = new Map<string, ToolOutcome>()
  kept.forEach((outcome, index) => {
    const key =
      outcome.subject === undefined
        ? `#${index}`
        : outcome.subject.trim().toLowerCase()
    bySubject.set(key, outcome)
  })
  return [...bySubject.values()]
}

/** The template answer's length, as the lead tools build it. */
const TEMPLATE_CHARS = 400

/**
 * `text` cut to `room` without breaking a word or a number: whole
 * sentences when one fits, else up to a clause (", ", ": ") or, failing
 * that, a word, marked with "…".
 */
function clipText(text: string, room: number): string {
  if (text.length <= room) return text
  let kept = ""
  for (const sentence of text.split(/(?<=[.!?])\s+/)) {
    const next = kept === "" ? sentence : `${kept} ${sentence}`
    if (next.length > room) break
    kept = next
  }
  if (kept !== "") return kept
  const head = text.slice(0, Math.max(room - 1, 0))
  const clause = Math.max(head.lastIndexOf(", "), head.lastIndexOf(": "))
  const cut = clause > 0 ? clause : head.lastIndexOf(" ")
  return cut > 0 ? `${head.slice(0, cut)}…` : ""
}

/**
 * One answer for several calls of the same tool, so each subject keeps
 * its result ("SNF claimed ... Nothing on Mezo is labelled "Acme"."): in
 * call order. When they do not all fit, the others are cut to their first
 * sentence and the found ones share what is left, the shortest first so a
 * short one passes its spare room on, each cut at a sentence or clause.
 */
export function combinedAnswer(
  outcomes: readonly ToolOutcome[],
  primary: ToolOutcome,
): Omit<Answer, "origin" | "evidenceRefs"> {
  const parts: ToolOutcome[] = []
  for (const outcome of shownSiblings(outcomes, primary)) {
    if (!parts.some((each) => each.answer.text === outcome.answer.text)) {
      parts.push(outcome)
    }
  }
  if (parts.length < 2) return primary.answer
  // A failed read for another subject names it: "Acme: Token transfers
  // are unavailable right now."
  const texts = parts.map((each) => {
    const subject = each.subject?.trim()
    return unread(each) &&
      subject !== undefined &&
      subject !== "" &&
      !each.answer.text.toLowerCase().includes(subject.toLowerCase())
      ? `${subject}: ${each.answer.text}`
      : each.answer.text
  })
  const joined = () => texts.filter((text) => text !== "").join(" ")
  if (joined().length > TEMPLATE_CHARS) {
    parts.forEach((each, index) => {
      if (each.status !== "ok") {
        texts[index] = (texts[index] ?? "").split(/(?<=[.!?])\s+/)[0] ?? ""
      }
    })
  }
  if (joined().length > TEMPLATE_CHARS) {
    const found = parts
      .flatMap((each, index) => (each.status === "ok" ? [index] : []))
      .sort((a, b) => (texts[a] ?? "").length - (texts[b] ?? "").length)
    const others = texts
      .filter((_, index) => !found.includes(index))
      .reduce((sum, text) => sum + text.length, 0)
    let room = TEMPLATE_CHARS - others - (parts.length - 1)
    found.forEach((index, position) => {
      const share = Math.floor(room / (found.length - position))
      texts[index] = clipText(texts[index] ?? "", Math.max(share, 0))
      room -= texts[index]?.length ?? 0
    })
  }
  return {
    ...primary.answer,
    text: clipText(joined(), TEMPLATE_CHARS),
    factRefs: [...new Set(parts.flatMap((each) => each.answer.factRefs))],
  }
}

export function outcomeDraft(outcomes: ToolOutcome[]): Draft | null {
  const primary = primaryOf(outcomes)
  if (!primary) return null
  if (primary.status === "clarify") {
    return {
      intent: "clarify",
      title: primary.title,
      snapshot: {
        blockNumber: null,
        epoch: null,
        label: "No financial tool called yet",
      },
      answer: {
        ...primary.answer,
        origin: "template",
        evidenceRefs: [],
      },
      // What a card leaves open is explained beside it (a ballot's lines).
      why: primary.why,
      outcomes: [primary],
      extraBlocks: [],
      followups: primary.followups,
      extraTrace: [],
      surface: "rail",
      blockOrder: [],
    }
  }
  return {
    intent: primary.intent,
    title: primary.title,
    snapshot: primary.snapshot,
    answer: {
      ...combinedAnswer(outcomes, primary),
      origin: "template",
      evidenceRefs: siblingsOf(outcomes, primary).flatMap((outcome) =>
        outcome.evidence.map((item) => item.id),
      ),
    },
    why: primary.why,
    outcomes,
    extraBlocks: [],
    followups: outcomes.flatMap((outcome) => outcome.followups),
    extraTrace: [],
    surface: outcomes.some((outcome) => outcome.surface === "canvas")
      ? "canvas"
      : "rail",
    blockOrder: [],
  }
}

export function sourcedSetFor(
  outcomes: readonly ToolOutcome[],
  wallet: string,
  /**
   * The user's message this turn: it vets ballot lines "as written" and
   * never sources a number or an address.
   */
  userMessage = "",
  /** Now: today's date, which the model is given, is sourced. */
  now: Date | null = null,
): SourcedSet {
  const set = emptySourcedSet(userMessage)
  // Every symbol of the turn first: each is blanked out of every value.
  for (const outcome of outcomes) {
    addSymbols(set, outcome.facts, outcome.model)
  }
  for (const outcome of outcomes) {
    const echo =
      outcome.input === undefined ? null : argumentFigures(outcome.input)
    addFacts(set, outcome.facts, echo)
    addModelView(set, outcome.model, echo)
    addEvidence(set, outcome.evidence)
    for (const proposal of outcome.proposals) {
      addProposalIds(set, proposal.proposalId)
    }
    // An unsigned proposal for the user to sign: Stuart's own flow.
    if (outcome.proposals.length > 0) set.prepared = true
  }
  addAddresses(set, [wallet])
  if (now !== null) addToday(set, now)
  return set
}

function sanitizeFollowups(
  scope: IdScope,
  texts: readonly string[],
): Followup[] {
  return texts
    .map((text) => text.replace(/\s+/g, " ").trim())
    .filter(
      (text) =>
        text.length > 0 &&
        text.length <= 80 &&
        !/\d/.test(text) &&
        !/0x/i.test(text) &&
        checkModelAnswer(text, emptySourcedSet()).ok,
    )
    .slice(0, 3)
    .map((text, index) => ({
      id: scope.id(`f.model.${index}`),
      label: text,
      action: { kind: "query" as const, query: text },
    }))
}

/** Admits Claude's sentence only if every number in it is sourced. */
function applyModelAnswer(input: {
  draft: Draft
  respond: RespondInput
  scope: IdScope
  wallet: string
  query: string
  now: Date
  log: (event: Record<string, unknown>) => void
}): Draft {
  const { draft, respond } = input
  const sourced = sourcedSetFor(
    draft.outcomes,
    input.wallet,
    input.query,
    input.now,
  )
  const text = normalizeCopy(respond.answer)
  // The template of the answer being given, reused verbatim, is spared the
  // length limit only: the greeting, claim and unsourced checks still apply.
  const template = normalizeCopy(draft.answer.text)
  const verbatim = template === text
  // Stuart's own template is sourced as a whole, in its exact form: the
  // unsourced check still catches anything added to it.
  // The template reused whole is Stuart's own line, which it would show
  // anyway: not an instruction. A part of it is checked like any sentence,
  // since a template may print a name planted on chain.
  if (verbatim) {
    sourced.names.add(template)
    sourced.own.push(template)
  }
  const check = checkModelAnswer(
    text,
    sourced,
    draft.intent === "mezo_help" ? SUPPORT_LIMITS : DEFAULT_LIMITS,
    { written: respond.answer, lengthExempt: verbatim },
  )
  if (!check.ok) {
    input.log({
      message: "stuart.model_answer_rejected",
      reason: check.reason,
      detail: check.detail.slice(0, 5),
    })
    return draft
  }
  const evidenceByCall = new Map(
    draft.outcomes.map((outcome) => [
      outcome.evidence[0]?.id.split(".")[0] ?? "",
      outcome.evidence.map((item) => item.id),
    ]),
  )
  const evidenceRefs = respond.evidence.flatMap(
    (callId) => evidenceByCall.get(callId) ?? [],
  )
  const allEvidence = draft.outcomes.flatMap((outcome) =>
    outcome.evidence.map((item) => item.id),
  )
  const tokens = new Set(numberTokens(text))
  const factRefs = draft.outcomes
    .flatMap((outcome) => outcome.facts)
    .filter((fact) =>
      numberTokens(fact.display).some((token) => tokens.has(token)),
    )
    .map((fact) => fact.id)
  const blockIds = new Set(
    draft.outcomes.flatMap((outcome) =>
      outcome.blocks.map((block) => block.id),
    ),
  )
  const order = respond.blocks.filter((id) => blockIds.has(id))
  const modelFollowups = sanitizeFollowups(input.scope, respond.followups)
  return {
    ...draft,
    answer: {
      kind: draft.answer.kind,
      origin: "model",
      templateId: "claude.respond.v1",
      text,
      factRefs,
      evidenceRefs: evidenceRefs.length
        ? [...new Set(evidenceRefs)]
        : allEvidence,
    },
    extraBlocks: [],
    ...(verbatim ? { reusedTemplate: template } : {}),
    followups: modelFollowups.length ? modelFollowups : draft.followups,
    blockOrder: order,
  }
}

/**
 * The collapsed summary row: "Checked 1 lock and prices, block 13,103,045".
 * Null when no tool named what it looked at (the UI counts the steps).
 */
export function traceSummary(draft: {
  outcomes: readonly ToolOutcome[]
  snapshot: { blockNumber: bigint | null }
}): string | null {
  const checked = [
    ...new Set(draft.outcomes.flatMap((outcome) => outcome.checked ?? [])),
  ]
  if (checked.length === 0) return null
  const block =
    draft.snapshot.blockNumber === null
      ? ""
      : `, block ${displayBlock(draft.snapshot.blockNumber)}`
  return `Checked ${listWithAnd(checked)}${block}`.slice(0, 120)
}

function assemble(input: {
  draft: Draft
  requestId: string
  request: ParsedStuartRequest
  wallet: StuartWallet
  service: ServiceState
  now: Date
}): StuartResponse {
  const { draft } = input
  const evidence: Evidence[] = []
  const seen = new Set<string>()
  for (const item of draft.outcomes.flatMap((outcome) => outcome.evidence)) {
    if (seen.has(item.id)) continue
    seen.add(item.id)
    evidence.push(item)
  }
  const allBlocks = [
    ...draft.extraBlocks,
    ...draft.outcomes.flatMap((outcome) => outcome.blocks),
  ].filter((block) => block.type !== "source_cluster")
  const ordered = draft.blockOrder.length
    ? [
        ...draft.blockOrder.flatMap((id) =>
          allBlocks.filter((block) => block.id === id),
        ),
        ...allBlocks.filter((block) => !draft.blockOrder.includes(block.id)),
      ]
    : allBlocks
  const trace = [
    ...draft.outcomes.flatMap((outcome) => outcome.trace),
    ...draft.extraTrace,
  ].slice(0, 16)
  const scope = new IdScope("r")
  const blocks: UiBlock[] = ordered.slice(0, 10)
  if (evidence.length > 0) {
    blocks.push({
      type: "source_cluster",
      version: 1,
      id: scope.id("b.sources"),
      evidenceRefs: evidence.slice(0, 24).map((item) => item.id),
    })
  }
  if (trace.length > 0) {
    const summary = traceSummary(draft)
    blocks.push({
      type: "activity_trace",
      version: 1,
      id: scope.id("b.trace"),
      evidenceRefs: [],
      items: trace,
      ...(summary === null ? {} : { summary }),
    })
  }
  const proposals = draft.outcomes
    .flatMap((outcome) => outcome.proposals)
    .slice(0, 4)
  const rankingRows = blocks.reduce(
    (count, block) =>
      block.type === "gauge_ranking" ? count + block.rows.length : count,
    0,
  )
  return {
    version: 1,
    responseId: `q_${input.requestId}`,
    requestId: input.requestId,
    intent: draft.intent,
    title: draft.title.slice(0, 120),
    generatedAt: input.now.toISOString(),
    snapshot: {
      chainId: input.request.chainId,
      blockNumber:
        draft.snapshot.blockNumber === null
          ? null
          : draft.snapshot.blockNumber.toString(),
      epoch: draft.snapshot.epoch,
      label: draft.snapshot.label || "Live",
    },
    wallet: {
      address: input.wallet.address,
      mode: input.wallet.mode,
      label: input.wallet.label.slice(0, 80),
      network:
        input.request.chainId === 31_612 ? "Mezo Mainnet" : "Mezo Testnet",
    },
    answer: draft.answer,
    why: draft.why,
    facts: draft.outcomes.flatMap((outcome) => outcome.facts).slice(0, 64),
    evidence: evidence.slice(0, 24),
    uiBlocks: blocks.slice(0, 12),
    proposedActions: proposals,
    followups: draft.followups.slice(0, 4),
    presentation: {
      surface:
        draft.surface === "canvas" || proposals.length > 0 ? "canvas" : "rail",
      openCanvas:
        proposals.length > 0 || rankingRows >= 6 || draft.surface === "canvas",
    },
    service: input.service,
  }
}

async function executeDecision(
  decision: Extract<RouterDecision, { kind: "tool" }>,
  context: StuartContext,
  onStatus: ((text: string) => void) | undefined,
): Promise<ToolOutcome[]> {
  const tool = toolByName(decision.tool)
  if (!tool) return []
  onStatus?.(tool.status)
  const outcome = await tool.execute(
    { ...context, scope: new IdScope("c1") },
    decision.input,
  )
  if ("invalid" in outcome) return []
  for (const item of outcome.trace) onStatus?.(item.label)
  return [outcome]
}

/**
 * Without the model (no key, breaker, failure), a question the router left
 * open is still answered from the Mezo knowledge notes when one matches.
 */
function knowledgeFallback(query: string, help: boolean): ToolOutcome[] {
  const matches = searchMezoKnowledge(query)
  const [best, second] = matches
  if (best === undefined) return []
  // A data question ("compare sMUSD incentives") takes a note only on a
  // clear match: an unrelated note is worse than "unavailable".
  if (!help && (best.score < 5 || best.score - (second?.score ?? 0) < 2)) {
    return []
  }
  return [knowledgeOutcome({ scope: new IdScope("c1") }, matches)]
}

/**
 * For a safety question (a pasted or named secret, someone reaching out, a
 * scam), the best safety note in place of a draft that is not one: the
 * user sees the warning, not a claim prompt or another tool's answer.
 */
function safetyFallback(
  query: string,
  draft: Draft,
  known: ReadonlySet<string>,
): Draft | null {
  if (!isSafetyQuestion(query, known)) return null
  // A safety note already chosen stays, but never with another tool's
  // proposal (a claim card) beside it, and only the required note when one
  // fits the message alone (a secret already given away, a request to
  // claim elsewhere).
  const proposal = draft.outcomes.some(
    (outcome) => outcome.proposals.length > 0,
  )
  const required = requiredSafetyNote(query, known)
  const chosen = required === null ? "safety." : `${required}.`
  if (
    draft.answer.templateId.startsWith(`mezo_knowledge.${chosen}`) &&
    !proposal
  ) {
    return null
  }
  const matches = searchMezoKnowledge(query)
  if (matches[0]?.entry.id.startsWith("safety.") !== true) return null
  return outcomeDraft([knowledgeOutcome({ scope: new IdScope("c1") }, matches)])
}

/** The advice for a secret given away: it is exposed, use a new wallet. */
const EXPOSED_ADVICE =
  /\b(?:exposed|compromised)\b[\s\S]*\b(?:new|fresh|different|separate|clean)\s+wallet\b|\b(?:new|fresh|different|separate|clean)\s+wallet\b[\s\S]*\b(?:exposed|compromised)\b/i

/**
 * The model's own shown warning to a safety question, with every outcome
 * that prepared a proposal taken out, or null when it does not stand: not
 * a warning, a request to claim elsewhere (the redirect note says what
 * the user needs), or a secret given away or a drained wallet without the
 * advice to treat it as exposed or compromised and move to a new wallet.
 */
function keptWarning(
  query: string,
  draft: Draft,
  known: ReadonlySet<string>,
): Draft | null {
  if (!isSafetyQuestion(query, known) || draft.answer.origin !== "model") {
    return null
  }
  if (!isWarningAnswer(sentencesOf(draft.answer.text))) return null
  const required = requiredSafetyNote(query, known)
  // The redirect and phrase-holder notes say what the user needs.
  if (required === "safety.redirect" || required === "safety.phrase_holder") {
    return null
  }
  if (
    (required === "safety.secrets" || required === "safety.drained") &&
    !EXPOSED_ADVICE.test(draft.answer.text)
  ) {
    return null
  }
  return {
    ...draft,
    outcomes: draft.outcomes.map((outcome) => ({
      ...outcome,
      proposals: [],
      // A block that carries a proposal (a claim review, a vote composer)
      // is the card the user would sign from: it goes with the proposal.
      blocks: outcome.blocks.filter((block) => !("proposalId" in block)),
    })),
  }
}

/** The router's decision for a request, before any tool or model runs. */
function decide(
  request: ParsedStuartRequest,
  now: Date,
): RouterDecision | null {
  const clarification = request.context.clarification
  if (clarification && clarification.cardId !== "entity-disambiguation") {
    return resolveCard(
      clarification.cardId,
      clarification.optionId,
      extractSlots(request.query),
    )
  }
  return routeQuery(request.query, now)
}

/**
 * True when the router answers without the model (a tool, a navigation or
 * a clarification card): the answer depends only on the request and the
 * chain snapshot, so it may be cached per block.
 */
export function isDeterministicRequest(
  request: ParsedStuartRequest,
  now: Date = new Date(),
): boolean {
  if (request.chainId !== 31_612) return false
  const decision = decide(request, now)
  return (
    decision !== null &&
    (decision.kind === "tool" ||
      decision.kind === "navigate" ||
      decision.kind === "clarify")
  )
}

/** Like `runStuart`, but throws `StuartBusyError` instead of busy. */
export async function runStuartQuery(
  request: ParsedStuartRequest,
  runtime: StuartRuntime,
): Promise<StuartResponse> {
  const run = await runStuart(request, runtime)
  if (run.kind === "busy") {
    throw new StuartBusyError(run.reason, run.retryAfterSeconds)
  }
  return run.response
}

export async function runStuart(
  request: ParsedStuartRequest,
  given: StuartRuntime,
): Promise<StuartRun> {
  // Every log line of the turn is redacted: a pasted key, or one the model
  // repeats, never reaches the logs (stuart.model_answer_rejected logs the
  // model's unsourced items). Only 64-hex ids this turn's tools verified
  // (`verified`, filled as they return) stay.
  const verified = new Set<string>()
  const runtime: StuartRuntime = {
    ...given,
    log: redactingLog(given.log, verified),
  }
  const addVerified = (outcomes: readonly ToolOutcome[]) => {
    for (const id of verifiedIdsOf(outcomes)) verified.add(id)
  }
  // The router is synchronous: the BIP-39 checksums it may need are read
  // first.
  await primePhraseChecksums(request.query)
  const started = Date.now()
  const requestId = crypto.randomUUID()
  const wallet = resolveWallet(request)
  const scope = new IdScope("s")
  const context: StuartContext = {
    providers: runtime.providers,
    wallet,
    query: request.query,
    choice: null,
    now: runtime.now,
    secret: runtime.secret,
    verified,
  }
  let service: ServiceState = {
    runtime: "deterministic",
    model: null,
    degraded: false,
    notice: null,
    rateLimited: false,
  }
  let draft: Draft
  let toolsCalled: string[] = []
  let usageLog: Record<string, unknown> | null = null
  let deterministic = false
  // What became of the model's own answer (logged; the bench grades it).
  let modelAnswer:
    | "accepted"
    | "rejected"
    | "missing"
    | "clarify"
    | "question"
    | "out_of_scope"
    | "failed"
    | null = null

  if (request.chainId !== 31_612) {
    draft = unsupportedDraft(
      scope,
      "Stuart answers on Mezo mainnet only. Switch network to continue.",
      "network_unsupported.v1",
    )
  } else {
    const clarification = request.context.clarification
    if (clarification?.cardId === "entity-disambiguation") {
      context.choice = clarification.optionId.toLowerCase()
    }
    const routed = decide(request, runtime.now())
    const decision: RouterDecision | null =
      runtime.routerOff === true && routed !== null && !clarification
        ? { kind: "none", help: routed.kind === "none" && routed.help }
        : routed
    deterministic =
      decision !== null &&
      (decision.kind === "tool" ||
        decision.kind === "navigate" ||
        decision.kind === "clarify")

    if (decision === null) {
      draft = unsupportedDraft(
        scope,
        "That option is no longer available.",
        "clarify.invalid_option.v1",
      )
    } else if (decision.kind === "navigate") {
      draft = {
        ...unsupportedDraft(scope, `Open ${decision.label}.`, "navigate.v1"),
        intent: "navigate",
        title: decision.label,
        answer: {
          kind: "empty",
          origin: "template",
          templateId: "navigate.v1",
          text: `Open ${decision.label}.`,
          factRefs: [],
          evidenceRefs: [],
        },
        followups: [
          {
            id: scope.id("f.nav"),
            label: decision.label,
            action: { kind: "navigate", to: decision.to },
          },
        ],
      }
    } else if (decision.kind === "clarify") {
      draft = clarifyDraft(scope, decision.cardId, request.query)
    } else if (decision.kind === "tool") {
      const outcomes = await executeDecision(
        decision,
        context,
        runtime.onStatus,
      )
      toolsCalled = outcomes.map((outcome) => outcome.tool)
      addVerified(outcomes)
      draft =
        outcomeDraft(outcomes) ??
        unsupportedDraft(
          scope,
          "Data unavailable right now. Try again shortly.",
          "tool.failed.v1",
        )
    } else if (runtime.claude) {
      const nowMs = runtime.now().getTime()
      if (claudeBreakerOpen(nowMs)) {
        return busy(runtime, "model_busy", breakerRetryAfterSeconds(nowMs))
      }
      const spend = runtime.spend ? await runtime.spend.check() : null
      if (spend?.capped) {
        return busy(runtime, "spend_cap", spend.retryAfterSeconds)
      }
      runtime.onStatus?.("Reading the question")
      const turn = await runClaudeTurn({
        create: runtime.claude.create,
        model: runtime.claude.model,
        effort: runtime.claude.effort,
        ...(runtime.onStatus ? { onStatus: runtime.onStatus } : {}),
        context: { ...context, scope },
        query: request.query,
        page: request.context.page?.route ?? null,
        previousIntent: request.context.previous?.intent ?? null,
        nowMs: () => runtime.now().getTime(),
        onModelError: (detail) =>
          runtime.log({ message: "stuart.model_error", requestId, detail }),
        ...(runtime.claude.budgetMs === undefined
          ? {}
          : { budgetMs: runtime.claude.budgetMs }),
        ...(runtime.claude.maxTokens === undefined
          ? {}
          : { maxTokens: runtime.claude.maxTokens }),
        ...(runtime.claude.fallbacks === undefined
          ? {}
          : { fallbacks: runtime.claude.fallbacks }),
      })
      toolsCalled = turn.outcomes.map((outcome) => outcome.tool)
      addVerified(turn.outcomes)
      if (turn.kind === "failed") {
        runtime.log({
          message: "stuart.model_failed",
          requestId,
          reason: turn.reason,
        })
      }
      const cost = estimateCostMicroUsd(runtime.claude.model, turn.usage)
      usageLog = { ...turn.usage, costMicroUsd: cost.toString() }
      await runtime.spend?.record(cost).catch((error: unknown) => {
        runtime.log({
          message: "stuart.spend_record_failed",
          error:
            error instanceof Error
              ? redactAndClip(error.message, 200)
              : "unknown",
        })
      })
      if (
        turn.kind === "failed" &&
        (turn.reason === "rate_limited" || turn.reason === "overloaded")
      ) {
        return busy(
          runtime,
          "model_busy",
          breakerRetryAfterSeconds(runtime.now().getTime()),
        )
      }
      if (turn.kind === "clarify") {
        modelAnswer = "clarify"
        service = { ...service, runtime: "claude", model: runtime.claude.model }
        draft = clarifyDraft(scope, turn.cardId, request.query)
      } else if (turn.kind === "respond") {
        service = { ...service, runtime: "claude", model: runtime.claude.model }
        const base =
          outcomeDraft(turn.outcomes) ??
          (decision.help
            ? outcomeDraft(knowledgeFallback(request.query, true))
            : null)
        if (!base) {
          // No tool ran: only a short question back ("Which address is
          // the treasury?") is shown, never a claim, so nothing ungrounded
          // reaches the user; anything else is the unsupported line.
          const question = modelQuestion(turn.respond)
          modelAnswer =
            turn.respond === null
              ? "missing"
              : question === null
                ? "out_of_scope"
                : "question"
          draft =
            question === null
              ? unsupportedDraft(scope, UNSUPPORTED_TEXT, "unsupported.v1")
              : unsupportedDraft(scope, question, "model_question.v1")
        } else if (base.intent === "clarify") {
          modelAnswer = "clarify"
          draft = base
        } else if (turn.respond === null) {
          modelAnswer = "missing"
          draft = base
        } else {
          draft = applyModelAnswer({
            draft: base,
            respond: turn.respond,
            scope,
            wallet: wallet.address,
            query: request.query,
            now: runtime.now(),
            log: runtime.log,
          })
          modelAnswer =
            draft.answer.origin === "model" ? "accepted" : "rejected"
        }
      } else {
        const fallback =
          outcomeDraft(turn.outcomes) ??
          outcomeDraft(knowledgeFallback(request.query, decision.help))
        // A plain-text reply is never shown; with nothing else to show,
        // only a short question back in it is (as for a no-tool respond).
        const question =
          fallback === null &&
          turn.kind === "failed" &&
          turn.reason === "no_tool" &&
          turn.text
            ? modelQuestion({
                answer: turn.text,
                blocks: [],
                evidence: [],
                followups: [],
              })
            : null
        if (question !== null) {
          modelAnswer = "question"
          service = {
            ...service,
            runtime: "claude",
            model: runtime.claude.model,
          }
          draft = unsupportedDraft(scope, question, "model_question.v1")
        } else {
          modelAnswer = "failed"
          service = {
            ...service,
            degraded: true,
            notice: NOTICES.failed,
          }
          draft =
            fallback ??
            unsupportedDraft(scope, UNSUPPORTED_TEXT, "unsupported.v1")
        }
      }
    } else {
      service = {
        ...service,
        degraded: true,
        notice: NOTICES.unavailable,
      }
      draft =
        outcomeDraft(knowledgeFallback(request.query, decision.help)) ??
        unsupportedDraft(
          scope,
          `${UNSUPPORTED_TEXT} Try one of these.`,
          "unsupported.v1",
        )
    }
    // A safety question never ends on another tool's template or on a
    // signing step. The model's own warning is shown without any proposal
    // the turn prepared (no claim card for a wallet whose key was pasted
    // or whose seed was typed into a site). Otherwise, when the model's
    // answer was not shown, a proposal was prepared, or a note fits the
    // message alone (a secret already given away, a request to claim
    // elsewhere), the best safety note is, alone.
    const proposal = draft.outcomes.some(
      (outcome) => outcome.proposals.length > 0,
    )
    const warning = keptWarning(request.query, draft, verified)
    if (warning !== null) draft = warning
    else if (
      draft.answer.origin !== "model" ||
      proposal ||
      requiredSafetyNote(request.query, verified) !== null
    ) {
      draft = safetyFallback(request.query, draft, verified) ?? draft
    }
  }

  let response = assemble({
    draft,
    requestId,
    request,
    wallet,
    service,
    now: runtime.now(),
  })
  const turnSet = sourcedSetFor(
    draft.outcomes,
    wallet.address,
    request.query,
    runtime.now(),
  )
  if (draft.reusedTemplate) turnSet.names.add(draft.reusedTemplate)
  const violations = sourcedViolations(response, turnSet)
  if (violations.length > 0) {
    if (modelAnswer === "accepted") modelAnswer = "rejected"
    runtime.log({
      message: "stuart.unsourced_answer",
      requestId,
      violations: violations.slice(0, 5),
    })
    response = {
      ...response,
      answer: {
        kind: "unsupported",
        origin: "template",
        templateId: "unsourced.v1",
        text: "Stuart could not source an answer for this. Details are below.",
        factRefs: [],
        evidenceRefs: [],
      },
      why: null,
    }
  }
  const checked = stuartResponseSchema.safeParse(response)
  runtime.log({
    message: "stuart.query",
    requestId,
    queryHash: (await sha256Hex(request.query)).slice(0, 16),
    intent: response.intent,
    tools: toolsCalled,
    runtime: response.service.runtime,
    degraded: response.service.degraded,
    answerOrigin: response.answer.origin,
    modelAnswer,
    usage: usageLog,
    durationMs: Date.now() - started,
    schemaValid: checked.success,
  })
  if (!checked.success) {
    runtime.log({
      message: "stuart.schema_violation",
      requestId,
      issues: checked.error.issues
        .slice(0, 5)
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`),
    })
    const fallback = assemble({
      draft: unsupportedDraft(
        scope,
        "Data unavailable right now. Try again shortly.",
        "schema.v1",
      ),
      requestId,
      request,
      wallet,
      service,
      now: runtime.now(),
    })
    return { kind: "answer", response: fallback, deterministic: false }
  }
  return { kind: "answer", response: checked.data, deterministic }
}
