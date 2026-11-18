// @vitest-environment node
import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

/**
 * The shell's own code that every route loads: the live price slot and
 * block ticker, the footer, the phone tab bar and the floating search bar
 * are server rendered but load as their own chunks (React.lazy), off the
 * first paint's script budget. A static import would pull them back into
 * every route's first paint (about 3.5 kB brotli).
 */
const source = (file: string) =>
  readFileSync(new URL(file, import.meta.url), "utf8")

const staticImport = (from: string) =>
  new RegExp(`^import [^;]*? from "${from.replace(/[./]/g, "$&")}"`, "m")

describe("the shell's first paint", () => {
  it("loads the live widgets, footer, tab bar and floating search lazily", () => {
    const shell = source("./app-shell.tsx")
    const topBar = source("./top-bar.tsx")
    for (const [file, text, module] of [
      ["app-shell", shell, "./footer"],
      ["app-shell", shell, "./tab-bar"],
      ["app-shell", shell, "../search/floating-search"],
      ["top-bar", topBar, "./live"],
    ] as const) {
      expect(staticImport(module).test(text), `${file} ${module}`).toBe(false)
      expect(text, `${file} ${module}`).toContain(`import("${module}")`)
    }
  })
})
