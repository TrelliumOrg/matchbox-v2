import type {
  Answer,
  Entry,
  FailureType,
  Kind,
  PublicQuestion,
  SiteResults,
} from "../data/schema"

/**
 * Everything the page computes from the results file, apart from React:
 * ranks, labels, colours, the reader's filters, chart scales and the rows
 * of the grid and the two cards. Pure functions, unit tested.
 */

// Ranks and labels

/**
 * Effort levels from least to most thinking, as the contract lists them
 * (benchEffortSchema). Unknown levels sort last.
 */
export const effortOrder = ["low", "medium", "high", "xhigh", "max"]

export function effortRank(effort: string): number {
  const index = effortOrder.indexOf(effort)
  return index === -1 ? effortOrder.length : index
}

const effortWords: Record<string, string> = { xhigh: "extra high" }

/** "extra high effort". */
export function effortLabel(effort: string): string {
  return `${effortWords[effort] ?? effort} effort`
}

/** "Extra high", for a control that picks an effort level. */
export function effortName(effort: string): string {
  const words = effortWords[effort] ?? effort
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** "2 of 3 runs" while an entry has not finished every run, else null. */
export function partialRuns(entry: Entry, runsPerEntry: number): string | null {
  if (entry.runs >= runsPerEntry) return null
  return `${entry.runs} of ${runsPerEntry} runs`
}

export type RankedEntry = Entry & { rank: number }

/**
 * The three scores the leaderboard ranks by:
 * - "score" (Inside Stuart): the sentence had to pass Stuart's rules and
 *   every check.
 * - "ignoring-length": a sentence Stuart refused only for its length is
 *   graded on its content (scoreIgnoringLength).
 * - "within-stuart": an answer also fails past production Stuart's time and
 *   output limits (scoreWithinStuartLimit).
 */
export type RankBy = "score" | "ignoring-length" | "within-stuart"

export const rankOrder: readonly RankBy[] = [
  "score",
  "ignoring-length",
  "within-stuart",
]

export function rankValue(entry: Entry, by: RankBy): number {
  if (by === "score") return entry.score
  if (by === "ignoring-length") return entry.scoreIgnoringLength
  return entry.scoreWithinStuartLimit
}

/** "Inside Stuart", "Ignoring length", "Within 20 s". */
export function scoreName(by: RankBy, stuartBudgetMs: number): string {
  if (by === "score") return "Inside Stuart"
  if (by === "ignoring-length") return "Ignoring length"
  return `Within ${wholeSeconds(stuartBudgetMs)}`
}

/** Each score in one plain line. */
export function scoreLine(by: RankBy, stuartBudgetMs: number): string {
  if (by === "score")
    return "The answer had to pass Stuart's display rules and every check, as a user would see it."
  if (by === "ignoring-length")
    return "An answer Stuart refused only for being over two sentences or 280 characters is graded on its content. Unsourced numbers, claims to have acted and safety checks still fail."
  return `Inside Stuart, and an answer also fails when it took longer than the ${wholeSeconds(stuartBudgetMs)} Stuart allows in production.`
}

/**
 * The run to run spread of an entry: the gap between its best and worst run
 * on the main score. Only the main score is published per run, so it is the
 * noise estimate for all three scores.
 */
export function runSpread(entry: Entry): number {
  if (entry.scoreRuns.length < 2) return 0
  return Math.max(...entry.scoreRuns) - Math.min(...entry.scoreRuns)
}

/**
 * Highest score first, then the other scores, then the cheaper entry. The
 * key is the printed value (percentTenths, which percent() prints), so two
 * entries share a rank exactly when the page shows the same score, and a
 * lower printed score never sits above a higher one.
 */
export function rankEntries(
  entries: readonly Entry[],
  by: RankBy = "score",
): RankedEntry[] {
  const others = rankOrder.filter((metric) => metric !== by)
  function shown(entry: Entry, metric: RankBy): number {
    return percentTenths(rankValue(entry, metric))
  }
  const sorted = [...entries].sort(
    (a, b) =>
      shown(b, by) - shown(a, by) ||
      others.reduce(
        (result, metric) => result || shown(b, metric) - shown(a, metric),
        0,
      ) ||
      a.costPer100Usd - b.costPer100Usd ||
      a.id.localeCompare(b.id),
  )
  return sorted.map((entry) => ({
    ...entry,
    rank:
      1 + sorted.filter((item) => shown(item, by) > shown(entry, by)).length,
  }))
}

// Models and their colours

/** "Haiku 5.5" from "Claude Haiku 5.5": the short name charts and grids use. */
export function shortModel(label: string): string {
  return label.replace(/^Claude /, "")
}

export type ModelInfo = { model: string; label: string; colour: string }

const familyColours: Record<string, string> = {
  haiku: "var(--bench-haiku)",
  sonnet: "var(--bench-sonnet)",
  opus: "var(--bench-opus)",
}

/**
 * One colour per model, by its family, so a colour never moves when the
 * reader hides a model. A model from an unknown family is drawn in ink.
 */
export function modelColour(model: string): string {
  const family = Object.keys(familyColours).find((name) => model.includes(name))
  return family === undefined ? "var(--ink2)" : (familyColours[family] ?? "")
}

/** The models in the file, smallest first (by their cheapest entry). */
export function modelsOf(entries: readonly Entry[]): ModelInfo[] {
  const cheapest = new Map<string, number>()
  const labels = new Map<string, string>()
  for (const entry of entries) {
    labels.set(entry.model, entry.modelLabel)
    cheapest.set(
      entry.model,
      Math.min(cheapest.get(entry.model) ?? Infinity, entry.costPer100Usd),
    )
  }
  return [...labels.keys()]
    .sort((a, b) => (cheapest.get(a) ?? 0) - (cheapest.get(b) ?? 0))
    .map((model) => ({
      model,
      label: shortModel(labels.get(model) ?? model),
      colour: modelColour(model),
    }))
}

/** The effort levels in the file, least thinking first. */
export function effortsOf(entries: readonly Entry[]): string[] {
  return [...new Set(entries.map((entry) => entry.effort))].sort(
    (a, b) => effortRank(a) - effortRank(b) || a.localeCompare(b),
  )
}

export type MarkerShape = "ring" | "circle" | "square" | "diamond" | "triangle"

/** In effortOrder: low, medium, high, extra high, max. */
const shapes: readonly MarkerShape[] = [
  "circle",
  "square",
  "diamond",
  "triangle",
  "ring",
]

/**
 * One marker shape per effort level, so effort never rests on colour. Fixed
 * per level, so a shape means the same in every run.
 */
export function effortShape(effort: string): MarkerShape {
  return shapes[Math.min(effortRank(effort), shapes.length - 1)] ?? "circle"
}

// The reader's filters

/**
 * Which entries the grid, the two cards and the question's answers show:
 * each model's best entry, every entry, or one effort level.
 */
export type EffortView = "best" | "all" | { effort: string }

export type Selection = {
  /** Models the reader has hidden. */
  hidden: ReadonlySet<string>
  effortView: EffortView
  rankBy: RankBy
}

export const defaultSelection: Selection = {
  hidden: new Set(),
  effortView: "best",
  rankBy: "score",
}

export function toggleModel(selection: Selection, model: string): Selection {
  const hidden = new Set(selection.hidden)
  if (hidden.has(model)) hidden.delete(model)
  else hidden.add(model)
  return { ...selection, hidden }
}

/** Entries of the models the reader has not hidden, best first. */
export function visibleEntries(
  entries: readonly Entry[],
  selection: Selection,
): RankedEntry[] {
  return rankEntries(entries, selection.rankBy).filter(
    (entry) => !selection.hidden.has(entry.model),
  )
}

/** The entries the grid and the cards show, best first. */
export function focusEntries(
  entries: readonly Entry[],
  selection: Selection,
): RankedEntry[] {
  const visible = visibleEntries(entries, selection)
  const view = selection.effortView
  if (view === "all") return visible
  if (view === "best") {
    const seen = new Set<string>()
    return visible.filter((entry) => {
      if (seen.has(entry.model)) return false
      seen.add(entry.model)
      return true
    })
  }
  return visible.filter((entry) => entry.effort === view.effort)
}

export function sameEffortView(a: EffortView, b: EffortView): boolean {
  if (typeof a === "string" || typeof b === "string") return a === b
  return a.effort === b.effort
}

/** "Opus 5.5, high effort". */
export function entryName(entry: Entry): string {
  return `${entry.modelLabel}, ${effortLabel(entry.effort)}`
}

// Numbers

/**
 * A share as a whole number of printed units (tenths of a point with one
 * digit). Never the extreme a share does not reach: below 1 never prints
 * 100, above 0 never prints 0.
 */
function percentUnits(share: number, digits: number): number {
  const scale = 10 ** digits
  const units = Math.round(share * 100 * scale)
  if (share < 1 && units >= 100 * scale) return 100 * scale - 1
  if (share > 0 && units <= 0) return 1
  return units
}

/** The rank key: exactly the number percent() prints, in tenths. */
export function percentTenths(share: number): number {
  return percentUnits(share, 1)
}

/** "66.7%". The printed value the ranks are keyed on. */
export function percent(share: number, digits = 1): string {
  const scale = 10 ** digits
  return `${(percentUnits(share, digits) / scale).toFixed(digits)}%`
}

/** A CSS width for a share: exact, never clamped. */
export function cssPercent(share: number): string {
  return `${(Math.min(1, Math.max(0, share)) * 100).toFixed(3)}%`
}

/**
 * Whole percentages for parts of one total that add up to exactly 100
 * (largest remainder), so a summary never reads 99% or 101%.
 */
export function wholeShares(shares: readonly number[]): number[] {
  const total = shares.reduce((sum, share) => sum + share, 0)
  if (total <= 0) return shares.map(() => 0)
  const raw = shares.map((share) => (share / total) * 100)
  const floors = raw.map(Math.floor)
  let left = 100 - floors.reduce((sum, value) => sum + value, 0)
  const order = raw
    .map((value, index) => ({ index, rest: value - Math.floor(value) }))
    .sort((a, b) => b.rest - a.rest)
  for (const { index } of order) {
    if (left <= 0) break
    floors[index] = (floors[index] ?? 0) + 1
    left -= 1
  }
  // A share above zero never prints 0%: it takes a point from the largest.
  shares.forEach((share, index) => {
    if (share <= 0 || (floors[index] ?? 0) > 0) return
    const largest = floors.indexOf(Math.max(...floors))
    floors[largest] = (floors[largest] ?? 0) - 1
    floors[index] = 1
  })
  return floors
}

export function usd(amount: number): string {
  if (amount > 0 && amount < 0.01) return "under $0.01"
  return `$${amount.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

export function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)} s`
}

export function whole(value: number): string {
  return Math.round(value).toLocaleString("en-US")
}

const months = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
]

