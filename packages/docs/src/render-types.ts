/**
 * The shape of a built docs page: what the pipeline (scripts/build.ts)
 * writes as one JSON chunk per page and what apps/docs renders. Prose is a
 * small tree of plain HTML tags plus a fixed vocabulary of docs components,
 * so a page ships as data, not code, and the renderer stays the only place
 * that knows how a callout or a code block looks.
 */

/** One highlighted run in a code line, with its token class. */
export type CodeTokenKind = "" | "k" | "s" | "c" | "n" | "f"

export type CodeToken = readonly [text: string, kind: CodeTokenKind]

export type CodeLine = readonly CodeToken[]

/** Plain HTML a page may contain. Anything else fails the build. */
export type HtmlTag =
  | "p"
  | "h2"
  | "h3"
  | "h4"
  | "ul"
  | "ol"
  | "li"
  | "a"
  | "strong"
  | "em"
  | "code"
  | "del"
  | "br"
  | "hr"
  | "table"
  | "thead"
  | "tbody"
  | "tr"
  | "th"
  | "td"
  | "blockquote"
  | "kbd"

export type DocText = string

export type DocHtml = {
  t: HtmlTag
  /** Attributes: href, id, align, start. */
  p?: Readonly<Record<string, string | number>>
  c?: readonly DocNode[]
}

export type CalloutTone = "note" | "warning" | "danger"

export type DocCallout = {
  t: "callout"
  p: { tone: CalloutTone; title?: string }
  c: readonly DocNode[]
}

export type DocSteps = { t: "steps"; c: readonly DocStep[] }

export type DocStep = {
  t: "step"
  p: { title: string; tag?: string }
  c: readonly DocNode[]
}

export type DocCode = {
  t: "pre"
  p: {
    lang: string
    /** File name or tab label. */
    title?: string
    /** The source, for the Copy button. */
    source: string
  }
  lines: readonly CodeLine[]
}

/** Tabbed code: TypeScript and curl, or TypeScript and HTTP. */
export type DocCodeGroup = { t: "code-group"; c: readonly DocCode[] }

/** A term with its definition, shown in a popover. */
export type DocTerm = {
  t: "term"
  p: { title: string; definition: string; href: string; label: string }
  c: readonly DocNode[]
}

/** A labelled picture with numbered markers placed in percent. */
export type DocFigure = {
  t: "figure"
  p: {
    /** One of the schematic drawings the renderer knows. */
    drawing: string
    caption: string
    label: string
  }
}

/** Link rows: icon, title, subline, chevron. */
export type DocLinkRows = {
  t: "link-rows"
  c: readonly DocLinkRow[]
}

export type DocLinkRow = {
  t: "link-row"
  p: { href: string; title: string; subline?: string; icon?: string }
}

/** The live epoch clock, computed in the browser. */
export type DocEpochClock = { t: "epoch-clock" }

/** Key facts in a soft card: label over value, two columns. */
export type DocFacts = {
  t: "facts"
  c: readonly DocFact[]
}

export type DocFact = {
  t: "fact"
  p: { label: string; mono?: boolean }
  c: readonly DocNode[]
}

export type DocElement =
  | DocHtml
  | DocCallout
  | DocSteps
  | DocStep
  | DocCode
  | DocCodeGroup
  | DocTerm
  | DocFigure
  | DocLinkRows
  | DocLinkRow
  | DocEpochClock
  | DocFacts
  | DocFact

export type DocNode = DocText | DocElement

export type TocItem = { id: string; text: string; depth: 2 | 3 }

/** A row of a schema tree: one property and its children. */
export type SchemaField = {
  name: string
  type: string
  required: boolean
  description: string
  /** Allowed values, rendered as code chips. */
  values: readonly string[]
  children: readonly SchemaField[]
}

export type OperationParameter = {
  name: string
  in: "path" | "query" | "header"
  type: string
  required: boolean
  description: string
  values: readonly string[]
}

export type OperationStatus = {
  code: string
  description: string
  /** Error codes this status can carry, linked to /developer/errors#code. */
  errors: readonly string[]
}

export type OperationDoc = {
  id: string
  tag: string
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"
  path: string
  summary: string
  description: readonly DocNode[]
  /** "API key", "None" or the scheme's label. */
  auth: string
  since: string | null
  parameters: readonly OperationParameter[]
  headers: readonly OperationParameter[]
  response: {
    status: string
    contentType: string
    fields: readonly SchemaField[]
  } | null
  statuses: readonly OperationStatus[]
  samples: readonly DocCode[]
  /** Example bodies per status, when the document has one. */
  examples: readonly DocCode[]
}

export type ToolDoc = {
  name: string
  group: string
  title: string
  description: readonly DocNode[]
  readOnly: boolean
  input: readonly SchemaField[]
  call: DocCode
}

export type ReferenceIndexDoc = {
  version: string
  /** Classic console anchors (`get-v1-gauges`) to operation pages. */
  legacyAnchors: Readonly<Record<string, string>>
  baseUrl: string
  networks: readonly string[]
  tags: readonly {
    name: string
    operations: readonly {
      method: string
      path: string
      summary: string
      href: string
    }[]
  }[]
}

export type PageBody =
  | { kind: "prose"; body: readonly DocNode[] }
  | { kind: "operation"; operation: OperationDoc }
  | { kind: "tool"; tool: ToolDoc; body: readonly DocNode[] }
  | {
      kind: "reference"
      reference: ReferenceIndexDoc
      body: readonly DocNode[]
    }

export type PageData = PageBody & {
  path: string
  title: string
  /** For the page's meta description: kept out of the manifest. */
  description: string
  toc: readonly TocItem[]
}
