// biome-ignore-all lint/a11y/noRedundantRoles: the phone layout restyles the table's display, and some browsers then drop table semantics unless the roles are explicit
import type { ReactNode } from "react"
import results from "../data/results"
import type { Entry } from "../data/schema"
import {
  type Domain,
  domainPosition,
  effortLabel,
  effortShape,
  modelColour,
  partialRuns,
  percent,
  type RankBy,
  rankOrder,
  rankValue,
  scoreDomain,
  seconds,
  usd,
  visibleEntries,
  whole,
  wholeSeconds,
} from "../view/model"
import { Marker, MarkerPath } from "./marker"
import { scoreLabels, useSelection } from "./selection"

/**
 * Every entry, best first by the score the reader ranks by. The chosen score
 * sits on a track with its range stated (never from zero, so the gaps read
 * at their true size), and for the main score a line shows the spread of
 * the entry's own runs. The three scores also have a column each. One table
 * on every screen: on phones (styles.css, `.bench-board`) each row lays out
 * as a small card and each figure carries a short visible label, while the
 * header row stays in the accessibility tree, so every cell keeps its
 * column name.
 */
function partial(entry: Entry): string | null {
  return partialRuns(entry, results.run.runsPerEntry)
}

const stuartLimit = wholeSeconds(results.run.limits.stuartBudgetMs)

/** The track's range for each score, from every entry (and every run). */
const domains: Record<RankBy, Domain> = {
  score: scoreDomain(results.entries.flatMap((entry) => entry.scoreRuns)),
  "ignoring-length": scoreDomain(
    results.entries.map((entry) => entry.scoreIgnoringLength),
  ),
  "within-stuart": scoreDomain(
    results.entries.map((entry) => entry.scoreWithinStuartLimit),
  ),
}

/** A label only phones show: the column header names the cell elsewhere. */
function PhoneLabel({ children }: { children: ReactNode }): ReactNode {
  return (
    <span aria-hidden="true" className="bench-phone-label">
      {children}
    </span>
  )
}

/** Where an entry sits on the chosen score's range, with its run spread. */
function Track({
  entry,
  by,
  domain,
}: {
  entry: Entry
  by: RankBy
  domain: Domain
}): ReactNode {
  const at = domainPosition(rankValue(entry, by), domain)
  const runs = by === "score" ? entry.scoreRuns : []
  const low = runs.length > 1 ? domainPosition(Math.min(...runs), domain) : at
  const high = runs.length > 1 ? domainPosition(Math.max(...runs), domain) : at
  return (
    <span
      data-part="score-bar"
      aria-hidden="true"
      className="relative block h-5 flex-1"
    >
      <span className="absolute inset-x-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-soft2" />
      {high > low ? (
        <span
          className="absolute top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-mut"
          style={{
            left: `${(low * 100).toFixed(2)}%`,
            width: `${((high - low) * 100).toFixed(2)}%`,
          }}
        />
      ) : null}
      <svg
        aria-hidden="true"
        width="16"
        height="16"
        viewBox="-8 -8 16 16"
        className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 overflow-visible"
        style={{ left: `${(at * 100).toFixed(2)}%` }}
      >
        <MarkerPath
          shape={effortShape(entry.effort)}
          colour={modelColour(entry.model)}
          r={6.5}
        />
      </svg>
    </span>
  )
}

