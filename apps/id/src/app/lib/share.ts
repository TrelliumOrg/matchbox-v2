/**
 * Matchbox ID's production origin: link previews name it on every host,
 * so a workers.dev copy points previews at the real site.
 */
export const idOrigin = "https://id.matchbox.markets"

/**
 * The link preview card every page shares, 1200x630, drawn by packages/og
 * (`pnpm --filter @matchbox/og cards`) into public/og.png.
 */
export const ogImage = `${idOrigin}/og.png`

/** A page's address on the production origin, without its query. */
export function pageUrl(pathname: string): string {
  const path = pathname.startsWith("/") ? pathname : `/${pathname}`
  return `${idOrigin}${path}`
}

/** Link-preview tags for a page: OG and twitter, on the production origin. */
export function shareTags(pathname: string, description: string) {
  return [
    { property: "og:site_name", content: "Matchbox ID" },
    { property: "og:type", content: "website" },
    { property: "og:title", content: "Matchbox ID" },
    { property: "og:description", content: description },
    { property: "og:url", content: pageUrl(pathname) },
    { property: "og:image", content: ogImage },
    { property: "og:image:type", content: "image/png" },
    { property: "og:image:width", content: "1200" },
    { property: "og:image:height", content: "630" },
    {
      property: "og:image:alt",
      content: "Matchbox ID: sign in with your wallet",
    },
    { name: "twitter:card", content: "summary_large_image" },
  ]
}