/** "17 Nov 2026", in UTC so the build and the reader agree. */
export function day(iso: string): string {
  const date = new Date(iso)
  return `${date.getUTCDate()} ${months[date.getUTCMonth()]} ${date.getUTCFullYear()}`
}

/** "08:00 UTC". */
export function time(iso: string): string {
  const date = new Date(iso)
  const pad = (value: number) => String(value).padStart(2, "0")
  return `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())} UTC`
}

/** "1 h 42 min". */
export function duration(fromIso: string, toIso: string): string {
  const minutes = Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 60000)
  const hours = Math.floor(minutes / 60)
  if (hours === 0) return `${minutes} min`
  return `${hours} h ${minutes % 60} min`
}

// Chart scales. Positions are shares of the plot, 0 to 1, from the left
// and from the top, so the charts are fluid and their text never scales.

export type Tick = { at: number; label: string }

export type Axis = {
  position: (value: number) => number
  ticks: Tick[]
}

/**
 * The score axis, top is high: 2 point steps, wider as the spread grows so
 * there are never more than about ten ticks.
 */
export function scoreAxis(scores: readonly number[]): Axis {
  const low = Math.min(...scores)
  const high = Math.max(...scores)
  const spread = high - low
  const step =
    spread > 0.5 ? 0.2 : spread > 0.25 ? 0.1 : spread > 0.12 ? 0.05 : 0.02
  const from = Math.max(0, Math.floor((low - 0.004) / step) * step)
  const to = Math.min(1, Math.ceil((high + 0.004) / step) * step)
  const span = to - from || step
  const ticks: Tick[] = []
  for (let value = from; value <= to + 1e-9; value += step) {
    ticks.push({
      at: 1 - (value - from) / span,
      label: `${Math.round(value * 100)}%`,
    })
  }
  return {
    position: (value) => 1 - (value - from) / span,
    ticks,
  }
}

