import GithubSlugger from "github-slugger"
import type {
  Code,
  Heading,
  ListItem,
  PhrasingContent,
  Root,
  RootContent,
  Table,
} from "mdast"
import { toString as mdastToString } from "mdast-util-to-string"
import remarkDirective from "remark-directive"
import remarkGfm from "remark-gfm"
import remarkParse from "remark-parse"
import { unified } from "unified"
import type {
  CalloutTone,
  DocCode,
  DocFact,
  DocLinkRow,
  DocNode,
  DocStep,
  HtmlTag,
  TocItem,
} from "../render-types"
import { codeLanguage, highlight } from "./highlight"

/**
 * Markdown to the page tree (render-types). Prose uses plain Markdown with
 * GFM tables and a small directive vocabulary:
 *
 *   :::note[Votes carry over]   :::warning   :::danger   callouts
 *   ::::steps / :::step[Title]{tag="Server"}            numbered steps
 *   :::code-group                                       tabbed code
 *   :::links                                            link rows
 *   :::facts                                            facts card
 *   ::epoch-clock                                       live epoch clock
 *   ::figure{drawing="vote" caption="…" label="…"}      schematic figure
 *   ::<name>  (data tables from @matchbox/contracts)    see `tables`
 *   :term[epoch]{to="/concepts/epochs"}                 definition popover
 *
 * Headings take an explicit id with a trailing `{#id}`, so a copy edit
 * never moves an anchor other pages link to.
 */

type DirectiveAttributes = Record<string, string | null | undefined>

type ContainerDirective = {
  type: "containerDirective"
  name: string
  attributes?: DirectiveAttributes | null
  children: RootContent[]
  position?: Root["position"]
}

type LeafDirective = {
  type: "leafDirective"
  name: string
  attributes?: DirectiveAttributes | null
  children: PhrasingContent[]
  position?: Root["position"]
}

type TextDirective = {
  type: "textDirective"
  name: string
  attributes?: DirectiveAttributes | null
  children: PhrasingContent[]
  position?: Root["position"]
}

export type TermTarget = {
  title: string
  definition: string
  href: string
}

export type MarkdownContext = {
  /** The page being built, for error messages. */
  file: string
  /** A `:term` target: the page's title and definition. */
  term: (to: string) => TermTarget
  /** Leaf directives that render data from code (`::errors-table`). */
  tables: Readonly<Record<string, () => DocNode[]>>
}

export type SearchSection = {
  /** Heading id, or null for the text before the first heading. */
  id: string | null
  heading: string
  text: string
}

export type RenderedMarkdown = {
  body: DocNode[]
  toc: TocItem[]
  /** Every heading id, for the anchor checker. */
  ids: string[]
  /** Every href in the page, for the link checker. */
  links: string[]
  /** TypeScript samples to compile against the SDK. */
  samples: string[]
  sections: SearchSection[]
  words: number
}

export function parseMarkdown(source: string): Root {
  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkDirective)
  return processor.runSync(processor.parse(source)) as Root
}

class MarkdownError extends Error {
  constructor(
    file: string,
    node: { position?: Root["position"] },
    text: string,
  ) {
    const line = node.position?.start.line
    super(`${file}${line === undefined ? "" : `:${line}`}: ${text}`)
  }
}

/**
 * Hidden setup for TypeScript fragments that continue an earlier step on
 * the same page (fence meta `prelude="oidc-callback"`), so every fragment
 * still compiles against the SDK.
 */
export const samplePreludes: Readonly<Record<string, readonly string[]>> = {
  "oidc-callback": [
    'const clientId: string = "mbx_live_…"',
    'const redirectUri: string = "https://app.example.com/auth/callback"',
    'const code: string = "…"',
    'const nonce: string = "…"',
    'const pkce = { codeVerifier: "…" }',
  ],
  "oidc-session": [
    'const clientId: string = "mbx_live_…"',
    'const tokens = { accessToken: "…", refreshToken: "…" as string | undefined }',
  ],
}

