#!/usr/bin/env node
// Fails when a tracked file holds something a secret scanner would flag:
// Supabase keys (publishable keys too, so GitHub and partner scanners stay
// quiet), JWTs, private keys and common provider tokens. Keys belong in
// `wrangler secret put` or gitignored `.dev.vars` files.
//
// Default: the staged version of every tracked file. `--dir <path>`: every
// file under a directory instead (a prepared release snapshot, which has no
// Git index). Findings name the file, line and rule, never the value.
import { execFileSync } from "node:child_process"
import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import secretPatterns from "./lib/secret-patterns.mjs"

const skip =
  /(^|\/)(pnpm-lock\.yaml|.*\.(png|jpg|jpeg|gif|webp|ico|woff2?|ttf|pen|fig))$/
const skippedDirectories = new Set([".git", "node_modules", ".turbo"])

function listDir(root) {
  const out = []
  function walk(current) {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!skippedDirectories.has(entry.name)) {
          walk(path.join(current, entry.name))
        }
        continue
      }
      out.push(
        path
          .relative(root, path.join(current, entry.name))
          .replaceAll("\\", "/"),
      )
    }
  }
  walk(root)
  return out
}

const args = process.argv.slice(2)
let dir = null
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === "--dir") {
    dir = args[i + 1]
    i += 1
    continue
  }
  console.error(`Unknown argument: ${args[i]}`)
  console.error("Usage: node scripts/check-secrets.mjs [--dir <path>]")
  process.exit(1)
}

const absoluteDir = dir ? path.resolve(dir) : null
const files = (
  absoluteDir
    ? listDir(absoluteDir)
    : execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" }).split("\0")
).filter((file) => file.length > 0 && !skip.test(file))

function read(file) {
  if (absoluteDir) return readFileSync(path.join(absoluteDir, file), "utf8")
  return execFileSync("git", ["show", `:${file}`], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
}

const findings = []
for (const file of files) {
  let text
  try {
    text = read(file)
  } catch {
    continue
  }
  const lines = text.split("\n")
  lines.forEach((line, index) => {
    for (const [name, pattern] of secretPatterns) {
      if (pattern.test(line)) findings.push(`${file}:${index + 1} ${name}`)
    }
  })
}

const where = absoluteDir ?? "tracked files"
if (findings.length > 0) {
  console.error(`Possible secrets in ${where}:`)
  for (const finding of findings) console.error(`  ${finding}`)
  console.error("Move them to wrangler secrets or a gitignored .dev.vars.")
  process.exit(1)
}
console.log(`No secrets in ${files.length} files (${where}).`)
