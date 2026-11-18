import { type KeyboardEvent, type ReactNode, useId, useState } from "react"
import results from "../data/results"
import type { Entry } from "../data/schema"
import {
  type Axis,
  costAxis,
  effortLabel,
  effortName,
  effortRank,
  effortShape,
  entryName,
  modelColour,
  percent,
  type RankBy,
  type RankedEntry,
  rankValue,
  scoreAxis,
  seconds,
  shortModel,
  timeAxis,
  usd,
  visibleEntries,
  wholeSeconds,
} from "../view/model"
import { Marker, MarkerPath } from "./marker"
import {
  efforts,
  models,
  scoreLabels,
  useSelection,
  withinLabel,
  withinPhrase,
} from "./selection"

/**
 * Score against cost and score against median answer time. Positions are
 * percentages of the plot, so the charts follow the column's width while
 * their text stays at its size. Each model's effort levels are joined in
 * order, so the reader sees what more thinking buys. Every point is
 * focusable and names its entry; the same figures are in the leaderboard
 * table, which is the charts' text alternative.
 */

type Measure = "cost" | "time"

/** Production Stuart's time limit, and the benchmark's own answer budget. */
const stuartLimit = results.run.limits.stuartBudgetMs
const answerBudget = results.run.limits.answerBudgetMs

function pct(share: number): string {
  return `${(share * 100).toFixed(3)}%`
}

// Axes from every entry, so hiding a model never rescales the charts. Each
// score has its own axis: the score within Stuart's limit can sit far lower.
const scoreAxes: Record<RankBy, Axis> = {
  score: scoreAxis(results.entries.map((entry) => entry.score)),
  "ignoring-length": scoreAxis(
    results.entries.map((entry) => entry.scoreIgnoringLength),
  ),
  "within-stuart": scoreAxis(
    results.entries.map((entry) => entry.scoreWithinStuartLimit),
  ),
}
const cost = costAxis(results.entries.map((entry) => entry.costPer100Usd))
const time = timeAxis(
  results.entries.map((entry) => entry.medianAnswerMs),
  stuartLimit,
  answerBudget,
)

export default function ScoreCharts(): ReactNode {
  const { selection } = useSelection()
  const entries = visibleEntries(results.entries, selection)
  const scoreName = scoreLabels[selection.rankBy]
  return (
    <div className="mt-[18px] grid gap-6 lg:grid-cols-2">
      <Chart
        title={`${scoreName} against cost`}
        caption="Up and to the left is better. Cost per 100 answers, on a log scale."
        measure="cost"
        entries={entries}
        rankBy={selection.rankBy}
        score={scoreAxes[selection.rankBy]}
        x={cost}
        xTitle="cost per 100 answers"
      />
      <Chart
        title={`${scoreName} against speed`}
        caption={`Up and to the left is better. Median time to a full answer, tools included, with timeouts at their elapsed time. The dashed line is the ${wholeSeconds(stuartLimit)} Stuart allows in production.${time.log ? " Time on a log scale." : ""}`}
        measure="time"
        entries={entries}
        rankBy={selection.rankBy}
        score={scoreAxes[selection.rankBy]}
        x={time}
        xTitle={
          time.log ? "median answer time, log scale" : "median answer time"
        }
      />
    </div>
  )
}

function value(entry: Entry, measure: Measure): number {
  return measure === "cost" ? entry.costPer100Usd : entry.medianAnswerMs
}

