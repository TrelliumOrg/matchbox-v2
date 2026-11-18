import type { Entry, SiteResults } from "../data/schema"
import {
  effortLabel,
  effortRank,
  lengthReasons,
  lengthShareOfRejections,
  percent,
  type RankBy,
  rankOrder,
  rankValue,
  rejectionLabel,
  runSpread,
  scoreName,
  seconds,
  shortModel,
  wholeSeconds,
} from "./model"

/**
 * "What this run shows": a few plain findings computed from the results
 * file, never written by hand, so they stay true for the next run. Each
 * generator returns null when its statement does not hold for the data, and
 * the statement is then left out.
 *
 * A lead counts only when it is larger than the run to run spread of both
 * entries (the gap between their best and worst run on the main score, the
 * only score published per run). Closer than that, entries are level.
 */

export type Finding = { id: string; text: string }

/** "two", "three", up to ten, then digits. */
function count(n: number): string {
  const words = [
    "no",
    "one",
    "two",
    "three",
    "four",
    "five",
    "six",
    "seven",
    "eight",
    "nine",
    "ten",
  ]
  return words[n] ?? String(n)
}

/** "a, b and c". */
function list(items: readonly string[]): string {
  if (items.length <= 1) return items.join("")
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`
}

/** "Sonnet 5.5 at max effort". */
export function entryPhrase(entry: Entry): string {
  return `${shortModel(entry.modelLabel)} at ${effortLabel(entry.effort)}`
}

/**
 * Several entries by model: "Sonnet 5.5 at max, extra high and low effort
 * and Opus 5.5 at low effort", models in the order their best entry comes.
 */
function entriesPhrase(entries: readonly Entry[]): string {
  const models: { label: string; efforts: string[] }[] = []
  for (const entry of entries) {
    const label = shortModel(entry.modelLabel)
    const model = models.find((item) => item.label === label)
    if (model === undefined) models.push({ label, efforts: [entry.effort] })
    else model.efforts.push(entry.effort)
  }
  return list(
    models.map(
      (item) =>
        `${item.label} at ${list(
          [...item.efforts]
            .sort((a, b) => effortRank(a) - effortRank(b))
            .map((effort) => effortLabel(effort).replace(/ effort$/, "")),
        )} effort`,
    ),
  )
}

/** Entries level with the leader on one score, best first. */
export function leaders(entries: readonly Entry[], by: RankBy): Entry[] {
  const sorted = [...entries].sort(
    (a, b) => rankValue(b, by) - rankValue(a, by),
  )
  const best = sorted[0]
  if (best === undefined) return []
  return sorted.filter(
    (entry) =>
      entry === best ||
      rankValue(best, by) - rankValue(entry, by) <
        Math.max(runSpread(best), runSpread(entry)),
  )
}

/** Who leads on each score, or who is level at the top. */
function leadersFinding(results: SiteResults): Finding | null {
  if (results.entries.length < 2) return null
  const budget = results.run.limits.stuartBudgetMs
  const sentences = rankOrder.map((by) => {
    const top = leaders(results.entries, by)
    const name = scoreName(by, budget)
    const first = top[0]
    if (first === undefined) return ""
    if (top.length === 1) {
      return `${name}, ${entryPhrase(first)} leads with ${percent(rankValue(first, by))}.`
    }
    const values = top.map((entry) => rankValue(entry, by))
    return `${name}, ${count(top.length)} entries are level at the top: ${entriesPhrase(top)} (${percent(Math.min(...values))} to ${percent(Math.max(...values))}), closer than their own runs vary.`
  })
  return { id: "leaders", text: sentences.filter(Boolean).join(" ") }
}

/** How often Stuart did not show the model's sentence, and why. */
function refusalFinding(results: SiteResults): Finding | null {
  const shares = results.entries.map((entry) => entry.rejectedShare)
  if (shares.length === 0 || Math.max(...shares) === 0) return null
  const totals = new Map<string, number>()
  for (const entry of results.entries) {
    for (const item of entry.rejectionReasons) {
      totals.set(item.reason, (totals.get(item.reason) ?? 0) + item.count)
    }
  }
  const all = [...totals.values()].reduce((sum, value) => sum + value, 0)
  const lengthShare = lengthShareOfRejections(results.entries)
  // The most common reason that is not about length, with its share.
  const [other, otherCount] =
    [...totals]
      .filter(([reason]) => !lengthReasons.includes(reason))
      .sort((a, b) => b[1] - a[1])[0] ?? []
  const parts: string[] = []
  if (lengthShare > 0)
    parts.push(
      `${percent(lengthShare, 0)} of those were for length (more than two sentences or over 280 characters)`,
    )
  if (other !== undefined && otherCount !== undefined && all > 0)
    parts.push(
      `${percent(otherCount / all, 0)} for ${rejectionLabel(other, results.rejectionTypes).replace(/^./, (letter) => letter.toLowerCase())}`,
    )
  const range =
    Math.min(...shares) === Math.max(...shares)
      ? `${percent(Math.min(...shares))}`
      : `${percent(Math.min(...shares))} to ${percent(Math.max(...shares))}`
  const why =
    parts.length === 0
      ? ""
      : ` ${list(parts).replace(/^./, (letter) => letter.toUpperCase())}.`
  return {
    id: "refusals",
    text: `Stuart did not show the model's own sentence in ${range} of each entry's answers, and each of those answers fails Inside Stuart.${why}`,
  }
}

/**
 * Below max effort, how much reasoning effort moved the main score, against
 * how much an entry's own runs vary. Shown only when the moves are within
 * that noise, and then says where max effort stands clearly higher.
 */
function effortFinding(results: SiteResults): Finding | null {
  const byModel = new Map<string, Entry[]>()
  for (const entry of results.entries) {
    const list = byModel.get(entry.model) ?? []
    list.push(entry)
    byModel.set(entry.model, list)
  }
  let widest = 0
  let noise = 0
  const efforts = new Set<string>()
  const clearlyHigher: string[] = []
  for (const entries of byModel.values()) {
    const below = entries.filter((entry) => entry.effort !== "max")
    if (below.length < 2) return null
    const scores = below.map((entry) => entry.score)
    widest = Math.max(widest, Math.max(...scores) - Math.min(...scores))
    for (const entry of below) {
      noise = Math.max(noise, runSpread(entry))
      efforts.add(entry.effort)
    }
    const max = entries.find((entry) => entry.effort === "max")
    const best = [...below].sort((a, b) => b.score - a.score)[0]
    if (
      max !== undefined &&
      best !== undefined &&
      max.score - best.score > Math.max(runSpread(max), runSpread(best))
    ) {
      clearlyHigher.push(shortModel(max.modelLabel))
    }
  }
  if (byModel.size === 0 || widest > noise) return null
  const sorted = [...efforts].sort((a, b) => effortRank(a) - effortRank(b))
  const lowest = effortLabel(sorted[0] ?? "").replace(/ effort$/, "")
  const highest = effortLabel(sorted.at(-1) ?? "").replace(/ effort$/, "")
  const points = (value: number) => (value * 100).toFixed(1)
  const higher =
    clearlyHigher.length === 0
      ? ""
      : clearlyHigher.length === byModel.size
        ? " Max effort scored clearly higher for every model."
        : ` Max effort scored clearly higher for ${list(clearlyHigher)}.`
  return {
    id: "effort",
    text: `Below max effort, reasoning effort changed little: within each model, ${lowest} to ${highest} effort lie within ${points(widest)} points of each other Inside Stuart, no more than a single entry's own runs vary (up to ${points(noise)} points).${higher}`,
  }
}

