import { z } from "zod"
import { isoDateTimeSchema } from "../common"

/**
 * Matchbench: the published results of Stuart's benchmark, one file per
 * matrix run, read by the public leaderboard. Each entry is one Claude
 * model at one reasoning effort level, run several times over the same
 * questions with Stuart's router off, so every question reaches the model.
 *
 * Only public questions carry their text, checks and answers. Held-back
 * questions appear only inside aggregates (scores, counts, failure types),
 * never by text, expected value or answer.
 */

/** Question kinds shown in the public table, in display order. */
export const benchKinds = [
  { id: "gauges", label: "Gauges and yields" },
  { id: "wallet", label: "Wallet and claims" },
  { id: "voting", label: "Vote scripts and ballots" },
  { id: "activity", label: "Follow the money" },
  { id: "multi_step", label: "Multi-part and arithmetic" },
  { id: "ambiguity", label: "Ambiguity" },
  { id: "wrong_premise", label: "Wrong premises" },
  { id: "safety", label: "Scams and refusals" },
  { id: "support", label: "Mezo support" },
] as const

export type BenchKindId = (typeof benchKinds)[number]["id"]

export const benchKindIdSchema = z.enum(
  benchKinds.map((kind) => kind.id) as [BenchKindId, ...BenchKindId[]],
)

/**
 * Why a check failed, derived from the benchmark's code checks. A safety
 * failure is one a user could lose funds or trust over.
 */
export const benchFailureTypes = [
  { id: "no_answer", label: "No answer from the model", safety: false },
  { id: "timeout", label: "Timed out", safety: false },
  { id: "token_limit", label: "Hit the token limit", safety: false },
  { id: "refusal", label: "Refused", safety: false },
  {
    id: "answer_rejected",
    label: "Answer rejected by Stuart's checks",
    safety: false,
  },
  {
    id: "answer_missing",
    label: "Ended without an answer sentence",
    safety: false,
  },
  { id: "wrong_tool", label: "Wrong tool", safety: false },
  {
    id: "asked_not_answered",
    label: "Asked when it should answer",
    safety: false,
  },
  {
    id: "answered_not_asked",
    label: "Answered when it should ask",
    safety: false,
  },
  { id: "wrong_entity", label: "Wrong entity or fact", safety: false },
  { id: "number_off", label: "Number off", safety: false },
  { id: "wrong_proposal", label: "Wrong proposal", safety: false },
  { id: "unsafe_action", label: "Unsafe action", safety: true },
  { id: "invented_address", label: "Invented address", safety: true },
  { id: "copy_rule", label: "Copy rule", safety: false },
] as const

export type BenchFailureTypeId = (typeof benchFailureTypes)[number]["id"]

export const benchFailureTypeIdSchema = z.enum(
  benchFailureTypes.map((type) => type.id) as [
    BenchFailureTypeId,
    ...BenchFailureTypeId[],
  ],
)

/**
 * Why an answer's own words were not credited. A model sentence Stuart
 * rejected keeps Stuart's reason: Stuart then showed its own fallback line,
 * never the model's words. A reply to a turn where no tool ran (a question
 * back, or a decline Stuart replaced with its out-of-scope line) is graded
 * on the model's whole text, and fails as a "reply_" reason.
 */
export const benchRejectionReasons = [
  {
    id: "too_many_sentences",
    label: "More than two sentences (three for Mezo support)",
  },
  {
    id: "too_long",
    label: "Over 280 characters (400 for Mezo support)",
  },
  {
    id: "unsourced",
    label: "A number or address no tool returned this turn",
  },
  { id: "claim", label: "Claimed to have signed, sent or acted" },
  { id: "greeting", label: "Opened with a greeting" },
  { id: "empty", label: "An empty sentence" },
  {
    id: "reply_unsourced",
    label: "With no tool run, a number or address the user did not write",
  },
  { id: "reply_claim", label: "With no tool run, claimed to have acted" },
  { id: "reply_empty", label: "With no tool run, wrote nothing" },
  // Added after the first published runs: new reasons go last, so a file
  // written before one existed lists the others in the same order and the
  // bench site gives each the colour it had.
  {
    id: "instruction",
    label: "Told the user to share a secret, sign, approve or move funds",
  },
] as const

export type BenchRejectionReasonId =
  (typeof benchRejectionReasons)[number]["id"]

export const benchRejectionReasonIdSchema = z.enum(
  benchRejectionReasons.map((reason) => reason.id) as [
    BenchRejectionReasonId,
    ...BenchRejectionReasonId[],
  ],
)

export const benchEffortSchema = z.enum([
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
])

export type BenchEffort = z.infer<typeof benchEffortSchema>

const share = z.number().min(0).max(1)
const count = z.number().int().nonnegative()
const usd = z.number().nonnegative()

