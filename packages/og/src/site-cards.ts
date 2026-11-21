import type { SiteCard } from "./site-card"

/**
 * The static link preview cards of the sites with no live figures, each
 * with the file it is written to under apps/ (scripts/site-cards.mjs). The
 * copy is each site's own: its heading and its product.
 */
export const siteCards: readonly { out: string; card: SiteCard }[] = [
  {
    out: "home/public/og.png",
    card: {
      product: "matchbox",
      label: "Apps for Mezo",
      headline: "Use Mezo with Matchbox",
      host: "matchbox.markets",
    },
  },
  {
    out: "scan/public/og.png",
    card: {
      product: "scan",
      label: "Mezo explorer",
      headline: "Explore Mezo",
      host: "scan.matchbox.markets",
    },
  },
  {
    out: "docs/public/og.png",
    card: {
      product: "docs",
      label: "Guides and reference",
      headline: "Learn Matchbox",
      host: "docs.matchbox.markets",
    },
  },
  {
    out: "id/public/og.png",
    card: {
      product: "id",
      label: "Apps built on Mezo",
      headline: "Sign in with your wallet",
      host: "id.matchbox.markets",
    },
  },
]
