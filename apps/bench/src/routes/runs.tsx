import { createFileRoute } from "@tanstack/react-router"
import type { ReactNode } from "react"
import results from "../data/results"
import { pageHead } from "../data/site"
import { scoreLabels, withinLabel } from "../ui/selection"
import { PageHead } from "../ui/shell"
import {
  benchmarkLimits,
  costNote,
  runProvenance,
  runRules,
  stuartLimits,
} from "../view/method"
import {
  activeKinds,
  day,
  duration,
  effortLabel,
  percent,
  rankEntries,
  runsText,
  seconds,
  time,
  usd,
  whole,
  wholeSeconds,
} from "../view/model"

/** This run's details, how it counts, and each entry in every run. */

export const Route = createFileRoute("/runs")({
  head: () => pageHead("/runs", "Runs, Matchbench"),
  component: Runs,
})

type Fact = { label: string; value: string; note?: string; mono?: boolean }

function Runs(): ReactNode {
  const { run } = results
  const entries = rankEntries(results.entries)
  const runNumbers = Array.from({ length: run.runsPerEntry }, (_, i) => i + 1)
  const stuartLimit = wholeSeconds(run.limits.stuartBudgetMs)
  const provenance = runProvenance(run)
  const facts: Fact[] = [
    { label: "Run", value: run.id },
    {
      label: "Started",
      value: `${day(run.startedAt)}, ${time(run.startedAt)}, took ${duration(run.startedAt, run.finishedAt)}`,
    },
    {
      label: "Benchmark commit and fingerprint",
      value: `${run.commit.slice(0, 8)} ${run.fingerprint}`,
      mono: true,
      note: "The fingerprint covers Stuart's prompt, code, data and limits every published answer was made under.",
    },
    {
      label: "Questions",
      value: `${run.questions} in ${activeKinds(results.kinds).length} kinds, ${run.publicQuestions} published`,
    },
    {
      label: "Entries",
      value: `${entries.length}, ${runsText(entries)} each`,
    },
    {
      label: "Routing",
      value: "Every question to the model, no fallbacks",
    },
    {
      label: "Spent",
      value: usd(run.totalCostUsd),
      ...(run.unmeteredCostUsd > 0
        ? {
            note: `retries included, ${usd(run.unmeteredCostUsd)} of it estimated`,
          }
        : { note: "retries included" }),
    },
    { label: "Benchmark limits per answer", value: benchmarkLimits(run) },
    { label: "Stuart in production", value: stuartLimits(run) },
  ]
  const head = "pb-2.5 pt-3 text-[14px] font-normal text-sec whitespace-nowrap"
  const cell = "py-3 text-right text-ink2"
  return (
    <>
      <PageHead
        title="Runs"
        lede="Matchbench publishes one run at a time. Each entry answers every question several times, so a lucky answer cannot carry a score."
      />
      <h2 className="mt-12 text-[24px] font-[650] tracking-[-0.015em] text-ink">
        This run
      </h2>
      <dl className="mt-4 grid gap-px overflow-hidden rounded-[20px] border border-line bg-line sm:grid-cols-3">
        {facts.map((fact) => (
          <div key={fact.label} className="bg-bg px-5 py-4">
            <dt className="text-[14px] text-sec">{fact.label}</dt>
            <dd
              className={`mt-0.5 text-[17px] font-semibold text-ink ${fact.mono === true ? "font-mono text-[15.5px] font-medium" : ""}`}
            >
              {fact.value}
              {fact.note === undefined ? null : (
                <span className="mt-0.5 block font-sans text-[14px] font-normal text-sec">
                  {fact.note}
                </span>
              )}
            </dd>
          </div>
        ))}
      </dl>
      {provenance === null ? null : (
        <p
          data-part="provenance"
          className="mt-3 max-w-[760px] text-[15px] text-sec"
        >
          {provenance}
        </p>
      )}
      <h2 className="mt-12 text-[24px] font-[650] tracking-[-0.015em] text-ink">
        How this run counts
      </h2>
      <ul className="mt-3 max-w-[760px] list-disc space-y-1.5 pl-5 text-[16px] leading-[1.55] text-ink2">
        {runRules(run).map((rule) => (
          <li key={rule} className="pl-1">
            {rule}
          </li>
        ))}
      </ul>
      <h2 className="mt-12 text-[24px] font-[650] tracking-[-0.015em] text-ink">
        Each entry in every run
      </h2>
      <p className="mt-1.5 max-w-[760px] text-[15px] text-sec">
        Score in each run and the average over the entry's runs, the score
        within Stuart's {stuartLimit}, and how many answers ran over it. The
        90th percentile is how long the slowest tenth of answers took. The
        counts are answers, summed over the entry's own runs. Cost is the
        estimate for the entry's answers, described below.
      </p>
      <p className="mt-2 max-w-[760px] text-[15px] text-sec">{costNote}</p>
      <section
        className="mt-4 overflow-x-auto rounded-sm outline-none focus-visible:outline-2 focus-visible:outline-ink"
        // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrolling region must be reachable by keyboard
        tabIndex={0}
        aria-label="Each entry in every run"
      >
        <table className="w-full min-w-[1180px] border-collapse text-[15px]">
          <thead>
            <tr className="border-b border-soft2">
              <th scope="col" className={`${head} text-left`}>
                Entry
              </th>
              {runNumbers.map((number) => (
                <th key={number} scope="col" className={`${head} text-right`}>
                  Run {number}
                </th>
              ))}
              <th scope="col" className={`${head} text-right`}>
                {scoreLabels.score}
              </th>
              <th scope="col" className={`${head} text-right`}>
                {scoreLabels["ignoring-length"]}
              </th>
              <th scope="col" className={`${head} text-right`}>
                {withinLabel}
              </th>
              <th scope="col" className={`${head} text-right`}>
                Over {stuartLimit}
              </th>
              <th scope="col" className={`${head} text-right`}>
                90th percentile
              </th>
              <th scope="col" className={`${head} text-right`}>
                Timeouts
              </th>
              <th scope="col" className={`${head} text-right`}>
                Refusals
              </th>
              <th scope="col" className={`${head} text-right`}>
                Token limit
              </th>
              <th scope="col" className={`${head} text-right`}>
                Not shown
              </th>
              <th scope="col" className={`${head} text-right`}>
                Cost
              </th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr
                key={entry.id}
                className="border-t border-line first:border-t-0"
              >
                <th scope="row" className="py-3 pr-4 text-left font-normal">
                  <span className="font-semibold text-ink">
                    {entry.modelLabel}
                  </span>
                  <span className="text-sec">
                    , {effortLabel(entry.effort)}
                  </span>
                </th>
                {runNumbers.map((number) => (
                  <td key={number} className={cell}>
                    {number > entry.runs ? (
                      <span className="text-sec">not run</span>
                    ) : (
                      percent(entry.scoreRuns[number - 1] ?? 0)
                    )}
                  </td>
                ))}
                <td className="py-3 text-right font-semibold text-ink">
                  {percent(entry.score)}
                </td>
                <td className="py-3 text-right font-semibold text-ink">
                  {percent(entry.scoreIgnoringLength)}
                </td>
                <td className="py-3 text-right font-semibold text-ink">
                  {percent(entry.scoreWithinStuartLimit)}
                </td>
                <td className={cell}>
                  {percent(entry.overStuartBudgetShare, 0)}
                </td>
                <td className={cell}>{seconds(entry.p90AnswerMs)}</td>
                <td className={cell}>{entry.timeouts}</td>
                <td className={cell}>{entry.refusals}</td>
                <td className={cell}>{entry.tokenLimitStops}</td>
                <td className={cell}>
                  {whole(entry.rejectedAnswers)}
                  <span className="block text-[13px] text-sec">
                    {percent(entry.rejectedShare)}
                  </span>
                </td>
                <td className={cell}>{usd(entry.costUsd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  )
}