const headingIdPattern = /\s*\{#([a-z0-9-]+)\}\s*$/

/** A heading's text and explicit id, with the `{#id}` removed. */
export function headingParts(heading: Heading): {
  text: string
  explicitId: string | null
} {
  const text = mdastToString(heading)
  const match = headingIdPattern.exec(text)
  if (match === null) return { text: text.trim(), explicitId: null }
  return {
    text: text.slice(0, match.index).trim(),
    explicitId: match[1] ?? null,
  }
}

function attribute(
  attributes: DirectiveAttributes | null | undefined,
  name: string,
): string | undefined {
  const value = attributes?.[name]
  return value === null || value === undefined ? undefined : value
}

/** The `[label]` of a container directive, and its other children. */
function splitLabel(directive: ContainerDirective): {
  label: string | undefined
  children: RootContent[]
} {
  const [first, ...rest] = directive.children
  if (
    first?.type === "paragraph" &&
    (first.data as { directiveLabel?: boolean } | undefined)?.directiveLabel ===
      true
  ) {
    return { label: mdastToString(first), children: rest }
  }
  return { label: undefined, children: directive.children }
}

class Converter {
  readonly links: string[] = []
  /** TypeScript fences to compile, unless marked `nocheck`. */
  readonly samples: string[] = []
  readonly ids: string[] = []
  readonly toc: TocItem[] = []
  readonly sections: SearchSection[] = [{ id: null, heading: "", text: "" }]
  words = 0
  private readonly slugger = new GithubSlugger()

  constructor(private readonly context: MarkdownContext) {}

  private fail(node: { position?: Root["position"] }, text: string): never {
    throw new MarkdownError(this.context.file, node, text)
  }

  private addText(text: string): void {
    const section = this.sections.at(-1)
    if (section === undefined) return
    section.text = section.text === "" ? text : `${section.text} ${text}`
    this.words += text.split(/\s+/).filter(Boolean).length
  }

  private addId(id: string, node: { position?: Root["position"] }): void {
    if (this.ids.includes(id)) this.fail(node, `Duplicate anchor #${id}`)
    this.ids.push(id)
  }

  async blocks(nodes: readonly RootContent[]): Promise<DocNode[]> {
    const out: DocNode[] = []
    for (const node of nodes) {
      const converted = await this.block(node)
      if (converted !== null) out.push(...converted)
    }
    return out
  }

  private async block(node: RootContent): Promise<DocNode[] | null> {
    switch (node.type) {
      case "paragraph": {
        this.addText(mdastToString(node))
        return [{ t: "p", c: this.inline(node.children) }]
      }
      case "heading":
        return [this.heading(node)]
      case "list": {
        const items: DocNode[] = []
        for (const item of node.children) items.push(await this.listItem(item))
        const tag: HtmlTag = node.ordered === true ? "ol" : "ul"
        return [
          node.ordered === true && node.start !== null && node.start !== 1
            ? { t: tag, p: { start: node.start ?? 1 }, c: items }
            : { t: tag, c: items },
        ]
      }
      case "code":
        return [await this.code(node)]
      case "table":
        return [this.table(node)]
      case "blockquote":
        return [{ t: "blockquote", c: await this.blocks(node.children) }]
      case "thematicBreak":
        return [{ t: "hr" }]
      case "containerDirective":
        return [await this.container(node as unknown as ContainerDirective)]
      case "leafDirective":
        return this.leaf(node as unknown as LeafDirective)
      default:
        return this.fail(node, `Unsupported Markdown: ${node.type}`)
    }
  }

  private heading(node: Heading): DocNode {
    if (node.depth < 2 || node.depth > 4) {
      this.fail(node, "Use ## to #### inside a page; the title is the h1")
    }
    const { text, explicitId } = headingParts(node)
    const id = explicitId ?? this.slugger.slug(text)
    if (explicitId !== null) this.slugger.slug(explicitId)
    this.addId(id, node)
    const children = this.inline(node.children)
    const last = children.at(-1)
    if (typeof last === "string") {
      children[children.length - 1] = last.replace(headingIdPattern, "")
    }
    if (node.depth === 2 || node.depth === 3) {
      this.toc.push({ id, text, depth: node.depth })
    }
    this.sections.push({ id, heading: text, text: "" })
    const tag: HtmlTag =
      node.depth === 2 ? "h2" : node.depth === 3 ? "h3" : "h4"
    return { t: tag, p: { id }, c: children }
  }

  private async listItem(item: ListItem): Promise<DocNode> {
    const [first, ...rest] = item.children
    // Tight list items hold one paragraph: render its text directly.
    if (first?.type === "paragraph" && rest.length === 0) {
      this.addText(mdastToString(first))
      return { t: "li", c: this.inline(first.children) }
    }
    return { t: "li", c: await this.blocks(item.children) }
  }

  async code(node: Code): Promise<DocCode> {
    const lang = codeLanguage(node.lang)
    const title = /title="([^"]+)"/.exec(node.meta ?? "")?.[1]
    if (
      (lang === "ts" || lang === "tsx") &&
      !/\bnocheck\b/.test(node.meta ?? "")
    ) {
      const prelude = /prelude="([a-z-]+)"/.exec(node.meta ?? "")?.[1]
      const lines = samplePreludes[prelude ?? ""]
      if (prelude !== undefined && lines === undefined) {
        this.fail(node, `Unknown sample prelude ${prelude}`)
      }
      // The prelude goes after the sample's imports: typed stand-ins for
      // what an earlier step on the page defined. Never shown.
      const lead =
        /^(import[\s\S]*?from\s+"[^"]+"\n)+/.exec(node.value)?.[0] ?? ""
      this.samples.push(
        lines === undefined
          ? node.value
          : `${lead}${lines.join("\n")}\n${node.value.slice(lead.length)}`,
      )
    }
    return {
      t: "pre",
      p: {
        lang,
        source: node.value,
        ...(title === undefined ? {} : { title }),
      },
      lines: await highlight(node.value, lang),
    }
  }

  private table(node: Table): DocNode {
    const [head, ...rows] = node.children
    if (head === undefined) this.fail(node, "Empty table")
    const align = node.align ?? []
    const cell = (
      tag: "th" | "td",
      children: PhrasingContent[],
      index: number,
    ) => {
      const a = align[index]
      this.addText(mdastToString({ type: "paragraph", children }))
      return a === "right" || a === "center"
        ? { t: tag, p: { align: a }, c: this.inline(children) }
        : { t: tag, c: this.inline(children) }
    }
    return {
      t: "table",
      c: [
        {
          t: "thead",
          c: [
            {
              t: "tr",
              c: head.children.map((c, i) => cell("th", c.children, i)),
            },
          ],
        },
        {
          t: "tbody",
          c: rows.map((row) => ({
            t: "tr",
            c: row.children.map((c, i) => cell("td", c.children, i)),
          })),
        },
      ],
    } satisfies DocNode
  }

  private async container(node: ContainerDirective): Promise<DocNode> {
    const { label, children } = splitLabel(node)
    switch (node.name) {
      case "note":
      case "warning":
      case "danger": {
        const tone: CalloutTone = node.name
        if (label !== undefined) this.addText(label)
        return {
          t: "callout",
          p: label === undefined ? { tone } : { tone, title: label },
          c: await this.blocks(children),
        }
      }
      case "steps": {
        const steps: DocStep[] = []
        for (const child of children) {
          if (
            child.type !== "containerDirective" ||
            (child as unknown as ContainerDirective).name !== "step"
          ) {
            this.fail(child, "steps may only contain :::step blocks")
          }
          const step = child as unknown as ContainerDirective
          const parts = splitLabel(step)
          if (parts.label === undefined)
            this.fail(step, "A step needs a [title]")
          this.addText(parts.label)
          const tag = attribute(step.attributes, "tag")
          steps.push({
            t: "step",
            p:
              tag === undefined
                ? { title: parts.label }
                : { title: parts.label, tag },
            c: await this.blocks(parts.children),
          })
        }
        return { t: "steps", c: steps }
      }
      case "code-group": {
        const codes: DocCode[] = []
        for (const child of children) {
          if (child.type !== "code")
            this.fail(child, "code-group holds code only")
          const code = await this.code(child)
          if (code.p.title === undefined) {
            this.fail(child, 'Each code in a code-group needs title="…"')
          }
          codes.push(code)
        }
        return { t: "code-group", c: codes }
      }
      case "links": {
        const [list, ...extra] = children
        if (list?.type !== "list" || extra.length > 0) {
          this.fail(node, ":::links holds one list of links")
        }
        const rows: DocLinkRow[] = list.children.map((item) => {
          const paragraph = item.children[0]
          const link =
            paragraph?.type === "paragraph" ? paragraph.children[0] : undefined
          if (link?.type !== "link" || paragraph?.type !== "paragraph") {
            return this.fail(item, "Each :::links item starts with a link")
          }
          this.links.push(link.url)
          const title = mdastToString(link)
          const subline = mdastToString({
            type: "paragraph",
            children: paragraph.children.slice(1),
          }).trim()
          this.addText(`${title} ${subline}`)
          return {
            t: "link-row",
            p:
              subline === ""
                ? { href: link.url, title }
                : { href: link.url, title, subline },
          }
        })
        return { t: "link-rows", c: rows }
      }
      case "facts": {
        const [list] = children
        if (list?.type !== "list") this.fail(node, ":::facts holds one list")
        const facts: DocFact[] = list.children.map((item) => {
          const paragraph = item.children[0]
          const strong =
            paragraph?.type === "paragraph" ? paragraph.children[0] : undefined
          if (strong?.type !== "strong" || paragraph?.type !== "paragraph") {
            return this.fail(item, "Each fact starts with a **Label**")
          }
          const rest = paragraph.children.slice(1)
          const first = rest[0]
          if (first?.type === "text") {
            rest[0] = { ...first, value: first.value.replace(/^\s+/, "") }
          }
          const mono = rest.length === 1 && rest[0]?.type === "inlineCode"
          this.addText(mdastToString(paragraph))
          return {
            t: "fact",
            p: mono
              ? { label: mdastToString(strong), mono: true }
              : { label: mdastToString(strong) },
            c:
              mono && rest[0]?.type === "inlineCode"
                ? [rest[0].value]
                : this.inline(rest),
          }
        })
        return { t: "facts", c: facts }
      }
      default:
        return this.fail(node, `Unknown block :::${node.name}`)
    }
  }

  private leaf(node: LeafDirective): DocNode[] {
    if (node.name === "epoch-clock") return [{ t: "epoch-clock" }]
    if (node.name === "figure") {
      const drawing = attribute(node.attributes, "drawing")
      const caption = attribute(node.attributes, "caption")
      const label = attribute(node.attributes, "label")
      if (
        drawing === undefined ||
        caption === undefined ||
        label === undefined
      ) {
        this.fail(node, "figure needs drawing, caption and label")
      }
      this.addText(caption)
      return [{ t: "figure", p: { drawing, caption, label } }]
    }
    const table = this.context.tables[node.name]
    if (table === undefined) this.fail(node, `Unknown directive ::${node.name}`)
    const nodes = table()
    for (const added of nodes) this.collect(added)
    return nodes
  }

  /** Records ids, links and search text from generated nodes. */
  private collect(node: DocNode): void {
    if (typeof node === "string") {
      this.addText(node)
      return
    }
    if ("p" in node && node.p !== undefined) {
      const props = node.p as Record<string, unknown>
      if (typeof props.id === "string") this.ids.push(props.id)
      if (typeof props.href === "string") this.links.push(props.href)
    }
    if ("c" in node && node.c !== undefined) {
      for (const child of node.c) this.collect(child)
    }
  }

  inline(nodes: readonly PhrasingContent[]): DocNode[] {
    return mergeText(this.inlineParts(nodes))
  }

  private inlineParts(nodes: readonly PhrasingContent[]): DocNode[] {
    const out: DocNode[] = []
    for (const node of nodes) {
      switch (node.type) {
        case "text":
          out.push(node.value)
          break
        case "strong":
          out.push({ t: "strong", c: this.inline(node.children) })
          break
        case "emphasis":
          out.push({ t: "em", c: this.inline(node.children) })
          break
        case "delete":
          out.push({ t: "del", c: this.inline(node.children) })
          break
        case "inlineCode":
          out.push({ t: "code", c: [node.value] })
          break
        case "break":
          out.push({ t: "br" })
          break
        case "link":
          this.links.push(node.url)
          out.push({
            t: "a",
            p: { href: node.url },
            c: this.inline(node.children),
          })
          break
        case "textDirective": {
          const directive = node as unknown as TextDirective
          if (directive.name === "kbd") {
            out.push({ t: "kbd", c: [mdastToString(directive)] })
            break
          }
          const bare =
            directive.children.length === 0 &&
            Object.keys(directive.attributes ?? {}).length === 0
          if (bare && directive.name !== "term") {
            // "00:00" parses as a directive named "00": it is text.
            out.push(`:${directive.name}`)
            break
          }
          if (directive.name !== "term") {
            this.fail(directive, `Unknown inline directive :${directive.name}`)
          }
          const to = attribute(directive.attributes, "to")
          if (to === undefined) this.fail(directive, ':term needs to="/path"')
          const target = this.context.term(to)
          this.links.push(target.href)
          out.push({
            t: "term",
            p: {
              title: target.title,
              definition: target.definition,
              href: target.href,
              label: target.title,
            },
            c: this.inline(directive.children),
          })
          break
        }
        default:
          this.fail(node, `Unsupported inline Markdown: ${node.type}`)
      }
    }
    return out
  }
}