/** Cost per 100 answers on a log scale, whole decades, ticks at 1, 2 and 5. */
export function costAxis(costs: readonly number[]): Axis {
  const positive = costs.filter((cost) => cost > 0)
  const low = Math.min(...positive, 1)
  const high = Math.max(...positive, low * 10)
  const from = Math.floor(Math.log10(low))
  const to = Math.max(from + 1, Math.ceil(Math.log10(high)))
  const position = (value: number) =>
    (Math.log10(Math.max(value, 10 ** from)) - from) / (to - from)
  const ticks: Tick[] = []
  // Fewer ticks as the range widens, so labels never touch.
  const decades = to - from
  const steps = decades > 3 ? [1] : decades === 3 ? [1, 3] : [1, 2, 5]
  for (let decade = from; decade <= to; decade += 1) {
    for (const step of steps) {
      const value = step * 10 ** decade
      if (value > 10 ** to * 1.0001) continue
      ticks.push({ at: position(value), label: costTick(value) })
    }
  }
  return { position, ticks }
}

function costTick(value: number): string {
  if (value >= 1) return `$${value.toFixed(0)}`
  return `$${value.toFixed(Math.max(2, -Math.floor(Math.log10(value))))}`
}

/** "20 s". */
export function wholeSeconds(ms: number): string {
  return `${Math.round(ms / 100) / 10} s`
}

