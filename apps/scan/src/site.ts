/**
 * Matchscan's production origin (wrangler.jsonc, env "preview", custom
 * domain). Canonical URLs and the OG and twitter tags name it on every
 * host, so a preview or workers.dev copy points search engines and link
 * previews at the real site. The CSP names no host of its own: 'self'.
 */
export const scanOrigin = "https://scan.matchbox.markets"

/** The canonical URL of a path on Matchscan. */
export function canonicalUrl(pathname: string): string {
  const path = pathname.startsWith("/") ? pathname : `/${pathname}`
  return `${scanOrigin}${path === "/" ? "/" : path.replace(/\/+$/, "")}`
}

/** Link-preview tags for a page: OG and twitter, on the production origin. */
export function shareTags(
  pathname: string,
  title: string,
  description: string,
) {
  const url = canonicalUrl(pathname)
  return {
    meta: [
      { property: "og:site_name", content: "Matchscan" },
      { property: "og:type", content: "website" },
      { property: "og:url", content: url },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:title", content: title },
      { name: "twitter:description", content: description },
    ],
    links: [{ rel: "canonical", href: url }],
  }
}
