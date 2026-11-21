// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

/**
 * Matchscan's pages never load viem. @matchbox/chain depends on it, so a
 * page, panel or shell module may take only types (`import type`) from
 * that package or from a module that imports it, never a value: /borrow
 * once took a word helper from borrow-views and its first paint grew by
 * viem's ccip chunk (155 kB brotli against the 120 kB budget). Pure
 * helpers the browser needs live in import-free modules (scan/words.ts).
 * This checks direct imports only; scripts/measure.mjs checks the build.
 */
const src = resolve(dirname(fileURLToPath(import.meta.url)), "..")

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return /\.tsx?$/.test(entry.name) ? [path] : []
  })

const isBrowserCode = (path: string) =>
  !/\.(test|server)\.tsx?$/.test(path) && !/[\\/]fixtures[\\/]/.test(path)

const importPattern = /^import\s+(type\s+)?[^;]*?\s+from\s+"([^"]+)"/gm

const importsOf = (text: string) =>
  [...text.matchAll(importPattern)].map((match) => ({
    typeOnly: match[1] !== undefined,
    from: match[2] as string,
  }))

const resolveImport = (file: string, from: string): string | null => {
  if (!from.startsWith(".")) return null
  const base = resolve(dirname(file), from)
  for (const candidate of [`${base}.ts`, `${base}.tsx`, base]) {
    if (all.has(candidate)) return candidate
  }
  return null
}

const all = new Map(
  sourceFiles(src).map((path) => [path, readFileSync(path, "utf8")]),
)

/** Modules that take a value from @matchbox/chain. */
const chainModules = new Set(
  [...all]
    .filter(([, text]) =>
      importsOf(text).some(
        (item) => !item.typeOnly && item.from === "@matchbox/chain",
      ),
    )
    .map(([path]) => path),
)

describe("the pages' scripts carry no wallet code", () => {
  it("finds the modules that import @matchbox/chain", () => {
    expect(chainModules.size).toBeGreaterThan(0)
  })

  it("routes, panels, shell and search take only types from them", () => {
    const pageDirs = ["routes", "explorer", "shell", "search"].map((dir) =>
      join(src, dir, "/"),
    )
    const offending: string[] = []
    for (const [file, text] of all) {
      if (!pageDirs.some((dir) => file.startsWith(dir))) continue
      if (!isBrowserCode(file)) continue
      for (const item of importsOf(text)) {
        if (item.typeOnly) continue
        const target = resolveImport(file, item.from)
        if (
          item.from === "@matchbox/chain" ||
          (target !== null && chainModules.has(target))
        ) {
          offending.push(`${file.slice(src.length + 1)} <- ${item.from}`)
        }
      }
    }
    expect(offending).toEqual([])
  })
})