function Chart({
  title,
  caption,
  measure,
  entries,
  rankBy,
  score,
  x,
  xTitle,
}: {
  title: string
  caption: string
  measure: Measure
  entries: RankedEntry[]
  rankBy: RankBy
  score: Axis
  x: Axis
  xTitle: string
}): ReactNode {
  const id = useId()
  const [active, setActive] = useState<string | null>(null)
  const [stop, setStop] = useState<string | null>(null)
  function point(entry: Entry): { left: number; top: number } {
    return {
      left: x.position(value(entry, measure)),
      top: score.position(rankValue(entry, rankBy)),
    }
  }
  const byModel = models
    .map((item) => ({
      ...item,
      line: entries
        .filter((entry) => entry.model === item.model)
        .sort((a, b) => effortRank(a.effort) - effortRank(b.effort)),
    }))
    .filter((item) => item.line.length > 0)
  const labels = placeLabels(
    byModel.map((item) => {
      const last = item.line[item.line.length - 1] as Entry
      return { model: item.model, label: item.label, ...point(last) }
    }),
  )
  const activeEntry = entries.find((entry) => entry.id === active)
  const limit = measure === "time" ? x.position(stuartLimit) : null
  // One tab stop per chart: the points form a roving group in left to right
  // order, and the arrow keys, Home and End move between them.
  const order = [...entries].sort(
    (a, b) => point(a).left - point(b).left || point(a).top - point(b).top,
  )
  const stopId = order.some((entry) => entry.id === stop)
    ? stop
    : (order[0]?.id ?? null)
  function move(event: KeyboardEvent<SVGSVGElement>, from: string): void {
    const index = order.findIndex((entry) => entry.id === from)
    const last = order.length - 1
    const next =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? Math.min(last, index + 1)
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? Math.max(0, index - 1)
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? last
              : null
    if (next === null) return
    event.preventDefault()
    const target = order[next]
    if (target === undefined) return
    setStop(target.id)
    const element = event.currentTarget.ownerSVGElement?.querySelector(
      `[data-point="${target.id}"]`,
    )
    if (element instanceof SVGElement) element.focus()
  }

  return (
    <figure
      className="min-w-0 rounded-[24px] border border-line px-5 py-6 md:px-[26px]"
      aria-labelledby={`${id}-title`}
    >
      <h3 id={`${id}-title`} className="text-[18px] font-[650] text-ink">
        {title}
      </h3>
      <p className="mt-1 text-[14px] text-sec">{caption}</p>
      <div className="relative mt-4 h-[280px] pr-2 pb-11 pl-11 md:h-[300px]">
        <div className="relative h-full w-full">
          {score.ticks.map((tick) => (
            <span
              key={tick.label}
              aria-hidden="true"
              className="absolute right-[calc(100%+8px)] -translate-y-1/2 font-mono text-[11.5px] text-sec"
              style={{ top: pct(tick.at) }}
            >
              {tick.label}
            </span>
          ))}
          <svg
            className="absolute inset-0 h-full w-full overflow-visible"
            aria-labelledby={`${id}-title`}
            aria-describedby={`${id}-desc`}
          >
            <title>{title}</title>
            <desc id={`${id}-desc`}>
              {caption} {entries.length} entries are drawn. The arrow keys move
              from one entry to the next. The leaderboard table above lists the
              same figures.
            </desc>
            <g style={{ stroke: "var(--soft2)" }} strokeWidth={1}>
              {score.ticks.map((tick) => (
                <line
                  key={tick.label}
                  x1="0"
                  x2="100%"
                  y1={pct(tick.at)}
                  y2={pct(tick.at)}
                  strokeDasharray="3 4"
                />
              ))}
              <line x1="0" x2="0" y1="0" y2="100%" />
              <line x1="0" x2="100%" y1="100%" y2="100%" />
            </g>
            {limit === null ? null : (
              <line
                x1={pct(limit)}
                x2={pct(limit)}
                y1="0"
                y2="100%"
                strokeWidth={1.5}
                strokeDasharray="2 4"
                style={{ stroke: "var(--neg)" }}
              />
            )}
            {byModel.map((item) =>
              item.line.slice(1).map((entry, index) => {
                const from = point(item.line[index] as Entry)
                const to = point(entry)
                return (
                  <line
                    key={entry.id}
                    x1={pct(from.left)}
                    y1={pct(from.top)}
                    x2={pct(to.left)}
                    y2={pct(to.top)}
                    strokeWidth={2}
                    style={{ stroke: item.colour, opacity: 0.45 }}
                  />
                )
              }),
            )}
            {entries.map((entry) => {
              const at = point(entry)
              const colour = modelColour(entry.model)
              const label = `${entryName(entry)}: ${scoreLabels.score} ${percent(entry.score)}, ${scoreLabels["ignoring-length"].toLowerCase()} ${percent(entry.scoreIgnoringLength)}, ${withinPhrase} ${percent(entry.scoreWithinStuartLimit)}, ${measure === "cost" ? `${usd(entry.costPer100Usd)} per 100 answers` : `${seconds(entry.medianAnswerMs)} median, ${percent(entry.overStuartBudgetShare, 0)} of answers over ${wholeSeconds(stuartLimit)}`}${entry.runsStuart ? ", runs Stuart today" : ""}`
              return (
                <svg
                  key={entry.id}
                  x={pct(at.left)}
                  y={pct(at.top)}
                  data-point={entry.id}
                  tabIndex={entry.id === stopId ? 0 : -1}
                  role="img"
                  aria-label={label}
                  className="cursor-default overflow-visible outline-none [&:focus-visible>circle:first-child]:stroke-ink"
                  onPointerEnter={() => setActive(entry.id)}
                  onPointerLeave={() => setActive(null)}
                  onFocus={() => {
                    setActive(entry.id)
                    setStop(entry.id)
                  }}
                  onBlur={() => setActive(null)}
                  onKeyDown={(event) => move(event, entry.id)}
                >
                  <circle
                    r={16}
                    style={{ fill: "transparent", strokeWidth: 2 }}
                    className="stroke-transparent"
                  />
                  {entry.runsStuart ? (
                    <circle
                      r={12}
                      strokeDasharray="2 2"
                      style={{
                        fill: "none",
                        stroke: "var(--ink)",
                        strokeWidth: 1.5,
                      }}
                    />
                  ) : null}
                  <MarkerPath
                    shape={effortShape(entry.effort)}
                    colour={colour}
                    r={7}
                  />
                </svg>
              )
            })}
          </svg>
          {labels.map((label) => (
            <span
              key={label.model}
              aria-hidden="true"
              className={`pointer-events-none absolute rounded-md bg-bg/80 px-1 text-[13.5px] font-semibold whitespace-nowrap text-ink ${labelPlacement[label.side]}`}
              style={{ left: pct(label.left), top: pct(label.top) }}
            >
              {label.label}
            </span>
          ))}
          {limit === null ? null : (
            <span
              aria-hidden="true"
              className="absolute bottom-1 -translate-x-[calc(100%+6px)] font-mono text-[11.5px] whitespace-nowrap text-neg"
              style={{ left: pct(limit) }}
            >
              Stuart's {wholeSeconds(stuartLimit)} limit
            </span>
          )}
          {activeEntry === undefined ? null : (
            <Tooltip entry={activeEntry} at={point(activeEntry)} />
          )}
          {x.ticks.map((tick, index) => (
            <span
              key={tick.label}
              aria-hidden="true"
              className={`absolute top-full mt-2 font-mono text-[11.5px] whitespace-nowrap text-sec ${index === 0 ? "" : index === x.ticks.length - 1 ? "-translate-x-full" : "-translate-x-1/2"} ${shortTicks(x, index) ? "max-sm:hidden" : ""}`}
              style={{ left: pct(tick.at) }}
            >
              {tick.label}
            </span>
          ))}
          <span
            aria-hidden="true"
            className="absolute top-full left-1/2 mt-7 -translate-x-1/2 font-mono text-[11.5px] whitespace-nowrap text-sec"
          >
            {xTitle}
          </span>
        </div>
      </div>
      <Legend />
    </figure>
  )
}

