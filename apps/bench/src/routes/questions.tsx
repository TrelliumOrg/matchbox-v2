import { questionIndex } from "virtual:bench-question-index"
import { createFileRoute } from "@tanstack/react-router"
import type { ReactNode } from "react"
import results from "../data/results"
import type { QuestionSummary } from "../data/schema"
import { pageHead } from "../data/site"
import { preloadAnswers, useAnswers } from "../ui/answers"
import { Answers, Checks } from "../ui/question"
import { PageHead } from "../ui/shell"
import { kindLabel, type RankedEntry, rankEntries } from "../view/model"

/**
 * Every published question, grouped by kind, with its checks, and every
 * entry's shown answer (model output, rendered as text only) once the
 * reader opens the question.
 */

export const Route = createFileRoute("/questions")({
  head: () => pageHead("/questions", "Questions, Matchbench"),
  component: Questions,
})

/**
 * A question's answers, loaded when the reader opens it:
 * they are most of the results file, so no page carries them on first load.
 */
function QuestionAnswers({
  summary,
  entries,
}: {
  summary: QuestionSummary
  entries: readonly RankedEntry[]
}): ReactNode {
  const { questions, failed } = useAnswers()
  const question = questions?.find((item) => item.id === summary.id)
  return (
    <details
      className="group mt-3"
      onToggle={(event) => {
        if (event.currentTarget.open) preloadAnswers()
      }}
    >
      <summary className="inline-flex cursor-pointer list-none items-center rounded-xl py-1 text-[14.5px] font-semibold text-ink underline decoration-mut underline-offset-4 outline-none hover:decoration-ink focus-visible:outline-2 focus-visible:outline-ink [&::-webkit-details-marker]:hidden">
        <span className="group-open:hidden">
          Show the {summary.answers} answers
        </span>
        <span className="hidden group-open:inline">Hide the answers</span>
      </summary>
      {question === undefined ? (
        <p role="status" className="mt-3 text-[14.5px] text-sec">
          {failed
            ? "The answers could not load. Close this and open it again to retry."
            : "Loading the answers"}
        </p>
      ) : (
        <Answers question={question} entries={entries} />
      )}
    </details>
  )
}

function Questions(): ReactNode {
  const entries = rankEntries(results.entries)
  const held = results.run.questions - results.run.publicQuestions
  const kinds = results.kinds.filter((kind) =>
    questionIndex.some((question) => question.kind === kind.id),
  )
  return (
    <>
      <PageHead
        title="Questions"
        lede={`The ${results.run.publicQuestions} published questions, what the grader checks on each, and what every entry showed the user. The other ${held} stay private so no model can be tuned to them.`}
      />
      <nav aria-label="Kinds of question" className="mt-8">
        <ul className="flex flex-wrap gap-2">
          {kinds.map((kind) => (
            <li key={kind.id}>
              <a
                href={`#${kind.id}`}
                className="flex h-9 items-center rounded-[18px] bg-soft px-3.5 text-[14.5px] font-medium text-ink2 outline-none hover:text-ink focus-visible:outline-2 focus-visible:outline-ink"
              >
                <span className="[overflow-wrap:anywhere]">{kind.label}</span>
              </a>
            </li>
          ))}
        </ul>
      </nav>
      {kinds.map((kind) => (
        <section key={kind.id} aria-labelledby={kind.id} className="mt-12">
          <h2
            id={kind.id}
            className="scroll-mt-6 text-[24px] font-[650] tracking-[-0.015em] text-ink"
          >
            {kindLabel(results.kinds, kind.id)}
          </h2>
          <ol className="mt-4 grid gap-4">
            {questionIndex
              .filter((question) => question.kind === kind.id)
              .map((question) => (
                <li
                  key={question.id}
                  className="min-w-0 rounded-[24px] border border-line px-5 py-5 md:px-[26px]"
                >
                  <h3 className="text-[17px] leading-[1.35] font-semibold [overflow-wrap:anywhere] text-ink md:text-[19px]">
                    "{question.question}"
                  </h3>
                  <p className="mt-1 text-[14px] text-sec">
                    {question.passed} of {question.answers} entries passed in
                    the run shown
                  </p>
                  <Checks checks={question.checks} />
                  <QuestionAnswers summary={question} entries={entries} />
                </li>
              ))}
          </ol>
        </section>
      ))}
    </>
  )
}
