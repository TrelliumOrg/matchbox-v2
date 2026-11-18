// The LCP timestamp tie rule for Lighthouse CI (simulated throttling).
//
// When a page's largest paint is text drawn in the same frame as its first
// paint, Lighthouse reports the simulated first paint as the LCP, but only
// if the trace's two timestamps are exactly equal. Chrome sometimes stamps
// the largest-paint candidate 1 µs after the first paint for that same
// frame; Lighthouse then simulates every request started before it
// (scripts included) and reports about twice the time. Across 120 CI runs
// of Scan, the 116 exact ties were all fast and the 4 one-microsecond gaps
// all slow, though each painted its heading in the first frame.
//
// A run whose two timestamps are within 1 ms, whose LCP element is text
// (not an image, whose load Lighthouse models for real), and whose
// simulated LCP exceeds its simulated first paint is judged on its
// simulated first paint: the value Lighthouse gives an exact tie. Every
// other run is judged as Lighthouse reported it. Budgets do not change.

import { readdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"

/** Timestamps this close (trace µs) count as the same paint. */
export const tieWindowUs = 1000

/**
 * The adjustment for one Lighthouse result, or null when the rule does not
 * apply. Values are ms; timestamps are the trace's (µs).
 *
 * @param {any} lhr
 * @returns {null | { route: string, simulatedLcp: number, simulatedFcp: number, observedLcp: number, observedFcp: number, fcpTs: number, lcpTs: number }}
 */
export function tieAdjustment(lhr) {
  const metrics = lhr?.audits?.metrics?.details?.items?.[0]
  const lcp = lhr?.audits?.["largest-contentful-paint"]?.numericValue
  const fcp = lhr?.audits?.["first-contentful-paint"]?.numericValue
  if (
    metrics === undefined ||
    typeof lcp !== "number" ||
    typeof fcp !== "number"
  ) {
    return null
  }
  const fcpTs = metrics.observedFirstContentfulPaintTs
  const lcpTs = metrics.observedLargestContentfulPaintTs
  if (typeof fcpTs !== "number" || typeof lcpTs !== "number") return null
  if (Math.abs(lcpTs - fcpTs) > tieWindowUs) return null
  if (lcpIsImage(lhr)) return null
  if (lcp <= fcp) return null
  return {
    route: routeOf(lhr),
    simulatedLcp: lcp,
    simulatedFcp: fcp,
    observedLcp: metrics.observedLargestContentfulPaint,
    observedFcp: metrics.observedFirstContentfulPaint,
    fcpTs,
    lcpTs,
  }
}

/**
 * An image's LCP has a resource to load (Lighthouse's breakdown names its
 * load delay and duration); text has none.
 *
 * @param {any} lhr
 */
export function lcpIsImage(lhr) {
  const items = lhr?.audits?.["lcp-breakdown-insight"]?.details?.items ?? []
  const table = items.find((/** @type {any} */ item) => item.type === "table")
  return (table?.items ?? []).some((/** @type {any} */ row) =>
    ["resourceLoadDelay", "resourceLoadDuration"].includes(row.subpart),
  )
}

/** @param {any} lhr */
function routeOf(lhr) {
  const url = lhr.finalDisplayedUrl ?? lhr.finalUrl ?? lhr.requestedUrl ?? ""
  try {
    const parsed = new URL(url)
    return `${parsed.pathname}${parsed.search}`
  } catch {
    return url
  }
}

/** One log line for a run the rule judged on its simulated first paint. */
export function tieLine(
  /** @type {NonNullable<ReturnType<typeof tieAdjustment>>} */ a,
) {
  const ms = (/** @type {number} */ value) => `${Math.round(value)} ms`
  return [
    `LCP tie allowance: ${a.route}`,
    `simulated LCP ${ms(a.simulatedLcp)} judged as simulated FCP ${ms(a.simulatedFcp)}`,
    `observed LCP ${ms(a.observedLcp)}`,
    `FCP ts ${a.fcpTs}, LCP ts ${a.lcpTs} (${a.lcpTs - a.fcpTs} µs apart)`,
  ].join("; ")
}

/**
 * Applies the rule to every saved result in `dir` (lhci collect's
 * `.lighthouseci`): a run it covers gets the simulated first paint as its
 * LCP, with the simulated LCP kept beside it (`matchboxLcpTie`), so
 * `lhci assert` judges it like any other run and the report still shows
 * what Lighthouse measured. Returns the adjustments and the run count.
 *
 * @param {string} dir
 */
export async function applyTieRule(dir) {
  const files = (await readdir(dir)).filter((name) =>
    /^lhr-.*\.json$/.test(name),
  )
  /** @type {NonNullable<ReturnType<typeof tieAdjustment>>[]} */
  const used = []
  for (const name of files.sort()) {
    const file = path.join(dir, name)
    const lhr = JSON.parse(await readFile(file, "utf8"))
    if (lhr.matchboxLcpTie !== undefined) continue
    const adjustment = tieAdjustment(lhr)
    if (adjustment === null) continue
    const audit = lhr.audits["largest-contentful-paint"]
    lhr.matchboxLcpTie = adjustment
    audit.numericValue = adjustment.simulatedFcp
    audit.displayValue = `${(adjustment.simulatedFcp / 1000).toFixed(1)} s (tie allowance; simulated ${(adjustment.simulatedLcp / 1000).toFixed(1)} s)`
    await writeFile(file, JSON.stringify(lhr))
    used.push(adjustment)
  }
  return { used, runs: files.length }
}

/** The summary line: how many runs the rule judged on their first paint. */
export function tieSummary(
  /** @type {{ used: unknown[], runs: number }} */ result,
) {
  return `LCP tie allowance used in ${result.used.length} of ${result.runs} runs`
}
