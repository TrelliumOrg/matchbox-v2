import type { Evidence, Fact } from "@matchbox/stuart-ui/contract"
import { z } from "zod"
import {
  type KnowledgeMatch,
  MEZO_KNOWLEDGE_CHECKED_AT,
  MEZO_KNOWLEDGE_VERSION,
  searchMezoKnowledge,
} from "../knowledge/mezo"
import { makeEvidence, makeFact, type ToolOutcome, traceItem } from "../outcome"
import { plainOutcome, sourceCluster } from "./common"
import { defineTool, type ToolContext } from "./tool"

// Mezo support knowledge as citable evidence: how Mezo Earn, veBTC,
// veMEZO, boost, MEZO gauges, MUSD, Morpho and Enclaves work, contract
// behaviour that trips users up, and safety rules. Each entry carries its
// sources; the answer template is the best entry's reviewed answer.

const TOOL = "mezo_knowledge"
const MAX_EVIDENCE = 6

/** The outcome for a set of matches (shared with the no-model fallback). */
export function knowledgeOutcome(
  context: Pick<ToolContext, "scope">,
  matches: readonly KnowledgeMatch[],
): ToolOutcome {
  const { scope } = context
  const best = matches[0]
  if (best === undefined) {
    return plainOutcome({
      scope,
      tool: TOOL,
      intent: "mezo_help",
      status: "empty",
      title: "Mezo docs",
      templateId: "mezo_knowledge.none.v2",
      text: "No reviewed Mezo note covers that. For other Mezo questions, open a ticket in Mezo's Discord.",
      kind: "empty",
      traceLabel: "No matching Mezo note",
    })
  }
  const evidence: Evidence[] = []
  const seen = new Set<string>()
  for (const [index, match] of matches.entries()) {
    for (const source of match.entry.sources) {
      if (seen.has(source.url) || evidence.length >= MAX_EVIDENCE) continue
      seen.add(source.url)
      evidence.push(
        makeEvidence({
          scope,
          key: `doc.${index}.${evidence.length}`,
          kind: "docs",
          label: source.label,
          source: `${match.entry.title}, knowledge ${MEZO_KNOWLEDGE_VERSION}`,
          url: source.url,
          fetchedAt: MEZO_KNOWLEDGE_CHECKED_AT,
          status: "finalized",
        }),
      )
    }
  }
  const facts: Fact[] = matches.flatMap((match, entryIndex) =>
    match.entry.facts.map((fact, factIndex) =>
      makeFact({
        scope,
        key: `k.${entryIndex}.${factIndex}`,
        label: fact.label,
        value: { kind: "text", text: fact.display },
        display: fact.display,
        status: "finalized",
        evidenceRefs: evidence
          .filter((item) =>
            match.entry.sources.some((source) => source.url === item.url),
          )
          .map((item) => item.id),
      }),
    ),
  )
  return {
    tool: TOOL,
    intent: "mezo_help",
    status: "ok",
    title: best.entry.title,
    snapshot: {
      blockNumber: null,
      epoch: null,
      label: `Mezo knowledge ${MEZO_KNOWLEDGE_VERSION}`,
    },
    answer: {
      kind: "result",
      templateId: `mezo_knowledge.${best.entry.id}.v1`,
      text: best.entry.answer,
      factRefs: facts
        .filter((fact) => fact.id.startsWith(scope.id("k.0.")))
        .map((fact) => fact.id),
    },
    why: null,
    facts,
    evidence,
    blocks: [sourceCluster(scope, evidence)],
    proposals: [],
    followups: [],
    trace: [
      traceItem({
        scope,
        key: "docs",
        label: `Matched ${matches.length} Mezo ${matches.length === 1 ? "note" : "notes"}`,
        tool: TOOL,
      }),
    ],
    model: {
      rows: matches.map((match) => ({
        topic: match.entry.title,
        answer: match.entry.answer,
        detail: match.entry.detail.join(" ") || null,
        sources: match.entry.sources.map((source) => source.label).join(", "),
      })),
      notes: [],
    },
    surface: "rail",
    checked: ["Mezo docs"],
  }
}

export const mezoKnowledgeTool = defineTool({
  name: TOOL,
  family: "knowledge",
  description:
    "Reviewed Mezo support notes with sources: how veBTC, veMEZO, boost, BoostVoter and ThirdPartyVoter, epochs, voting rules and reverts, claiming, MEZO gauges, MUSD troves, Morpho borrowing, Enclaves, MUSD Savings and gas work, plus safety rules (NFT approvals, relayers). Use it for how-to, why and troubleshooting questions. question: the user's question in their words.",
  input: z.object({ question: z.string().min(1).max(300) }),
  async run(context, input) {
    return knowledgeOutcome(context, searchMezoKnowledge(input.question))
  },
})
