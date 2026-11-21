#!/usr/bin/env node
// Checks that every relative link in a public Markdown file (Markdown links,
// reference definitions and HTML href and src) points at a file or directory
// that ships publicly: in Git (tracked, or new and not ignored) and not
// removed by .trelliumignore. Root-relative links ("/path") resolve from the
// repository root, as on GitHub, except in packages/docs/content, where they
// are site routes. URLs and same-file anchors are not checked. Runs as part
// of `pnpm lint`.
//
//   pnpm check:links
//
// Findings print as path:line, the rule and the link target.
import { execFileSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { checkLinks, directoriesOf } from "./lib/markdown-links.mjs"
import { matchesAny, parsePatternFile } from "./lib/public-tree.mjs"

const repoRoot = process.cwd()
const ignoreFile = path.join(repoRoot, ".trelliumignore")
const ignored = existsSync(ignoreFile)
  ? parsePatternFile(readFileSync(ignoreFile, "utf8"))
  : []

// Tracked files plus new ones Git does not ignore, so a fresh snapshot with
// nothing committed yet is checked too.
const tracked = execFileSync(
  "git",
  ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
  {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  },
)
  .split("\0")
  .filter((file) => file && existsSync(path.join(repoRoot, file)))
const files = new Set(tracked.filter((file) => !matchesAny(file, ignored)))
const directories = directoriesOf(files)

const findings = []
let checked = 0
for (const file of files) {
  if (!file.endsWith(".md")) continue
  checked += 1
  const text = readFileSync(path.join(repoRoot, file), "utf8")
  findings.push(...checkLinks(file, text, { files, directories, ignored }))
}

for (const finding of findings) {
  console.error(
    `${finding.file}:${finding.line} ${finding.rule}: ${finding.target}`,
  )
}
if (findings.length > 0) {
  console.error(
    `${findings.length} broken relative link(s) in ${checked} Markdown files`,
  )
  process.exit(1)
}
console.log(`Relative links OK in ${checked} public Markdown files`)