/** "64,000 tokens". */
export function tokens(count: number): string {
  return `${whole(count)} tokens`
}

export type TimeAxis = Axis & { log: boolean }

/**
 * Median answer time.
 * - Linear from zero while the medians sit near Stuart's limit and close
 *   together, so the limit line keeps its place.
 * - A log scale when the slowest median is more than six times the fastest
 *   (3 s and 24 s: the fast entries would bunch at the left edge), ending a
 *   little past the slowest median, with ticks at 1, 2, 5, 10 and 20 s.
 * - A log scale up to the benchmark's own answer budget when a median runs
 *   well past Stuart's limit.
 */
export function timeAxis(
  times: readonly number[],
  limitMs: number,
  budgetMs: number,
): TimeAxis {
  const slowest = Math.max(...times, limitMs)
  const fastest = Math.max(1, Math.min(...times))
  const pastLimit = slowest > limitMs * 1.5
  // The spread of the medians themselves, not of the medians and the limit.
  const spread = Math.max(...times, fastest) / fastest
  if (!pastLimit && spread <= 6) {
    const to = Math.ceil((slowest * 1.08) / 5000) * 5000
    const ticks: Tick[] = []
    for (let value = 0; value <= to; value += 5000) {
      ticks.push({ at: value / to, label: `${value / 1000} s` })
    }
    return { position: (value) => value / to, ticks, log: false }
  }
  const from = Math.min(1000, 10 ** Math.floor(Math.log10(fastest)))
  const to = pastLimit
    ? Math.max(budgetMs, slowest)
    : Math.ceil((slowest * 1.15) / 5000) * 5000
  const span = Math.log10(to) - Math.log10(from)
  function position(value: number): number {
    return (
      (Math.log10(Math.min(Math.max(value, from), to)) - Math.log10(from)) /
      span
    )
  }
  const marks = [500, 1000, 2000, 5000, 10_000, 20_000, 50_000, 120_000]
  if (!pastLimit) {
    // Round marks only: the end of the axis is unlabelled, so the 20 s mark
    // keeps its label.
    const ticks = marks
      .filter((ms) => ms >= from && ms <= to)
      .map((ms) => ({ at: position(ms), label: wholeSeconds(ms) }))
    return { position, ticks, log: true }
  }
  // The end of the axis always has its label; a mark too close to it gives
  // way, so two labels never overlap.
  const ticks = marks
    .filter((ms) => ms >= from && 1 - position(ms) > 0.2)
    .map((ms) => ({ at: position(ms), label: wholeSeconds(ms) }))
  ticks.push({ at: 1, label: wholeSeconds(to) })
  return { position, ticks, log: true }
}

// Where each model is strong

/** The score range a scale covers, in whole tens of points. */
export type Domain = { from: number; to: number }

/**
 * The scale for a set of scores: the nearest tens of points around them
 * (0.375 to 0.781 gives 30% to 80%), at least 20 points wide. Never forced
 * to zero, and stated wherever it is drawn.
 */
export function scoreDomain(scores: readonly number[]): Domain {
  if (scores.length === 0) return { from: 0, to: 1 }
  let from = Math.floor(Math.min(...scores) * 10) / 10
  let to = Math.ceil(Math.max(...scores) * 10) / 10
  if (to - from < 0.2) {
    to = Math.min(1, to + 0.1)
    from = Math.max(0, to - 0.2)
  }
  return { from: Math.round(from * 10) / 10, to: Math.round(to * 10) / 10 }
}

/** Where a score sits on a domain, 0 to 1. */
export function domainPosition(score: number, domain: Domain): number {
  const span = domain.to - domain.from || 1
  return Math.min(1, Math.max(0, (score - domain.from) / span))
}

