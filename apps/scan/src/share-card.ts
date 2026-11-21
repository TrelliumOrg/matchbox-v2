import { scanOrigin, shareTags } from "./site"

/**
 * The link preview card every page shares, 1200x630, drawn by packages/og
 * (`pnpm --filter @matchbox/og cards`) into public/og.png. Static: no
 * per-page rendering, so no image code in this Worker.
 */
export const ogImage = `${scanOrigin}/og.png`

/** The card's tags, added to every page's <head> by `withShareCard`. */
export const cardTags: readonly { property: string; content: string }[] = [
  { property: "og:image", content: ogImage },
  { property: "og:image:width", content: "1200" },
  { property: "og:image:height", content: "630" },
  { property: "og:image:alt", content: "Matchscan: explore Mezo" },
]

/** An attribute value as written: the page's own text is already escaped. */
function quoted(value: string): string {
  return value.replaceAll('"', "&quot;")
}

/**
 * The tags `withShareCard` writes at the end of a page's head: OG and
 * twitter for its title and description, its canonical link, the card.
 */
export function previewHtml(
  pathname: string,
  title: string,
  description: string,
): string {
  const tags = shareTags(pathname, title, description)
  const meta = [...tags.meta, ...cardTags].map((tag) =>
    "property" in tag
      ? `<meta property="${tag.property}" content="${quoted(tag.content)}">`
      : `<meta name="${tag.name}" content="${quoted(tag.content)}">`,
  )
  const links = tags.links.map(
    (link) => `<link rel="${link.rel}" href="${quoted(link.href)}">`,
  )
  return [...meta, ...links].join("")
}

/** What each page that people paste is, after its name. */
const pageKinds: readonly [RegExp, (name: string) => string][] = [
  [/^\/tx\//, (name) => `${name}, a Mezo transaction`],
  [/^\/block\//, (name) => `${name} on Mezo: its transactions and proposer`],
  [
    /^\/address\//,
    (name) => `${name} on Mezo: tokens, transactions, locks, votes and loans`,
  ],
  [
    /^\/locks\/[^/]+\/[^/]+$/,
    (name) => {
      const lock = /^(veBTC|veMEZO) #(\d+)$/.exec(name)
      return `${lock === null ? name : `Lock #${lock[2]}, ${lock[1]},`} on Mezo: amount, unlock date, votes and rewards`
    },
  ],
  [
    /^\/epochs\/[^/]+$/,
    (name) =>
      `${name} on Mezo: votes, incentives, emissions and the top gauges`,
  ],
  [
    /^\/gauges\/[^/]+$/,
    (name) => `${name} gauge on Mezo: votes, voters, incentives and APY`,
  ],
]

/** The words a page's title falls back to before its data has read. */
const unnamed = new Set([
  "Transaction",
  "Block",
  "Address",
  "Lock",
  "Epoch",
  "Gauge",
])

/**
 * A pasted page's own description, from its path and its title ("veBTC
 * #6033, Matchscan" is "Lock #6033, veBTC, on Mezo: ..."); null for the
 * pages that keep Matchscan's, and for a page whose title names nothing.
 * Here, not in the route heads: head code ships on every route.
 */
export function pageDescription(
  pathname: string,
  title: string,
): string | null {
  const name = title.replace(/, Matchscan$/, "").trim()
  if (name === "" || unnamed.has(name)) return null
  const kind = pageKinds.find(([path]) => path.test(pathname))
  return kind === undefined ? null : kind[1](name)
}

/**
 * The page with its link preview, done here on the server rather than in
 * the route heads: head code ships on every route, and Matchscan's routes
 * sit at their 120 kB script budget. Link unfurlers read only this HTML.
 * The page's own title (the deepest route's) is its og:title and
 * twitter:title; a pasted page's description (`pageDescription`) replaces
 * Matchscan's, and is its og:description and twitter:description; the
 * tags (`previewHtml`) go at the end of the head, once both are read.
 */
export function withShareCard(response: Response, pathname = "/"): Response {
  if (!(response.headers.get("content-type") ?? "").includes("text/html")) {
    return response
  }
  let title = ""
  let description = ""
  return new HTMLRewriter()
    .on("head > title", {
      text(chunk) {
        title += chunk.text
      },
    })
    .on('head > meta[name="description"]', {
      element(element) {
        const own = pageDescription(pathname, title)
        description = own ?? element.getAttribute("content") ?? ""
        if (own !== null) {
          element.replace(
            `<meta name="description" content="${quoted(own)}">`,
            { html: true },
          )
        }
      },
    })
    .on("head", {
      element(element) {
        element.onEndTag((end) => {
          end.before(previewHtml(pathname, title.trim(), description), {
            html: true,
          })
        })
      },
    })
    .transform(response)
}
