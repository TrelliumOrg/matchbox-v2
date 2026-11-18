import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { parse as parseYaml } from "yaml"
import { z } from "zod"
import { pathOfFile } from "../site"

/**
 * Content files: Markdown with YAML frontmatter, one page per file under
 * packages/docs/content, at the URL its path gives (`pro/vote.md` is
 * `/pro/vote`, `pro/index.md` is `/pro`).
 */

/** A topic key products link by: lower case words joined by dots. */
export const topicKeySchema = z
  .string()
  .regex(/^[a-z][a-z0-9-]*(\.[a-z0-9-]+)*$/, "topic keys are dotted lower case")

/**
 * `pro.vote` names the page; `pro.vote.optimize#optimize` names an anchor
 * on it. Anchors must be explicit heading ids so copy edits never move them.
 */
export const topicSchema = z
  .string()
  .regex(
    /^[a-z][a-z0-9-]*(\.[a-z0-9-]+)*(#[a-z0-9-]+)?$/,
    "topics are key or key#anchor",
  )

const shortLabel = z.string().min(1).max(60)

/**
 * A reviewed note for Stuart, in the shape apps/stuart's knowledge tool
 * reads (`KnowledgeEntry` in apps/stuart/src/query/knowledge/mezo.ts).
 */
export const stuartEntrySchema = z.object({
  id: z.string().regex(/^[a-z]+(\.[a-z_]+)+$/),
  title: shortLabel,
  answer: z.string().min(1),
  detail: z.array(z.string().min(1)).default([]),
  facts: z
    .array(z.object({ label: shortLabel, display: shortLabel }))
    .default([]),
  keywords: z.array(z.string().regex(/^[a-z0-9 :%.'-]+$/)).min(1),
  sources: z.array(z.object({ label: shortLabel, url: z.url() })).default([]),
})

export type StuartEntry = z.infer<typeof stuartEntrySchema>

export const frontmatterSchema = z.object({
  title: z.string().min(1),
  /** Page tree label when the title is long. */
  nav: z.string().min(1).optional(),
  description: z.string().min(1),
  /** Stubs are planned pages: built nowhere, listed in the report. */
  status: z.enum(["published", "stub"]).default("published"),
  topics: z.array(topicSchema).default([]),
  /** One or two sentences for `:term` popovers that point here. */
  definition: z.string().min(1).optional(),
  updated: z.iso.date(),
  stuart: z.array(stuartEntrySchema).default([]),
})

export type Frontmatter = z.infer<typeof frontmatterSchema>

export type ContentFile = {
  /** Relative to content/, with forward slashes. */
  file: string
  path: string
  meta: Frontmatter
  markdown: string
  /** Lines before the Markdown body, so messages point at the file's line. */
  bodyLine: number
}

const fence = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/

export function parseContentFile(file: string, source: string): ContentFile {
  const match = fence.exec(source)
  if (match === null) throw new Error(`${file}: missing frontmatter`)
  const raw: unknown = parseYaml(match[1] ?? "")
  const parsed = frontmatterSchema.safeParse(raw)
  if (!parsed.success) {
    throw new Error(`${file}: ${z.prettifyError(parsed.error)}`)
  }
  return {
    file,
    path: pathOfFile(file),
    meta: parsed.data,
    markdown: source.slice(match[0].length),
    bodyLine: match[0].split("\n").length - 1,
  }
}

function walk(directory: string): string[] {
  const files: string[] = []
  for (const name of readdirSync(directory).sort()) {
    const full = join(directory, name)
    if (statSync(full).isDirectory()) files.push(...walk(full))
    else if (name.endsWith(".md")) files.push(full)
  }
  return files
}

export function loadContent(contentDirectory: string): ContentFile[] {
  return walk(contentDirectory).map((full) => {
    const file = relative(contentDirectory, full).replaceAll("\\", "/")
    return parseContentFile(file, readFileSync(full, "utf8"))
  })
}
