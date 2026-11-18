import { createHash } from "node:crypto"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { claudeTools, SYSTEM_PROMPT } from "../../src/query/claude"

// What a matrix answer depends on, as one fingerprint: Stuart's prompt and
// tool definitions, all of Stuart's code (sourcing, the orchestrator,
// tools, providers, fakes), the workspace packages it imports (the docs
// knowledge, pool naming in domain, addresses in chain, the response
// contract), the bench's world and fixtures, the limits and how the bench
// calls the model. Entries run under different fingerprints are never
// resumed or published side by side.
//
// The grader's own fingerprint (GRADER_HASH) goes into each record's
// checks hash instead: a grader change re-grades stored answers offline.

const here = dirname(fileURLToPath(import.meta.url))
const stuart = resolve(here, "..", "..")
const repo = resolve(stuart, "..", "..")

const SOURCE = /\.(?:ts|tsx|json|md)$/
const SKIP = /(?:\.test\.ts|\.gen\.d\.ts)$/
const SKIP_DIRS = new Set(["node_modules", "dist", ".wrangler", "results"])

function sha(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16)
}

/** Every source file under these paths, in a stable order, as one digest. */
export function digestPaths(paths: readonly string[]): string {
  const files: string[] = []
  const walk = (path: string) => {
    const stat = statSync(path)
    if (stat.isFile()) {
      if (SOURCE.test(path) && !SKIP.test(path)) files.push(path)
      return
    }
    for (const name of readdirSync(path).sort()) {
      if (SKIP_DIRS.has(name)) continue
      walk(join(path, name))
    }
  }
  for (const path of paths) walk(path)
  const hash = createHash("sha256")
  for (const file of files.sort()) {
    hash.update(relative(repo, file).replaceAll("\\", "/"))
    hash.update("\0")
    hash.update(readFileSync(file, "utf8").replace(/\r\n/g, "\n"))
    hash.update("\0")
  }
  return hash.digest("hex").slice(0, 16)
}

export type MatrixFingerprint = {
  fingerprint: string
  budgetMs: number
  maxTokens: number
  parts: Record<string, string>
}

export function matrixFingerprint(limits: {
  budgetMs: number
  maxTokens: number
}): MatrixFingerprint {
  const parts = {
    prompt: sha(SYSTEM_PROMPT),
    tools: sha(JSON.stringify(claudeTools())),
    stuart: digestPaths([join(stuart, "src")]),
    packages: digestPaths(
      ["docs/src", "docs/content", "domain/src", "chain/src", "stuart-ui/src"]
        .map((path) => join(repo, "packages", path))
        .filter((path) => {
          try {
            return statSync(path).isDirectory()
          } catch {
            return false
          }
        }),
    ),
    world: digestPaths([
      join(stuart, "bench", "world.ts"),
      join(stuart, "bench", "harness.ts"),
      join(stuart, "bench", "fixtures"),
    ]),
    bench: sha(
      JSON.stringify({
        routerOff: true,
        fallbacks: false,
        budgetMs: limits.budgetMs,
        maxTokens: limits.maxTokens,
      }),
    ),
  }
  return {
    fingerprint: sha(JSON.stringify(parts)),
    budgetMs: limits.budgetMs,
    maxTokens: limits.maxTokens,
    parts,
  }
}

/** The grader and what it imports: part of every record's checks hash. */
export const GRADER_HASH = digestPaths(
  [
    "bench/grade.ts",
    "bench/failures.ts",
    "bench/shared.ts",
    "bench/harness.ts",
    "bench/matrix/length.ts",
    "src/query/sourced.ts",
    "src/query/copy.ts",
  ]
    .map((path) => join(stuart, path))
    .concat(join(repo, "packages", "contracts", "src", "bench", "results.ts")),
)
