import type { GaugePicture } from "@matchbox/contracts/read-models"
import type {
  Evidence,
  Fact,
  Followup,
  GaugeKind,
  Intent,
  UiBlock,
} from "@matchbox/stuart-ui/contract"
import type { Address } from "viem"
import { displayBlock, shortAddress } from "../format"
import {
  emptyModelView,
  type IdScope,
  makeEvidence,
  makeFact,
  type ToolOutcome,
  traceItem,
} from "../outcome"
import type { PriceSnapshot } from "../providers/prices"
import { priceSourceLabel } from "../providers/prices"
import type { VoteTarget, VotingDomain } from "../providers/voting"
import { calcChip, epochNumberFor } from "../versions"
import type { ToolContext } from "./tool"

export const ZERO_WALLET = "0x0000000000000000000000000000000000000000"

// The ranking table's "Funded" column: completed epochs, of the last 8, in
// which the target had incentives.
export const FUNDED_WINDOW = 8

/**
 * Funded epochs for just the targets a table shows (a few reads per row, not
 * the whole voter). Null when history can't be read; the column then reads
 * "—" rather than a guess.
 */
export async function fundedForRows(
  context: Pick<ToolContext, "providers">,
  domain: VotingDomain,
  targets: readonly VoteTarget[],
): Promise<Map<string, number> | null> {
  if (targets.length === 0) return new Map()
  return context.providers
    .fundedEpochs({ ...domain, targets: [...targets] }, FUNDED_WINDOW)
    .catch(() => null)
}

const KIND_BY_BRANCH: Record<VotingDomain["branch"], GaugeKind> = {
  boost: "vebtc",
  validators: "validator",
  pools: "pool",
}

/** A target's gauge type, for its icon; the branch's when unread. */
export function targetKind(
  domain: VotingDomain,
  target: VoteTarget | undefined,
): GaugeKind {
  return (
    (target && domain.kinds.get(target.targetAddress.toLowerCase())) ??
    KIND_BY_BRANCH[domain.branch]
  )
}

/** How the UI draws a target (read model picture), or null. */
export function targetPicture(
  domain: VotingDomain,
  target: VoteTarget | undefined,
): GaugePicture | null {
  if (target === undefined) return null
  return domain.pictures.get(target.targetAddress.toLowerCase()) ?? null
}

/** This epoch's incentive token addresses, for official coins (max 8). */
export function incentiveTokenAddresses(
  target: VoteTarget | undefined,
): Address[] {
  if (target === undefined) return []
  const seen = new Set<string>()
  const tokens: Address[] = []
  for (const incentive of target.incentives) {
    const key = incentive.token.toLowerCase()
    if (incentive.amount <= 0n || seen.has(key)) continue
    seen.add(key)
    tokens.push(incentive.token)
  }
  return tokens.slice(0, 8)
}

export function domainLabel(domain: VotingDomain): string {
  if (domain.branch === "boost") return "Boost gauges"
  if (domain.branch === "validators") return "Validator gauges"
  return "Pools and vaults"
}

/**
 * How many live targets carry incentives out of all targets in the domain,
 * as facts plus the sentence that prints them ("2 of 723 carry incentives
 * this epoch.").
 */
export function fundedShareFacts(input: {
  scope: IdScope
  funded: number
  total: number
  evidenceRef: string
}): { facts: Fact[]; text: string } {
  const funded = makeFact({
    scope: input.scope,
    key: "funded_targets",
    label: "Targets with incentives",
    value: { kind: "count", count: input.funded },
    display: String(input.funded),
    status: "live",
    evidenceRefs: [input.evidenceRef],
  })
  const total = makeFact({
    scope: input.scope,
    key: "all_targets",
    label: "Targets",
    value: { kind: "count", count: input.total },
    display: String(input.total),
    status: "live",
    evidenceRefs: [input.evidenceRef],
  })
  return {
    facts: [funded, total],
    text: `${funded.display} of ${total.display} carry incentives this epoch.`,
  }
}

export function domainEvidence(scope: IdScope, domain: VotingDomain): Evidence {
  return makeEvidence({
    scope,
    key: "domain",
    kind: "chain",
    label: domainLabel(domain),
    source: `${domain.source} ${shortAddress(domain.voter)}`,
    blockNumber: domain.blockNumber.toString(),
    ...(epochNumberFor(domain.epochStart) !== null
      ? { epoch: epochNumberFor(domain.epochStart) ?? 0 }
      : {}),
    fetchedAt: domain.fetchedAt,
    status: "live",
  })
}