/** Joins neighbouring strings ("00" and ":00" split by the directive parser). */
function mergeText(nodes: DocNode[]): DocNode[] {
  const out: DocNode[] = []
  for (const node of nodes) {
    const last = out.at(-1)
    if (typeof node === "string" && typeof last === "string") {
      out[out.length - 1] = last + node
    } else {
      out.push(node)
    }
  }
  return out
}

export async function renderMarkdown(
  root: Root,
  context: MarkdownContext,
): Promise<RenderedMarkdown> {
  const converter = new Converter(context)
  const body = await converter.blocks(root.children)
  return {
    body,
    toc: converter.toc,
    ids: converter.ids,
    links: converter.links,
    samples: converter.samples,
    sections: converter.sections.filter(
      (section) => section.id !== null || section.text !== "",
    ),
    words: converter.words,
  }
}

/** Plain paragraphs of generated prose (descriptions from OpenAPI). */
export function paragraphs(text: string): DocNode[] {
  return text
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => ({ t: "p", c: inlineText(part) }) satisfies DocNode)
}

/** Text with `code` spans, for generated descriptions. */
export function inlineText(text: string): DocNode[] {
  const out: DocNode[] = []
  const pattern = /`([^`]+)`/g
  let last = 0
  for (const match of text.matchAll(pattern)) {
    if (match.index > last) out.push(text.slice(last, match.index))
    out.push({ t: "code", c: [match[1] ?? ""] })
    last = match.index + match[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}
