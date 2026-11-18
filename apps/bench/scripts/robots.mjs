// The X-Robots-Tag header for a build: noindex on every page while the
// results file is a sample, nothing once it holds a real run. The page's
// <meta name="robots"> follows the same flag (src/data/site.ts). Kept apart
// from postbuild.mjs so a unit test can call it.

const marker = "  X-Robots-Tag: noindex"

/** True when the results file says its figures are made up. */
export function isSample(results) {
  return results?.run?.sample === true
}

/**
 * The _headers text with X-Robots-Tag: noindex added to the "/*" block when
 * the run is a sample, and unchanged otherwise.
 */
export function withRobotsHeader(headers, sample) {
  if (!sample || headers.includes(marker)) return headers
  if (!/^\/\*$/m.test(headers)) throw new Error("_headers has no /* block")
  return headers.replace(/^\/\*$/m, `/*\n${marker}`)
}
