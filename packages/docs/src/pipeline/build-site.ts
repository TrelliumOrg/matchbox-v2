import type { Manifest, ManifestPage, ManifestTree } from "../manifest"
import type { DocNode, PageBody, PageData, TocItem } from "../render-types"
import type { SearchEntry, SearchIndex } from "../search"
import { uniqueTerms } from "../search"
import {
  editBaseUrl,
  type SectionId,
  sectionById,
  sectionOfPath,
  sections,
  siteOrigin,
  trees,
} from "../site"
import type { ContentFile, StuartEntry } from "./content"
import { lintMarkdown, lintMeta } from "./copy-lint"
import {
  type MarkdownContext,
  parseMarkdown,
  renderMarkdown,
  type SearchSection,
} from "./markdown"

/**
 * Turns content files and generated pages into everything the site serves:
 * page chunks, the navigation manifest, the search index, typed links, the
 * topics index, Stuart's knowledge, llms.txt and the sitemap. Every check
 * that can fail a build runs here: copy rules, unknown links and anchors,
 * duplicate anchors, trees that name missing pages.
 */

/** A page made from data rather than Markdown (API operations, MCP tools). */
export type GeneratedPage = {
  path: string
  title: string
  nav: string
  description: string
  section: SectionId
  eyebrow: string
  tree: string
  method: string | null
  body: PageBody
  toc: TocItem[]
  ids: string[]
  links: string[]
  sections: SearchSection[]
  markdown: string
  kind: SearchEntry["k"]
  topics: string[]
}

/** Extra trees from generators: the API reference and the MCP tools. */
export type GeneratedTree = ManifestTree

export type BuildInput = {
  content: readonly ContentFile[]
  generated: readonly GeneratedPage[]
  generatedTrees: readonly GeneratedTree[]
  tables: MarkdownContext["tables"]
  apiVersion: string
  /** Paths that exist but are not pages (llms.txt, openapi.json). */
  files: readonly string[]
  /** Pages that list the generated ones: their tree leaf. */
  generatedTreeOf: (path: string) => string | null
}

export type BuildOutput = {
  pages: Map<string, PageData>
  manifest: Manifest
  search: SearchIndex
  topics: Map<string, string>
  topicsIndex: TopicsIndexEntry[]
  knowledge: { page: string; entries: StuartEntry[] }[]
  markdownTwins: Map<string, string>
  llms: string
  sitemap: string
  stubs: { path: string; title: string }[]
  /** TypeScript fences from the content, for src/samples.gen.ts. */
  samples: { id: string; source: string }[]
  problems: string[]
}

export type TopicsIndexEntry = {
  topic: string
  title: string
  url: string
  section: SectionId
  description: string
  headings: { title: string; url: string }[]
}

function readingMinutes(words: number): number {
  return Math.max(1, Math.round(words / 220))
}

/** "/pro/vote" to "pro.vote", "/" to "home". */
export function topicOfPath(path: string): string {
  if (path === "/") return "home"
  return path.slice(1).replaceAll("/", ".")
}

function excerpt(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim()
  if (clean.length <= 140) return clean
  return `${clean.slice(0, 137).replace(/\s\S*$/, "")}…`
}

