import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { isSample, withRobotsHeader } from "../../scripts/robots.mjs"
import { type Entry, parseResults } from "../data/schema"
import { pageHead, robotsMeta } from "../data/site"
import { heldBackTitle, methodNotes, runProvenance, runRules } from "./method"
import {
  activeKinds,
  agreementPercents,
  agreementSplit,
  agreementSummary,
  answersGiven,
  cellScore,
  costAxis,
  defaultSelection,
  domainPosition,
  duration,
  effortLabel,
  effortName,
  effortOrder,
  effortShape,
  effortsOf,
  type FailureRow,
  failureGroups,
  failureLabels,
  failureRows,
  failureSummary,
  focusEntries,
  gridScoreFor,
  heroFacts,
  kindScore,
  kindTint,
  lengthShareOfRejections,
  modelColour,
  modelsOf,
  partialRuns,
  per100,
  percent,
  percentTenths,
  questionPlace,
  type RejectionRow,
  rankEntries,
  rejectionColour,
  rejectionRows,
  rejectionSummary,
  runsText,
  scoreAxis,
  scoreDomain,
  seconds,
  shortModel,
  shownIsClean,
  splitShown,
  templateNote,
  timeAxis,
  toggleModel,
  usd,
  visibleEntries,
  visibleShares,
  wholeShares,
  wrapIndex,
} from "./model"

// Read from disk, not imported: the schema must accept the file as it is.
const results = parseResults(
  JSON.parse(readFileSync(join(process.cwd(), "data/results.json"), "utf8")),
)

function entry(overrides: Partial<Entry> & { id: string }): Entry {
  return {
    model: "claude-sonnet-5-5",
    modelLabel: "Sonnet 5.5",
    effort: "low",
    runsStuart: false,
    score: 0.9,
    scoreRuns: [0.9, 0.9],
    scoreIgnoringLength: 0.92,
    scoreWithinStuartLimit: 0.85,
    overStuartBudgetShare: 0.1,
    runs: 2,
    safetyFails: 0,
    timeouts: 0,
    refusals: 0,
    tokenLimitStops: 0,
    answers: 200,
    rejectedAnswers: 0,
    rejectedShare: 0,
    rejectionReasons: [],
    costUsd: 1.43,
    costPer100Usd: 1,
    medianAnswerMs: 4000,
    p90AnswerMs: 8000,
    tokensPerAnswer: { input: 10_000, output: 500 },
    byKind: [],
    failures: [],
    agreement: { always: 0.9, sometimes: 0.05, never: 0.05 },
    ...overrides,
  }
}

/** The largest matrix the runner can make: 3 models at 5 effort levels. */
const families = [
  { model: "claude-haiku-5-5", modelLabel: "Haiku 5.5", base: 0.7 },
  { model: "claude-sonnet-5-5", modelLabel: "Sonnet 5.5", base: 0.8 },
  { model: "claude-opus-5-5", modelLabel: "Opus 5.5", base: 0.85 },
]
const matrix = families.flatMap((family) =>
  effortOrder.map((effort, index) =>
    entry({
      id: `${family.model.replace("claude-", "")}.${effort}`,
      model: family.model,
      modelLabel: family.modelLabel,
      effort: effort as Entry["effort"],
      score: family.base + index * 0.01,
      costPer100Usd: (family.base * 10) ** (index + 1) / 100,
    }),
  ),
)

