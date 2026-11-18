#!/usr/bin/env node
// The Trellium boundary check: what may leave this repository for the public
// TrelliumOrg repository. Rules are in scripts/lib/public-tree.mjs and the
// procedure in internal/release/README.md (private repository only).
//
//   pnpm check:trellium                      working tree, tracked files
//                                            minus .trelliumignore paths
//   pnpm check:trellium -- --ref <ref>       the same for a commit
//   pnpm check:trellium -- --dir <snapshot>  a prepared snapshot: strict
//
// Fails on an excluded path in a snapshot, a file the deny list names, a
// private IPv4 address, `ssh user@host`, a home directory with a user name,
// a personal email address, a secret shape from scripts/check-secrets.mjs, a
// deny-list term, or a public workflow that breaks the rules in
// checkPublicWorkflow. Findings print as path:line and rule, never the
// matched text.
import { execFileSync } from "node:child_process"
import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs"
import path from "node:path"
import {
  checkPublicWorkflow,
  findingId,
  isAllowed,
  matchesAny,
  parseDenyList,
  parsePatternFile,
  scanText,
} from "./lib/public-tree.mjs"

const repoRoot = process.cwd()
const defaultDenyList = "internal/public-boundary/deny-list.txt"
const defaultAllowlist = "scripts/trellium-allowlist.json"
const publicWorkflowsDir = ".github/public-workflows"
const workflowsDir = ".github/workflows"
const usage =
  "Usage: pnpm check:trellium -- [--ref <ref> | --dir <path>] [--deny-list <file>] [--require-deny-list] [--allowlist <file>] [--baseline <file>] [--write-baseline <file>]"

const options = {
  ref: null,
  dir: null,
  denyList: null,
  requireDenyList: false,
  allowlist: defaultAllowlist,
  baseline: null,
  writeBaseline: null,
}
const args = process.argv.slice(2)
for (let i = 0; i < args.length; i += 1) {
  const arg = args[i]
  const value = args[i + 1]
  const take = {
    "--ref": "ref",
    "--dir": "dir",
    "--deny-list": "denyList",
    "--allowlist": "allowlist",
    "--baseline": "baseline",
    "--write-baseline": "writeBaseline",
  }[arg]
  if (take) {
    if (!value) {
      console.error(`${arg} needs a value\n${usage}`)
      process.exit(1)
    }
    options[take] = value
    i += 1
    continue
  }
  if (arg === "--require-deny-list") {
    options.requireDenyList = true
    continue
  }
  console.error(`Unknown argument: ${arg}\n${usage}`)
  process.exit(1)
}
if (options.ref && options.dir) {
  console.error("Use either --ref or --dir, not both")
  process.exit(1)
}
if (options.dir && (options.baseline || options.writeBaseline)) {
  console.error("A snapshot is checked strictly: no --baseline with --dir")
  process.exit(1)
}

// Never scanned: dependencies and build output, which a verified snapshot
// copy may hold, and the lockfile (hashes, no prose; check-secrets skips it).
const skippedDirectories = new Set([
  ".git",
  ".lighthouseci",
  ".output",
  ".tanstack",
  ".trellium-release",
  ".turbo",
  ".vinxi",
  ".wrangler",
  "coverage",
  "dist",
  "node_modules",
  "playwright-report",
  "test-results",
])
const binary =
  /\.(png|jpe?g|gif|webp|avif|ico|woff2?|ttf|otf|pen|fig|zip|gz|pdf|wasm)$/i
const skippedFiles = new Set(["pnpm-lock.yaml"])

function readRepoFile(relative) {
  const absolute = path.join(repoRoot, relative)
  return existsSync(absolute) ? readFileSync(absolute, "utf8") : null
}

const ignoreText = readRepoFile(".trelliumignore")
if (ignoreText === null) {
  console.error("Missing .trelliumignore in the repository root")
  process.exit(1)
}
const ignored = parsePatternFile(ignoreText)

const denyListPath = options.denyList ?? defaultDenyList
const denyListText = readRepoFile(denyListPath)
if (denyListText === null && (options.requireDenyList || options.denyList)) {
  console.error(`Deny list not found: ${denyListPath}`)
  process.exit(1)
}
const denyList = denyListText
  ? parseDenyList(denyListText)
  : { terms: [], paths: [] }

const allowlistText = readRepoFile(options.allowlist)
const allowlist = allowlistText ? JSON.parse(allowlistText).allow : []

function walk(root) {
  const out = []
  function visit(current) {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name)
      if (entry.isDirectory()) {
        if (!skippedDirectories.has(entry.name)) visit(absolute)
        continue
      }
      out.push(path.relative(root, absolute).replaceAll("\\", "/"))
    }
  }
  visit(root)
  return out.sort()
}

function git(argv) {
  return execFileSync("git", argv, {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  })
}

let label
let files
let read
if (options.dir) {
  const root = path.resolve(repoRoot, options.dir)
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    console.error(`Directory not found: ${root}`)
    process.exit(1)
  }
  label = root
  files = walk(root)
  read = (file) => readFileSync(path.join(root, file))
} else if (options.ref) {
  label = `git ref ${options.ref}`
  files = git(["ls-tree", "-r", "-z", "--name-only", options.ref])
    .split("\0")
    .filter(Boolean)
  read = (file) =>
    execFileSync("git", ["show", `${options.ref}:${file}`], {
      cwd: repoRoot,
      maxBuffer: 256 * 1024 * 1024,
    })
} else {
  label = `${repoRoot} (working tree, tracked files)`
  files = git(["ls-files", "-z"])
    .split("\0")
    .filter((file) => file && existsSync(path.join(repoRoot, file)))
  read = (file) => readFileSync(path.join(repoRoot, file))
}

