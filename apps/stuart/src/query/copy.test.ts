import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { FORBIDDEN_COPY, normalizeCopy } from "./copy"

// Every string Stuart can show (templates, labels, chips, notices) follows
// the copy rules: no em or en dashes, no middle dots, no semicolons. This
// scans the string literals of Stuart's sources and the Stuart UI package.

const here = import.meta.dirname
const ROOTS = [
  join(here, ".."),
  join(here, "..", "..", "..", "..", "packages", "stuart-ui", "src"),
]

function sources(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name)
    if (statSync(path).isDirectory()) return sources(path)
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : []
  })
}

/** String and template literals, with comments removed first. */
function stringLiterals(code: string): string[] {
  const withoutComments = code
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1")
  const literals: string[] = []
  const pattern = /"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`|'(?:[^'\\\n]|\\.)*'/g
  for (const match of withoutComments.matchAll(pattern)) {
    literals.push(match[0].slice(1, -1))
  }
  return literals
}

// Strings that only define the rules themselves.
const ALLOWED = new Set([";", "application/json; charset=utf-8"])

describe("copy rules", () => {
  it("no Stuart string shows a dash, middle dot or semicolon", () => {
    const offenders: string[] = []
    for (const root of ROOTS) {
      for (const file of sources(root)) {
        if (file.endsWith("copy.ts")) continue
        for (const literal of stringLiterals(readFileSync(file, "utf8"))) {
          if (ALLOWED.has(literal)) continue
          // CSS and code fragments inside template literals are not copy.
          if (/[{}]\s*$|^\s*[.#@:]/.test(literal) && literal.includes(";")) {
            continue
          }
          if (FORBIDDEN_COPY.test(literal)) {
            offenders.push(`${file.slice(-60)}: ${literal.slice(0, 80)}`)
          }
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it("normalises model sentences to the rules", () => {
    expect(normalizeCopy("Boost 5x — the maximum")).toBe(
      "Boost 5x, the maximum",
    )
    expect(normalizeCopy("Votes revert 00:00–01:00 UTC")).toBe(
      "Votes revert 00:00 to 01:00 UTC",
    )
    expect(normalizeCopy("Epoch 9 · block 13")).toBe("Epoch 9, block 13")
    expect(normalizeCopy("APY 9.86%; boost 5.00x.")).toBe(
      "APY 9.86%, boost 5.00x.",
    )
    expect(FORBIDDEN_COPY.test(normalizeCopy("a — b · c; d"))).toBe(false)
  })
})
