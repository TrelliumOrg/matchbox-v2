import type { SectionId } from "./site"

/**
 * The navigation manifest the build writes to dist/manifest.js: every
 * published page's title and place, the page trees with only published
 * pages, and previous and next links. It is the one piece of content data
 * every docs page loads, so it carries labels and paths only.
 */

export type ManifestPage = {
  path: string
  title: string
  /** Shorter label for the page tree, when the title is long. */
  nav: string
  section: SectionId
  /** Eyebrow above the title: the section name or the tag. */
  eyebrow: string
  /** Which tree to show beside the page. */
  tree: string | null
  /** Method label in API trees ("GET"), or null. */
  method: string | null
  /**
   * How the page body renders. The shell lays out operation and tool pages
   * with a samples column before the body's chunk has loaded.
   */
  kind: "prose" | "operation" | "tool" | "reference"
  /** The page has an On this page list, so the header offers it. */
  outline: boolean
  readingMinutes: number
  updated: string
  /** "Edit on GitHub" target, or null for generated pages. */
  source: string | null
  /** Previous and next pages in the tree's reading order. */
  prev: string | null
  next: string | null
}

export type ManifestTree = {
  id: string
  groups: readonly {
    label: string
    pages: readonly { path: string; nav: string; method: string | null }[]
  }[]
}

export type Manifest = {
  pages: Readonly<Record<string, ManifestPage>>
  trees: Readonly<Record<string, ManifestTree>>
  /** Published page counts per section, for the home cards. */
  counts: Readonly<Record<SectionId, number>>
  apiVersion: string
}
