import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { render } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import {
  barId,
  barInputId,
  closeStuartSearch,
  getStuartState,
  openStuartSearch,
  StuartBadge,
} from "./launcher"

const here = dirname(fileURLToPath(import.meta.url))

/** Value imports of a module and everything it imports locally. */
function moduleGraph(entry: string): { local: string[]; external: string[] } {
  const local = new Set<string>()
  const external = new Set<string>()
  const queue = [resolve(here, entry)]
  while (queue.length > 0) {
    const file = queue.pop()
    if (file === undefined || local.has(file)) continue
    local.add(file)
    const source = readFileSync(file, "utf8")
    const pattern =
      /^\s*(import|export)\s+(type\s+)?(?:[^"';]*?\s+from\s+)?["']([^"']+)["']/gm
    for (const match of source.matchAll(pattern)) {
      if (match[2] !== undefined) continue
      const specifier = match[3]
      if (specifier === undefined) continue
      if (specifier.startsWith(".")) {
        const base = resolve(dirname(file), specifier)
        const candidates = [`${base}.ts`, `${base}.tsx`]
        const found = candidates.find((candidate) => {
          try {
            readFileSync(candidate)
            return true
          } catch {
            return false
          }
        })
        if (found !== undefined) queue.push(found)
      } else {
        external.add(specifier)
      }
    }
  }
  return {
    local: [...local].map((file) =>
      file.slice(here.length + 1).replaceAll("\\", "/"),
    ),
    external: [...external],
  }
}

describe("first-paint modules", () => {
  it("keeps the launcher to React, the mark and the store core", () => {
    const graph = moduleGraph("launcher.tsx")
    expect(graph.external.every((name) => name === "react")).toBe(true)
    expect(graph.local.sort()).toEqual(["launcher.tsx", "mark.tsx", "store.ts"])
  })

  it("keeps the store to React, with contract types only", () => {
    const graph = moduleGraph("store.ts")
    expect(graph.external).toEqual(["react"])
    expect(graph.local).toEqual(["store.ts"])
  })

  it("loads zod, the client and the contract only from the panel", () => {
    const graph = moduleGraph("panel.tsx")
    expect(graph.external).toContain("zod")
    expect(graph.local).toContain("client.ts")
  })
})

describe("first-paint entry", () => {
  it("names the bar and its input for the panel to dock to", () => {
    expect(barId).toBe("stuart-bar")
    expect(barInputId).toBe("stuart-bar-input")
  })

  it("draws the dog: face in the given colour, ears in the accent", () => {
    render(<StuartBadge size={36} />)
    const svg = document.querySelector("svg")
    expect(svg?.getAttribute("aria-hidden")).toBe("true")
    const paths = [...document.querySelectorAll("path")]
    expect(paths.at(-1)?.getAttribute("stroke")).toBe("var(--acc)")
    expect(document.querySelector("g")?.getAttribute("stroke")).toBe(
      "var(--bg)",
    )
  })

  it("opens and closes the phone search sheet through the store", () => {
    openStuartSearch()
    expect(getStuartState().searchOpen).toBe(true)
    expect(getStuartState().wanted).toBe(true)
    closeStuartSearch()
    expect(getStuartState().searchOpen).toBe(false)
  })
})