describe("the results file", () => {
  it("parses the real run with the runner's contract", () => {
    expect(results.version).toBe(1)
    expect(results.run.sample).toBeUndefined()
    expect(results.entries).toHaveLength(15)
    expect(results.run.questions).toBe(143)
    expect(results.publicQuestions).toHaveLength(results.run.publicQuestions)
  })

  it("splits into the first load and the answers without losing anything", async () => {
    const site = (await import("../data/results")).default
    const answers = (await import("../data/questions")).default
    const index = await import("virtual:bench-question-index")
    const { publicQuestions, ...rest } = results
    expect(site).toEqual(rest)
    expect("publicQuestions" in site).toBe(false)
    expect(answers).toEqual(publicQuestions)
    expect(index.firstQuestion).toEqual(publicQuestions[0])
    expect(index.questionIndex).toHaveLength(publicQuestions.length)
    publicQuestions.forEach((question, at) => {
      expect(index.questionIndex[at]).toEqual({
        id: question.id,
        kind: question.kind,
        question: question.question,
        checks: question.checks,
        answers: question.answers.length,
        passed: question.answers.filter((answer) => answer.passed).length,
      })
    })
  })

  it("says how this run's answers were made, and nothing for another run", () => {
    expect(runProvenance(results.run)).toBe(
      "The answers were collected on 17 Nov 2026 and re-checked offline against the final Stuart code, with every decision to show or set aside an answer reproduced.",
    )
    expect(runProvenance({ ...results.run, id: "matchbench3" })).toBeNull()
  })

  it("rejects a field the contract does not know", () => {
    const broken = structuredClone(results) as unknown as {
      run: Record<string, unknown>
    }
    broken.run.extra = 1
    expect(() => parseResults(broken)).toThrow(/extra/)
  })

  it("rejects an entry scoring a kind the file does not list", () => {
    const broken = structuredClone(results)
    const scored = broken.entries[0]?.byKind[0]?.kind
    broken.kinds = broken.kinds.filter((kind) => kind.id !== scored)
    expect(() => parseResults(broken)).toThrow(/unlisted kind/)
  })

  it("rejects an entry whose scores disagree with its finished runs", () => {
    const broken = structuredClone(results)
    const first = broken.entries[0]
    if (first === undefined) throw new Error("no entries")
    first.scoreRuns = [0.5]
    expect(() => parseResults(broken)).toThrow(/1 scores for 3 runs/)
  })
})

describe("ranks", () => {
  it("puts the best score first and breaks ties on cost", () => {
    const ranked = rankEntries([
      entry({ id: "a", score: 0.9, costPer100Usd: 5 }),
      entry({ id: "b", score: 0.95 }),
      entry({ id: "c", score: 0.9, costPer100Usd: 1 }),
      entry({ id: "d", score: 0.8 }),
    ])
    expect(ranked.map((item) => item.id)).toEqual(["b", "c", "a", "d"])
    expect(ranked.map((item) => item.rank)).toEqual([1, 2, 2, 4])
  })

  it("shares a rank when the shown scores are equal", () => {
    const ranked = rankEntries([
      entry({ id: "a", score: 0.93261 }),
      entry({ id: "b", score: 0.93251 }),
    ])
    expect(ranked.map((item) => item.rank)).toEqual([1, 1])
  })

  it("never lists a lower printed score above a higher one", () => {
    // 0.6665 prints as 66.6% and 0.667 as 66.7%: different ranks, higher first.
    const ranked = rankEntries([
      entry({ id: "low", score: 0.6665, costPer100Usd: 0.1 }),
      entry({ id: "high", score: 0.667, costPer100Usd: 9 }),
    ])
    const printed = ranked.map((item) => percent(item.score))
    expect(ranked.map((item) => item.id)).toEqual(["high", "low"])
    expect(printed).toEqual(["66.7%", "66.6%"])
    expect(ranked.map((item) => item.rank)).toEqual([1, 2])
    // The rank key is the printed value: equal prints share a rank.
    const tied = rankEntries([
      entry({ id: "a", score: 0.6671, costPer100Usd: 5 }),
      entry({ id: "b", score: 0.6669, costPer100Usd: 1 }),
    ])
    expect(tied.map((item) => percent(item.score))).toEqual(["66.7%", "66.7%"])
    expect(tied.map((item) => item.rank)).toEqual([1, 1])
    expect(percentTenths(0.6665)).toBe(
      Number(percent(0.6665).slice(0, -1)) * 10,
    )
  })

  it("never prints an extreme a score does not reach", () => {
    expect(percent(0.99996)).toBe("99.9%")
    expect(percent(1)).toBe("100.0%")
    expect(percent(0.00004)).toBe("0.1%")
    expect(percent(0)).toBe("0.0%")
    expect(percent(0.996, 0)).toBe("99%")
    expect(percent(0.004, 0)).toBe("1%")
    expect(cellScore(0.004)).toBe("1")
  })

  it("ranks by the score within Stuart's limit when asked", () => {
    const entries = [
      entry({ id: "slow", score: 0.9, scoreWithinStuartLimit: 0.7 }),
      entry({ id: "quick", score: 0.85, scoreWithinStuartLimit: 0.84 }),
    ]
    expect(rankEntries(entries).map((item) => item.id)).toEqual([
      "slow",
      "quick",
    ])
    expect(
      rankEntries(entries, "within-stuart").map((item) => item.id),
    ).toEqual(["quick", "slow"])
    const best = { ...defaultSelection, rankBy: "within-stuart" as const }
    expect(focusEntries(entries, best).map((item) => item.id)).toEqual([
      "quick",
    ])
  })

  it("ranks the real run differently by each score", () => {
    const top = (by: "score" | "ignoring-length" | "within-stuart") =>
      rankEntries(results.entries, by)[0]?.id
    expect(top("score")).toBe("sonnet-5-5.max")
    expect(top("ignoring-length")).toBe("sonnet-5-5.max")
    expect(top("within-stuart")).toBe("opus-5-5.low")
    // Ignoring length changes the order: Sonnet low moves above Opus max.
    const order = rankEntries(results.entries, "ignoring-length").map(
      (item) => item.id,
    )
    expect(order.indexOf("sonnet-5-5.low")).toBeLessThan(
      order.indexOf("opus-5-5.max"),
    )
  })
})

