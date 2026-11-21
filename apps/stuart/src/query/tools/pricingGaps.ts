import { getTokenPriceType } from "@matchbox/chain"
import type { PricedTarget } from "@matchbox/domain/voteMath"
import type { Fact } from "@matchbox/stuart-ui/contract"
import { listWithAnd } from "../format"
import { type IdScope, makeFact, type ToolOutcome } from "../outcome"
import type { PriceSnapshot } from "../providers/prices"
import { assetFor } from "../providers/voting"
import {
  domainEvidence,
  errorOutcome,
  plainOutcome,
  priceEvidence,
  queryFollowup,
} from "./common"
import type { ToolContext } from "./tool"
import type { VotePlan } from "./votes"

// Why no live target has a priced incentive this epoch. Three different
// answers hide behind "nothing priced", and each needs its own words:
// - no live target has any incentive at all;
// - a reference price (MEZO or BTC) is missing right now, so registry
//   tokens that would be priced can't be valued until it is back;
// - the only incentives are tokens with no verified price (not in the
//   registry by address), which never count.

export type PricingGaps = {
  /** Live targets with at least one incentive above zero. */
  live: number
  /** Live targets with a registry token whose reference price is missing. */
  waiting: number
  /** The missing reference prices those targets need. */
  missing: Array<"MEZO" | "BTC">
  /** Live targets whose incentives are all unpriced (not `waiting`). */
  unpricedOnly: number
}

export function pricingGaps(
  priced: readonly PricedTarget[],
  prices: PriceSnapshot,
): PricingGaps {
  const missing = new Set<"MEZO" | "BTC">()
  let live = 0
  let waiting = 0
  let unpricedOnly = 0
  for (const entry of priced) {
    if (!entry.target.isAlive) continue
    const paid = entry.target.incentives.filter(
      (incentive) => incentive.amount > 0n,
    )
    if (paid.length === 0) continue
    live += 1
    let needs = false
    for (const incentive of paid) {
      const type = getTokenPriceType(incentive.token)
      if (type === "mezo" && prices.mezo.priceUsd === null) {
        missing.add("MEZO")
        needs = true
      }
      if (type === "btc-pegged" && prices.btc.priceUsd === null) {
        missing.add("BTC")
        needs = true
      }
    }
    if (needs) waiting += 1
    else if (entry.pricingStatus === "unpriced") unpricedOnly += 1
  }
  return {
    live,
    waiting,
    missing: (["MEZO", "BTC"] as const).filter((name) => missing.has(name)),
    unpricedOnly,
  }
}

function targets(count: number): string {
  return count === 1 ? "target" : "targets"
}

/**
 * Sentences (with their count facts) for the gaps: how many live targets
 * wait on a missing price and how many have only unpriced incentives.
 * Empty when neither applies.
 */
export function pricingGapNotes(input: {
  scope: IdScope
  gaps: PricingGaps
  evidenceRef: string
}): { facts: Fact[]; waiting: string | null; unpriced: string | null } {
  const { scope, gaps, evidenceRef } = input
  const facts: Fact[] = []
  let waiting: string | null = null
  let unpriced: string | null = null
  if (gaps.waiting > 0) {
    const fact = makeFact({
      scope,
      key: "gaps.waiting",
      label: "Targets waiting on a price",
      value: { kind: "count", count: gaps.waiting },
      display: String(gaps.waiting),
      status: "stale",
      evidenceRefs: [evidenceRef],
    })
    facts.push(fact)
    const names = listWithAnd(gaps.missing)
    waiting = `The ${names} ${gaps.missing.length === 1 ? "price is" : "prices are"} unavailable right now, so incentives on ${fact.display} live ${targets(gaps.waiting)} can't be valued.`
  }
  if (gaps.unpricedOnly > 0) {
    const fact = makeFact({
      scope,
      key: "gaps.unpriced",
      label: "Targets with only unpriced incentives",
      value: { kind: "count", count: gaps.unpricedOnly },
      display: String(gaps.unpricedOnly),
      status: "unpriced",
      evidenceRefs: [evidenceRef],
    })
    facts.push(fact)
    unpriced = `${fact.display} live ${targets(gaps.unpricedOnly)} ${gaps.unpricedOnly === 1 ? "has" : "have"} only unpriced incentives, tokens with no verified price.`
  }
  return { facts, waiting, unpriced }
}

