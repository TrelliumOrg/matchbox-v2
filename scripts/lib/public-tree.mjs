// The rules behind the Trellium boundary check (scripts/check-trellium-boundary.mjs).
// Pure functions only, so scripts/lib/public-tree.test.mjs can test every
// pattern without a repository.
//
// A finding is { path, line, rule, value }. `value` is the matched text: it is
// used to hash findings for the baseline and must never be printed.
import { createHash } from "node:crypto"
import secretPatterns from "./secret-patterns.mjs"

// ---------------------------------------------------------------- paths

/** Lines of an ignore file, without comments and blanks. */
export function parsePatternFile(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
}

function escapeRegExp(text) {
  return text.replaceAll(/[.+^${}()|[\]\\]/g, "\\$&")
}

/**
 * Glob to RegExp: `**` any depth, `*` within one segment, `?` one character.
 * `dir/**` matches everything under dir. A pattern without a slash matches
 * that name at any depth (`*.pen`, `notes.md`), as in .gitignore.
 */
export function globToRegExp(glob) {
  const anchored = glob.includes("/") ? glob.replace(/^\//, "") : `**/${glob}`
  let out = ""
  for (let i = 0; i < anchored.length; i += 1) {
    const char = anchored[i]
    if (char === "*" && anchored[i + 1] === "*") {
      const slash = anchored[i + 2] === "/"
      out += slash ? "(?:.*/)?" : ".*"
      i += slash ? 2 : 1
      continue
    }
    if (char === "*") out += "[^/]*"
    else if (char === "?") out += "[^/]"
    else out += escapeRegExp(char)
  }
  return new RegExp(`^${out}$`)
}

export function matchesAny(filePath, globs) {
  return globs.some((glob) => globToRegExp(glob).test(filePath))
}

// ------------------------------------------------------------- contents

const octet = "(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)"
const privateIpv4 = new RegExp(
  `(?<![\\d.])(?:10\\.${octet}\\.${octet}\\.${octet}|172\\.(?:1[6-9]|2\\d|3[01])\\.${octet}\\.${octet}|192\\.168\\.${octet}\\.${octet})(?![\\d]|\\.\\d)`,
  "g",
)

// `ssh` followed on the same line by user@host, options allowed in between
// (`ssh -p 2222 me@host`, `ssh -o BatchMode=yes me@host`).
const sshUserHost =
  /\bssh\s+(?:[^\s@]+\s+){0,6}?([A-Za-z0-9._-]+)@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*)/g