/**
 * A cell's background: one hue, lightest at the bottom of the grid's range
 * and darkest at the top (a sequential scale, so darker means higher and
 * nothing suggests a midpoint). Theme colours mixed in the browser, so it
 * follows dark mode. The score is always printed in the cell too.
 */
export function kindTint(score: number, domain: Domain): string {
  const strength = Math.round(6 + domainPosition(score, domain) * 46)
  return `color-mix(in oklab, var(--pos) ${strength}%, var(--bg))`
}

/**
 * An entry's score on one kind, for the chosen score where the data has it.
 * The data has per-kind figures for Inside Stuart and Ignoring length only,
 * so Within 20 s shows Inside Stuart's (gridScoreFor says which).
 */
export function kindScore(
  entry: Entry,
  kind: string,
  by: RankBy = "score",
): number | undefined {
  const item = entry.byKind.find((each) => each.kind === kind)
  if (item === undefined) return undefined
  return gridScoreFor(by) === "ignoring-length"
    ? item.scoreIgnoringLength
    : item.score
}

/** The score the grid can show for a chosen score. */
export function gridScoreFor(by: RankBy): RankBy {
  return by === "within-stuart" ? "score" : by
}

/** "93", the cell's text: a whole percentage, never rounded up to 100. */
export function cellScore(score: number): string {
  return String(percentUnits(score, 0))
}

// How they fail

/**
 * One colour per group of failure types in the stacked bars. Safety types
 * always get their own reds. Of the rest, the most frequent across every
 * entry get their own colours and the others share "Other", so the bars
 * stay readable as the contract adds types. Computed from every entry, so a
 * colour never moves when the reader hides a model.
 */
export type FailureGroup = {
  key: string
  label: string
  colour: string
  types: FailureType[]
  safety: boolean
}

export type FailureSegment = { group: FailureGroup; count: number }

export type FailureRow = {
  entry: RankedEntry
  segments: FailureSegment[]
  /** Every failure type with a count, for the text alternative. */
  details: { type: FailureType; count: number }[]
  /** Failed checks, summed over the entry's runs. */
  total: number
  /** Answers the entry gave: every question in each of its runs. */
  answers: number
  /** Failed checks per 100 answers, so entries with fewer runs compare. */
  per100: number
}

/**
 * Answers an entry gave: each question once per finished run. Counts summed
 * across runs (safety fails, failed checks) are read against this, so an
 * entry with fewer runs does not look safer.
 */
export function answersGiven(entry: Entry, questions: number): number {
  return questions * entry.runs
}

/** "1.2": a count per 100 answers, one decimal. */
export function per100(count: number, answers: number): string {
  if (answers <= 0) return "0"
  const value = (count / answers) * 100
  if (count > 0 && value < 0.05) return "under 0.1"
  return value.toFixed(1)
}

const failureColours = [
  "var(--bench-fail-1)",
  "var(--bench-fail-2)",
  "var(--bench-fail-3)",
  "var(--bench-fail-4)",
  "var(--bench-fail-6)",
  "var(--bench-fail-7)",
  "var(--bench-fail-8)",
]
const otherColour = "var(--bench-fail-5)"
const safetyColours = ["var(--neg)", "var(--bench-safety-2)"]

function failureCount(entry: Entry, type: string): number {
  return entry.failures.find((failure) => failure.type === type)?.count ?? 0
}

export function failureGroups(
  entries: readonly Entry[],
  types: readonly FailureType[],
): FailureGroup[] {
  const totals = new Map(
    types.map((type) => [
      type.id,
      entries.reduce((sum, entry) => sum + failureCount(entry, type.id), 0),
    ]),
  )
  const seen = types.filter((type) => (totals.get(type.id) ?? 0) > 0)
  const plain = seen.filter((type) => !type.safety)
  const coloured = new Set(
    [...plain]
      .sort((a, b) => (totals.get(b.id) ?? 0) - (totals.get(a.id) ?? 0))
      .slice(0, failureColours.length)
      .map((type) => type.id),
  )
  const groups: FailureGroup[] = plain
    .filter((type) => coloured.has(type.id))
    .map((type, index) => ({
      key: type.id,
      label: type.label,
      colour: failureColours[index] ?? otherColour,
      types: [type],
      safety: false,
    }))
  const rest = plain.filter((type) => !coloured.has(type.id))
  if (rest.length > 0) {
    groups.push({
      key: "other",
      label: "Other",
      colour: otherColour,
      types: rest,
      safety: false,
    })
  }
  seen
    .filter((type) => type.safety)
    .forEach((type, index) => {
      groups.push({
        key: type.id,
        label: `Safety: ${type.label.toLowerCase().replace(/\b(stuart|mezo)\b/g, (name) => name.charAt(0).toUpperCase() + name.slice(1))}`,
        colour: safetyColours[Math.min(index, safetyColours.length - 1)] ?? "",
        types: [type],
        safety: true,
      })
    })
  return groups
}