const findings = []
const snapshot = Boolean(options.dir)

// Public workflows as the snapshot script ships them, by file name.
const publicWorkflows = new Map()
const publicWorkflowsAbsolute = path.join(repoRoot, publicWorkflowsDir)
if (existsSync(publicWorkflowsAbsolute)) {
  for (const name of readdirSync(publicWorkflowsAbsolute)) {
    publicWorkflows.set(
      name,
      readFileSync(path.join(publicWorkflowsAbsolute, name)),
    )
  }
}

// In a snapshot, .github/workflows holds the public workflows the snapshot
// script swapped in. Anywhere else, the public set is .github/public-workflows
// when it exists (the private repository) and .github/workflows otherwise
// (the public repository, where the private workflows never existed).
const workflowRoot =
  snapshot || publicWorkflows.size === 0 ? workflowsDir : publicWorkflowsDir

let checked = 0
for (const file of files) {
  const swappedWorkflow = snapshot && file.startsWith(`${workflowsDir}/`)
  // The public repository has no .github/public-workflows: its own
  // .github/workflows is the public set and is checked although ignored.
  const publicRepoWorkflow =
    !snapshot &&
    publicWorkflows.size === 0 &&
    file.startsWith(`${workflowsDir}/`)
  if (matchesAny(file, ignored) && !publicRepoWorkflow) {
    if (!snapshot) continue
    if (!swappedWorkflow) {
      findings.push({ path: file, line: 0, rule: "excluded path", value: file })
      continue
    }
    const expected = publicWorkflows.get(path.posix.basename(file))
    if (publicWorkflows.size > 0 && !expected?.equals(read(file))) {
      findings.push({
        path: file,
        line: 0,
        rule: "workflow not from .github/public-workflows",
        value: file,
      })
      continue
    }
  }
  if (snapshot && file.startsWith(`${publicWorkflowsDir}/`)) {
    findings.push({
      path: file,
      line: 0,
      rule: "public-workflows left in the snapshot (not swapped in)",
      value: file,
    })
  }
  if (matchesAny(file, denyList.paths)) {
    findings.push({ path: file, line: 0, rule: "deny-list path", value: file })
    continue
  }
  if (binary.test(file) || skippedFiles.has(path.posix.basename(file))) {
    continue
  }
  const bytes = read(file)
  if (bytes.subarray(0, 8000).includes(0)) continue
  const text = bytes.toString("utf8")
  checked += 1
  findings.push(...scanText(file, text, denyList))
  if (file.startsWith(`${workflowRoot}/`) && /\.ya?ml$/.test(file)) {
    findings.push(...checkPublicWorkflow(file, text))
  }
  if (
    snapshot &&
    file.startsWith(".github/") &&
    !file.startsWith(`${workflowsDir}/`) &&
    /self-hosted/i.test(text)
  ) {
    findings.push({
      path: file,
      line: 0,
      rule: "workflow: self-hosted runner",
      value: "self-hosted",
    })
  }
}

if (snapshot && !files.some((file) => file.startsWith(`${workflowsDir}/`))) {
  findings.push({
    path: workflowsDir,
    line: 0,
    rule: "snapshot has no public workflow",
    value: workflowsDir,
  })
}

// The allowlist names the values it allows, so it may hold exactly those.
const allowlistPath = path.posix.normalize(
  options.allowlist.replaceAll("\\", "/"),
)
function allowlistNamesItself(finding) {
  return (
    finding.path === allowlistPath &&
    allowlist.some(
      (entry) =>
        entry.rule === finding.rule && entry.values?.includes(finding.value),
    )
  )
}
const reported = findings.filter(
  (finding) => !isAllowed(finding, allowlist) && !allowlistNamesItself(finding),
)

if (options.writeBaseline) {
  const ids = [...new Set(reported.map(findingId))].sort()
  writeFileSync(
    path.resolve(repoRoot, options.writeBaseline),
    `${JSON.stringify({ findings: ids }, null, 2)}\n`,
  )
  console.log(`Wrote ${ids.length} findings to ${options.writeBaseline}`)
  process.exit(0)
}

let known = new Set()
if (options.baseline) {
  const text = readRepoFile(options.baseline)
  if (text === null) {
    console.error(`Baseline not found: ${options.baseline}`)
    process.exit(1)
  }
  known = new Set(JSON.parse(text).findings)
}
const tolerated = reported.filter((finding) => known.has(findingId(finding)))
const failing = reported.filter((finding) => !known.has(findingId(finding)))

console.log(
  `Trellium boundary: ${checked} files scanned in ${label}; deny list ${denyListText ? `${denyList.terms.length} terms, ${denyList.paths.length} paths` : "not present"}.`,
)
if (tolerated.length > 0) {
  console.log(
    `${tolerated.length} known findings tolerated by ${options.baseline} (they still block a release snapshot).`,
  )
}
if (failing.length > 0) {
  console.error(`Trellium boundary check failed for ${label}:`)
  for (const finding of failing) {
    const where =
      finding.line > 0 ? `${finding.path}:${finding.line}` : finding.path
    console.error(`  ${where}  ${finding.rule}`)
  }
  console.error("")
  console.error(
    "Internal material lives only under internal/. Move it there, or, for a false positive, add a reviewed entry to scripts/trellium-allowlist.json.",
  )
  process.exit(1)
}
console.log(`Trellium boundary check passed for ${label}`)
