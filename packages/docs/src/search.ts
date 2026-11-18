import type { SectionId } from "./site"

/**
 * The static search index: one entry per page and per heading, written by
 * the build to /search-index.json and searched in the browser with no
 * service. The docs site loads it on intent (hover or focus of the Ctrl K
 * bar, or the shortcut), so it never weighs on first paint.
 */

export type SearchKind = "page" | "heading" | "operation" | "tool"

export type SearchEntry = {
  /** URL path with an optional #anchor. */
  u: string
  /** Title of the page or the heading. */
  t: string
  /** The page's title, for heading entries. */
  p: string
  s: SectionId
  k: SearchKind
  /** A short excerpt shown under the title. */
  x: string
  /** Lower-case unique terms of the text, space separated. */
  w: string
}

export type SearchIndex = { version: 1; entries: SearchEntry[] }

export function terms(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9_]+/)
    .filter((term) => term.length > 0)
}

export function uniqueTerms(text: string): string {
  return [...new Set(terms(text))].join(" ")
}

export type SearchHit = { entry: SearchEntry; score: number }

function includesTerm(
  haystack: readonly string[],
  term: string,
  prefix: boolean,
): boolean {
  return haystack.some((word) =>
    prefix ? word.startsWith(term) : word === term || word.startsWith(term),
  )
}

/**
 * Every query term must match (the last one as a prefix, so results follow
 * typing). Title matches rank first, then headings, then body text; pages
 * beat their own headings on a tie.
 */
export function search(
  index: SearchIndex,
  query: string,
  limit = 12,
): SearchHit[] {
  const wanted = terms(query)
  if (wanted.length === 0) return []
  const hits: SearchHit[] = []
  for (const entry of index.entries) {
    const title = terms(entry.t)
    const page = terms(entry.p)
    const words = entry.w.split(" ")
    let score = 0
    let matched = true
    wanted.forEach((term, position) => {
      const prefix = position === wanted.length - 1
      if (includesTerm(title, term, prefix)) score += 10
      else if (includesTerm(page, term, prefix)) score += 4
      else if (includesTerm(words, term, prefix)) score += 1
      else matched = false
    })
    if (!matched) continue
    if (entry.t.toLowerCase() === query.trim().toLowerCase()) score += 20
    if (entry.k === "page") score += 0.5
    hits.push({ entry, score })
  }
  hits.sort((a, b) => b.score - a.score || a.entry.u.localeCompare(b.entry.u))
  return hits.slice(0, limit)
}
