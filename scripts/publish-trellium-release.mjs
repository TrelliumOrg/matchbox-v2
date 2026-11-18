#!/usr/bin/env node
// Publishes a snapshot made by `pnpm release:trellium:prepare` as ONE new
// commit on a public repository. It never force-pushes and never sends Git
// history from this repository: the commit is built in a fresh temporary
// clone of the target (or a new repository, for the first release).
//
//   pnpm release:trellium:publish -- --dir <snapshot>
//     (--repo <owner/name> | --remote-url <url>)
//     --author "Name <email>" --message "Release vX.Y.Z"
//     [--branch main] [--tag vX.Y.Z] --confirm
//
// Refuses to run without --confirm and an explicit target, when the target
// is this repository's own origin, when the snapshot is a Git repository or
// holds dependencies or build output, and when the strict boundary or
// secrets check fails on it. The author is explicit so the public commit
// carries a chosen identity, not whatever this machine's Git config holds.
import { execFileSync } from "node:child_process"
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

const repoRoot = process.cwd()
const usage =
  'Usage: pnpm release:trellium:publish -- --dir <snapshot> (--repo <owner/name> | --remote-url <url>) --author "Name <email>" --message "Release vX.Y.Z" [--branch main] [--tag vX.Y.Z] --confirm'

const options = {
  dir: null,
  repo: null,
  remoteUrl: null,
  author: null,
  message: null,
  branch: "main",
  tag: null,
  confirm: false,
}
const keys = {
  "--dir": "dir",
  "--repo": "repo",
  "--remote-url": "remoteUrl",
  "--author": "author",
  "--message": "message",
  "--branch": "branch",
  "--tag": "tag",
}
const args = process.argv.slice(2).filter((arg) => arg !== "--")
for (let i = 0; i < args.length; i += 1) {
  const arg = args[i]
  if (arg === "--confirm") {
    options.confirm = true
    continue
  }
  const key = keys[arg]
  if (!key || !args[i + 1]) {
    console.error(
      `${key ? `${arg} needs a value` : `Unknown argument: ${arg}`}\n${usage}`,
    )
    process.exit(1)
  }
  options[key] = args[i + 1]
  i += 1
}

function refuse(reason) {
  console.error(`Refusing to publish: ${reason}\n${usage}`)
  process.exit(1)
}

if (!options.confirm)
  refuse("--confirm is required (this pushes to a public repository)")
if (!options.dir) refuse("--dir is required")
if (!options.repo && !options.remoteUrl)
  refuse("a target is required: --repo or --remote-url")
if (options.repo && options.remoteUrl)
  refuse("use --repo or --remote-url, not both")
if (options.repo && !/^[\w.-]+\/[\w.-]+$/.test(options.repo)) {
  refuse("--repo takes owner/name")
}
if (!options.message) refuse("--message is required")
const author = /^(.+?)\s*<([^<>\s]+@[^<>\s]+)>$/.exec(options.author ?? "")
if (!author) refuse('--author "Name <email>" is required')

const target = options.remoteUrl ?? `https://github.com/${options.repo}.git`

function git(argv, cwd, env) {
  return execFileSync("git", argv, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  }).trim()
}

function normalise(url) {
  return url
    .toLowerCase()
    .replace(/^git@github\.com:/, "https://github.com/")
    .replace(/\.git$/, "")
    .replace(/\/$/, "")
}

let origin = null
try {
  origin = git(["remote", "get-url", "origin"], repoRoot)
} catch {}
if (origin && normalise(origin) === normalise(target)) {
  refuse("the target is this repository's own origin")
}

const snapshot = path.resolve(repoRoot, options.dir)
if (!existsSync(snapshot)) refuse(`snapshot not found: ${snapshot}`)
for (const name of [".git", "node_modules", ".turbo", "dist", ".output"]) {
  if (existsSync(path.join(snapshot, name))) {
    refuse(`the snapshot holds ${name}; prepare a fresh one`)
  }
}

// The same strict checks as prepare, on exactly what will be committed.
for (const [script, extra] of [
  ["check-trellium-boundary.mjs", ["--require-deny-list"]],
  ["check-secrets.mjs", []],
]) {
  execFileSync(
    process.execPath,
    [path.join(repoRoot, "scripts", script), "--dir", snapshot, ...extra],
    { cwd: repoRoot, stdio: "inherit" },
  )
}

const workspace = mkdtempSync(path.join(tmpdir(), "trellium-publish-"))
const identity = {
  GIT_AUTHOR_NAME: author[1],
  GIT_AUTHOR_EMAIL: author[2],
  GIT_COMMITTER_NAME: author[1],
  GIT_COMMITTER_EMAIL: author[2],
}
try {
  const remoteHasBranch =
    git(["ls-remote", "--heads", target, options.branch], repoRoot).length > 0
  if (remoteHasBranch) {
    git(
      [
        "clone",
        "--depth",
        "1",
        "--branch",
        options.branch,
        "--single-branch",
        target,
        workspace,
      ],
      repoRoot,
    )
  } else {
    mkdirSync(workspace, { recursive: true })
    git(["init", "--initial-branch", options.branch], workspace)
    git(["remote", "add", "origin", target], workspace)
  }

  for (const entry of readdirSync(workspace)) {
    if (entry !== ".git")
      rmSync(path.join(workspace, entry), { recursive: true, force: true })
  }
  for (const entry of readdirSync(snapshot)) {
    cpSync(path.join(snapshot, entry), path.join(workspace, entry), {
      recursive: true,
    })
  }

  git(["add", "-A"], workspace)
  if (git(["status", "--porcelain"], workspace).length === 0) {
    console.log("The snapshot matches the target branch: nothing to publish")
  } else {
    git(["commit", "--quiet", "-m", options.message], workspace, identity)
    git(["push", "origin", `HEAD:refs/heads/${options.branch}`], workspace)
    console.log(`Pushed one commit to ${target} ${options.branch}`)
  }

  if (options.tag) {
    git(["tag", "-a", options.tag, "-m", options.message], workspace, identity)
    git(["push", "origin", `refs/tags/${options.tag}`], workspace)
    console.log(`Pushed tag ${options.tag}`)
  }
} finally {
  rmSync(workspace, { recursive: true, force: true })
}
