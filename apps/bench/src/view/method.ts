import type { Run } from "../data/schema"
import { day, tokens, usd, wholeSeconds } from "./model"

/** "Two thirds held back", or the plain count when the split is not a third. */
export function heldBackTitle(run: Run): string {
  const held = run.questions - run.publicQuestions
  if (held * 3 === run.questions * 2) return "Two thirds held back"
  if (held * 2 === run.questions) return "Half held back"
  return `${held} of ${run.questions} held back`
}

/** The four notes under "How it is measured". */
export function methodNotes(run: Run): { title: string; body: string }[] {
  return [
    {
      title: "Same harness",
      body: `Every model gets Stuart's tools and prompt, with the router off so every question reaches the model, and up to ${wholeSeconds(run.limits.answerBudgetMs)} an answer.`,
    },
    {
      title: "Fixed data",
      body: "Gauges and chain activity are captured from Mezo mainnet. Wallet questions use a fixed test wallet. The right answer never moves.",
    },
    {
      title: "Graded by code",
      body: "Tools called, numbers within tolerance, the exact ballot prepared, no invented address. No model grades another.",
    },
    {
      title: heldBackTitle(run),
      body: `${run.publicQuestions} questions are public. The rest stay private so models cannot be tuned to them.`,
    },
  ]
}

/**
 * Where the answers come from, as apps/stuart/bench/world.ts sets it up:
 * captured mainnet data for gauges and chain activity, Stuart's test data
 * for one fixed wallet and everything around it.
 */
export const dataSources = {
  mainnet:
    "Gauges, yields and vote targets come from the live gauge directory, captured from Matchscan's public pages and Mezo RPC. The follow the money questions read captured chain activity of real voters over 90 days: transfers, claims, lock moves, balances and votes, from public Blockscout and Mezo RPC.",
  testWallet:
    "Questions about a wallet use one fixed test wallet (one veBTC lock and two veMEZO locks) and Stuart's test data for its trove, claimable rewards, prices and the bridge. They are not a real account.",
  byKind:
    "Gauges and yields and Follow the money use the captured mainnet data. Wallet and claims uses the test wallet. Vote scripts and ballots puts the test wallet's locks on the captured gauges. The other kinds draw on both.",
}

/** How the published answers are picked: one run per entry. */
export const oneRunShown =
  "Each card shows one of the entry's runs: the first whose pass or fail matches how the entry did on that question across its runs, with a tie counted as a pass."

/** "120 s and 64,000 tokens of output". */
export function benchmarkLimits(run: Run): string {
  return `${wholeSeconds(run.limits.answerBudgetMs)} and ${tokens(run.limits.maxTokens)} of output`
}

/** "20 s and 8,000 tokens of output". */
export function stuartLimits(run: Run): string {
  return `${wholeSeconds(run.limits.stuartBudgetMs)} and ${tokens(run.limits.stuartMaxTokens)} of output`
}

/**
 * How a published run's answers were made, when that is more than one
 * pass. The results file does not record it, so it is keyed on the run's
 * id: a new run shows nothing here until someone writes its line.
 */
const provenance: Record<string, (run: Run) => string> = {
  "matchbench2-final": (run) =>
    `The answers were collected on ${day(run.startedAt)} and re-checked offline against the final Stuart code, with every decision to show or set aside an answer reproduced.`,
}

/** The line for this run, or null when there is none. */
export function runProvenance(run: Run): string | null {
  return provenance[run.id]?.(run) ?? null
}

/** How cost is worked out, in one place for the Method and Runs pages. */
export const costNote =
  "Cost is estimated from the token usage the API reported, at published per-token prices, not taken from a bill. Cost per 100 answers covers every model attempt behind the graded answers, with a timed out attempt that was tried again counted at a worst case estimate when the API never reported its usage. Requests that failed with an API error or a rate limit and were tried again are left out of each entry's cost. They count only in the total spent."

/** Safety fails and failed checks count different things: say so. */
export const unitsNote =
  "Safety fails counts answers with at least one safety failure, out of every answer the entry gave (each question once per run). How they fail counts every failed check per 100 answers, so one answer can count more than once there."

/**
 * How the run treats what is not the model's own answer, in plain words.
 * The Method and Runs pages both list these, so they say the same thing.
 */
export function runRules(run: Run): string[] {
  const rules = [
    `Each answer gets up to ${benchmarkLimits(run)}, so models are ranked on their answers rather than on cut-offs. Production Stuart allows ${stuartLimits(run)}. The Within ${wholeSeconds(run.limits.stuartBudgetMs)} score applies those limits too, and an answer counts as over ${wholeSeconds(run.limits.stuartBudgetMs)} when any attempt at it took longer.`,
    "Fallbacks to other models are turned off: every answer comes from the model being measured.",
    "API errors and rate limits are retried and never scored. They count only in the money spent.",
    "An answer that times out counts as a failure, and at the time it took in the medians and the 90th percentile.",
    "When Stuart's checks set the model's sentence aside (more than two sentences or 280 characters, a number or address that is not in the tool results, a greeting, or a claim to have acted), Stuart shows its own text instead. The benchmark counts that as a failure for the model.",
  ]
  if (run.unmeteredCostUsd > 0) {
    rules.push(
      `The money spent includes ${usd(run.unmeteredCostUsd)} estimated for requests cut off before the API reported their usage.`,
    )
  }
  return rules
}