describe("labels and colours", () => {
  it("names effort levels in plain words", () => {
    expect(effortLabel("high")).toBe("high effort")
    expect(effortLabel("xhigh")).toBe("extra high effort")
    expect(effortName("xhigh")).toBe("Extra high")
  })

  it("says when an entry has not finished every run", () => {
    expect(partialRuns(entry({ id: "a", runs: 2 }), 3)).toBe("2 of 3 runs")
    expect(partialRuns(entry({ id: "a", runs: 3 }), 3)).toBeNull()
  })

  it("gives each model family one colour, whatever is hidden", () => {
    expect(modelColour("claude-opus-5-5")).toBe("var(--bench-opus)")
    expect(modelColour("claude-haiku-5-5")).toBe("var(--bench-haiku)")
    expect(modelColour("someone-else")).toBe("var(--ink2)")
  })

  it("orders models by their cheapest entry and efforts by thinking", () => {
    expect(shortModel("Claude Opus 5.5")).toBe("Opus 5.5")
    expect(modelsOf(results.entries).map((item) => item.label)).toEqual([
      "Haiku 5.5",
      "Sonnet 5.5",
      "Opus 5.5",
    ])
    expect(effortsOf(matrix)).toEqual(["low", "medium", "high", "xhigh", "max"])
  })

  it("gives every effort level its own shape, the same in every run", () => {
    const shapes = effortOrder.map((effort) => effortShape(effort))
    expect(new Set(shapes).size).toBe(effortOrder.length)
    expect(effortShape("low")).toBe("circle")
  })
})

describe("the reader's filters", () => {
  const entries = [
    entry({ id: "s-low", effort: "low", score: 0.9 }),
    entry({ id: "s-high", effort: "high", score: 0.95 }),
    entry({
      id: "o-low",
      model: "claude-opus-5-5",
      modelLabel: "Opus 5.5",
      effort: "low",
      score: 0.97,
    }),
  ]

  it("shows each model's best entry by default", () => {
    expect(
      focusEntries(entries, defaultSelection).map((item) => item.id),
    ).toEqual(["o-low", "s-high"])
  })

  it("shows one effort level, or every entry", () => {
    const low = { ...defaultSelection, effortView: { effort: "low" } }
    expect(focusEntries(entries, low).map((item) => item.id)).toEqual([
      "o-low",
      "s-low",
    ])
    const all = { ...defaultSelection, effortView: "all" as const }
    expect(focusEntries(entries, all)).toHaveLength(3)
  })

  it("hides a model everywhere, and shows it again", () => {
    const hidden = toggleModel(defaultSelection, "claude-opus-5-5")
    expect(visibleEntries(entries, hidden).map((item) => item.id)).toEqual([
      "s-high",
      "s-low",
    ])
    expect(focusEntries(entries, hidden).map((item) => item.id)).toEqual([
      "s-high",
    ])
    expect(toggleModel(hidden, "claude-opus-5-5").hidden.size).toBe(0)
  })

  it("keeps a full 15 entry matrix to one row per model by default", () => {
    expect(visibleEntries(matrix, defaultSelection)).toHaveLength(15)
    expect(focusEntries(matrix, defaultSelection)).toHaveLength(3)
    const xhigh = { ...defaultSelection, effortView: { effort: "xhigh" } }
    expect(
      focusEntries(matrix, xhigh).every((item) => item.effort === "xhigh"),
    ).toBe(true)
  })
})

describe("numbers", () => {
  it("formats scores, money, time and durations", () => {
    expect(percent(0.9326)).toBe("93.3%")
    expect(usd(0.92)).toBe("$0.92")
    expect(usd(13.587)).toBe("$13.59")
    expect(usd(0.004)).toBe("under $0.01")
    expect(seconds(4752)).toBe("4.8 s")
    expect(duration("2026-11-17T08:00:00Z", "2026-11-17T09:42:00Z")).toBe(
      "1 h 42 min",
    )
  })

  it("never rounds a cell up to a perfect score", () => {
    expect(cellScore(1)).toBe("100")
    expect(cellScore(0.996)).toBe("99")
    expect(cellScore(0.75)).toBe("75")
  })
})