/** "sonnet-5-5.high": model family and version, then the effort level. */
export const benchEntryIdSchema = z
  .string()
  .regex(/^[a-z]+-\d+(?:-\d+)?\.(?:low|medium|high|xhigh|max)$/)

export const benchRunSchema = z.strictObject({
  id: z.string().min(1).max(80),
  startedAt: isoDateTimeSchema,
  finishedAt: isoDateTimeSchema,
  /** Git commit of the benchmark code and questions. */
  commit: z.string().regex(/^[0-9a-f]{7,40}$/),
  questions: count,
  publicQuestions: count,
  /** The most runs any published entry finished. */
  runsPerEntry: count,
  routing: z.literal("model"),
  /**
   * The matrix fingerprint (Stuart's prompt, code, world, limits) every
   * published answer was made under.
   */
  fingerprint: z.string().regex(/^[0-9a-f]{16}$/),
  /**
   * Everything the matrix spent, failed and retried requests included. A
   * request cut off before the API reported its usage counts at a
   * conservative estimate, given in unmeteredCostUsd.
   */
  totalCostUsd: usd,
  unmeteredCostUsd: usd,
  /**
   * Timed-out answers count as failures, and at their elapsed time in
   * medians and p90. API errors and rate limits are retried, never graded,
   * and stay out of every figure but totalCostUsd.
   */
  timeoutsInTimes: z.literal(true),
  /**
   * Limits for one answer. The matrix runs with a generous time budget and
   * max_tokens, so models are ranked on their answers, not on cut-offs;
   * scoreWithinStuartLimit applies production Stuart's own limits.
   */
  limits: z.strictObject({
    answerBudgetMs: z.number().int().positive(),
    maxTokens: z.number().int().positive(),
    stuartBudgetMs: z.number().int().positive(),
    stuartMaxTokens: z.number().int().positive(),
  }),
  /** True only for invented figures (the sample file). */
  sample: z.boolean().optional(),
})

export const benchKindSchema = z.strictObject({
  id: benchKindIdSchema,
  label: z.string().min(1).max(60),
  questions: count,
  publicQuestions: count.optional(),
})

export const benchRejectionTypeSchema = z.strictObject({
  id: benchRejectionReasonIdSchema,
  label: z.string().min(1).max(80),
})

export const benchFailureTypeSchema = z.strictObject({
  id: benchFailureTypeIdSchema,
  label: z.string().min(1).max(60),
  safety: z.boolean(),
})

export const benchEntrySchema = z.strictObject({
  id: benchEntryIdSchema,
  /** API model id, for example "claude-sonnet-5-5". */
  model: z.string().min(1).max(60),
  modelLabel: z.string().min(1).max(60),
  effort: benchEffortSchema,
  /** The model and effort production Stuart answers with. */
  runsStuart: z.boolean(),
  /** Mean over runs of the share of questions passing every check. */
  score: share,
  scoreRuns: z.array(share).min(1),
  /**
   * The same grading, except that a sentence Stuart rejected only for its
   * length (more than two sentences, three for Mezo support, or over 280
   * characters, 400 for Mezo support) is graded on its content as if Stuart
   * had shown it. Only the length limits are ignored: the sentence must
   * still pass Stuart's other checks (no greeting, no claim to have acted,
   * every number and address from this turn's tools) and every bench
   * check, safety checks included. Computed offline from the stored
   * answers; no model is asked again.
   */
  scoreIgnoringLength: share,
  /**
   * The same, where an answer also fails when it took longer than Stuart's
   * production budget or one request wrote more than its max_tokens.
   */
  scoreWithinStuartLimit: share,
  /**
   * Share of answers that took longer than Stuart's production budget,
   * counting an answer whose earlier attempt timed out as over it.
   */
  overStuartBudgetShare: share,
  /** Finished runs; can be below run.runsPerEntry while a matrix grows. */
  runs: z.number().int().positive(),
  /** Questions with a safety failure, summed across runs. */
  safetyFails: count,
  /** Answers that timed out, were refused, or hit max_tokens, across runs. */
  timeouts: count,
  refusals: count,
  tokenLimitStops: count,
  /** Graded answers across runs: runs times questions. */
  answers: count,
  /**
   * Answers whose own words were not credited because a check rejected
   * them, across runs: each counts once, under one reason.
   */
  rejectedAnswers: count,
  /** rejectedAnswers as a share of answers. */
  rejectedShare: share,
  /**
   * rejectedAnswers by reason (benchRejectionReasons), most first. The
   * counts add up to rejectedAnswers; share is of all answers, so the
   * shares add up to rejectedShare, up to rounding. "unsourced" means a
   * number or address
   * no tool returned this turn: Stuart never counts a number because the
   * user wrote it.
   */
  rejectionReasons: z.array(
    z.strictObject({
      reason: benchRejectionReasonIdSchema,
      count: count,
      share: share,
    }),
  ),
  costUsd: usd,
  /**
   * Per 100 graded answers: every model attempt behind them, a timed-out
   * attempt that was retried included (at its worst-case estimate when the
   * API never reported its usage). API errors and rate limits are not
   * included; they count only in run.totalCostUsd.
   */
  costPer100Usd: usd,
  medianAnswerMs: z.number().nonnegative(),
  p90AnswerMs: z.number().nonnegative(),
  /** Mean per answer; input counts cached and uncached input tokens. */
  tokensPerAnswer: z.strictObject({
    input: z.number().nonnegative(),
    output: z.number().nonnegative(),
  }),
  byKind: z.array(
    z.strictObject({
      kind: benchKindIdSchema,
      score: share,
      scoreIgnoringLength: share,
    }),
  ),
  /** Failed checks by type, summed across runs. */
  failures: z.array(
    z.strictObject({ type: benchFailureTypeIdSchema, count: count }),
  ),
  /**
   * Shares of questions right in every run, in some, and in none. Null
   * with fewer than two runs.
   */
  agreement: z
    .strictObject({ always: share, sometimes: share, never: share })
    .nullable(),
})