/** Max effort is the slowest, and what that costs within Stuart's limit. */
function speedFinding(results: SiteResults): Finding | null {
  const max = results.entries.filter((entry) => entry.effort === "max")
  const rest = results.entries.filter((entry) => entry.effort !== "max")
  if (max.length === 0 || rest.length === 0) return null
  const maxTimes = max.map((entry) => entry.medianAnswerMs)
  const restTimes = rest.map((entry) => entry.medianAnswerMs)
  if (Math.min(...maxTimes) <= Math.max(...restTimes)) return null
  const budget = results.run.limits.stuartBudgetMs
  const span = (values: number[], format: (value: number) => string) =>
    Math.min(...values) === Math.max(...values)
      ? format(Math.min(...values))
      : `${format(Math.min(...values))} to ${format(Math.max(...values))}`
  let text = `Max effort is the slowest: median answers of ${span(maxTimes, seconds)}, against ${span(restTimes, seconds)} below it.`
  const over = max.map((entry) => entry.overStuartBudgetShare)
  if (Math.max(...over) > 0) {
    const within = max.map((entry) => entry.scoreWithinStuartLimit)
    text += ` ${span(over, (value) => percent(value, 0))} of its answers ran past Stuart's ${wholeSeconds(budget)}, so ${scoreName("within-stuart", budget)} its scores fall to ${span(within, (value) => percent(value))}.`
  }
  return { id: "speed", text }
}

export function findings(results: SiteResults): Finding[] {
  return [
    leadersFinding(results),
    refusalFinding(results),
    effortFinding(results),
    speedFinding(results),
  ].filter((finding): finding is Finding => finding !== null)
}
