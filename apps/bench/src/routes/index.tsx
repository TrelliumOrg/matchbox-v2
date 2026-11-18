import { createFileRoute, Link } from "@tanstack/react-router"
import type { ReactNode } from "react"
import results from "../data/results"
import { pageHead } from "../data/site"
import {
  AgreementCard,
  FailureCard,
  KindsGrid,
  RejectionCard,
} from "../ui/breakdown"
import Leaderboard from "../ui/leaderboard"
import { QuestionStepper } from "../ui/question"
import ScoreCharts from "../ui/scatter"
import {
  EffortPicker,
  ModelFilter,
  RankPicker,
  SelectionProvider,
  scoreLabels,
  scoreLines,
  useSelection,
} from "../ui/selection"
import { SectionHead } from "../ui/shell"
import { findings } from "../view/findings"
import { methodNotes } from "../view/method"
import { focusEntries, heroFacts, rankOrder, wholeSeconds } from "../view/model"

/**
 * The leaderboard (Doop `DOXM2YuhbJ`, "Matchbench, leaderboard"): the hero,
 * every entry ranked, the two scatter charts, the scores by kind, how they
 * fail, agreement between runs, one published question and the method in
 * four notes. The model filter applies to the whole page; the effort
 * picker to the grid, the cards and the question.
 */

export const Route = createFileRoute("/")({
  head: () => pageHead("/", "Matchbench: Claude models inside Stuart"),
  component: Home,
})

function Home(): ReactNode {
  return (
    <SelectionProvider>
      <Hero />
      <Findings />
      <SectionHead
        id="leaderboard"
        title="Leaderboard"
        lede={`Share of questions that passed every check, averaged over each entry's runs, with up to ${wholeSeconds(results.run.limits.answerBudgetMs)} per answer. Three scores:`}
      >
        <div className="flex flex-wrap gap-2">
          <RankPicker />
          <ModelFilter />
        </div>
      </SectionHead>
      <dl className="mt-3 grid gap-x-6 gap-y-1.5 text-[14.5px] md:grid-cols-[150px_1fr]">
        {rankOrder.map((metric) => (
          <div key={metric} className="contents">
            <dt className="font-semibold text-ink">{scoreLabels[metric]}</dt>
            <dd className="text-sec max-md:mb-1.5">{scoreLines[metric]}</dd>
          </div>
        ))}
      </dl>
      <Leaderboard />
      <ScoreCharts />
      <SectionHead
        id="kinds"
        title="Where each model is strong"
        lede="Score by kind of question. The harder kinds are where the models separate."
      >
        <EffortPicker />
      </SectionHead>
      <KindsGrid />
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <FailureCard />
        <AgreementCard />
      </div>
      <RejectionCard />
      <Question />
      <Method />
    </SelectionProvider>
  )
}

function Hero(): ReactNode {
  return (
    <section
      aria-labelledby="title"
      className="grid items-end gap-8 pt-10 md:pt-14 lg:grid-cols-[1fr_420px] lg:gap-[60px]"
    >
      <div>
        <h1
          id="title"
          className="text-[38px] leading-[1.04] font-[650] tracking-[-0.03em] text-ink md:text-[56px] md:leading-[1.02]"
        >
          Which model answers Mezo questions best?
        </h1>
        <p className="mt-[18px] max-w-[640px] text-[17px] leading-normal text-ink2 md:text-[19px]">
          Matchbench puts each model inside Stuart, Matchbox's assistant, with
          the same tools and the same prompt, and asks it questions written for
          the benchmark about gauges, votes, locks and where the money went.
          Every answer is graded by code against fixed data: captured Mezo
          mainnet data for gauges and chain activity, a test wallet for the
          rest.
        </p>
      </div>
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-[20px] border border-line bg-line">
        {heroFacts(results).map((fact) => (
          <div
            key={fact.label}
            className="flex flex-col-reverse bg-bg px-4 py-4 md:px-5"
          >
            <dt className="text-[14px] text-sec">{fact.label}</dt>
            <dd className="text-[24px] font-[650] tracking-[-0.02em] text-ink md:text-[26px]">
              {fact.value}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

/**
 * What this run shows: findings computed from the results file
 * (view/findings.ts), each shown only when it holds for the data.
 */
function Findings(): ReactNode {
  const items = findings(results)
  if (items.length === 0) return null
  return (
    <section
      aria-labelledby="findings"
      className="mt-10 rounded-[24px] bg-soft px-5 py-6 md:px-[26px]"
    >
      <h2
        id="findings"
        className="text-[20px] font-[650] tracking-[-0.01em] text-ink"
      >
        What this run shows
      </h2>
      <ul className="mt-3 space-y-2.5 text-[16px] leading-[1.5] text-ink2">
        {items.map((item) => (
          <li
            key={item.id}
            data-finding={item.id}
            className="flex gap-3 before:mt-[0.62em] before:size-1.5 before:flex-none before:rounded-full before:bg-acc"
          >
            {item.text}
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[13.5px] text-sec">
        Worked out from this run's results. Entries count as level when their
        scores differ by less than their own runs vary.
      </p>
    </section>
  )
}

function Question(): ReactNode {
  const { selection } = useSelection()
  const entries = focusEntries(results.entries, selection)
  return (
    <section aria-labelledby="question">
      <QuestionStepper
        entries={entries}
        heading={
          <div>
            <h2
              id="question"
              className="text-[24px] font-[650] tracking-[-0.015em] text-ink md:text-[26px]"
            >
              A question from the set
            </h2>
            <p className="mt-1.5 text-[15px] text-sec">
              One of the {results.run.publicQuestions} published questions, with
              what the grader checks and what each entry said.
            </p>
          </div>
        }
      />
    </section>
  )
}

function Method(): ReactNode {
  return (
    <section aria-labelledby="method">
      <SectionHead id="method" title="How it is measured">
        <Link
          to="/method"
          className="rounded-md text-[15px] font-semibold text-ink underline decoration-mut underline-offset-4 outline-none hover:decoration-ink focus-visible:outline-2 focus-visible:outline-ink"
        >
          Read the full method
        </Link>
      </SectionHead>
      <ul className="mt-[18px] grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {methodNotes(results.run).map((note) => (
          <li key={note.title} className="border-t-2 border-ink pt-3.5">
            <h3 className="text-[16.5px] font-[650] text-ink">{note.title}</h3>
            <p className="mt-1.5 text-[14.5px] leading-[1.45] text-sec">
              {note.body}
            </p>
          </li>
        ))}
      </ul>
    </section>
  )
}