// Placeholders that name no one.
const placeholderUsers = new Set([
  "<name>",
  "<user>",
  "<username>",
  "<you>",
  "default",
  "me",
  "name",
  "node",
  "public",
  "runner",
  "runneradmin",
  "user",
  "username",
  "you",
  "your-name",
  "yourname",
])
const windowsHome =
  /\b[A-Za-z]:(?:\\{1,2}|\/)Users(?:\\{1,2}|\/)([^\\/\s"'`<>|:*?]+)/gi
const unixHome = /(?<![\w.:/~-])\/(?:home|Users)\/([^/\s"'`<>|:*?]+)/g

const emailPattern =
  /(?<![\w.%+-])([A-Za-z0-9._%+-]+)@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,})(?![\w-])/g

/**
 * Domains whose addresses name no person: reserved test domains, the
 * project's own domains and GitHub's noreply addresses.
 */
export const allowedEmailDomains = [
  "example.com",
  "example.net",
  "example.org",
  "matchbox.markets",
  "trellium.org",
  "users.noreply.github.com",
]
const allowedEmailSuffixes = [
  ".example",
  ".invalid",
  ".local",
  ".localhost",
  ".test",
]

function emailIsAllowed(local, domain) {
  const lowerLocal = local.toLowerCase()
  const lowerDomain = domain.toLowerCase()
  if (lowerLocal === "noreply" || lowerLocal === "no-reply") return true
  if (
    allowedEmailDomains.some(
      (allowed) =>
        lowerDomain === allowed || lowerDomain.endsWith(`.${allowed}`),
    )
  ) {
    return true
  }
  return allowedEmailSuffixes.some((suffix) => lowerDomain.endsWith(suffix))
}

function* matchAll(pattern, line) {
  pattern.lastIndex = 0
  for (const match of line.matchAll(pattern)) yield match
}

/** Findings of the fixed rules in one line. */
export function scanLine(line) {
  const found = []
  for (const match of matchAll(privateIpv4, line)) {
    found.push({ rule: "private-ipv4", value: match[0] })
  }
  const sshSpans = []
  for (const match of matchAll(sshUserHost, line)) {
    if (match[1] === "git" || placeholderUsers.has(match[1].toLowerCase())) {
      continue
    }
    sshSpans.push([match.index, match.index + match[0].length])
    found.push({ rule: "ssh-user-host", value: match[0] })
  }
  for (const pattern of [windowsHome, unixHome]) {
    for (const match of matchAll(pattern, line)) {
      if (placeholderUsers.has(match[1].toLowerCase())) continue
      if (match[1].startsWith("$") || match[1].startsWith("%")) continue
      found.push({ rule: "home-path", value: match[0] })
    }
  }
  for (const match of matchAll(emailPattern, line)) {
    // user@host inside a URL (postgres://user@host) is not an address.
    const before = line.slice(0, match.index)
    const token = before.slice(before.search(/[^\s"'`(<[{,=]*$/))
    if (token.includes("://")) continue
    // git@github.com and the address inside an ssh finding are not mail.
    if (match[1] === "git") continue
    if (
      sshSpans.some(([from, to]) => match.index >= from && match.index < to)
    ) {
      continue
    }
    if (emailIsAllowed(match[1], match[2])) continue
    found.push({ rule: "personal-email", value: match[0] })
  }
  for (const [name, pattern] of secretPatterns) {
    const match = pattern.exec(line)
    if (match) found.push({ rule: `secret: ${name}`, value: match[0] })
  }
  return found
}

/**
 * The owner's deny list. Each line is a case-insensitive term, `re:<regexp>`
 * (case-insensitive) or `path:<glob>` (a file path that must never ship).
 */
export function parseDenyList(text) {
  const terms = []
  const paths = []
  for (const line of parsePatternFile(text)) {
    if (line.startsWith("path:")) {
      paths.push(line.slice(5).trim())
      continue
    }
    const source = line.startsWith("re:")
      ? line.slice(3).trim()
      : escapeRegExp(line).replaceAll("*", "\\*").replaceAll("?", "\\?")
    terms.push(new RegExp(source, "i"))
  }
  return { terms, paths }
}

/** Findings in a file's text. `denyList` comes from parseDenyList. */
export function scanText(filePath, text, denyList = { terms: [], paths: [] }) {
  const findings = []
  const lines = text.split("\n")
  lines.forEach((line, index) => {
    for (const hit of scanLine(line)) {
      findings.push({ path: filePath, line: index + 1, ...hit })
    }
    denyList.terms.forEach((term, termIndex) => {
      const match = term.exec(line)
      if (match) {
        findings.push({
          path: filePath,
          line: index + 1,
          rule: `deny-list term ${termIndex + 1}`,
          value: match[0],
        })
      }
    })
  })
  return findings
}

// ------------------------------------------------------------ workflows

/**
 * Rules for a workflow that runs on the public repository, where anyone can
 * open a pull request: GitHub-hosted runners only, read-only token by
 * default, no pull_request_target or workflow_run (they run fork code with
 * the base repository's secrets), actions pinned to a full commit SHA, no
 * secrets beyond GITHUB_TOKEN and nothing that deploys.
 */
export function checkPublicWorkflow(filePath, text) {
  const findings = []
  const add = (line, rule, value) =>
    findings.push({ path: filePath, line, rule, value })
  const lines = text.split("\n")
  if (!/^permissions:/m.test(text)) {
    add(1, "workflow: no top-level permissions", "permissions")
  }
  lines.forEach((raw, index) => {
    const line = raw.replace(/(^|\s)#.*$/, "")
    const n = index + 1
    if (/self-hosted/i.test(line)) {
      add(n, "workflow: self-hosted runner", "self-hosted")
    }
    const runsOn = /^\s*runs-on:\s*(.+)$/.exec(line)
    if (runsOn && !/^\[?\s*["']?ubuntu-latest["']?\s*\]?$/.test(runsOn[1])) {
      add(n, "workflow: runner other than ubuntu-latest", runsOn[1])
    }
    if (/\bpull_request_target\b/.test(line)) {
      add(n, "workflow: pull_request_target", "pull_request_target")
    }
    if (/\bworkflow_run\b/.test(line)) {
      add(n, "workflow: workflow_run", "workflow_run")
    }
    const uses = /^\s*(?:-\s*)?uses:\s*["']?([^\s"']+)/.exec(line)
    if (uses && !uses[1].startsWith("./")) {
      const pinned = uses[1].startsWith("docker://")
        ? /@sha256:[0-9a-f]{64}$/.test(uses[1])
        : /@[0-9a-f]{40}$/.test(uses[1])
      if (!pinned) add(n, "workflow: action not pinned to a SHA", uses[1])
    }
    // `secrets.NAME`, not `check-secrets.mjs`.
    for (const match of line.matchAll(
      /(?<![\w-])secrets\.([A-Za-z_][A-Za-z0-9_]*)/g,
    )) {
      if (match[1] !== "GITHUB_TOKEN") {
        add(n, "workflow: uses a secret", match[0])
      }
    }
    if (/secrets\s*:\s*inherit/.test(line)) {
      add(n, "workflow: inherits secrets", "secrets: inherit")
    }
    if (
      /wrangler(?:\s+\S+)*\s+(?:deploy|publish|secret|versions\s+deploy)\b/.test(
        line,
      ) ||
      /cloudflare\/wrangler-action/.test(line)
    ) {
      add(n, "workflow: deploys", "wrangler")
    }
    if (/\bpermissions:\s*write-all\b/.test(line)) {
      add(n, "workflow: write-all permissions", "write-all")
    }
  })
  return findings
}

// ------------------------------------------------------------- baseline

/** Stable id of a finding that does not reveal its value. */
export function findingId(finding) {
  const digest = createHash("sha256")
    .update(`${finding.path}\0${finding.rule}\0${finding.value}`)
    .digest("hex")
  return `${finding.path}|${finding.rule}|${digest.slice(0, 16)}`
}

/** Allowlist entries: { rule, paths: [glob], values?: [exact], reason }. */
export function isAllowed(finding, allowlist) {
  return allowlist.some(
    (entry) =>
      (entry.rule === finding.rule ||
        (entry.rule.endsWith("*") &&
          finding.rule.startsWith(entry.rule.slice(0, -1)))) &&
      matchesAny(finding.path, entry.paths) &&
      (!entry.values || entry.values.includes(finding.value)),
  )
}
