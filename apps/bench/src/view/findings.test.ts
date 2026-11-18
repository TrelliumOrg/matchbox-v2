import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { type Entry, parseResults, type Results } from "../data/schema"
import { findings, leaders } from "./findings"

// Read from disk, not imported: the real run as published.
const results = parseResults(
  JSON.parse(readFileSync(join(process.cwd(), "data/results.json"), "utf8")),
)

function text(data: Results, id: string): string | undefined {
  return findings(data).find((item) => item.id === id)?.text
}

/** A copy of the real run with some entries changed. */
function variant(change: (entries: Entry[]) => Entry[]): Results {
  const copy = structuredClone(results)
  copy.entries = change(copy.entries)
  return copy
}

describe("what this run shows, on the real run", () => {
  it("names the leader on each score, and level entries as level", () => {
    expect(text(results, "leaders")).toBe(
      "Inside Stuart, Sonnet 5.5 at max effort leads with 74.4%. Ignoring length, five entries are level at the top: Sonnet 5.5 at low, high, extra high and max effort and Opus 5.5 at low effort (74.4% to 78.1%), closer than their own runs vary. Within 20 s, three entries are level at the top: Opus 5.5 at low, medium and high effort (59.7% to 65.3%), closer than their own runs vary.",
    )
  })

  it("says how often Stuart did not show the sentence, and why", () => {
    expect(text(results, "refusals")).toBe(
      "Stuart did not show the model's own sentence in 23.8% to 48.7% of each entry's answers, and each of those answers fails Inside Stuart. 51% of those were for length (more than two sentences or over 280 characters) and 45% for a number or address no tool returned this turn.",
    )
  })

  it("says reasoning effort below max moved scores no more than noise", () => {
    expect(text(results, "effort")).toBe(
      "Below max effort, reasoning effort changed little: within each model, low to extra high effort lie within 8.2 points of each other Inside Stuart, no more than a single entry's own runs vary (up to 9.1 points). Max effort scored clearly higher for Haiku 5.5 and Sonnet 5.5.",
    )
  })

  it("says max effort is the slowest and what that costs within 20 s", () => {
    expect(text(results, "speed")).toBe(
      "Max effort is the slowest: median answers of 15.1 s to 23.7 s, against 3.3 s to 6.3 s below it. 42% to 55% of its answers ran past Stuart's 20 s, so Within 20 s its scores fall to 37.5% to 49.9%.",
    )
  })
})

describe("what this run shows, kept true for other runs", () => {
  it("counts an entry as level when the gap is within either one's runs", () => {
    const top = leaders(results.entries, "ignoring-length")
    const best = top[0]
    if (best === undefined) throw new Error("no leader")
    for (const entry of top.slice(1)) {
      const gap = best.scoreIgnoringLength - entry.scoreIgnoringLength
      const spread = (each: Entry) =>
        Math.max(...each.scoreRuns) - Math.min(...each.scoreRuns)
      expect(gap).toBeLessThan(Math.max(spread(best), spread(entry)))
    }
  })

  it("names a single leader when nobody is within the noise", () => {
    const data = variant((entries) =>
      entries.map((entry) =>
        entry.id === "opus-5-5.low"
          ? { ...entry, scoreWithinStuartLimit: 0.9 }
          : entry,
      ),
    )
    expect(text(data, "leaders")).toContain(
      "Within 20 s, Opus 5.5 at low effort leads with 90.0%.",
    )
  })

  it("leaves out the effort statement when effort moved scores beyond the noise", () => {
    const data = variant((entries) =>
      entries.map((entry) =>
        entry.id === "haiku-5-5.xhigh"
          ? { ...entry, score: 0.9, scoreRuns: [0.9, 0.9, 0.9] }
          : entry,
      ),
    )
    expect(text(data, "effort")).toBeUndefined()
  })

  it("leaves out the speed statement when max effort is not the slowest", () => {
    const data = variant((entries) =>
      entries.map((entry) =>
        entry.id === "haiku-5-5.low"
          ? { ...entry, medianAnswerMs: 60_000 }
          : entry,
      ),
    )
    expect(text(data, "speed")).toBeUndefined()
  })

  it("leaves out the refusal statement when Stuart showed every sentence", () => {
    const data = variant((entries) =>
      entries.map((entry) => ({
        ...entry,
        rejectedAnswers: 0,
        rejectedShare: 0,
        rejectionReasons: [],
      })),
    )
    expect(text(data, "refusals")).toBeUndefined()
  })

  it("shows nothing it cannot back with a single entry", () => {
    const data = variant((entries) => entries.slice(0, 1))
    expect(text(data, "leaders")).toBeUndefined()
  })
})
