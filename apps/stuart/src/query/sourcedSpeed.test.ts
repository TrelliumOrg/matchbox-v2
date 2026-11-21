import { describe, expect, it } from "vitest"
import { IdScope, makeFact } from "./outcome"
import {
  addFacts,
  addModelView,
  checkModelAnswer,
  emptySourcedSet,
} from "./sourced"

// The sourcing check reads text a user, a chain name or the model wrote,
// so its time must grow with the text's length, not its square. These
// inputs each took between 0.7 s and 7.4 s before the patterns were
// bounded; each now takes a few milliseconds, the dates case about 45 ms.
// The CI laptop is about five times slower (the dates case took 226 ms
// there), so the bound leaves it room while staying below the 0.7 s the
// mildest quadratic pattern took on a fast machine.

const LIMIT_MS = 600

const INPUTS: Record<string, string> = {
  "alternating Latin and Cyrillic letters": Array.from(
    { length: 10_000 },
    (_, index) => (index % 2 === 0 ? "a" : "а"),
  ).join(""),
  '"a-" repeated': "a-".repeat(5_000),
  '"twenty-" repeated': "twenty-".repeat(1_430),
  '"0x" repeated': "0x".repeat(5_000),
  "one long word": "a".repeat(10_000),
  dashes: "-".repeat(10_000),
  "digits and spaces": "1 ".repeat(5_000),
  dates: "15 Aug ".repeat(1_430),
  '"a." repeated': "a.".repeat(5_000),
}

/** The fastest of three runs, in milliseconds. */
function fastest(run: () => unknown): number {
  let best = Number.POSITIVE_INFINITY
  for (let round = 0; round < 3; round += 1) {
    const started = performance.now()
    run()
    best = Math.min(best, performance.now() - started)
  }
  return best
}

const scope = new IdScope("c9")

describe("the sourcing check on long adversarial text", () => {
  for (const [name, text] of Object.entries(INPUTS)) {
    it(`checks ${name} in linear time`, () => {
      expect(text.length).toBeGreaterThanOrEqual(10_000)
      const ms = fastest(() =>
        checkModelAnswer(text, emptySourcedSet(text), {
          sentences: 1_000,
          chars: 100_000,
        }),
      )
      expect(ms).toBeLessThan(LIMIT_MS)
    })

    it(`builds the sourced set from ${name} in linear time`, () => {
      const ms = fastest(() => {
        const set = emptySourcedSet(text)
        addFacts(set, [
          makeFact({
            scope,
            key: "text",
            label: "Note",
            value: { kind: "text", text },
            display: text,
            status: "live",
            evidenceRefs: [],
          }),
        ])
        addModelView(set, { rows: [{ name: text, note: text }], notes: [text] })
      })
      expect(ms).toBeLessThan(LIMIT_MS)
    })
  }
})