export function failureRows(
  entries: readonly RankedEntry[],
  groups: readonly FailureGroup[],
  questions: number,
): FailureRow[] {
  return entries.map((entry) => {
    const answers = answersGiven(entry, questions)
    const segments = groups
      .map((group) => ({
        group,
        count: group.types.reduce(
          (sum, type) => sum + failureCount(entry, type.id),
          0,
        ),
      }))
      .filter((segment) => segment.count > 0)
    const details = groups
      .flatMap((group) => group.types)
      .map((type) => ({ type, count: failureCount(entry, type.id) }))
      .filter((detail) => detail.count > 0)
    const total = segments.reduce((sum, segment) => sum + segment.count, 0)
    return {
      entry,
      segments,
      details,
      total,
      answers,
      per100: answers > 0 ? (total / answers) * 100 : 0,
    }
  })
}

/**
 * "3 failed checks in 402 answers: 2 asked when it should answer, 1 invented
 * address". Every type, named, with the answers they are out of.
 */
export function failureSummary(row: FailureRow): string {
  if (row.total === 0)
    return `no failed checks in ${whole(row.answers)} answers`
  const checks = row.total === 1 ? "failed check" : "failed checks"
  return `${whole(row.total)} ${checks} in ${whole(row.answers)} answers: ${row.details
    .map(
      (detail) =>
        `${detail.count} ${detail.type.label.toLowerCase().replace(/\b(stuart|mezo)\b/g, (name) => name.charAt(0).toUpperCase() + name.slice(1))}`,
    )
    .join(", ")}`
}

// Agreement between runs

/** The agreement shares as whole percentages that add up to 100. */
export function agreementPercents(
  entry: Entry,
): { always: number; sometimes: number; never: number } | null {
  if (entry.agreement === null) return null
  const { always, sometimes, never } = entry.agreement
  const [a = 0, s = 0, n = 0] = wholeShares([always, sometimes, never])
  return { always: a, sometimes: s, never: n }
}

export function agreementSummary(entry: Entry): string {
  const shares = agreementPercents(entry)
  if (shares === null) return "fewer than two runs"
  return `${shares.always}% right every run, ${shares.sometimes}% in some, ${shares.never}% never`
}

/**
 * Bar segments that never vanish: a share above zero gets at least a
 * sliver (`floor` of the bar), so 1% "never right" stays visible. The text
 * alternative keeps the true shares.
 */
export function visibleShares(
  shares: readonly number[],
  floor = 0.025,
): number[] {
  const total = shares.reduce((sum, share) => sum + Math.max(0, share), 0)
  if (total <= 0) return shares.map(() => 0)
  const raised = shares.map((share) =>
    share > 0 ? Math.max(share / total, floor) : 0,
  )
  // Normalised to add up to 1: the bars size segments with flex-grow, and
  // flex-grow factors adding up to less than 1 fill only that fraction of
  // the bar (reason shares of 0.31 filled 31% of it).
  const sum = raised.reduce((acc, value) => acc + value, 0)
  return raised.map((value) => value / sum)
}

/** Entries with agreement figures, and those left out (fewer than two runs). */
export function agreementSplit<T extends Entry>(
  entries: readonly T[],
): { shown: T[]; left: T[] } {
  return {
    shown: entries.filter((entry) => entry.agreement !== null),
    left: entries.filter((entry) => entry.agreement === null),
  }
}

// Answers Stuart replaced with its own template

/**
 * Why an answer's own words were not credited, in the order the contract
 * lists the reasons (benchRejectionReasons, which follows Stuart's own
 * answer check: the first that fails is the reason recorded). Labels come
 * from the file's rejectionTypes. One colour per reason, by that order, so a
 * colour never moves: a reason added later ("instruction") is appended to
 * the contract's list and takes the next colour.
 */
const rejectionColours = [
  "var(--bench-fail-1)",
  "var(--bench-fail-2)",
  "var(--bench-fail-7)",
  "var(--bench-fail-4)",
  "var(--bench-fail-3)",
  "var(--bench-fail-6)",
  "var(--bench-fail-8)",
  "var(--bench-fail-5)",
  "var(--bench-fail-9)",
  "var(--bench-fail-10)",
]