/**
 * On phones, the 2, 3 and 5 ticks of a crowded log axis give way to the
 * decades ($0.30 and $30 hide, $0.10 and $10 stay).
 */
function shortTicks(axis: Axis, index: number): boolean {
  const label = axis.ticks[index]?.label ?? ""
  return axis.ticks.length > 6 && /^\$(0\.0*)?[235]/.test(label)
}

type Label = {
  model: string
  label: string
  left: number
  top: number
  /** Beside the point, or over it when the right edge is near. */
  side: "right" | "above"
}

/**
 * One name per model, beside its last effort level, where its line ends.
 * Near the right edge the name sits over the point instead, so it never
 * runs back across the other models' lines; names on the same side are
 * nudged apart when they would touch.
 */
function placeLabels(
  points: readonly {
    model: string
    label: string
    left: number
    top: number
  }[],
): Label[] {
  const placed: Label[] = [...points]
    .sort((a, b) => a.top - b.top)
    .map((item) => ({ ...item, side: item.left > 0.7 ? "above" : "right" }))
  for (let index = 1; index < placed.length; index += 1) {
    const current = placed[index] as Label
    const before = placed
      .slice(0, index)
      .filter((other) => other.side === current.side)
      .at(-1)
    if (before !== undefined && current.top - before.top < 0.08) {
      current.top = before.top + 0.08
    }
  }
  return placed
}