describe("chart scales", () => {
  it("puts the best score at the top and covers every score", () => {
    const axis = scoreAxis([0.68, 0.88])
    expect(axis.position(0.88)).toBeLessThan(axis.position(0.68))
    for (const value of [0.68, 0.88]) {
      expect(axis.position(value)).toBeGreaterThanOrEqual(0)
      expect(axis.position(value)).toBeLessThanOrEqual(1)
    }
    expect(axis.ticks[0]?.at).toBe(1)
  })

  it("puts cost on whole decades of a log scale", () => {
    const axis = costAxis([0.05, 13.6])
    expect(axis.position(0.01)).toBe(0)
    expect(axis.position(100)).toBe(1)
    expect(axis.position(1)).toBeCloseTo(0.5)
    expect(axis.ticks.map((tick) => tick.label)).toEqual([
      "$0.01",
      "$0.10",
      "$1",
      "$10",
      "$100",
    ])
    expect(costAxis([0.5, 3]).ticks.map((tick) => tick.label)).toContain("$2")
    // The runner's sample: three decades, so 1 and 3 only.
    expect(costAxis([0.21, 14.2]).ticks.map((tick) => tick.label)).toEqual([
      "$0.10",
      "$0.30",
      "$1",
      "$3",
      "$10",
      "$30",
      "$100",
    ])
  })

  it("keeps Stuart's limit on a linear axis while medians sit near it", () => {
    const { stuartBudgetMs, answerBudgetMs } = results.run.limits
    const quick = timeAxis([1500, 4000], stuartBudgetMs, answerBudgetMs)
    expect(quick.log).toBe(false)
    expect(quick.position(stuartBudgetMs)).toBeLessThan(1)
    expect(quick.ticks.at(-1)?.label).toBe("25 s")
    const near = timeAxis([8000, 26_000], 20_000, 120_000)
    expect(near.log).toBe(false)
    expect(near.position(26_000)).toBeLessThanOrEqual(1)
  })

  it("spreads the real medians (3 s to 24 s) on a log axis around the 20 s line", () => {
    const axis = timeAxis(
      results.entries.map((entry) => entry.medianAnswerMs),
      results.run.limits.stuartBudgetMs,
      results.run.limits.answerBudgetMs,
    )
    expect(axis.log).toBe(true)
    expect(axis.ticks.map((tick) => tick.label)).toEqual([
      "1 s",
      "2 s",
      "5 s",
      "10 s",
      "20 s",
    ])
    // 20 s sits inside the axis, past the slowest median's neighbours.
    expect(axis.position(20_000)).toBeGreaterThan(0.8)
    expect(axis.position(20_000)).toBeLessThan(1)
    // The fast entries no longer bunch: 3.3 s and 6.3 s sit apart.
    expect(axis.position(6300) - axis.position(3300)).toBeGreaterThan(0.15)
    expect(axis.position(23_700)).toBeLessThan(1)
  })

  it("moves to a log axis up to the answer budget when medians run long", () => {
    const axis = timeAxis([1800, 4000, 95_000], 20_000, 120_000)
    expect(axis.log).toBe(true)
    expect(axis.position(1000)).toBe(0)
    expect(axis.position(120_000)).toBe(1)
    expect(axis.position(95_000)).toBeLessThan(1)
    // The fast entries do not bunch at the left: 2 s and 20 s sit apart.
    expect(axis.position(20_000) - axis.position(2000)).toBeGreaterThan(0.4)
    expect(axis.ticks.map((tick) => tick.label)).toEqual([
      "1 s",
      "2 s",
      "5 s",
      "10 s",
      "20 s",
      "120 s",
    ])
  })

  it("gives the end of a long time axis its own label, never two at once", () => {
    // The end label is right-aligned, so the mark before it keeps a fifth
    // of the axis clear.
    const axis = timeAxis([2000, 187_200], 20_000, 120_000)
    expect(axis.ticks.at(-1)).toEqual({ at: 1, label: "187.2 s" })
    expect(axis.ticks.map((tick) => tick.label)).not.toContain("120 s")
    expect(1 - (axis.ticks.at(-2)?.at ?? 0)).toBeGreaterThan(0.2)
    for (let index = 1; index < axis.ticks.length; index += 1) {
      const gap =
        (axis.ticks[index]?.at ?? 0) - (axis.ticks[index - 1]?.at ?? 0)
      expect(gap).toBeGreaterThan(0.1)
    }
  })

  it("keeps the score axis to about ten ticks however wide the spread", () => {
    expect(scoreAxis([0.05, 0.9]).ticks.length).toBeLessThanOrEqual(10)
    expect(scoreAxis([0.68, 0.88]).ticks.length).toBeLessThanOrEqual(10)
  })
})

