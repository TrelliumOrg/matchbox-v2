/**
 * Where the homepage links: each product's real address. Developer's is
 * the custom domain in apps/developer/wrangler.jsonc.
 */
export const links = {
  /**
   * `from=home` tells Pro the visitor came from this page: only then
   * does it offer the way back to Classic ("Looking for the old
   * Matchbox?"). Pro removes it from the address on load.
   */
  pro: "https://pro.matchbox.markets/?from=home",
  scan: "https://scan.matchbox.markets",
  /**
   * The Matchscan card's search form submits here as a plain GET
   * (`?q=`), so it works without JavaScript; this Worker's `/search`
   * redirects to the matching Matchscan page (src/search.ts).
   */
  scanSearch: "/search",
  id: "https://id.matchbox.markets",
  developer: "https://developer.matchbox.markets",
  docs: "https://docs.matchbox.markets",
  classic: "https://app.matchbox.markets",
  /**
   * As every other app links them. This page will answer matchbox.markets
   * once a person moves the domain, so these two must exist by then:
   * README, Open questions.
   */
  privacy: "https://matchbox.markets/privacy",
  terms: "https://matchbox.markets/terms",
} as const
