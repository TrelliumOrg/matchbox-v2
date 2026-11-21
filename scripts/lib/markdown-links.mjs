// Relative links in Markdown files: which ones point at a file that is not
// there, or at a path the public repository never gets (.trelliumignore).
// Used by scripts/check-markdown-links.mjs, tested in markdown-links.test.mjs.
import path from "node:path"
import { matchesAny } from "./public-tree.mjs"

// A fence opens with 3+ backticks (no backtick in the info string) or 3+
// tildes, at any indent so fences inside list items count too. It closes on
// a line of the same character, at least as long, and nothing else.
const backtickFence = /^[ \t]*(`{3,})[^`]*$/
const tildeFence = /^[ \t]*(~{3,}).*$/
const blankLine = /\n[ \t]*\r?\n/g
// Link text: anything but brackets, a backslash escape, a line break that
// does not end the paragraph, or one nested [...] (a badge's image).
const textChar = String.raw`[^\[\]\\\n]|\\[\s\S]|\n(?![ \t]*\r?\n)`
const linkText = String.raw`(?:${textChar}|\[(?:${textChar})*\])*`
// [text](target "title") and ![alt](target). The target is wrapped in <...>
// or runs to the first space, with balanced parentheses inside.
const inlineLink = new RegExp(
  String.raw`!?\[(${linkText})\]\(\s*(<[^<>\n]*>|[^\s()<>]*(?:\([^\s()]*\)[^\s()<>]*)*)(?:\s+(?:"[^"]*"|'[^']*'|\([^()]*\)))?\s*\)`,
  "g",
)
// [label]: target, the target on the same line or the next. Footnote
// definitions ([^1]: text) are not links.
const referenceDefinition =
  /^ {0,3}\[(?!\^)((?:[^[\]\\\n]|\\.)+)\]:[ \t]*(?:\r?\n[ \t]*)?(<[^<>\n]*>|\S+)/gm
// <a href="..."> and <img src="...">: every href and src of an HTML tag.
const htmlTag = /<[a-zA-Z][\w-]*(?:\s[^<>]*)?>/g
const htmlTarget =
  /\s(?:href|src)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi
const scheme = /^[a-z][a-z0-9+.-]*:/i
// Root-relative links in the docs site content are site routes.
const siteContent = "packages/docs/content/"

// Every link target outside code fences, inline code and HTML comments, as
// { line, target } in document order. Links may wrap across lines.
export function extractLinks(text) {
  const masked = maskCode(text)
  const found = []
  collectInline(masked, 0, found)
  for (const match of masked.matchAll(referenceDefinition)) {
    found.push({
      offset: match.index + match[0].length - match[2].length,
      target: match[2],
    })
  }
  for (const tag of masked.matchAll(htmlTag)) {
    for (const attribute of tag[0].matchAll(htmlTarget)) {
      found.push({
        offset: tag.index + attribute.index,
        target: attribute[1] ?? attribute[2] ?? attribute[3],
      })
    }
  }
  const starts = lineStarts(text)
  return found
    .sort((a, b) => a.offset - b.offset)
    .map(({ offset, target }) => ({
      line: lineOf(starts, offset),
      target: unwrap(target),
    }))
}

// Inline links in `text`, and the links inside each one's text, so a badge
// ([![alt](image)](target)) gives both targets.
function collectInline(text, base, found) {
  for (const match of text.matchAll(inlineLink)) {
    found.push({ offset: base + match.index, target: match[2] })
    const inner = match.index + match[0].indexOf("[") + 1
    collectInline(match[1], base + inner, found)
  }
}

