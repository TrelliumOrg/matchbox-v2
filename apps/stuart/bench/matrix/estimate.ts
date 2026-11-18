import type { BenchEffort } from "@matchbox/contracts/bench"
import { MAX_ROUNDS, rateFor } from "../../src/query/claude"

// Cost planning for the matrix, before any paid call.
//
// Calibrated on the paid Haiku 5.5 runs of 17 Nov 2026, the second one
// with the 120 s budget and 64,000 max_tokens (337 answers, mostly vote
// scripts, so on the heavy side): about 2 model calls per answer (2.4 at
// max), each reading the ~10,500-token cached prefix (system prompt and
// tools) at the cache read rate, with the prefix written about once per
// entry. Uncached input and output per answer, by effort, are the measured
// means. Sonnet and Opus are assumed to use as many tokens as Haiku at the
// same level; real usage is metered during the run, and after ten answers
// an entry's estimate uses its own measured cost.

export const PREFIX_TOKENS = 10_500

export const TOKENS_PER_ANSWER: Record<
  BenchEffort,
  { calls: number; input: number; output: number }
> = {
  low: { calls: 2, input: 1_710, output: 640 },
  medium: { calls: 2, input: 1_840, output: 740 },
  high: { calls: 2.1, input: 2_060, output: 1_010 },
  xhigh: { calls: 2.3, input: 2_720, output: 1_770 },
  // Unbounded by Stuart's 20 s, max thinks far longer.
  max: { calls: 2.4, input: 6_250, output: 8_940 },
}

/** Share of answers that write the cached prefix in a matrix run. */
export const MATRIX_CACHE_WRITE_SHARE = 0.01

/**
 * Estimated USD for `answers` model answers. `cacheWriteShare` is the
 * share of answers that write the prefix: about one per entry in the
 * matrix, every answer for questions far apart, as in production.
 */
export function estimateUsd(
  model: string,
  answers: number,
  effort: BenchEffort = "low",
  cacheWriteShare = MATRIX_CACHE_WRITE_SHARE,
): number {
  const rate = rateFor(model)
  const tokens = TOKENS_PER_ANSWER[effort]
  const perAnswer =
    Number(rate.write) * PREFIX_TOKENS * cacheWriteShare +
    Number(rate.read) * PREFIX_TOKENS * (tokens.calls - cacheWriteShare) +
    Number(rate.input) * tokens.input +
    Number(rate.output) * tokens.output
  return (perAnswer * answers) / 1e9
}

/** Uncached input a request can carry at most (tool results, thinking). */
const WORST_INPUT_TOKENS = 30_000
/** Faster than any model writes: bounds output by the time budget. */
const WORST_OUTPUT_TOKENS_PER_SECOND = 200

function outputBound(maxTokens: number, budgetMs: number): number {
  return Math.min(
    maxTokens,
    Math.ceil((WORST_OUTPUT_TOKENS_PER_SECOND * budgetMs) / 1000),
  )
}

/**
 * The most one request can cost: the prefix written, a long conversation,
 * and as much output as max_tokens and the time budget allow. Counted for a
 * request cut off before the API reported its usage.
 */
export function worstRequestUsd(
  model: string,
  maxTokens: number,
  budgetMs: number,
): number {
  const rate = rateFor(model)
  return (
    (Number(rate.write) * PREFIX_TOKENS +
      Number(rate.input) * WORST_INPUT_TOKENS +
      Number(rate.output) * outputBound(maxTokens, budgetMs)) /
    1e9
  )
}

/** The most one answer (every round of one attempt) can cost: reserved. */
export function worstAnswerUsd(
  model: string,
  maxTokens: number,
  budgetMs: number,
): number {
  const rate = rateFor(model)
  return (
    (MAX_ROUNDS *
      (Number(rate.write) * PREFIX_TOKENS +
        Number(rate.input) * WORST_INPUT_TOKENS) +
      Number(rate.output) * outputBound(MAX_ROUNDS * maxTokens, budgetMs)) /
    1e9
  )
}