export function priceEvidence(
  scope: IdScope,
  prices: PriceSnapshot,
  which: "btc" | "mezo" | "both",
): Evidence {
  const quotes =
    which === "both"
      ? [prices.mezo, prices.btc]
      : [which === "btc" ? prices.btc : prices.mezo]
  const stale = quotes.some((quote) => quote.priceUsd === null)
  return makeEvidence({
    scope,
    key: `price.${which}`,
    kind: "price",
    label: stale ? "Prices, partial" : "Prices",
    source: quotes.map(priceSourceLabel).join(" + "),
    fetchedAt: quotes[0]?.fetchedAt ?? new Date(0).toISOString(),
    status: stale ? "stale" : "live",
  })
}

export function calcEvidence(
  scope: IdScope,
  version: string,
  label: string,
  fetchedAt: string,
): Evidence {
  return makeEvidence({
    scope,
    key: "calc",
    kind: "calculation",
    label: calcChip(version),
    source: label,
    fetchedAt,
    status: "deterministic",
    calculationVersion: version,
  })
}

export function chainEvidence(input: {
  scope: IdScope
  key: string
  label: string
  source: string
  blockNumber: bigint
  fetchedAt: string
}): Evidence {
  return makeEvidence({
    scope: input.scope,
    key: input.key,
    kind: "chain",
    label: input.label,
    source: input.source,
    blockNumber: input.blockNumber.toString(),
    fetchedAt: input.fetchedAt,
    status: "live",
  })
}

export function sourceCluster(scope: IdScope, evidence: Evidence[]): UiBlock {
  return {
    type: "source_cluster",
    version: 1,
    id: scope.id("b.sources"),
    evidenceRefs: evidence.map((item) => item.id),
  }
}

export function snapshotLabel(input: {
  blockNumber: bigint | null
  epochStart: bigint | null
  extra?: string
}): string {
  const parts: string[] = []
  if (input.epochStart !== null) {
    const epoch = epochNumberFor(input.epochStart)
    if (epoch !== null) parts.push(`epoch ${epoch}`)
  }
  if (input.blockNumber !== null) {
    parts.push(`block ${displayBlock(input.blockNumber)}`)
  }
  if (input.extra) parts.push(input.extra)
  return parts.join(", ").slice(0, 120)
}

export function queryFollowup(
  scope: IdScope,
  key: string,
  label: string,
  query: string,
): Followup {
  return {
    id: scope.id(`f.${key}`),
    label,
    action: { kind: "query", query },
  }
}

export function navigateFollowup(
  scope: IdScope,
  key: string,
  label: string,
  to: string,
): Followup {
  return { id: scope.id(`f.${key}`), label, action: { kind: "navigate", to } }
}

/** A no-number outcome for empty, unavailable or failed tool calls. */
export function plainOutcome(input: {
  scope: IdScope
  tool: string
  intent: Intent
  status: ToolOutcome["status"]
  title: string
  templateId: string
  text: string
  kind: ToolOutcome["answer"]["kind"]
  followups?: Followup[]
  blocks?: UiBlock[]
  evidence?: Evidence[]
  traceLabel: string
  traceStatus?: "ok" | "error" | "skipped"
  notes?: string[]
}): ToolOutcome {
  return {
    tool: input.tool,
    intent: input.intent,
    status: input.status,
    title: input.title,
    snapshot: { blockNumber: null, epoch: null, label: "" },
    answer: {
      kind: input.kind,
      templateId: input.templateId,
      text: input.text,
      factRefs: [],
    },
    why: null,
    facts: [],
    evidence: input.evidence ?? [],
    blocks: input.blocks ?? [],
    proposals: [],
    followups: input.followups ?? [],
    trace: [
      traceItem({
        scope: input.scope,
        key: "main",
        label: input.traceLabel,
        tool: input.tool,
        status: input.traceStatus ?? "ok",
      }),
    ],
    model: emptyModelView(input.notes ?? [input.text]),
    surface: "rail",
  }
}

export function errorOutcome(input: {
  scope: IdScope
  tool: string
  intent: Intent
  title: string
}): ToolOutcome {
  return plainOutcome({
    ...input,
    status: "error",
    templateId: `${input.tool}.error.v1`,
    text: "Data unavailable right now. Try again shortly.",
    kind: "unavailable",
    traceLabel: "Read failed",
    traceStatus: "error",
  })
}
