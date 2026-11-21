import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import {
  benchFailureTypes,
  benchKinds,
  benchRejectionReasons,
  benchResultsSchema,
} from "./results"

// The sample the leaderboard is built against before a real run exists.
const sample = JSON.parse(
  readFileSync(
    new URL(
      "../../../../apps/stuart/bench/published/sample.json",
      import.meta.url,
    ),
    "utf8",
  ),
)

describe("bench results contract", () => {
  it("accepts the sample file", () => {
    const parsed = benchResultsSchema.parse(sample)
    expect(parsed.run.sample).toBe(true)
    expect(parsed.kinds.map((kind) => kind.id)).toEqual(
      benchKinds.map((kind) => kind.id),
    )
    expect(parsed.failureTypes.map((type) => type.id)).toEqual(
      benchFailureTypes.map((type) => type.id),
    )
    // A published file keeps the reasons that existed when it was
    // written: each is a known reason, in the contract's order, and the
    // contract adds new reasons only after them.
    const known = benchRejectionReasons.map((type) => type.id)
    const listed = parsed.rejectionTypes.map((type) => type.id)
    expect(listed.every((id) => known.includes(id))).toBe(true)
    expect(known.slice(0, listed.length)).toEqual(listed)
  })

  it("lists every rejection reason Stuart records, new ones last", () => {
    expect(benchRejectionReasons.map((type) => type.id)).toEqual([
      "too_many_sentences",
      "too_long",
      "unsourced",
      "claim",
      "greeting",
      "empty",
      "reply_unsourced",
      "reply_claim",
      "reply_empty",
      "instruction",
    ])
  })

  it("refuses rejection reasons that do not add up to the total", () => {
    const parsed = benchResultsSchema.parse(sample)
    for (const entry of parsed.entries) {
      const sum = entry.rejectionReasons.reduce((a, each) => a + each.count, 0)
      expect(sum).toBe(entry.rejectedAnswers)
    }
    const off = structuredClone(sample)
    off.entries[0].rejectedAnswers += 1
    expect(benchResultsSchema.safeParse(off).success).toBe(false)
    const unknown = structuredClone(sample)
    unknown.entries[0].rejectionReasons[0].reason = "rejected"
    expect(benchResultsSchema.safeParse(unknown).success).toBe(false)
  })

  it("requires the matrix fingerprint", () => {
    const bare = structuredClone(sample)
    delete bare.run.fingerprint
    expect(benchResultsSchema.safeParse(bare).success).toBe(false)
  })

  it("refuses unknown fields, so nothing extra is published", () => {
    const leaked = structuredClone(sample)
    leaked.publicQuestions[0].expected = 9_658.43
    expect(benchResultsSchema.safeParse(leaked).success).toBe(false)
    const extra = structuredClone(sample)
    extra.heldBack = [{ id: "x", question: "y" }]
    expect(benchResultsSchema.safeParse(extra).success).toBe(false)
  })

  it("refuses an answer for an entry that is not listed", () => {
    const orphan = structuredClone(sample)
    orphan.publicQuestions[0].answers[0].entry = "opus-5-5.max"
    expect(benchResultsSchema.safeParse(orphan).success).toBe(false)
  })

  it("publishes agreement only with two runs or more", () => {
    const one = structuredClone(sample)
    one.entries[0].runs = 1
    one.entries[0].scoreRuns = [one.entries[0].score]
    expect(benchResultsSchema.safeParse(one).success).toBe(false)
    one.entries[0].agreement = null
    expect(benchResultsSchema.safeParse(one).success).toBe(true)
  })
})