export default function Leaderboard(): ReactNode {
  const { selection } = useSelection()
  const entries = visibleEntries(results.entries, selection)
  const by = selection.rankBy
  const domain = domains[by]
  const head = "pb-2.5 pt-3 text-[14px] font-normal text-sec"
  const active = "font-semibold text-ink"
  return (
    <>
      <table
        role="table"
        className="bench-board mt-[18px] w-full border-collapse text-[16px]"
      >
        <caption className="sr-only">
          Leaderboard: {entries.length} entries, ranked by {scoreLabels[by]}
        </caption>
        <thead role="rowgroup">
          <tr role="row" className="border-b border-soft2">
            <th
              role="columnheader"
              scope="col"
              className={`${head} w-10 text-left`}
            >
              <span className="sr-only">Rank</span>
            </th>
            <th role="columnheader" scope="col" className={`${head} text-left`}>
              Model
            </th>
            <th
              role="columnheader"
              scope="col"
              className={`${head} w-[24%] pr-6 text-left`}
            >
              <span className="sr-only">
                {scoreLabels[by]}, scale from {percent(domain.from, 0)} to{" "}
                {percent(domain.to, 0)}
              </span>
              <span
                aria-hidden="true"
                className="flex items-baseline justify-between gap-3"
              >
                <span className="font-mono text-[12px]">
                  {percent(domain.from, 0)}
                </span>
                <span className={`${active} text-[13px]`}>
                  {scoreLabels[by]}
                </span>
                <span className="font-mono text-[12px]">
                  {percent(domain.to, 0)}
                </span>
              </span>
            </th>
            {rankOrder.map((metric) => (
              <th
                key={metric}
                role="columnheader"
                scope="col"
                aria-sort={metric === by ? "descending" : "none"}
                className={`${head} text-right ${metric === by ? active : ""}`}
              >
                {scoreLabels[metric]}
              </th>
            ))}
            <th
              role="columnheader"
              scope="col"
              className={`${head} text-right`}
            >
              Safety fails
            </th>
            <th
              role="columnheader"
              scope="col"
              className={`${head} text-right`}
            >
              Cost per 100 answers
            </th>
            <th
              role="columnheader"
              scope="col"
              className={`${head} text-right`}
            >
              Median answer
            </th>
          </tr>
        </thead>
        <tbody role="rowgroup">
          {entries.map((entry) => {
            const colour = modelColour(entry.model)
            const tokens =
              entry.tokensPerAnswer.input + entry.tokensPerAnswer.output
            const cell = "py-[16px] align-middle"
            return (
              <tr
                key={entry.id}
                role="row"
                className="border-t border-line first:border-t-0"
                data-entry={entry.id}
              >
                <td
                  role="cell"
                  data-cell="rank"
                  className={`${cell} font-mono text-[14px] text-sec`}
                >
                  {entry.rank}
                </td>
                <td role="cell" data-cell="model" className={`${cell} pr-4`}>
                  <div className="flex items-center gap-3">
                    <Marker shape={effortShape(entry.effort)} colour={colour} />
                    <div className="min-w-0">
                      <span className="block font-[650] text-ink">
                        {entry.modelLabel}
                      </span>
                      <span className="mt-px block text-[13.5px] text-sec">
                        {effortLabel(entry.effort)}
                        {partial(entry) === null ? null : `, ${partial(entry)}`}
                        {entry.runsStuart ? (
                          <>
                            ,{" "}
                            <span className="font-semibold text-acc-ink">
                              runs Stuart today
                            </span>
                          </>
                        ) : null}
                      </span>
                    </div>
                  </div>
                </td>
                <td role="cell" data-cell="score" className={`${cell} pr-6`}>
                  <span className="flex items-center gap-3">
                    <span
                      data-part="score-value"
                      className="w-[62px] flex-none text-[20px] font-[650] tracking-[-0.02em] text-ink md:hidden"
                    >
                      {percent(rankValue(entry, by))}
                    </span>
                    <Track entry={entry} by={by} domain={domain} />
                  </span>
                </td>
                {rankOrder.map((metric) => (
                  <td
                    key={metric}
                    role="cell"
                    data-cell="stats"
                    className={`${cell} text-right ${metric === by ? "font-[650] text-ink" : "text-ink2"}`}
                  >
                    <PhoneLabel>{scoreLabels[metric]} </PhoneLabel>
                    {percent(rankValue(entry, metric))}
                  </td>
                ))}
                <td
                  role="cell"
                  data-cell="stats"
                  className={`${cell} text-right font-semibold ${entry.safetyFails === 0 ? "text-pos" : "text-neg"}`}
                >
                  <PhoneLabel>Safety fails </PhoneLabel>
                  {whole(entry.safetyFails)}
                  <span className="mt-px block text-[13.5px] font-medium whitespace-nowrap text-sec">
                    of {whole(entry.answers)} answers
                  </span>
                </td>
                <td
                  role="cell"
                  data-cell="stats"
                  className={`${cell} text-right`}
                >
                  {usd(entry.costPer100Usd)}
                  <PhoneLabel> per 100 answers</PhoneLabel>
                  <span className="mt-px block text-[13.5px] font-medium whitespace-nowrap text-sec">
                    {whole(tokens)} tokens
                  </span>
                </td>
                <td
                  role="cell"
                  data-cell="stats"
                  className={`${cell} text-right`}
                >
                  <PhoneLabel>Median </PhoneLabel>
                  {seconds(entry.medianAnswerMs)}
                  <span className="mt-px block text-[13.5px] font-medium whitespace-nowrap text-sec">
                    {percent(entry.overStuartBudgetShare, 0)} over {stuartLimit}
                  </span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <p className="mt-3 text-[13.5px] text-sec">
        The track runs from {percent(domain.from, 0)} to {percent(domain.to, 0)}
        , not from zero.
        {by === "score"
          ? " The grey line behind each mark spans the entry's best and worst run, a measure of how much its score varies."
          : ""}
      </p>
    </>
  )
}