export async function buildSite(input: BuildInput): Promise<BuildOutput> {
  const problems: string[] = []
  const published = input.content.filter(
    (file) => file.meta.status === "published",
  )
  const stubs = input.content
    .filter((file) => file.meta.status === "stub")
    .map((file) => ({ path: file.path, title: file.meta.title }))

  const known = new Map<
    string,
    { title: string; definition: string | undefined }
  >()
  for (const file of published) {
    known.set(file.path, {
      title: file.meta.title,
      definition: file.meta.definition,
    })
  }
  for (const page of input.generated) {
    known.set(page.path, { title: page.title, definition: undefined })
  }

  type Built = {
    path: string
    title: string
    nav: string
    description: string
    section: SectionId
    eyebrow: string
    tree: string | null
    method: string | null
    data: PageData
    ids: string[]
    links: string[]
    sections: SearchSection[]
    words: number
    updated: string
    source: string | null
    markdown: string
    kind: SearchEntry["k"]
    topics: string[]
    stuart: StuartEntry[]
  }
  const built: Built[] = []
  const samples: { id: string; source: string }[] = []

  for (const file of published) {
    const fail = (message: string) => problems.push(`${file.file}: ${message}`)
    for (const message of lintMeta(file.meta)) fail(message)
    const root = parseMarkdown(file.markdown)
    for (const problem of lintMarkdown(root)) {
      fail(`line ${(problem.line ?? 0) + file.bodyLine}: ${problem.message}`)
    }
    const context: MarkdownContext = {
      file: file.file,
      tables: input.tables,
      term: (to) => {
        const [targetPath] = to.split("#")
        const target = known.get(targetPath ?? "")
        if (target === undefined)
          throw new Error(`${file.file}: :term to unknown page ${to}`)
        if (target.definition === undefined) {
          throw new Error(`${file.file}: ${to} has no definition for :term`)
        }
        return { title: target.title, definition: target.definition, href: to }
      },
    }
    const rendered = await renderMarkdown(root, context)
    rendered.samples.forEach((source, index) => {
      samples.push({ id: `${file.path} ${index + 1}`, source })
    })
    const section = sectionOfPath(file.path)
    const tree = sectionById(section).tree
    built.push({
      path: file.path,
      title: file.meta.title,
      nav: file.meta.nav ?? file.meta.title,
      description: file.meta.description,
      section,
      eyebrow: sectionById(section).name,
      tree,
      method: null,
      data: {
        kind: "prose",
        body: rendered.body,
        path: file.path,
        title: file.meta.title,
        description: file.meta.description,
        toc: rendered.toc,
      },
      ids: rendered.ids,
      links: rendered.links,
      sections: rendered.sections,
      words: rendered.words,
      updated: file.meta.updated,
      source: `${editBaseUrl}/${file.file}`,
      markdown: `# ${file.meta.title}\n\n${file.meta.description}\n\n${file.markdown.trim()}\n`,
      kind: "page",
      topics: file.meta.topics,
      stuart: file.meta.stuart,
    })
  }

  for (const page of input.generated) {
    const words = page.sections.reduce(
      (sum, section) => sum + section.text.split(/\s+/).filter(Boolean).length,
      0,
    )
    built.push({
      path: page.path,
      title: page.title,
      nav: page.nav,
      description: page.description,
      section: page.section,
      eyebrow: page.eyebrow,
      tree: page.tree,
      method: page.method,
      data: {
        ...page.body,
        path: page.path,
        title: page.title,
        description: page.description,
        toc: page.toc,
      },
      ids: page.ids,
      links: page.links,
      sections: page.sections,
      words,
      updated: "",
      source: null,
      markdown: page.markdown,
      kind: page.kind,
      topics: page.topics,
      stuart: [],
    })
  }

  const byPath = new Map(built.map((page) => [page.path, page]))
  if (byPath.size !== built.length) problems.push("Two pages share a path")

  // Trees: only published pages, every published page in one tree.
  const manifestTrees: Record<string, ManifestTree> = {}
  const placed = new Map<string, string>()
  for (const tree of trees) {
    const groups = tree.groups
      .map((group) => ({
        label: group.label,
        pages: group.paths
          .filter((path) => byPath.has(path))
          .map((path) => {
            const page = byPath.get(path)
            if (placed.has(path)) problems.push(`${path} sits in two trees`)
            placed.set(path, tree.id)
            return {
              path,
              nav: page?.nav ?? path,
              method: page?.method ?? null,
            }
          }),
      }))
      .filter((group) => group.pages.length > 0)
    manifestTrees[tree.id] = { id: tree.id, groups }
    for (const group of tree.groups) {
      for (const path of group.paths) {
        const isStub = stubs.some((stub) => stub.path === path)
        if (!byPath.has(path) && !isStub) {
          problems.push(
            `Tree ${tree.id} names ${path}, which has no content file`,
          )
        }
      }
    }
  }
  for (const tree of input.generatedTrees) {
    manifestTrees[tree.id] = tree
    for (const group of tree.groups) {
      for (const page of group.pages) {
        // An index page listed in a section tree keeps that tree.
        if (!placed.has(page.path)) placed.set(page.path, tree.id)
      }
    }
  }
  for (const page of built) {
    if (page.path === "/" || page.path === "/stuart") continue
    if (!placed.has(page.path)) problems.push(`${page.path} is in no page tree`)
  }

  // Previous and next follow the tree's reading order.
  const order = new Map<string, string[]>()
  for (const tree of Object.values(manifestTrees)) {
    order.set(
      tree.id,
      tree.groups.flatMap((group) => group.pages.map((page) => page.path)),
    )
  }

  // Links and anchors: every internal link names a page and, when it has
  // one, an anchor on that page.
  const files = new Set(input.files)
  for (const page of built) {
    for (const href of page.links) {
      if (/^(https?:|mailto:)/.test(href)) continue
      if (!href.startsWith("/") && !href.startsWith("#")) {
        problems.push(`${page.path}: relative link ${href}, use a path from /`)
        continue
      }
      const [targetPath = "", anchor] = href.split("#")
      const target = targetPath === "" ? page : byPath.get(targetPath)
      if (target === undefined) {
        if (!files.has(targetPath))
          problems.push(`${page.path}: broken link ${href}`)
        continue
      }
      if (
        anchor !== undefined &&
        anchor !== "" &&
        !target.ids.includes(anchor)
      ) {
        problems.push(`${page.path}: no #${anchor} on ${target.path}`)
      }
    }
  }

  const manifestPages: Record<string, ManifestPage> = {}
  const pages = new Map<string, PageData>()
  for (const page of built) {
    const treeId = placed.get(page.path) ?? page.tree
    const sequence = treeId === null ? [] : (order.get(treeId) ?? [])
    const index = sequence.indexOf(page.path)
    const neighbour = (offset: number): string | null => {
      const path = index === -1 ? undefined : sequence[index + offset]
      return path !== undefined && byPath.has(path) ? path : null
    }
    manifestPages[page.path] = {
      path: page.path,
      title: page.title,
      nav: page.nav,
      section: page.section,
      eyebrow: page.eyebrow,
      tree: treeId,
      method: page.method,
      kind: page.data.kind,
      outline: page.data.toc.length > 0,
      readingMinutes: readingMinutes(page.words),
      updated: page.updated,
      source: page.source,
      prev: neighbour(-1),
      next: neighbour(1),
    }
    pages.set(page.path, page.data)
  }

  const counts = Object.fromEntries(
    sections.map((section) => [
      section.id,
      built.filter((page) => page.section === section.id).length,
    ]),
  ) as Record<SectionId, number>

  // Search: a page entry with its lead text, a heading entry per section.
  const entries: SearchEntry[] = []
  for (const page of built) {
    if (page.path === "/") continue
    const lead = page.sections.find((section) => section.id === null)
    entries.push({
      u: page.path,
      t: page.title,
      p: sectionById(page.section).name,
      s: page.section,
      k: page.kind,
      x: excerpt(lead?.text ?? page.description),
      w: uniqueTerms(`${page.description} ${lead?.text ?? ""}`),
    })
    for (const section of page.sections) {
      if (section.id === null) continue
      entries.push({
        u: `${page.path}#${section.id}`,
        t: section.heading,
        p: page.title,
        s: page.section,
        k: "heading",
        x: excerpt(section.text),
        w: uniqueTerms(section.text),
      })
    }
  }

  // Typed links: one key per page, plus anchors named in frontmatter.
  const topics = new Map<string, string>()
  for (const page of built) {
    topics.set(topicOfPath(page.path), page.path)
    for (const topic of page.topics) {
      const [key = "", anchor] = topic.split("#")
      if (anchor !== undefined && !page.ids.includes(anchor)) {
        problems.push(`${page.path}: topic ${topic} names a missing anchor`)
      }
      if (topics.has(key) && topics.get(key) !== page.path) {
        problems.push(`${page.path}: topic ${key} already names another page`)
      }
      topics.set(
        key,
        anchor === undefined ? page.path : `${page.path}#${anchor}`,
      )
    }
  }

  const topicsIndex: TopicsIndexEntry[] = built
    .filter((page) => page.kind !== "heading")
    .map((page) => ({
      topic: topicOfPath(page.path),
      title: page.title,
      url: `${siteOrigin}${page.path}`,
      section: page.section,
      description: page.description,
      headings: page.data.toc
        .filter((item) => item.depth === 2)
        .map((item) => ({
          title: item.text,
          url: `${siteOrigin}${page.path}#${item.id}`,
        })),
    }))
    .sort((a, b) => a.url.localeCompare(b.url))

  const markdownTwins = new Map<string, string>()
  for (const page of built) markdownTwins.set(page.path, page.markdown)

  const llms = [
    "# Matchbox Docs",
    "",
    "> Documentation for Matchbox Pro, Matchscan, Matchbox ID, Matchbox Developer and Stuart, with the Mezo concepts they share. Every page has a Markdown copy at its path plus .md.",
    "",
    ...sections
      .filter((section) => section.id !== "home")
      .flatMap((section) => {
        const own = built
          .filter((page) => page.section === section.id)
          .sort((a, b) => a.path.localeCompare(b.path))
        if (own.length === 0) return []
        return [
          `## ${section.name}`,
          "",
          ...own.map(
            (page) =>
              `- [${page.title}](${siteOrigin}${page.path === "/" ? "/index" : page.path}.md): ${page.description}`,
          ),
          "",
        ]
      }),
    "## Machine-readable",
    "",
    `- [OpenAPI document](${siteOrigin}/developer/openapi.json): the Matchbox API, version ${input.apiVersion}`,
    `- [Sitemap](${siteOrigin}/sitemap.xml)`,
    "",
  ].join("\n")

  const sitemap = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...built
      .map((page) => page.path)
      .sort()
      .map((path) => {
        const page = byPath.get(path)
        const lastmod =
          page?.updated === "" || page === undefined
            ? ""
            : `<lastmod>${page.updated}</lastmod>`
        return `  <url><loc>${siteOrigin}${path}</loc>${lastmod}</url>`
      }),
    "</urlset>",
    "",
  ].join("\n")

  return {
    pages,
    manifest: {
      pages: manifestPages,
      trees: manifestTrees,
      counts,
      apiVersion: input.apiVersion,
    },
    search: { version: 1, entries },
    topics,
    topicsIndex,
    knowledge: built
      .filter((page) => page.stuart.length > 0)
      .map((page) => ({ page: page.path, entries: page.stuart })),
    markdownTwins,
    llms,
    sitemap,
    stubs,
    samples,
    problems,
  }
}

export type { DocNode }
