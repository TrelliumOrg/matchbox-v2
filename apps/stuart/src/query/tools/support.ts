import type {
  SupportReportDraft,
  SupportReportItem,
} from "@matchbox/stuart-ui/contract"
import { z } from "zod"
import { canonicalJson, hmacHex } from "../crypto"
import { clipName, shortAddress } from "../format"
import { makeEvidence, type ToolOutcome, traceItem } from "../outcome"
import { redactAndClip, redactSecrets } from "../redact"
import {
  CLAIM_CALC_VERSION,
  LOAN_CALC_VERSION,
  OPTIMIZER_CALC_VERSION,
  ZAP_CALC_VERSION,
} from "../versions"
import { ZERO_WALLET } from "./common"
import { defineTool } from "./tool"

const reportKindSchema = z.enum([
  "claim",
  "vote",
  "loan",
  "zap",
  "bridge",
  "data",
  "other",
])

export function draftTokenMessage(
  draft: Omit<SupportReportDraft, "draftToken">,
): string {
  return `support-draft|${canonicalJson(draft)}`
}

function guessKind(text: string): SupportReportDraft["kind"] {
  const lower = text.toLowerCase()
  if (/\bclaim/.test(lower)) return "claim"
  if (/\bvot/.test(lower)) return "vote"
  if (/\b(trove|loan|repay|liquidat)/.test(lower)) return "loan"
  if (/\b(zap|vault|savings|deposit|swap)/.test(lower)) return "zap"
  if (/\b(bridge|wormhole)/.test(lower)) return "bridge"
  if (/\b(wrong|missing|stale|data|number)/.test(lower)) return "data"
  return "other"
}

/** Said in the draft when a long hex value was taken out. */
export const HEX_REMOVED_NOTE =
  "A long hex value was removed for safety. You can add a transaction hash in the ticket."

export const draftSupportReportTool = defineTool({
  name: "draft_support_report",
  family: "support",
  description:
    "Draft a support report preview when Stuart cannot reconcile or answer an issue. Nothing is sent: the user reviews, edits and presses Submit report.",
  input: z.object({
    problem: z.string().min(1).max(2_000).describe("The user's own words."),
    kind: reportKindSchema.nullable(),
  }),
  async run(context, input) {
    const { scope, wallet } = context
    // A key or phrase pasted into the message never reaches the stored
    // report: the draft holds a marker in its place. A 64-hex string stays
    // only when this turn's tools returned it (a chain read, an evidence
    // link). Nothing the user typed is looked up anywhere: a lookup would
    // put a key in the request logs of the API Worker and the explorer.
    const verified = context.verified ?? new Set<string>()
    const options = { verified, mode: "report" } as const
    const redacted = redactSecrets(input.problem, options)
    const problem = redacted.text
    const message = redactSecrets(context.query, options)
    const hexRemoved =
      redacted.reasons.includes("hex_key") ||
      message.reasons.includes("hex_key")
    const statement = hexRemoved
      ? `${problem.slice(0, 2_000 - HEX_REMOVED_NOTE.length - 2)}\n\n${HEX_REMOVED_NOTE}`
      : problem.slice(0, 2_000)
    const items: SupportReportItem[] = [
      {
        itemId: "message",
        kind: "message",
        label: "This message",
        value: redactAndClip(context.query, 400, options),
        removable: true,
      },
    ]
    if (wallet.address !== ZERO_WALLET) {
      items.push({
        itemId: "wallet",
        kind: "wallet",
        label: `Wallet ${shortAddress(wallet.address)}, Mezo mainnet`,
        value: wallet.address,
        removable: true,
      })
    }
    items.push({
      itemId: "versions",
      kind: "indexer_status",
      label: `Calc versions: optimizer ${OPTIMIZER_CALC_VERSION}, loans ${LOAN_CALC_VERSION}`,
      value: `optimizer=${OPTIMIZER_CALC_VERSION};loans=${LOAN_CALC_VERSION};zap=${ZAP_CALC_VERSION};claims=${CLAIM_CALC_VERSION}`,
      removable: true,
    })
    const unsigned: Omit<SupportReportDraft, "draftToken"> = {
      draftId: `draft_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`,
      createdAt: context.now().toISOString(),
      chainId: 31_612,
      kind: input.kind ?? guessKind(problem),
      title: clipName(problem, 120),
      problemStatement: statement,
      included: items,
    }
    const draft: SupportReportDraft = {
      ...unsigned,
      draftToken: await hmacHex(context.secret, draftTokenMessage(unsigned)),
    }
    return {
      tool: "draft_support_report",
      intent: "support_report",
      status: "ok",
      title: draft.title,
      snapshot: {
        blockNumber: null,
        epoch: null,
        label: "Support report preview, nothing sent yet",
      },
      answer: {
        kind: "result",
        templateId: "draft_support_report.lead.v1",
        text: "Nothing has been sent. Preview is the report.",
        factRefs: [],
      },
      why: null,
      facts: [],
      evidence: [
        makeEvidence({
          scope,
          key: "draft",
          kind: "calculation",
          label: "Report draft, not sent",
          source: "Matchbox support draft",
          fetchedAt: context.now().toISOString(),
          status: "deterministic",
        }),
      ],
      blocks: [
        {
          type: "support_report_preview",
          version: 1,
          id: scope.id("b.report"),
          evidenceRefs: [scope.id("e.draft")],
          draft,
          excludedSummary: "history_watchlist_rpc",
          sent: false,
          contactMethods: ["thread_only", "email"],
        },
      ],
      proposals: [],
      followups: [],
      trace: [
        traceItem({
          scope,
          key: "draft",
          label: "Drafted a support report preview",
          tool: "draft_support_report",
        }),
      ],
      model: {
        rows: [],
        notes: ["Draft only. The user must press Submit report."],
      },
      surface: "canvas",
    } satisfies ToolOutcome
  },
})
