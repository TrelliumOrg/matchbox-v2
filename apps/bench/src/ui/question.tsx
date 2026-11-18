import { firstQuestion, questionIndex } from "virtual:bench-question-index"
import * as UntrustedText from "@matchbox/ui/untrusted-text"
import { type ReactNode, useState } from "react"
import results from "../data/results"
import type { PublicQuestion } from "../data/schema"
import { oneRunShown } from "../view/method"
import {
  effortLabel,
  effortShape,
  failureLabels,
  modelColour,
  questionPlace,
  type RankedEntry,
  type ShownParts,
  shortModel,
  splitShown,
  templateNote,
  wrapIndex,
} from "../view/model"
import { loadAnswers, preloadAnswers, useAnswers } from "./answers"
import { Marker } from "./marker"

/**
 * A published question, its checks in plain words, and each entry's shown
 * answer. Answers and the model's own words are untrusted model output:
 * React renders them as text through UntrustedText (direction isolated,
 * hidden characters shown as escapes), never as HTML, and nothing in them
 * becomes a link.
 */

export function Checks({ checks }: { checks: readonly string[] }): ReactNode {
  return (
    <div className="mt-3.5">
      <p className="text-[13.5px] font-medium text-sec">The grader checks</p>
      <ul className="mt-1 space-y-0.5 text-[14.5px] text-ink2">
        {checks.map((check) => (
          <li
            key={check}
            className="flex gap-2 [overflow-wrap:anywhere] before:mt-[0.6em] before:size-1 before:flex-none before:rounded-full before:bg-mut"
          >
            {check}
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Untrusted text with its line breaks kept; "No text was shown" when empty. */
function ModelText({
  value,
  className,
}: {
  value: string
  className?: string
}): ReactNode {
  if (value.trim() === "") {
    return (
      <p className={`text-sec italic ${className ?? ""}`}>No text was shown</p>
    )
  }
  const lines = value.split(/\r?\n/)
  return (
    <p dir="auto" className={`bench-answer ${className ?? ""}`}>
      {lines.map((line, index) => (
        // Lines are positional: the same text can repeat.
        // biome-ignore lint/suspicious/noArrayIndexKey: order is the key
        <span key={index}>
          {index === 0 ? null : <br />}
          <UntrustedText.Root value={line} limit={4_000} />
        </span>
      ))}
    </p>
  )
}

/** One untrusted line, as text. */
function Line({ value }: { value: string }): ReactNode {
  return <UntrustedText.Root value={value} limit={4_000} />
}

/**
 * The rest of what Stuart's response showed around the sentence: its title,
 * then the card's rows. Collapsed, because the rows (ballot lines, labels,
 * facts) bury the sentence when printed whole. Short values sit in a grid,
 * longer lines on their own, structured blocks as small monospaced text.
 */
function CardShown({ parts }: { parts: ShownParts }): ReactNode {
  if (parts.title === "" && parts.card.length === 0) return null
  return (
    <details className="group/card mt-2.5">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 rounded-lg py-0.5 text-[13px] font-medium text-sec outline-none hover:text-ink focus-visible:outline-2 focus-visible:outline-ink [&::-webkit-details-marker]:hidden">
        <svg
          aria-hidden="true"
          width="10"
          height="10"
          viewBox="0 0 10 10"
          className="flex-none transition-transform group-open/card:rotate-90"
        >
          <path
            d="M3 1.5 6.5 5 3 8.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          />
        </svg>
        What the card showed
      </summary>
      <div
        dir="auto"
        className="mt-1.5 space-y-1.5 border-l-2 border-line pl-2.5 text-[13px] leading-[1.4] text-ink2"
      >
        {parts.title === "" ? null : (
          <p className="font-semibold text-ink [overflow-wrap:anywhere]">
            <Line value={parts.title} />
          </p>
        )}
        {parts.card.map((group, index) => {
          // Groups are positional: the order is what the card showed.
          const key = `${group.kind}-${index}`
          if (group.kind === "values") {
            return (
              <ul
                key={key}
                className="grid grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))] gap-x-3 gap-y-0.5"
              >
                {group.items.map((item) => (
                  <li key={item} className="min-w-0 [overflow-wrap:anywhere]">
                    <Line value={item} />
                  </li>
                ))}
              </ul>
            )
          }
          return (
            <p
              key={key}
              className={`[overflow-wrap:anywhere] ${group.kind === "data" ? "line-clamp-4 font-mono text-[11.5px] text-sec" : ""}`}
            >
              <Line value={group.text} />
            </p>
          )
        })}
        {parts.repeats === 0 ? null : (
          <p className="text-[12.5px] text-sec">
            Lines the card repeated are listed once.
          </p>
        )}
      </div>
    </details>
  )
}

export function Answers({
  question,
  entries,
}: {
  question: PublicQuestion
  entries: readonly RankedEntry[]
}): ReactNode {
  const shown = entries.flatMap((entry) => {
    const answer = question.answers.find((item) => item.entry === entry.id)
    return answer === undefined ? [] : [{ entry, answer }]
  })
  if (shown.length === 0) {
    return (
      <p className="mt-5 text-[15px] text-sec">
        No answers for the entries shown.
      </p>
    )
  }
  return (
    <>
      <p className="mt-5 text-[13.5px] text-sec">{oneRunShown}</p>
      <ul className="mt-3 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {shown.map(({ entry, answer }) => {
          const fromStuart = answer.answerFrom === "template"
          const reason = templateNote(answer, results.rejectionTypes)
          const parts = splitShown(answer.shown)
          return (
            <li
              key={entry.id}
              className="min-w-0 rounded-[18px] bg-soft px-[18px] py-4 text-[14.5px] leading-[1.45] text-ink2"
            >
              <p className="mb-2 flex items-center gap-2 text-[13.5px] font-semibold text-ink">
                <Marker
                  shape={effortShape(entry.effort)}
                  colour={modelColour(entry.model)}
                  size={12}
                />
                <span className="min-w-0">
                  {shortModel(entry.modelLabel)}
                  <span className="font-normal text-sec">
                    , {effortLabel(entry.effort)}
                  </span>
                </span>
                <span
                  className={`ml-auto flex-none ${answer.passed ? "text-pos" : "text-neg"}`}
                >
                  {answer.passed ? "Pass" : "Fail"}
                </span>
              </p>
              {answer.passedIgnoringLength === answer.passed ? null : (
                <p
                  className={`mb-1.5 text-[13px] font-medium ${answer.passedIgnoringLength ? "text-pos" : "text-neg"}`}
                >
                  {answer.passedIgnoringLength
                    ? "Passes ignoring length"
                    : "Fails ignoring length"}
                </p>
              )}
              {answer.onCard ? (
                <p className="mb-1.5 text-[13px] font-medium text-sec">
                  Given as a clarification card
                </p>
              ) : null}
              {fromStuart ? (
                <p className="mb-1.5 text-[13px] font-medium text-acc-ink">
                  Stuart's own text, shown in place of the model's answer
                  {reason === null ? "" : `. Why: ${reason}`}
                </p>
              ) : null}
              <ModelText
                value={parts.sentence}
                className={fromStuart ? "border-l-2 border-acc pl-2.5" : ""}
              />
              {fromStuart && answer.modelText !== null ? (
                <div className="mt-2.5">
                  <p className="text-[13px] font-medium text-sec">
                    What the model wrote
                  </p>
                  <ModelText value={answer.modelText} className="mt-0.5" />
                </div>
              ) : null}
              <CardShown parts={parts} />
              {answer.passed || answer.failures.length === 0 ? null : (
                <p className="mt-2 text-[13px] text-neg">
                  Failed:{" "}
                  {failureLabels(answer.failures, results.failureTypes)
                    .join(", ")
                    .toLowerCase()
                    .replace(
                      /\b(stuart|mezo)\b/g,
                      (name) => name.charAt(0).toUpperCase() + name.slice(1),
                    )}
                </p>
              )}
            </li>
          )
        })}
      </ul>
    </>
  )
}

/** The front page's card: one question at a time, with a stepper. */
export function QuestionStepper({
  heading,
  entries,
}: {
  heading: ReactNode
  entries: readonly RankedEntry[]
}): ReactNode {
  const { questions, failed } = useAnswers()
  const [index, setIndex] = useState(0)
  // The first card renders from the build's copy, the rest once loaded.
  const question = questions?.[index] ?? (index === 0 ? firstQuestion : null)
  if (question === null || question === undefined) {
    return (
      <p className="mt-[18px] text-[15px] text-sec">
        No questions are published for this run.
      </p>
    )
  }
  function step(by: number): void {
    const next = wrapIndex(index + by, questionIndex.length)
    loadAnswers().then(
      () => setIndex(next),
      () => undefined,
    )
  }
  const button =
    "flex h-9 cursor-pointer items-center rounded-[18px] px-3.5 text-[14.5px] font-medium text-ink2 outline-none hover:bg-bg focus-visible:outline-2 focus-visible:outline-ink"
  return (
    <>
      <div className="mt-14 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        {heading}
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-[14.5px] text-sec" aria-live="polite">
            {failed
              ? "The next question could not load. Try again."
              : questionPlace(questionIndex, index, results.kinds)}
            <span className="sr-only">
              , question {index + 1} of {questionIndex.length}
            </span>
          </p>
          <div className="flex gap-0.5 rounded-[22px] bg-soft p-1">
            <button
              type="button"
              className={button}
              onClick={() => step(-1)}
              onPointerEnter={preloadAnswers}
              onFocus={preloadAnswers}
            >
              Previous
            </button>
            <button
              type="button"
              className={`${button} bg-bg font-semibold text-ink`}
              onClick={() => step(1)}
              onPointerEnter={preloadAnswers}
              onFocus={preloadAnswers}
            >
              Next question
            </button>
          </div>
        </div>
      </div>
      <article
        aria-label="Published question"
        className="mt-[18px] w-full rounded-[24px] border border-line px-5 py-6 md:px-[26px]"
      >
        <p className="text-[19px] leading-[1.3] font-semibold tracking-[-0.01em] [overflow-wrap:anywhere] text-ink md:text-[22px]">
          "{question.question}"
        </p>
        <Checks checks={question.checks} />
        <Answers question={question} entries={entries} />
      </article>
    </>
  )
}
