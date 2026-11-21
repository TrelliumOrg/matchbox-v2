import type {
  Answer,
  Evidence,
  Fact,
  FactValue,
  Followup,
  Intent,
  Proposal,
  TraceItem,
  UiBlock,
  ValueStatus,
  Why,
} from "@matchbox/stuart-ui/contract"

// What every Stuart tool returns. A tool is self-presenting: it emits the
// facts, evidence, trusted blocks, unsigned proposals and a deterministic
// template answer, plus a compact view for Claude. The orchestrator merges
// outcomes and decides which answer text is shown.

export type ToolStatus = "ok" | "empty" | "unavailable" | "error" | "clarify"

export type ModelRow = Record<string, string | null>

export type ModelView = {
  // Structured display strings (numbers allowed in a model answer come only
  // from here and from fact displays).
  rows: ModelRow[]
  notes: string[]
}

export type ToolOutcome = {
  tool: string
  intent: Intent
  status: ToolStatus
  title: string
  snapshot: { blockNumber: bigint | null; epoch: number | null; label: string }
  answer: Omit<Answer, "origin" | "evidenceRefs">
  why: Why | null
  facts: Fact[]
  evidence: Evidence[]
  blocks: UiBlock[]
  proposals: Proposal[]
  followups: Followup[]
  trace: TraceItem[]
  model: ModelView
  surface: "rail" | "canvas"
  // What the tool looked at, for the collapsed summary row ("1 lock",
  // "prices", "34 gauges"). Absent: the tool names nothing.
  checked?: string[]
  // The subject the tool was asked about ("SNF"), as given: several calls
  // for one subject show only the last one.
  subject?: string
  // The arguments the model called the tool with, set by the model loop
  // (claude.ts). Figures the result only echoes from them are the model's
  // choice, not a read (sourced.ts, ECHO_RULE).
  input?: unknown
}

/** A 64-hex id: what verified ids look like. */
const ID_64 = /^0x[0-9a-f]{64}$/

/** A Matchscan or Mezo explorer link to a transaction or a block. */
const ID_URL =
  /^https:\/\/(?:scan\.matchbox\.markets|explorer\.mezo\.org)\/(?:tx|block)\/(0x[0-9a-fA-F]{64})(?:[/?#]|$)/

/** Model rows whose values are hashes a provider returned. */
const ID_ROW_KEY = /^(?:tx|hash|txHash|transactionHash|blockHash)$/

/**
 * The 64-hex ids a turn's tools verified: transaction and block links in
 * their evidence, and hash fields of their rows (chain reads). Never the
 * model's arguments or any text the user wrote: those are what redaction
 * guards against, and nothing the user typed is looked up to confirm it.
 */
export function verifiedIdsOf(outcomes: readonly ToolOutcome[]): string[] {
  const ids = new Set<string>()
  const add = (value: unknown) => {
    if (typeof value !== "string") return
    const id = value.toLowerCase()
    if (ID_64.test(id)) ids.add(id)
  }
  for (const outcome of outcomes) {
    for (const evidence of outcome.evidence) {
      const link = ID_URL.exec(evidence.url ?? "")
      if (link) add(link[1])
    }
    for (const row of outcome.model.rows) {
      for (const [key, value] of Object.entries(row)) {
        if (ID_ROW_KEY.test(key)) add(value)
      }
    }
  }
  return [...ids]
}

// Row keys whose values are untrusted text: names read from chain or typed
// by the user (profile names, symbols, contract and label names, a ballot
// line as written). Their digits, addresses and dates never count as
// sourced. A tool puts every such name in a field of its own, named
// "name", "label" or "symbol", or ending in "Name", "Label" or "Symbol"
// ("gaugeName", "destinationName"), and composes every other value from
// typed values only (plantedNames.test.ts runs every tool to check it).
export const UNTRUSTED_MODEL_KEYS = new Set(["name", "label", "symbol"])

export function isUntrustedModelKey(key: string): boolean {
  return (
    UNTRUSTED_MODEL_KEYS.has(key) || /[a-z](?:Name|Label|Symbol)$/.test(key)
  )
}

/** Scopes fact/evidence/block ids to one tool call so outcomes merge cleanly. */
export class IdScope {
  readonly prefix: string

  constructor(prefix: string) {
    this.prefix = prefix
  }

  id(local: string): string {
    return `${this.prefix}.${local}`.slice(0, 40)
  }
}

export function makeFact(input: {
  scope: IdScope
  key: string
  label: string
  value: FactValue
  display: string
  status: ValueStatus
  evidenceRefs: string[]
}): Fact {
  return {
    id: input.scope.id(input.key),
    label: input.label.slice(0, 60),
    value: input.value,
    display: input.display.slice(0, 60),
    status: input.status,
    evidenceRefs: input.evidenceRefs,
  }
}

export function makeEvidence(
  input: Omit<Evidence, "id"> & { scope: IdScope; key: string },
): Evidence {
  const { scope, key, ...rest } = input
  return {
    ...rest,
    id: scope.id(`e.${key}`),
    label: rest.label.slice(0, 60),
    source: rest.source.slice(0, 120),
  }
}

export function traceItem(input: {
  scope: IdScope
  key: string
  label: string
  detail?: string | null
  tool: string | null
  startedAt?: number
  now?: number
  status?: TraceItem["status"]
}): TraceItem {
  return {
    id: input.scope.id(`t.${input.key}`),
    label: input.label.slice(0, 120),
    detail: input.detail ? input.detail.slice(0, 160) : null,
    tool: input.tool,
    durationMs:
      input.startedAt !== undefined && input.now !== undefined
        ? Math.max(0, Math.round(input.now - input.startedAt))
        : null,
    status: input.status ?? "ok",
  }
}

export function emptyModelView(notes: string[] = []): ModelView {
  return { rows: [], notes }
}