/** The reasons that are about length: Stuart's two sentence and 280 character limits. */
export const lengthReasons: readonly string[] = [
  "too_many_sentences",
  "too_long",
]

export type RejectionType = { id: string; label: string }

export function rejectionColour(
  reason: string,
  types: readonly RejectionType[],
): string {
  const index = types.findIndex((type) => type.id === reason)
  return index === -1
    ? "var(--bench-fail-5)"
    : (rejectionColours[index % rejectionColours.length] ?? "var(--sec)")
}

export function rejectionLabel(
  reason: string,
  types: readonly RejectionType[],
): string {
  return (
    types.find((type) => type.id === reason)?.label ??
    reason.replaceAll("_", " ")
  )
}

/**
 * Why Stuart showed its own text instead of the model's sentence, in the
 * file's words, or null when the model's own words were shown or no reason
 * was given (a card, or the out of scope line).
 */
export function templateNote(
  answer: Answer,
  types: readonly RejectionType[],
): string | null {
  if (answer.answerFrom === "model" || answer.rejectedReason === null)
    return null
  const label = rejectionLabel(answer.rejectedReason, types)
  return label.charAt(0).toLowerCase() + label.slice(1)
}

/** Part of what a card showed: a run of short values, or one longer line. */
export type CardGroup =
  | { kind: "values"; items: string[] }
  | { kind: "line"; text: string }
  | { kind: "data"; text: string }

export type ShownParts = {
  /** The response's title, the first line. */
  title: string
  /** The answer sentence the user read, the second line. */
  sentence: string
  /** Everything after it, in order, each distinct line once. */
  card: CardGroup[]
  /** Lines left out because they repeat the title, the sentence or a row. */
  repeats: number
}

/** A row short enough to sit in a grid of values: no sentence, no data. */
const shortValue = 32

/**
 * Splits an answer's `shown` text into the sentence the user read and what
 * the card around it showed. The runner writes `shown` as Stuart's
 * response, one part per line, in a fixed order (shownText in
 * apps/stuart/bench/grade.ts): the title, the answer sentence, then the
 * why lines, card prompts and options, ballot and ranking rows, structured
 * blocks as JSON, and the facts. So the second line is the sentence: the
 * model's own when answerFrom is "model", Stuart's when it is "template".
 * A text of one line is all sentence. shownIsClean checks a file holds to
 * this, and the unit tests run it over every published answer.
 */
export function splitShown(shown: string): ShownParts {
  const lines = shown.split(/\r?\n/).map((line) => line.trim())
  if (lines.length < 2) {
    return { title: "", sentence: lines[0] ?? "", card: [], repeats: 0 }
  }
  const [title = "", sentence = "", ...rest] = lines
  const seen = new Set([title, sentence])
  const card: CardGroup[] = []
  let repeats = 0
  for (const row of rest) {
    if (row === "") continue
    if (seen.has(row)) {
      repeats += 1
      continue
    }
    seen.add(row)
    if (row.startsWith("{") && row.endsWith("}")) {
      card.push({ kind: "data", text: row })
    } else if (row.length <= shortValue && !/[.?!]$/.test(row)) {
      const last = card.at(-1)
      if (last?.kind === "values") last.items.push(row)
      else card.push({ kind: "values", items: [row] })
    } else {
      card.push({ kind: "line", text: row })
    }
  }
  return { title, sentence, card, repeats }
}

/**
 * Whether `shown` has the shape splitShown reads: a title line, then one
 * sentence line that ends as a sentence does and fits Stuart's longest
 * limit (400 characters, for Mezo support).
 */
export function shownIsClean(shown: string): boolean {
  const lines = shown.split(/\r?\n/)
  const sentence = lines[1]?.trim() ?? ""
  return (
    lines.length >= 2 &&
    sentence !== "" &&
    sentence.length <= 400 &&
    /[.?!)%]$/.test(sentence)
  )
}

export type RejectionRow = {
  entry: RankedEntry
  /** Graded answers: every question once per finished run. */
  answers: number
  /** Answers whose own words were not credited. */
  total: number
  /** The entry's rejectedShare. */
  share: number
  segments: {
    reason: string
    label: string
    colour: string
    count: number
    share: number
  }[]
}

/**
 * "Answers Stuart did not show": per entry, rejectedShare split by the
 * reason shares, in the contract's order. Shares of answers, so entries with
 * fewer runs compare. The contract checks the counts add up.
 */
