import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

// @matchbox/domain is pure logic: every app, Worker and Stuart imports it, so
// it must not pull in a UI framework, a server framework or a Worker runtime.

const sourceDir = fileURLToPath(new URL(".", import.meta.url))

const FORBIDDEN_MODULES = [
  /^react(-dom)?(\/|$)/,
  /^@tanstack\//,
  /^wagmi(\/|$)/,
  /^hono(\/|$)/,
  /^@hono\//,
  /^cloudflare:/,
  /^@cloudflare\//,
  /^wrangler(\/|$)/,
  /^agents(\/|$)/,
  /^@supabase\//,
  /^node:/,
]

const FORBIDDEN_GLOBALS = [
  "D1Database",
  "KVNamespace",
  "DurableObject",
  "DurableObjectNamespace",
  "ExecutionContext",
  "R2Bucket",
  "fetch(",
]

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    const isSource =
      /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)
    return isSource ? [path] : []
  })
}

function importedModules(source: string): string[] {
  const pattern =
    /(?:import|export)\s[^"']*?from\s*["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)|import\s*["']([^"']+)["']/g
  return [...source.matchAll(pattern)].flatMap((match) => {
    const name = match[1] ?? match[2] ?? match[3]
    return name === undefined ? [] : [name]
  })
}

describe("domain purity", () => {
  const files = sourceFiles(sourceDir)

  it("finds the sources", () => {
    expect(files.length).toBeGreaterThan(10)
  })

  it.each(files)("%s imports no framework or runtime", (file) => {
    const source = readFileSync(file, "utf8")
    for (const name of importedModules(source)) {
      for (const pattern of FORBIDDEN_MODULES) {
        expect(pattern.test(name), `${file} imports ${name}`).toBe(false)
      }
    }
    for (const name of FORBIDDEN_GLOBALS) {
      expect(source.includes(name), `${file} uses ${name}`).toBe(false)
    }
  })

  it("rejects the imports it guards against", () => {
    const sample = [
      'import { Hono } from "hono"',
      'import type { FC } from "react"',
      'import { env } from "cloudflare:workers"',
      'export { x } from "@cloudflare/workers-types"',
    ].join("\n")
    const names = importedModules(sample)
    expect(names).toEqual([
      "hono",
      "react",
      "cloudflare:workers",
      "@cloudflare/workers-types",
    ])
    for (const name of names) {
      expect(FORBIDDEN_MODULES.some((pattern) => pattern.test(name))).toBe(true)
    }
  })
})
