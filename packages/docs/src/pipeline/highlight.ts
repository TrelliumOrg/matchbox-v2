import {
  createCssVariablesTheme,
  createHighlighter,
  type Highlighter,
} from "shiki"
import type { CodeLine, CodeToken, CodeTokenKind } from "../render-types"

/**
 * Build-time highlighting. Shiki tokenizes with its CSS variables theme and
 * each token's variable becomes one of five classes the renderer maps to
 * theme tokens (keywords ink, strings and numbers accInk, comments sec), so
 * code follows all eight presets and no highlighter ships to the browser.
 */

const theme = createCssVariablesTheme({
  name: "matchbox-docs",
  variablePrefix: "--shiki-",
})

const languages = [
  "ts",
  "tsx",
  "js",
  "json",
  "jsonc",
  "bash",
  "http",
  "html",
] as const

export type CodeLanguage = (typeof languages)[number] | "text"

let highlighter: Promise<Highlighter> | null = null

function getHighlighter(): Promise<Highlighter> {
  highlighter ??= createHighlighter({
    themes: [theme],
    langs: [...languages],
  })
  return highlighter
}

const aliases: Record<string, CodeLanguage> = {
  typescript: "ts",
  javascript: "js",
  sh: "bash",
  shell: "bash",
  console: "bash",
  curl: "bash",
  txt: "text",
  plaintext: "text",
  "": "text",
}

export function codeLanguage(lang: string | null | undefined): CodeLanguage {
  const key = (lang ?? "").toLowerCase()
  if (key === "text") return "text"
  const alias = aliases[key]
  if (alias !== undefined) return alias
  const known = languages.find((language) => language === key)
  if (known === undefined) throw new Error(`Unsupported code language ${key}`)
  return known
}

function kindOf(color: string | undefined): CodeTokenKind {
  if (color === undefined) return ""
  if (color.includes("keyword") || color.includes("token-link")) return "k"
  if (color.includes("string")) return "s"
  if (color.includes("comment")) return "c"
  if (color.includes("constant")) return "n"
  if (color.includes("function")) return "f"
  return ""
}

/** Merges neighbouring tokens of the same kind to keep the JSON small. */
function compact(tokens: CodeToken[]): CodeToken[] {
  const merged: CodeToken[] = []
  for (const token of tokens) {
    const last = merged.at(-1)
    if (last !== undefined && last[1] === token[1]) {
      merged[merged.length - 1] = [last[0] + token[0], last[1]]
    } else {
      merged.push(token)
    }
  }
  return merged
}

export async function highlight(
  source: string,
  lang: CodeLanguage,
): Promise<CodeLine[]> {
  const text = source.replace(/\n$/, "")
  if (lang === "text") return text.split("\n").map((line) => [[line, ""]])
  const shiki = await getHighlighter()
  const lines = shiki.codeToTokensBase(text, {
    lang,
    theme,
  })
  return lines.map((line) =>
    compact(line.map((token) => [token.content, kindOf(token.color)])),
  )
}
