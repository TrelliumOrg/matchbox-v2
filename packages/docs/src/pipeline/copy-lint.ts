import type { Heading, Node, Parent, PhrasingContent, Root } from "mdast"
import { toString as mdastToString } from "mdast-util-to-string"
import { headingParts } from "./markdown"

/**
 * The docs voice (Doop guideline `matchbox-docs`): page bodies may use short
 * plain sentences, at most two per paragraph and about 25 words each, and
 * every other v3 ban holds. Code, inline code and URLs are exempt. Each
 * message says what to change.
 */

export type CopyProblem = { line: number | null; message: string }

const characterRules: readonly { pattern: RegExp; message: string }[] = [
  {
    pattern: /—/,
    message: "Replace the em dash with a comma, 'to' or a new sentence",
  },
  { pattern: /–/, message: "Replace the en dash with 'to'" },
  { pattern: /·/, message: "Replace the middle dot with a comma" },
  {
    pattern: /;/,
    message: "Replace the semicolon with a full stop or a comma",
  },
  { pattern: /!/, message: "Remove the exclamation mark" },
]

const wordRules: readonly { pattern: RegExp; message: string }[] = [
  { pattern: /\bbribes?\b/i, message: "Write 'incentives', never 'bribes'" },
  { pattern: /\boops\b/i, message: "Say what happened instead of 'Oops'" },
]

/** At most this many words in one sentence (the guideline says about 25). */
export const maxSentenceWords = 30
export const maxSentences = 2

/**
 * Words that keep their capital inside a heading: names, products, tokens
 * and acronyms. Everything else after the first word is lower case.
 */
const properNouns = new Set([
  "API",
  "Activity",
  "Protocol",
  "BTC",
  "Blue",
  "Borrow",
  "BoostVoter",
  "Classic",
  "Connect",
  "Ctrl",
  "Curve",
  "Developer",
  "Discord",
  "Enclave",
  "Enclaves",
  "Epoch",
  "GitHub",
  "HTTP",
  "ID",
  "JSON",
  "MCP",
  "MEZO",
  "MUSD",
  "Matchbox",
  "Matchscan",
  "Mezo",
  "Morpho",
  "OIDC",
  "OpenAPI",
  "OpenID",
  "PKCE",
  "Pro",
  "Safe",
  "SDK",
  "Savings",
  "Stuart",
  "ThirdPartyVoter",
  "TypeScript",
  "UTC",
  "Uniswap",
  "Aerodrome",
  "WalletConnect",
])

function line(node: Node): number | null {
  return node.position?.start.line ?? null
}

/** Text a reader sees in prose: no code, no URLs. */
function proseText(node: Node): string {
  if (node.type === "inlineCode" || node.type === "code") return " "
  if (node.type === "text") return (node as unknown as { value: string }).value
  if ("children" in node) {
    return (node as Parent).children.map((child) => proseText(child)).join("")
  }
  return ""
}

export function sentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .trim()
    .split(/(?<=[.?])\s+(?=[A-Z0-9"'`(])/)
    .map((sentence) => sentence.trim())
    .filter(Boolean)
}

/** Character and word bans on any text a reader sees. */
export function lintText(text: string): string[] {
  const problems: string[] = []
  for (const rule of characterRules) {
    if (rule.pattern.test(text)) problems.push(rule.message)
  }
  for (const rule of wordRules) {
    if (rule.pattern.test(text)) problems.push(rule.message)
  }
  return problems
}

/** Two sentences per paragraph, each about 25 words at most. */
export function lintParagraph(text: string): string[] {
  const problems: string[] = []
  const parts = sentences(text)
  if (parts.length > maxSentences) {
    problems.push(
      `Split this paragraph: ${parts.length} sentences, at most ${maxSentences}`,
    )
  }
  for (const sentence of parts) {
    const words = sentence.split(" ").filter((word) => /\w/.test(word)).length
    if (words > maxSentenceWords) {
      problems.push(
        `Shorten this sentence: ${words} words, about 25 at most ("${sentence.slice(0, 40)}…")`,
      )
    }
  }
  return problems
}

export function lintHeading(text: string): string[] {
  const problems = lintText(text)
  if (/^\d+[.)]?\s/.test(text)) {
    problems.push("Remove the number from the heading")
  }
  const letters = text.replace(/[^A-Za-z]/g, "")
  const words = text.split(/\s+/)
  if (
    letters.length > 1 &&
    letters === letters.toUpperCase() &&
    words.length > 1
  ) {
    problems.push("Write the heading in sentence case, not upper case")
  }
  if (/^[a-z]/.test(text) && !/^(ve|m)[A-Z]/.test(text)) {
    problems.push("Start the heading with a capital")
  }
  for (const word of words.slice(1)) {
    const bare = word.replace(/[^A-Za-z]/g, "")
    if (
      /^[A-Z][a-z]+$/.test(bare) &&
      !properNouns.has(bare) &&
      !/[`/]/.test(word)
    ) {
      problems.push(`Write the heading in sentence case: lower-case "${bare}"`)
      break
    }
  }
  return problems
}

/** Paragraph-like blocks whose text is prose. */
const paragraphParents = new Set(["paragraph", "tableCell"])

export function lintMarkdown(root: Root): CopyProblem[] {
  const problems: CopyProblem[] = []
  function report(node: Node, messages: readonly string[]): void {
    for (const message of messages) problems.push({ line: line(node), message })
  }
  function visit(node: Node): void {
    if (node.type === "code" || node.type === "inlineCode") return
    if (node.type === "heading") {
      report(node, lintHeading(headingParts(node as Heading).text))
      return
    }
    if (paragraphParents.has(node.type)) {
      const text = proseText(node)
      report(node, lintText(text))
      // Table cells are labels and short values: no sentence rule.
      if (node.type === "paragraph") report(node, lintParagraph(text))
      return
    }
    if (
      node.type === "containerDirective" ||
      node.type === "leafDirective" ||
      node.type === "textDirective"
    ) {
      const attributes =
        (node as { attributes?: Record<string, string | null> }).attributes ??
        {}
      for (const [name, value] of Object.entries(attributes)) {
        if (name === "caption" || name === "label" || name === "tag") {
          report(node, lintText(value ?? ""))
        }
      }
    }
    if ("children" in node) {
      for (const child of (node as Parent).children) visit(child)
    }
  }
  visit(root)
  return problems
}

/** Frontmatter strings a reader sees: title, nav label, description. */
export function lintMeta(meta: {
  title: string
  description: string
  nav?: string | undefined
  definition?: string | undefined
}): string[] {
  return [
    ...lintHeading(meta.title).map((message) => `title: ${message}`),
    ...lintText(meta.description).map((message) => `description: ${message}`),
    ...lintParagraph(meta.description).map(
      (message) => `description: ${message}`,
    ),
    ...(meta.nav === undefined
      ? []
      : lintHeading(meta.nav).map((message) => `nav: ${message}`)),
    ...(meta.definition === undefined
      ? []
      : [...lintText(meta.definition), ...lintParagraph(meta.definition)].map(
          (message) => `definition: ${message}`,
        )),
  ]
}

export function plainText(nodes: readonly PhrasingContent[]): string {
  return mdastToString({ type: "paragraph", children: [...nodes] })
}
