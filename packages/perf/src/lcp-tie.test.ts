import { spawnSync } from "node:child_process"
import { cp, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import {
  applyTieRule,
  lcpIsImage,
  tieAdjustment,
  tieLine,
  tieSummary,
} from "./lcp-tie.mjs"

/**
 * The LCP timestamp tie rule against recorded Lighthouse results (trimmed
 * to what the rule and lhci assert read):
 *
 * - tie: Scan's Home on CI (run 42923851219, commit b98d0a5), all three
 *   runs with the largest paint stamped 1 µs after the first paint for
 *   the same frame: simulated LCP 1.58 to 1.59 s, observed 238 to 248 ms.
 * - slow: Scan's MEZO token page before its coin was drawn inline (commit
 *   5274f7f), a real 64 px image LCP at 1.52 to 1.65 s, recorded locally,
 *   with its timestamps tied exactly.
 */

const fixtures = fileURLToPath(new URL("./fixtures/lcp-tie/", import.meta.url))
const lhciCli = createRequire(import.meta.url).resolve("@lhci/cli/src/cli.js")

async function results(kind: string): Promise<unknown[]> {
  const dir = path.join(fixtures, kind)
  const names = (await readdir(dir)).filter((name) => name.endsWith(".json"))
  return Promise.all(
    names.map(async (name) =>
      JSON.parse(await readFile(path.join(dir, name), "utf8")),
    ),
  )
}

/** A fresh lhci workspace holding a fixture set as collect leaves it. */
async function workspace(kind: string): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "lcp-tie-"))
  await cp(path.join(fixtures, kind), path.join(root, ".lighthouseci"), {
    recursive: true,
  })
  // Scan's budget and lhci's own aggregation, as the apps assert them.
  await writeFile(
    path.join(root, "lighthouserc.json"),
    JSON.stringify({
      ci: {
        assert: {
          assertions: {
            "largest-contentful-paint": [
              "error",
              { maxNumericValue: 1200, aggregationMethod: "median-run" },
            ],
            "cumulative-layout-shift": [
              "error",
              { maxNumericValue: 0, aggregationMethod: "pessimistic" },
            ],
          },
        },
      },
    }),
  )
  return root
}

/** `lhci assert` in a workspace: its exit code. */
function assertIn(root: string): number {
  const run = spawnSync(
    process.execPath,
    [lhciCli, "assert", "--config=lighthouserc.json"],
    { cwd: root, encoding: "utf8" },
  )
  return run.status ?? 1
}

describe("the LCP timestamp tie rule", () => {
  it("covers a text LCP stamped a microsecond after the first paint", async () => {
    const tie = await results("tie")
    expect(tie).toHaveLength(3)
    for (const lhr of tie) {
      const adjustment = tieAdjustment(lhr)
      expect(adjustment).not.toBeNull()
      expect(adjustment?.route).toBe("/")
      expect((adjustment?.lcpTs ?? 0) - (adjustment?.fcpTs ?? 0)).toBe(1)
      expect(adjustment?.simulatedLcp).toBeGreaterThan(1500)
      expect(adjustment?.simulatedFcp).toBeLessThan(800)
    }
  })

  it("never covers an image LCP, even with its timestamps tied", async () => {
    const slow = await results("slow")
    expect(slow).toHaveLength(3)
    for (const lhr of slow) {
      expect(lcpIsImage(lhr)).toBe(true)
      expect(tieAdjustment(lhr)).toBeNull()
    }
  })

  it("leaves runs alone outside the 1 ms window or already at the first paint", async () => {
    // biome-ignore lint/suspicious/noExplicitAny: a recorded Lighthouse result
    const lhr = (await results("tie"))[0] as any
    const metrics = lhr.audits.metrics.details.items[0]
    // Two paints 2 ms apart are two paints.
    const apart = structuredClone(lhr)
    apart.audits.metrics.details.items[0].observedLargestContentfulPaintTs =
      metrics.observedFirstContentfulPaintTs + 2000
    expect(tieAdjustment(apart)).toBeNull()
    // An exact tie Lighthouse already reports at the first paint.
    const exact = structuredClone(lhr)
    exact.audits["largest-contentful-paint"].numericValue =
      exact.audits["first-contentful-paint"].numericValue
    expect(tieAdjustment(exact)).toBeNull()
  })

  it("says every run it covers, with the timestamps, and counts them", async () => {
    const root = await workspace("tie")
    const result = await applyTieRule(path.join(root, ".lighthouseci"))
    expect(result.used).toHaveLength(3)
    expect(tieSummary(result)).toBe("LCP tie allowance used in 3 of 3 runs")
    const line = tieLine(result.used[0] as NonNullable<(typeof result.used)[0]>)
    expect(line).toMatch(
      /^LCP tie allowance: \/; simulated LCP 15\d\d ms judged as simulated FCP 7\d\d ms; observed LCP 2\d\d ms; FCP ts \d+, LCP ts \d+ \(1 µs apart\)$/,
    )
    // Applying it twice changes nothing more.
    expect((await applyTieRule(path.join(root, ".lighthouseci"))).used).toEqual(
      [],
    )
  })

  it("passes the tie runs under lhci's own assertion, which fails them without it", async () => {
    const before = await workspace("tie")
    expect(assertIn(before)).toBe(1)
    const after = await workspace("tie")
    await applyTieRule(path.join(after, ".lighthouseci"))
    expect(assertIn(after)).toBe(0)
  }, 60_000)

  it("still fails a genuinely slow page", async () => {
    const root = await workspace("slow")
    const result = await applyTieRule(path.join(root, ".lighthouseci"))
    expect(result.used).toEqual([])
    expect(assertIn(root)).toBe(1)
  }, 60_000)
})
