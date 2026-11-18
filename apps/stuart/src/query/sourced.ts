import type { Fact, StuartResponse } from "@matchbox/stuart-ui/contract"
import { parseBallotScript } from "./ballotScript"
import { type ModelView, UNTRUSTED_MODEL_KEYS } from "./outcome"

// Sourced-by-construction checks. Every digit Stuart shows must trace back to
// a fact (template answers) or to a structured value a tool returned in this
// turn (model answers). Addresses are checked the same way.

const ADDRESS_PATTERN = /0x[0-9a-fA-F]{3,}(?:…|\.\.\.)?[0-9a-fA-F]*/g
const NUMBER_PATTERN = /\d[\d,]*(?:\.\d+)?/g

/** "1,024.80" → "1024.8", "042" → "42", "0.50" → "0.5". */
export function canonicalNumber(token: string): string {
  const plain = token.replace(/,/g, "")
  const [whole = "0", fraction = ""] = plain.split(".")
  const trimmedWhole = whole.replace(/^0+(?=\d)/, "")
  const trimmedFraction = fraction.replace(/0+$/, "")
  return trimmedFraction ? `${trimmedWhole}.${trimmedFraction}` : trimmedWhole
}

export function addressTokens(text: string): string[] {
  return [...text.matchAll(ADDRESS_PATTERN)].map((match) => match[0])
}

export function numberTokens(text: string): string[] {
  const withoutAddresses = text.replace(ADDRESS_PATTERN, " ")
  return [...withoutAddresses.matchAll(NUMBER_PATTERN)].map((match) =>
    canonicalNumber(match[0]),
  )
}

export type SourcedSet = {
  numbers: Set<string>
  addresses: string[]
  /**
   * Names in this turn's results whose digits are part of the name, not a
   * number to source: written exactly, they pass. Pool names whose only
   * digits are the pool type ("mUSDC/MUSD CL10"), a ballot line the user
   * wrote ("BTC/MUSD-300", from a row's label or an "As written" fact, only
   * when it is a whole ballot target of the user's message) and a prepared
   * proposal's id.
   */
  names: Set<string>
  /**
   * The ballot targets the user's own message names, lowercased: the target
   * of each "N% to X" line the ballot parser finds in it ("vote 100% to
   * BTC/MUSD-300" gives "btc/musd-300"). They vet "as written" names only:
   * tool arguments are the model's, so a line counts as the user's only if
   * it is one of these, whole. They never source a number or an address.
   */
  userTargets: Set<string>
}

export function emptySourcedSet(userMessage = ""): SourcedSet {
  return {
    numbers: new Set(),
    addresses: [],
    names: new Set(),
    userTargets: new Set(
      parseBallotScript(userMessage).lines.map((line) =>
        line.target.toLowerCase(),
      ),
    ),
  }
}

const POOL_NAME = /^[^\d\n]{1,60} CL\d{1,5}$/
const PROPOSAL_ID =
  /\b(?:vote|claim|lock|zap|repay|relock|surplus)_[0-9a-f]{8}\b/g
/** Labels "as written" by the user: a line or name, quoted as it was. */
const AS_WRITTEN_LABELS = new Set(["As written"])

function addPoolName(set: SourcedSet, text: string): void {
  const name = text.trim()
  if (POOL_NAME.test(name)) set.names.add(name)
}

/**
 * A digit standing free, not attached to a name: "7 BTC", "$5000 bonus",
 * "Your 10000 MUSD". In "BTC/MUSD-300" or "CL200" every digit follows a
 * letter, a digit, "-" or "/".
 */
const FREE_DIGIT = /(?<![\p{L}\d\-/])\d/u

/**
 * A ballot line as written, kept exactly. The tool echoes the model's
 * argument, so it counts only when it is a whole ballot target the user
 * wrote (case aside), never a piece of the user's text, and only when each
 * of its digits belongs to a name: "BTC/MUSD-300", never "300", "7 BTC" or
 * "MUSD-300" cut from "BTC/MUSD-300". Its digits vouch for nothing else.
 */