/**
 * "Optimize my votes" with eligible locks but no priced target: say why
 * truthfully (a missing price, only unpriced incentives, or no incentives)
 * instead of "no lock".
 */
export function nothingToOptimizeOutcome(
  context: ToolContext,
  plan: VotePlan,
  input: { tool: string; intent: "optimize_votes" | "custom_vote" },
): ToolOutcome {
  const { scope } = context
  const asset = assetFor(plan.branch)
  const evidence = [
    domainEvidence(scope, plan.domain),
    priceEvidence(scope, plan.prices, "both"),
  ]
  const priced = [...plan.priced.values()]
  // A priced live target the optimizer still gave nothing is not one of
  // these cases: report the read as failed rather than guess a reason.
  if (
    priced.some((entry) => entry.target.isAlive && entry.incentiveMicroUsd > 0n)
  ) {
    return errorOutcome({
      scope,
      tool: input.tool,
      intent: input.intent,
      title: `Best return for my ${asset} this epoch`,
    })
  }
  const gaps = pricingGaps(priced, plan.prices)
  const notes = pricingGapNotes({
    scope,
    gaps,
    evidenceRef: evidence[1]?.id ?? "",
  })
  const reason =
    notes.waiting !== null
      ? "prices_unavailable"
      : notes.unpriced !== null
        ? "no_priced_targets"
        : "no_incentives"
  const text =
    notes.waiting !== null
      ? `${notes.waiting}${notes.unpriced ? ` ${notes.unpriced}` : ""} Try again shortly.`
      : notes.unpriced !== null
        ? `No live target has priced incentives this epoch. ${notes.unpriced} There is nothing to optimize.`
        : "No live target has incentives this epoch, so there is nothing to optimize."
  const outcome = plainOutcome({
    scope,
    tool: input.tool,
    intent: input.intent,
    status: reason === "prices_unavailable" ? "unavailable" : "empty",
    title: `Best return for my ${asset} this epoch`,
    templateId: `${input.tool}.empty.${reason}.v1`,
    text,
    kind: reason === "prices_unavailable" ? "unavailable" : "empty",
    traceLabel: "Priced live targets",
    evidence,
    followups: [
      queryFollowup(
        scope,
        "incentives",
        "Most incentives deposited",
        "which gauges have the most incentives deposited",
      ),
    ],
  })
  return withFacts(outcome, notes.facts)
}

/**
 * A ranking's empty-state text: the lead sentence, then how many live
 * targets wait on a missing price or have only unpriced incentives.
 */
export function emptyRanking(input: {
  scope: IdScope
  lead: string
  priced: readonly PricedTarget[]
  prices: PriceSnapshot
  evidenceRef: string
}): { text: string; facts: Fact[] } {
  const notes = pricingGapNotes({
    scope: input.scope,
    gaps: pricingGaps(input.priced, input.prices),
    evidenceRef: input.evidenceRef,
  })
  return {
    text: [input.lead, notes.unpriced, notes.waiting]
      .filter((part) => part !== null)
      .join(" "),
    facts: notes.facts,
  }
}

/** A plain outcome with these facts sourcing its answer. */
export function withFacts(outcome: ToolOutcome, facts: Fact[]): ToolOutcome {
  return {
    ...outcome,
    answer: { ...outcome.answer, factRefs: facts.map((fact) => fact.id) },
    facts,
  }
}

/**
 * For "most consistently funded": live targets left out because every
 * epoch they were funded in (of the window) paid only unpriced tokens or
 * less than a cent. Null when there are none.
 */
export function unfundedNote(input: {
  scope: IdScope
  count: number
  evidenceRef: string
}): { fact: Fact; text: string } | null {
  if (input.count === 0) return null
  const fact = makeFact({
    scope: input.scope,
    key: "unfunded_unpriced",
    label: "Funded only in unpriced tokens",
    value: { kind: "count", count: input.count },
    display: String(input.count),
    status: "historical",
    evidenceRefs: [input.evidenceRef],
  })
  return {
    fact,
    text: `${fact.display} live ${targets(input.count)} had only unpriced tokens or dust in those epochs, which do not count as funded.`,
  }
}
