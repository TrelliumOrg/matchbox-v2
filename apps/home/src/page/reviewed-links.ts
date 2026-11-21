/**
 * The addresses outside this Worker that the footer may link, each opened
 * by a person and seen to answer 200 (after redirects) on the date given.
 * The unit and e2e tests fail on a footer link that is neither a route
 * this Worker serves nor on this list, so a new or moved page cannot ship
 * as a dead link. Check by hand before adding one: README, Open questions.
 */
export const reviewedLinks: Readonly<Record<string, string>> = {
  "https://pro.matchbox.markets/?from=home": "2026-11-19",
  "https://scan.matchbox.markets": "2026-11-19",
  "https://id.matchbox.markets": "2026-11-19",
  "https://developer.matchbox.markets": "2026-11-19",
  "https://docs.matchbox.markets": "2026-11-19",
  "https://app.matchbox.markets": "2026-11-19",
  // Goes on to Classic's privacy policy (src/classic-paths.ts).
  "https://matchbox.markets/privacy": "2026-11-19",
}

/** The paths this Worker answers itself (src/routes and src/server.ts). */
export const ownRoutes: readonly string[] = ["/", "/search"]