export function rejectionRows(
  entries: readonly RankedEntry[],
  types: readonly RejectionType[],
): RejectionRow[] {
  const order = (reason: string) => {
    const index = types.findIndex((type) => type.id === reason)
    return index === -1 ? types.length : index
  }
  return entries.map((entry) => ({
    entry,
    answers: entry.answers,
    total: entry.rejectedAnswers,
    share: entry.rejectedShare,
    segments: [...entry.rejectionReasons]
      .filter((item) => item.count > 0)
      .sort((a, b) => order(a.reason) - order(b.reason))
      .map((item) => ({
        reason: item.reason,
        label: rejectionLabel(item.reason, types),
        colour: rejectionColour(item.reason, types),
        count: item.count,
        share: item.share,
      })),
  }))
}

/** "175 of 429 answers not shown (40.8%): 94 more than two sentences ...". */
export function rejectionSummary(row: RejectionRow): string {
  if (row.total === 0)
    return `every answer's own words credited, ${whole(row.answers)} answers`
  return `${whole(row.total)} of ${whole(row.answers)} answers not shown (${percent(row.share)}): ${row.segments
    .map(
      (item) =>
        `${item.count} ${item.label.charAt(0).toLowerCase()}${item.label.slice(1)}`,
    )
    .join(", ")}`
}

/** The share of an entry's rejected answers that were refused for length. */
export function lengthShareOfRejections(entries: readonly Entry[]): number {
  let length = 0
  let all = 0
  for (const entry of entries) {
    for (const item of entry.rejectionReasons) {
      all += item.count
      if (lengthReasons.includes(item.reason)) length += item.count
    }
  }
  return all === 0 ? 0 : length / all
}

/** The fewest and the most runs any entry finished. */
export function runRange(entries: readonly Entry[]): {
  fewest: number
  most: number
} {
  if (entries.length === 0) return { fewest: 0, most: 0 }
  const runs = entries.map((entry) => entry.runs)
  return { fewest: Math.min(...runs), most: Math.max(...runs) }
}

/** "3 runs", or "1 to 3 runs" when entries finished different numbers. */
export function runsText(entries: readonly Entry[]): string {
  const { fewest, most } = runRange(entries)
  const noun = most === 1 ? "run" : "runs"
  return fewest === most ? `${most} ${noun}` : `${fewest} to ${most} ${noun}`
}

/** Kinds that have questions: a kind with none is never shown or counted. */
export function activeKinds(kinds: readonly Kind[]): Kind[] {
  return kinds.filter((kind) => kind.questions > 0)
}

// The published questions

export function kindLabel(kinds: readonly Kind[], id: string): string {
  return kinds.find((kind) => kind.id === id)?.label ?? id
}

/** "Wrong premises, 3 of 8": the question's place among its kind. */
export function questionPlace(
  questions: readonly Pick<PublicQuestion, "kind">[],
  index: number,
  kinds: readonly Kind[],
): string {
  const question = questions[index]
  if (question === undefined) return ""
  const sameKind = questions.filter((other) => other.kind === question.kind)
  return `${kindLabel(kinds, question.kind)}, ${sameKind.indexOf(question) + 1} of ${sameKind.length}`
}

export function wrapIndex(index: number, length: number): number {
  if (length === 0) return 0
  return ((index % length) + length) % length
}

/**
 * "Number off (2), wrong tool": an answer's failed checks by type, named
 * from failureTypes. The file lists one id per failed check.
 */
export function failureLabels(
  ids: readonly string[],
  types: readonly FailureType[],
): string[] {
  const counts = new Map<string, number>()
  for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1)
  return [...counts].map(([id, count]) => {
    const label = types.find((type) => type.id === id)?.label ?? id
    return count > 1 ? `${label} (${count})` : label
  })
}

/** The facts in the hero. */
export function heroFacts(
  results: SiteResults,
): { value: string; label: string }[] {
  const models = modelsOf(results.entries).length
  const { fewest, most } = runRange(results.entries)
  const kinds = activeKinds(results.kinds).length
  return [
    {
      value: String(results.run.questions),
      label: `questions, ${kinds} ${kinds === 1 ? "kind" : "kinds"}`,
    },
    fewest === most
      ? {
          value: `${results.entries.length} × ${most}`,
          label: `entries from ${models} models, runs each`,
        }
      : {
          value: String(results.entries.length),
          label: `entries from ${models} models, ${fewest} to ${most} runs each`,
        },
    {
      value: String(results.run.publicQuestions),
      label: "questions published",
    },
    { value: usd(results.run.totalCostUsd), label: "spent, retries included" },
  ]
}
