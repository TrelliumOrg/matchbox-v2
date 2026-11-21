/**
 * The addresses outside the docs that the site footer may link, each opened
 * by a person and seen to answer 200 (after redirects) on the date given.
 * e2e/smoke.spec.ts fails on a footer link that is neither a page or file
 * of this build nor on this list, so a moved page cannot ship as a dead
 * link. Check by hand before adding one.
 */
export const reviewedLinks: Readonly<Record<string, string>> = {
  "https://pro.matchbox.markets": "2026-11-19",
  "https://scan.matchbox.markets": "2026-11-19",
  // Goes on to Matchbox Classic's privacy policy.
  "https://matchbox.markets/privacy": "2026-11-19",
}