describe("the grid and the cards", () => {
  it("shades on one hue across the grid's own range, never from zero", () => {
    const domain = scoreDomain([0.5, 0.78])
    expect(domain).toEqual({ from: 0.5, to: 0.8 })
    expect(kindTint(0.5, domain)).toBe(
      "color-mix(in oklab, var(--pos) 6%, var(--bg))",
    )
    expect(kindTint(0.8, domain)).toBe(
      "color-mix(in oklab, var(--pos) 52%, var(--bg))",
    )
    // 0.50 and 0.78 sit far apart on the scale, not squeezed near the top.
    expect(
      domainPosition(0.78, domain) - domainPosition(0.5, domain),
    ).toBeGreaterThan(0.9)
    // Outside the range, the scale clamps rather than overflowing.
    expect(kindTint(0.2, domain)).toBe(kindTint(0.5, domain))
  })

  it("keeps a scale at least 20 points wide and within 0 to 100", () => {
    expect(scoreDomain([0.62, 0.66])).toEqual({ from: 0.6, to: 0.8 })
    expect(scoreDomain([0.95, 0.99])).toEqual({ from: 0.8, to: 1 })
    expect(scoreDomain([0.375, 0.781])).toEqual({ from: 0.3, to: 0.8 })
  })

  it("follows the chosen score in the grid where the data has it", () => {
    const withKinds = entry({
      id: "k",
      byKind: [{ kind: "gauges", score: 0.5, scoreIgnoringLength: 0.7 }],
    })
    expect(kindScore(withKinds, "gauges", "score")).toBe(0.5)
    expect(kindScore(withKinds, "gauges", "ignoring-length")).toBe(0.7)
    // No per-kind figure within 20 s: the grid shows Inside Stuart's.
    expect(gridScoreFor("within-stuart")).toBe("score")
    expect(kindScore(withKinds, "gauges", "within-stuart")).toBe(0.5)
  })

  it("stacks failures by type, per 100 answers, and says them in words", () => {
    const entries = rankEntries([
      entry({
        id: "a",
        runs: 2,
        failures: [
          { type: "asked_not_answered", count: 2 },
          { type: "invented_address", count: 1 },
        ],
      }),
    ])
    const groups = failureGroups(entries, results.failureTypes)
    const [row] = failureRows(entries, groups, 50)
    if (row === undefined) throw new Error("no row")
    expect(row.total).toBe(3)
    expect(row.answers).toBe(100)
    expect(row.per100).toBe(3)
    expect(row.segments.map((segment) => segment.group.colour)).toEqual([
      "var(--bench-fail-1)",
      "var(--neg)",
    ])
    expect(failureSummary(row)).toBe(
      "3 failed checks in 100 answers: 2 asked when it should answer, 1 invented address",
    )
  })

  it("compares entries with different runs by rate, not by raw count", () => {
    const full = entry({
      id: "full",
      runs: 3,
      failures: [{ type: "number_off", count: 30 }],
    })
    const partial = entry({
      id: "partial",
      runs: 1,
      scoreRuns: [0.9],
      agreement: null,
      failures: [{ type: "number_off", count: 10 }],
    })
    const groups = failureGroups([full, partial], results.failureTypes)
    const rows = failureRows(rankEntries([full, partial]), groups, 100)
    expect(rows.map((item) => item.total)).toEqual([30, 10])
    expect(rows.map((item) => item.per100)).toEqual([10, 10])
    expect(answersGiven(partial, 100)).toBe(100)
    expect(per100(3, 402)).toBe("0.7")
    expect(per100(1, 100_000)).toBe("under 0.1")
    expect(per100(0, 402)).toBe("0.0")
  })

  it("keeps the most frequent types apart and folds the rest into Other", () => {
    // Every type the contract knows, the infrastructure ones included.
    const everything = entry({
      id: "a",
      failures: results.failureTypes.map((type, index) => ({
        type: type.id,
        count: index + 1,
      })),
    })
    const groups = failureGroups([everything], results.failureTypes)
    const plain = groups.filter((group) => !group.safety)
    expect(plain).toHaveLength(8)
    expect(plain.at(-1)?.label).toBe("Other")
    expect(new Set(groups.map((group) => group.colour)).size).toBe(
      groups.length,
    )
    // Nothing is dropped: every type is in exactly one group.
    expect(groups.flatMap((group) => group.types)).toHaveLength(
      results.failureTypes.length,
    )
    for (const id of [
      "timeout",
      "token_limit",
      "refusal",
      "answer_rejected",
      "answer_missing",
    ]) {
      expect(results.failureTypes.map((type) => type.id)).toContain(id)
    }
    const [row] = failureRows(rankEntries([everything]), groups, 100)
    expect(failureSummary(row as FailureRow)).toContain(
      "1 no answer from the model",
    )
  })

  it("leaves entries with fewer than two runs out of agreement", () => {
    const one = entry({ id: "one", runs: 1, scoreRuns: [0.9], agreement: null })
    const two = entry({ id: "two" })
    const split = agreementSplit([one, two])
    expect(split.shown.map((item) => item.id)).toEqual(["two"])
    expect(split.left.map((item) => item.id)).toEqual(["one"])
    expect(agreementSummary(one)).toBe("fewer than two runs")
  })

  it("prints agreement shares that add up to 100", () => {
    const odd = entry({
      id: "odd",
      agreement: { always: 0.335, sometimes: 0.335, never: 0.33 },
    })
    const shares = agreementPercents(odd)
    expect(shares).not.toBeNull()
    expect(
      (shares?.always ?? 0) + (shares?.sometimes ?? 0) + (shares?.never ?? 0),
    ).toBe(100)
    expect(agreementSummary(odd)).toBe(
      "34% right every run, 33% in some, 33% never",
    )
    expect(wholeShares([0.985, 0.005, 0.01])).toEqual([98, 1, 1])
  })

  it("keeps a small share visible in the bars", () => {
    const bar = visibleShares([0.98, 0.01, 0.01])
    const total = bar.reduce((sum, value) => sum + value, 0)
    for (const value of bar.slice(1)) {
      expect(value / total).toBeGreaterThan(0.02)
    }
    expect(visibleShares([0.99, 0, 0.01])[1]).toBe(0)
  })

  it("fills the whole bar even when the shares add up to less than one", () => {
    // Reason shares of all answers: 0.2191 + 0.1702 + ... = 0.41.
    const bar = visibleShares([0.2191, 0.1702, 0.0117, 0.007, 0.0023])
    expect(bar.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 10)
    expect(bar[0]).toBeGreaterThan(bar[1] ?? 1)
  })

  it("finds the sentence in every published answer's shown text", () => {
    // The runner writes shown as title, sentence, then the card's rows, one
    // per line. Every published answer must hold to that, or the page would
    // lead with the wrong line.
    const answers = results.publicQuestions.flatMap((question) =>
      question.answers.map((answer) => ({ question, answer })),
    )
    expect(answers).toHaveLength(765)
    const unclear = answers.filter(({ answer }) => !shownIsClean(answer.shown))
    expect(unclear.map(({ question }) => question.id)).toEqual([])
    // Where Stuart showed its own line, the model's words are elsewhere.
    for (const { answer } of answers) {
      const { sentence } = splitShown(answer.shown)
      if (answer.answerFrom === "template" && answer.modelText !== null)
        expect(sentence).not.toBe(answer.modelText)
    }
  })

  it("splits the real vote script answer into sentence and card", () => {
    const question = results.publicQuestions.find(
      (item) => item.id === "script.compact",
    )
    const answer = question?.answers.find((item) => item.answerFrom === "model")
    if (answer === undefined) throw new Error("no model answer")
    const parts = splitShown(answer.shown)
    expect(parts.title).toBe("Your veBTC ballot")
    expect(parts.sentence).toMatch(/^Unsigned veBTC ballot prepared on #6100/)
    expect(parts.card[0]).toEqual({
      kind: "line",
      text: "Resolved: 60% BTC/MUSD CL200, 40% sMUSD",
    })
    expect(parts.card[1]).toMatchObject({ kind: "values" })
    expect(parts.repeats).toBeGreaterThan(10)
    // Nothing is lost: every row is a title, the sentence or a card row.
    const kept = new Set([
      parts.title,
      parts.sentence,
      ...parts.card.flatMap((group) =>
        group.kind === "values" ? group.items : [group.text],
      ),
    ])
    for (const line of answer.shown.split("\n")) expect(kept).toContain(line)
  })

  it("reads a one line shown text as all sentence", () => {
    expect(splitShown("Just this.")).toEqual({
      title: "",
      sentence: "Just this.",
      card: [],
      repeats: 0,
    })
    expect(shownIsClean("Just this.")).toBe(false)
    expect(shownIsClean("Title\nA sentence.\nrow")).toBe(true)
    expect(shownIsClean("Title\nno ending\nrow")).toBe(false)
  })

  it("explains an answer Stuart replaced with its own text, in the file's words", () => {
    const base = {
      entry: "a",
      passed: false,
      passedIgnoringLength: false,
      shown: "x",
      modelText: null,
      onCard: false,
      failures: [],
    }
    const types = results.rejectionTypes
    expect(
      templateNote(
        { ...base, answerFrom: "model", rejectedReason: null },
        types,
      ),
    ).toBeNull()
    expect(
      templateNote(
        {
          ...base,
          answerFrom: "template",
          rejectedReason: "too_many_sentences",
        },
        types,
      ),
    ).toBe("more than two sentences (three for Mezo support)")
    expect(
      templateNote(
        { ...base, answerFrom: "template", rejectedReason: "reply_unsourced" },
        types,
      ),
    ).toBe("with no tool run, a number or address the user did not write")
    // A card or the out of scope line: Stuart's text, no reason given.
    expect(
      templateNote(
        { ...base, answerFrom: "template", rejectedReason: null },
        types,
      ),
    ).toBeNull()
  })

  it("gives the share of answers Stuart did not show, from rejectedShare and the reason shares", () => {
    const types = results.rejectionTypes
    const haiku = entry({
      id: "haiku",
      answers: 429,
      rejectedAnswers: 176,
      rejectedShare: 0.4103,
      rejectionReasons: [
        { reason: "too_many_sentences", count: 94, share: 0.2191 },
        { reason: "unsourced", count: 73, share: 0.1702 },
        { reason: "reply_unsourced", count: 5, share: 0.0117 },
        { reason: "claim", count: 3, share: 0.007 },
        { reason: "too_long", count: 1, share: 0.0023 },
        { reason: "greeting", count: 0, share: 0 },
      ],
    })
    const [row] = rejectionRows(rankEntries([haiku]), types)
    if (row === undefined) throw new Error("no row")
    expect(row.answers).toBe(429)
    expect(row.total).toBe(176)
    expect(row.share).toBe(0.4103)
    // In the contract's order, with the file's labels, zero counts left out.
    expect(row.segments.map((item) => item.label)).toEqual([
      "More than two sentences (three for Mezo support)",
      "Over 280 characters (400 for Mezo support)",
      "A number or address no tool returned this turn",
      "Claimed to have signed, sent or acted",
      "With no tool run, a number or address the user did not write",
    ])
    expect(row.segments.map((item) => item.share)).toEqual([
      0.2191, 0.0023, 0.1702, 0.007, 0.0117,
    ])
    expect(new Set(row.segments.map((item) => item.colour)).size).toBe(5)
    expect(rejectionSummary(row)).toBe(
      "176 of 429 answers not shown (41.0%): 94 more than two sentences (three for Mezo support), 1 over 280 characters (400 for Mezo support), 73 a number or address no tool returned this turn, 3 claimed to have signed, sent or acted, 5 with no tool run, a number or address the user did not write",
    )
    const [none] = rejectionRows(rankEntries([entry({ id: "clean" })]), types)
    expect(none?.share).toBe(0)
    expect(rejectionSummary(none as RejectionRow)).toBe(
      "every answer's own words credited, 200 answers",
    )
  })

  it("gives every rejection reason in the file its own colour", () => {
    const colours = results.rejectionTypes.map((type) =>
      rejectionColour(type.id, results.rejectionTypes),
    )
    expect(new Set(colours).size).toBe(results.rejectionTypes.length)
  })

  it("reads the real run's rejection shares", () => {
    const rows = rejectionRows(
      rankEntries(results.entries),
      results.rejectionTypes,
    )
    for (const row of rows) {
      const parts = row.segments.reduce((sum, item) => sum + item.share, 0)
      expect(Math.abs(parts - row.share)).toBeLessThan(0.002)
      expect(row.share).toBeGreaterThan(0.2)
      expect(row.share).toBeLessThan(0.5)
    }
    expect(lengthShareOfRejections(results.entries)).toBeGreaterThan(0.5)
  })

  it("leaves a kind with no questions out of the grid and the counts", () => {
    const kinds = [
      { id: "gauges" as const, label: "Gauges and yields", questions: 14 },
      { id: "support" as const, label: "Mezo support", questions: 0 },
    ]
    expect(activeKinds(kinds).map((kind) => kind.id)).toEqual(["gauges"])
    const facts = heroFacts({ ...results, kinds })
    expect(facts[0]?.label).toBe("questions, 1 kind")
  })

  it("names an answer's failed checks once per type", () => {
    expect(
      failureLabels(
        ["number_off", "wrong_tool", "number_off"],
        results.failureTypes,
      ),
    ).toEqual(["Number off (2)", "Wrong tool"])
  })
})

describe("questions and copy", () => {
  it("places a question among its kind and wraps the stepper", () => {
    expect(questionPlace(results.publicQuestions, 0, results.kinds)).toBe(
      "Vote scripts and ballots, 1 of 11",
    )
    expect(wrapIndex(-1, 4)).toBe(3)
    expect(wrapIndex(4, 4)).toBe(0)
  })

  it("words runs from each entry's own count", () => {
    const three = entry({ id: "three", runs: 3, scoreRuns: [0.9, 0.9, 0.9] })
    const one = entry({ id: "one", runs: 1, scoreRuns: [0.9], agreement: null })
    expect(runsText([three])).toBe("3 runs")
    expect(runsText([one])).toBe("1 run")
    expect(runsText([three, one])).toBe("1 to 3 runs")
    const facts = heroFacts({ ...results, entries: [three, one] })
    expect(facts[1]).toEqual({
      value: "2",
      label: "entries from 1 models, 1 to 3 runs each",
    })
  })

  it("marks only a sample noindex, in the head and the headers", () => {
    expect(robotsMeta({ sample: true })).toEqual([
      { name: "robots", content: "noindex" },
    ])
    expect(robotsMeta({})).toEqual([])
    expect(robotsMeta({ sample: false })).toEqual([])
    const headers = "/*\n  X-Content-Type-Options: nosniff\n"
    expect(withRobotsHeader(headers, true)).toBe(
      "/*\n  X-Robots-Tag: noindex\n  X-Content-Type-Options: nosniff\n",
    )
    expect(withRobotsHeader(headers, false)).toBe(headers)
    expect(isSample({ run: { sample: true } })).toBe(true)
    expect(isSample({ run: {} })).toBe(false)
  })

  it("gives every page a canonical URL and Open Graph tags", () => {
    const head = pageHead("/runs", "Runs, Matchbench")
    expect(head.links).toEqual([
      { rel: "canonical", href: "https://bench.matchbox.markets/runs" },
    ])
    expect(head.meta).toContainEqual({
      property: "og:url",
      content: "https://bench.matchbox.markets/runs",
    })
    expect(head.meta).toContainEqual({
      property: "og:title",
      content: "Runs, Matchbench",
    })
  })

  it("states the hero's facts from the run", () => {
    expect(heroFacts(results).map((fact) => fact.value)).toEqual([
      String(results.run.questions),
      `${results.entries.length} × ${results.run.runsPerEntry}`,
      String(results.run.publicQuestions),
      usd(results.run.totalCostUsd),
    ])
  })

  it("names the held back share honestly", () => {
    const run = { ...results.run, questions: 99, publicQuestions: 33 }
    expect(heldBackTitle(run)).toBe("Two thirds held back")
    expect(heldBackTitle({ ...run, questions: 143, publicQuestions: 48 })).toBe(
      "95 of 143 held back",
    )
    expect(methodNotes(results.run)).toHaveLength(4)
  })

  it("states how the run counts, with the unmetered cost only above zero", () => {
    const rules = runRules(results.run).join(" ")
    expect(rules).toContain("up to 120 s and 64,000 tokens of output")
    expect(rules).toContain("allows 20 s and 8,000 tokens of output")
    expect(rules).toContain("Fallbacks to other models are turned off")
    expect(rules).toContain("retried and never scored")
    expect(rules).toContain("at the time it took")
    expect(rules).toContain("$11.97 estimated")
    expect(
      runRules({ ...results.run, unmeteredCostUsd: 0 }).join(" "),
    ).not.toContain("estimated")
  })

  it("follows the copy rules: no em dash, none of the banned words", () => {
    const text = JSON.stringify(results)
    expect(text).not.toContain(String.fromCharCode(0x2014))
    expect(text).not.toMatch(new RegExp(["dep", "recated"].join(""), "i"))
  })
})
