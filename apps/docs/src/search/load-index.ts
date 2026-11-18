import { type SearchIndex, search as searchIndex } from "@matchbox/docs/search"

/**
 * The static search index, fetched once on intent from /search-index.json
 * (written at build time). Searched in the browser: no service.
 */

let index: Promise<SearchIndex> | null = null

function isIndex(value: unknown): value is SearchIndex {
  return (
    typeof value === "object" &&
    value !== null &&
    "version" in value &&
    value.version === 1 &&
    "entries" in value &&
    Array.isArray(value.entries)
  )
}

export function loadIndex(): Promise<SearchIndex> {
  index ??= fetch("/search-index.json")
    .then((response) => {
      if (!response.ok) throw new Error(`Search index ${response.status}`)
      return response.json() as Promise<unknown>
    })
    .then((value) => {
      if (!isIndex(value)) throw new Error("Search index has an unknown shape")
      return value
    })
    .catch((error: unknown) => {
      index = null
      throw error
    })
  return index
}

export { searchIndex }
