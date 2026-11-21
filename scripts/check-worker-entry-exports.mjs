#!/usr/bin/env node
// Fails when a Worker entry module (the `main` of a wrangler config under
// apps/) has a named export that is not a class or a function. The Workers
// runtime refuses to start on one, so `wrangler dev` breaks; the rules are
// in scripts/lib/worker-entry-exports.mjs.
import path from "node:path"
import { checkRepository } from "./lib/worker-entry-exports.mjs"

const repoRoot = path.resolve(import.meta.dirname, "..")
const { lines, checked } = checkRepository(repoRoot)
if (lines.length > 0) {
  for (const line of lines) console.error(line)
  process.exit(1)
}
console.log(`Worker entry exports: ${checked.length} entry modules clean`)