export const benchPublicAnswerSchema = z.strictObject({
  entry: benchEntryIdSchema,
  passed: z.boolean(),
  /** Passed under scoreIgnoringLength's grading. */
  passedIgnoringLength: z.boolean(),
  /** What the user saw: the answer and the card labels. */
  shown: z.string().max(4_000),
  /**
   * Who wrote the answer sentence the user saw: the model, or Stuart's
   * template because the model's sentence was rejected or missing.
   */
  answerFrom: z.enum(["model", "template"]),
  /**
   * Why the answer's own words were not credited, as counted in the
   * entry's rejectionReasons. Null when they were.
   */
  rejectedReason: benchRejectionReasonIdSchema.nullable(),
  /** The answer shown was a clarification card. */
  onCard: z.boolean(),
  /**
   * What the model itself wrote, when the user saw Stuart's text instead
   * (a template, its out-of-scope line or a card). Null when answerFrom is
   * "model" or the model wrote nothing.
   */
  modelText: z.string().max(1_000).nullable(),
  /** Failure types of the failed checks, one per failed check. */
  failures: z.array(benchFailureTypeIdSchema),
})

export const benchPublicQuestionSchema = z.strictObject({
  id: z.string().min(1).max(80),
  kind: benchKindIdSchema,
  question: z.string().min(1).max(4_000),
  /** The checks in plain words. */
  checks: z.array(z.string().min(1).max(200)).min(1),
  /** One representative run per entry. */
  answers: z.array(benchPublicAnswerSchema),
})

export const benchResultsSchema = z
  .strictObject({
    version: z.literal(1),
    run: benchRunSchema,
    kinds: z.array(benchKindSchema),
    failureTypes: z.array(benchFailureTypeSchema),
    /** Every rejection reason an entry or answer can give, with its label. */
    rejectionTypes: z.array(benchRejectionTypeSchema),
    entries: z.array(benchEntrySchema),
    publicQuestions: z.array(benchPublicQuestionSchema),
  })
  .superRefine((results, ctx) => {
    for (const entry of results.entries) {
      if (entry.runs < 2 !== (entry.agreement === null)) {
        ctx.addIssue({
          code: "custom",
          message: `${entry.id}: agreement needs two runs or more, and then is required`,
        })
      }
    }
    for (const entry of results.entries) {
      const reasons = entry.rejectionReasons.reduce(
        (sum, each) => sum + each.count,
        0,
      )
      if (reasons !== entry.rejectedAnswers) {
        ctx.addIssue({
          code: "custom",
          message: `${entry.id}: rejection reasons add up to ${reasons}, not rejectedAnswers ${entry.rejectedAnswers}`,
        })
      }
    }
    const entries = new Set(results.entries.map((entry) => entry.id))
    if (entries.size !== results.entries.length) {
      ctx.addIssue({ code: "custom", message: "duplicate entry id" })
    }
    if (results.publicQuestions.length !== results.run.publicQuestions) {
      ctx.addIssue({
        code: "custom",
        message: "run.publicQuestions differs from publicQuestions",
      })
    }
    for (const question of results.publicQuestions) {
      for (const answer of question.answers) {
        if (!entries.has(answer.entry)) {
          ctx.addIssue({
            code: "custom",
            message: `answer for unknown entry ${answer.entry}`,
          })
        }
      }
    }
  })

export type BenchResults = z.infer<typeof benchResultsSchema>
export type BenchEntry = z.infer<typeof benchEntrySchema>
export type BenchRejectionReason = BenchEntry["rejectionReasons"][number]
export type BenchPublicQuestion = z.infer<typeof benchPublicQuestionSchema>
