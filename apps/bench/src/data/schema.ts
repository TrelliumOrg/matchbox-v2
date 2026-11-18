import {
  type BenchEntry,
  type BenchPublicQuestion,
  type BenchResults,
  benchResultsSchema,
} from "@matchbox/contracts/bench"
import { z } from "zod"

/**
 * The results file Matchbench renders (data/results.json), as the benchmark
 * runner writes it: the contract in @matchbox/contracts/bench. The build
 * parses the file (vite.config.ts) and a unit test does too, so the page
 * never ships a file it cannot render. The page itself imports only the
 * types: zod stays out of the browser bundle.
 *
 * On top of the contract, the page needs the file to agree with itself:
 * every kind and failure type an entry or a question names is listed, and
 * each entry has one score per finished run.
 */

export type Results = BenchResults
export type Run = Results["run"]
export type Kind = Results["kinds"][number]
export type FailureType = Results["failureTypes"][number]
export type Entry = BenchEntry
export type PublicQuestion = BenchPublicQuestion
export type Answer = PublicQuestion["answers"][number]

/**
 * What every page gets synchronously: the file without the published
 * answers, which load only when a reader asks for them (src/data/questions.ts).
 */
export type SiteResults = Omit<Results, "publicQuestions">

/**
 * A published question without its answers, for lists and the stepper:
 * built from the file at build time (scripts/question-index.mjs).
 */
export type QuestionSummary = Pick<
  PublicQuestion,
  "id" | "kind" | "question" | "checks"
> & {
  /** How many entries' answers are published. */
  answers: number
  /** How many of those passed. */
  passed: number
}

export const resultsSchema = benchResultsSchema.superRefine(
  (results, context) => {
    const issue = (message: string) =>
      context.addIssue({ code: "custom", message })
    const kinds = new Set<string>(results.kinds.map((item) => item.id))
    const types = new Set<string>(results.failureTypes.map((item) => item.id))
    for (const item of results.entries) {
      if (item.scoreRuns.length !== item.runs)
        issue(
          `entry ${item.id} has ${item.scoreRuns.length} scores for ${item.runs} runs`,
        )
      if (item.runs > results.run.runsPerEntry)
        issue(`entry ${item.id} has more runs than run.runsPerEntry`)
      for (const score of item.byKind)
        if (!kinds.has(score.kind))
          issue(`entry ${item.id} scores unlisted kind ${score.kind}`)
      for (const failure of item.failures)
        if (!types.has(failure.type))
          issue(`entry ${item.id} counts unlisted failure ${failure.type}`)
    }
    for (const question of results.publicQuestions) {
      if (!kinds.has(question.kind))
        issue(`question ${question.id} has unlisted kind ${question.kind}`)
      for (const answer of question.answers)
        for (const failure of answer.failures)
          if (!types.has(failure))
            issue(`question ${question.id} fails unlisted ${failure}`)
    }
  },
)

/** Parses a results file, throwing every problem in one readable error. */
export function parseResults(raw: unknown): Results {
  const parsed = resultsSchema.safeParse(raw)
  if (!parsed.success) {
    throw new Error(
      `data/results.json does not match the results schema:\n${z.prettifyError(parsed.error)}`,
    )
  }
  return parsed.data
}