function addWrittenName(set: SourcedSet, text: string): void {
  const name = text.trim()
  if (
    name.length > 0 &&
    name.length <= 80 &&
    /\d/.test(name) &&
    /\p{L}/u.test(name) &&
    !FREE_DIGIT.test(name) &&
    set.userTargets.has(name.toLowerCase())
  ) {
    set.names.add(name)
  }
}

/** A prepared proposal's id, from the outcome's proposals only. */
export function addProposalIds(set: SourcedSet, text: string): void {
  for (const match of text.matchAll(PROPOSAL_ID)) set.names.add(match[0])
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")
}

/**
 * The text with exact names from the results stripped of digits. A name
 * only counts where it starts and ends: "CL10" in "CL100", "CL10k",
 * "CL10%", "CL10 %" or "CL10.5" is not the name "... CL10".
 */
function withoutNames(text: string, set: SourcedSet): string {
  let masked = text
  const names = [...set.names].sort((a, b) => b.length - a.length)
  for (const name of names) {
    const exact = new RegExp(
      `(?<![\\p{L}\\d])${escapeRegExp(name)}(?![\\p{L}\\d%]|\\s*%|[.,]\\d)`,
      "gu",
    )
    masked = masked.replace(exact, name.replace(/\d/g, ""))
  }
  return masked
}

function addText(set: SourcedSet, text: string): void {
  for (const token of numberTokens(text)) set.numbers.add(token)
  for (const address of addressTokens(text)) {
    set.addresses.push(address.toLowerCase())
  }
}

export function addFacts(set: SourcedSet, facts: readonly Fact[]): void {
  for (const fact of facts) {
    // Entity names are untrusted text: their digits don't vouch for numbers.
    if (fact.value.kind === "text") {
      if (AS_WRITTEN_LABELS.has(fact.label)) addWrittenName(set, fact.display)
      else addPoolName(set, fact.display)
      continue
    }
    addText(set, fact.display)
  }
}

export function addModelView(set: SourcedSet, view: ModelView): void {
  for (const row of view.rows) {
    for (const [key, value] of Object.entries(row)) {
      if (value === null) continue
      if (UNTRUSTED_MODEL_KEYS.has(key)) {
        // A row's name may be a pool name; its label is a line as the user
        // wrote it, a name in its exact form. Neither vouches for numbers,
        // and a symbol never does.
        if (key === "name") addPoolName(set, value)
        if (key === "label") addWrittenName(set, value)
        continue
      }
      addText(set, value)
    }
  }
}

export function addAddresses(set: SourcedSet, addresses: readonly string[]) {
  for (const address of addresses) set.addresses.push(address.toLowerCase())
}

function addressIsKnown(token: string, known: readonly string[]): boolean {
  const lower = token.toLowerCase()
  const [head = "", tail = ""] = lower.split(/…|\.\.\./)
  if (!tail) return known.some((address) => address.startsWith(head))
  return known.some(
    (address) => address.startsWith(head) && address.endsWith(tail),
  )
}

export function unsourcedTokens(text: string, set: SourcedSet): string[] {
  const missingNumbers = numberTokens(withoutNames(text, set)).filter(
    (token) => !set.numbers.has(token),
  )
  const missingAddresses = addressTokens(text).filter(
    (token) => !addressIsKnown(token, set.addresses),
  )
  return [...missingNumbers, ...missingAddresses]
}