// The text with fenced code, inline code and HTML comments replaced by
// spaces. Line breaks and offsets stay where they were.
function maskCode(text) {
  const lines = text.split("\n")
  let open = null
  const unfenced = lines.map((line) => {
    if (open === null) {
      const start = line.match(backtickFence) ?? line.match(tildeFence)
      if (start) {
        open = start[1]
        return blank(line)
      }
      return line
    }
    const close = line.match(/^[ \t]*(`{3,}|~{3,})[ \t]*\r?$/)
    if (close && close[1][0] === open[0] && close[1].length >= open.length) {
      open = null
    }
    return blank(line)
  })
  return maskInline(unfenced.join("\n"))
}

// Masks code spans and HTML comments in one pass, left to right, so a
// backtick inside a comment or "<!--" inside a code span is not misread. A
// code span closes on a run of as many backticks in the same paragraph.
function maskInline(text) {
  const paragraphEnds = [...text.matchAll(blankLine)].map((m) => m.index)
  paragraphEnds.push(text.length)
  let out = ""
  let at = 0
  let i = 0
  let paragraph = 0
  while (i < text.length) {
    const char = text[i]
    if (char === "\\") {
      i += 2
      continue
    }
    if (char === "<" && text.startsWith("<!--", i)) {
      const close = text.indexOf("-->", i + 4)
      const end = close === -1 ? text.length : close + 3
      out += text.slice(at, i) + blank(text.slice(i, end))
      at = i = end
      continue
    }
    if (char === "`") {
      let run = 1
      while (text[i + run] === "`") run += 1
      while (paragraphEnds[paragraph] < i) paragraph += 1
      const limit = paragraphEnds[paragraph]
      const end = closingRun(text, i + run, run, limit)
      if (end !== -1) {
        out += text.slice(at, i) + blank(text.slice(i, end))
        at = i = end
        continue
      }
      i += run
      continue
    }
    i += 1
  }
  return out + text.slice(at)
}

// The end of the first run of exactly `length` backticks from `from`, before
// `limit`, or -1.
function closingRun(text, from, length, limit) {
  let i = text.indexOf("`", from)
  while (i !== -1 && i < limit) {
    let run = 1
    while (text[i + run] === "`") run += 1
    if (run === length) return i + run
    i = text.indexOf("`", i + run)
  }
  return -1
}

function blank(text) {
  return text.replace(/[^\r\n]/g, " ")
}

function lineStarts(text) {
  const starts = [0]
  for (let i = text.indexOf("\n"); i !== -1; i = text.indexOf("\n", i + 1)) {
    starts.push(i + 1)
  }
  return starts
}

// 1-based line of an offset, by binary search over the line starts.
function lineOf(starts, offset) {
  let low = 0
  let high = starts.length - 1
  while (low < high) {
    const middle = (low + high + 1) >> 1
    if (starts[middle] <= offset) low = middle
    else high = middle - 1
  }
  return low + 1
}

function unwrap(target) {
  return target.startsWith("<") && target.endsWith(">")
    ? target.slice(1, -1)
    : target
}

// The repository path a target names, or null when it is not a file link: a
// URL, mailto, an anchor in the same file, or a root-relative site route in
// the docs site content. Elsewhere "/path" is resolved from the repository
// root, as GitHub does in a README.
export function resolveTarget(fromFile, target) {
  if (!target || scheme.test(target) || target.startsWith("#")) return null
  if (target.startsWith("//")) return null
  const rooted = target.startsWith("/")
  if (rooted && fromFile.startsWith(siteContent)) return null
  const bare = target.split("#")[0].split("?")[0]
  if (!bare) return null
  let decoded
  try {
    decoded = decodeURIComponent(bare)
  } catch {
    decoded = bare
  }
  const joined = rooted
    ? path.posix.normalize(`.${decoded}`)
    : path.posix.normalize(
        path.posix.join(path.posix.dirname(fromFile), decoded),
      )
  return joined.replace(/\/$/, "") || "."
}

// Findings for one Markdown file. `files` is the set of public file paths
// and `directories` the set of directories that hold at least one of them.
export function checkLinks(fromFile, text, { files, directories, ignored }) {
  const findings = []
  for (const { line, target } of extractLinks(text)) {
    const resolved = resolveTarget(fromFile, target)
    if (resolved === null) continue
    if (resolved === ".." || resolved.startsWith("../")) {
      findings.push({
        file: fromFile,
        line,
        target,
        rule: "outside the repository",
      })
      continue
    }
    if (matchesAny(resolved, ignored) || matchesAny(`${resolved}/x`, ignored)) {
      findings.push({ file: fromFile, line, target, rule: "not published" })
      continue
    }
    if (!files.has(resolved) && !directories.has(resolved)) {
      findings.push({ file: fromFile, line, target, rule: "missing" })
    }
  }
  return findings
}

// Every directory above each file, as a set.
export function directoriesOf(files) {
  const directories = new Set(["."])
  for (const file of files) {
    let current = path.posix.dirname(file)
    while (current !== "." && !directories.has(current)) {
      directories.add(current)
      current = path.posix.dirname(current)
    }
  }
  return directories
}