const labelPlacement: Record<Label["side"], string> = {
  right: "translate-x-[14px] -translate-y-1/2",
  above: "-translate-x-[calc(100%-10px)] -translate-y-[calc(100%+12px)]",
}

function Tooltip({
  entry,
  at,
}: {
  entry: Entry
  at: { left: number; top: number }
}): ReactNode {
  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none absolute z-10 w-max max-w-[260px] rounded-2xl bg-ink px-3.5 py-2.5 text-[13px] leading-snug text-bg shadow-pop ${at.left > 0.6 ? "-translate-x-[calc(100%+16px)]" : "translate-x-4"} ${at.top > 0.6 ? "-translate-y-full" : ""}`}
      style={{ left: pct(at.left), top: pct(at.top) }}
    >
      <span className="block font-semibold">
        {shortModel(entry.modelLabel)}, {effortLabel(entry.effort)}
      </span>
      <span className="block">
        {scoreLabels.score} {percent(entry.score)}
      </span>
      <span className="block">
        {scoreLabels["ignoring-length"]} {percent(entry.scoreIgnoringLength)}
      </span>
      <span className="block">
        {withinLabel} {percent(entry.scoreWithinStuartLimit)}
      </span>
      <span className="block">
        {usd(entry.costPer100Usd)} per 100, {seconds(entry.medianAnswerMs)}{" "}
        median, {percent(entry.overStuartBudgetShare, 0)} over{" "}
        {wholeSeconds(stuartLimit)}
      </span>
    </div>
  )
}

function Legend(): ReactNode {
  const { selection } = useSelection()
  return (
    <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-[13.5px] text-sec">
      {models
        .filter((item) => !selection.hidden.has(item.model))
        .map((item) => (
          <span key={item.model} className="inline-flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="inline-block h-[3px] w-4 rounded-full"
              style={{ background: item.colour }}
            />
            {item.label}
          </span>
        ))}
      {efforts.map((effort) => (
        <span key={effort} className="inline-flex items-center gap-1.5">
          <Marker shape={effortShape(effort)} colour="var(--sec)" size={12} />
          {effortName(effort)}
        </span>
      ))}
      {results.entries.some((entry) => entry.runsStuart) ? (
        <span className="inline-flex items-center gap-1.5">
          <svg aria-hidden="true" width="14" height="14" viewBox="-7 -7 14 14">
            <circle
              r="6"
              strokeDasharray="2 2"
              style={{ fill: "none", stroke: "var(--ink)", strokeWidth: 1.5 }}
            />
          </svg>
          Runs Stuart today
        </span>
      ) : null}
    </div>
  )
}