const GREETING =
  /^\s*(hi|hello|hey|sure|great|certainly|of course|absolutely|happy to|i'd be happy|thanks)\b/i
export const SUBMISSION_CLAIM =
  /\b(stuart|i|we|matchbox)\s+(have\s+|has\s+|just\s+)?(submitted|sent|signed|executed|broadcast|placed|cast)\b|\b(was|were|has been|have been)\s+(submitted|sent|executed|broadcast)\b/i

export type ModelAnswerCheck =
  | { ok: true }
  | {
      ok: false
      reason:
        | "empty"
        | "too_many_sentences"
        | "too_long"
        | "greeting"
        | "claim"
        | "unsourced"
      detail: string[]
    }

/** Answer limits: two short sentences, three (400 chars) for Mezo support. */
export type AnswerLimits = { sentences: number; chars: number }

export const DEFAULT_LIMITS: AnswerLimits = { sentences: 2, chars: 280 }
export const SUPPORT_LIMITS: AnswerLimits = { sentences: 3, chars: 400 }

export function checkModelAnswer(
  text: string,
  sourced: SourcedSet,
  limits: AnswerLimits = DEFAULT_LIMITS,
  options: {
    /**
     * The sentence as the model wrote it, before semicolons became commas
     * for display: a semicolon still ends a sentence for the limit.
     */
    written?: string
    /** A tool's own template, reused: no length limit, every other check. */
    lengthExempt?: boolean
  } = {},
): ModelAnswerCheck {
  const trimmed = text.trim()
  if (!trimmed) return { ok: false, reason: "empty", detail: [] }
  const sentences = (options.written ?? trimmed)
    .replace(/;/g, ". ")
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) => sentence.trim().length > 0)
  if (!options.lengthExempt && sentences.length > limits.sentences) {
    return {
      ok: false,
      reason: "too_many_sentences",
      detail: [`${sentences.length}`],
    }
  }
  if (!options.lengthExempt && trimmed.length > limits.chars) {
    return { ok: false, reason: "too_long", detail: [`${trimmed.length}`] }
  }
  if (GREETING.test(trimmed))
    return { ok: false, reason: "greeting", detail: [] }
  if (SUBMISSION_CLAIM.test(trimmed)) {
    return { ok: false, reason: "claim", detail: [] }
  }
  const missing = unsourcedTokens(trimmed, sourced)
  if (missing.length > 0) {
    return { ok: false, reason: "unsourced", detail: missing }
  }
  return { ok: true }
}

export type SourcedViolation = {
  kind:
    | "answer_number"
    | "why_number"
    | "fact_evidence"
    | "block_evidence"
    | "answer_evidence"
    | "result_without_evidence"
  detail: string
}

/**
 * The invariant every response passes before it leaves the Worker. Template
 * answers may only print numbers held by the facts they reference.
 */
export function sourcedViolations(
  response: StuartResponse,
  turnSet: SourcedSet,
): SourcedViolation[] {
  const violations: SourcedViolation[] = []
  const evidenceIds = new Set(response.evidence.map((item) => item.id))
  const factsById = new Map(response.facts.map((fact) => [fact.id, fact]))

  for (const fact of response.facts) {
    for (const ref of fact.evidenceRefs) {
      if (!evidenceIds.has(ref)) {
        violations.push({ kind: "fact_evidence", detail: `${fact.id}:${ref}` })
      }
    }
  }
  for (const block of response.uiBlocks) {
    for (const ref of block.evidenceRefs) {
      if (!evidenceIds.has(ref)) {
        violations.push({
          kind: "block_evidence",
          detail: `${block.id}:${ref}`,
        })
      }
    }
  }
  for (const ref of response.answer.evidenceRefs) {
    if (!evidenceIds.has(ref)) {
      violations.push({ kind: "answer_evidence", detail: ref })
    }
  }
  if (response.answer.kind === "result" && response.evidence.length === 0) {
    violations.push({ kind: "result_without_evidence", detail: "" })
  }

  function referencedSet(refs: readonly string[]): SourcedSet {
    const set = emptySourcedSet()
    const facts = refs.flatMap((ref) => {
      const fact = factsById.get(ref)
      return fact ? [fact] : []
    })
    for (const fact of facts) {
      for (const token of numberTokens(fact.display)) set.numbers.add(token)
      for (const address of addressTokens(fact.display)) {
        set.addresses.push(address.toLowerCase())
      }
    }
    addAddresses(set, [response.wallet.address])
    return set
  }

  // Model answers are held to everything the turn's tools returned (facts and
  // structured row values); template answers to the facts they reference.
  const answerSet =
    response.answer.origin === "model"
      ? turnSet
      : referencedSet(response.answer.factRefs)
  for (const token of unsourcedTokens(response.answer.text, answerSet)) {
    violations.push({ kind: "answer_number", detail: token })
  }
  for (const item of response.why?.items ?? []) {
    const set = referencedSet(item.factRefs)
    for (const token of unsourcedTokens(item.text, set)) {
      violations.push({ kind: "why_number", detail: token })
    }
  }
  return violations
}
