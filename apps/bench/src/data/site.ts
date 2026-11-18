import type { Run } from "./schema"

/**
 * Where the site lives and what each page tells search engines and link
 * previews: a canonical URL, Open Graph title, description, URL and image,
 * and noindex while the results file is a sample.
 */

export const siteOrigin = "https://bench.matchbox.markets"

export const siteDescription =
  "How Claude models perform inside Stuart, Matchbox's assistant for the Mezo network: score, safety, cost and speed on the same questions, graded by code."

/** The link preview image, 1200 by 630, made from the design (public/og.png). */
export const ogImage = `${siteOrigin}/og.png`

type Meta = Record<string, string>
type Link = Record<string, string>

/** The robots meta for a run: noindex while its figures are a sample. */
export function robotsMeta(run: Pick<Run, "sample">): Meta[] {
  return run.sample === true ? [{ name: "robots", content: "noindex" }] : []
}

/** A page's title, canonical link and Open Graph tags. */
export function pageHead(
  path: string,
  title: string,
): { meta: Meta[]; links: Link[] } {
  const url = `${siteOrigin}${path}`
  return {
    meta: [
      { title },
      { property: "og:title", content: title },
      { property: "og:url", content: url },
    ],
    links: [{ rel: "canonical", href: url }],
  }
}
