// @vitest-environment node
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { presetNames, tokenContrast } from "@matchbox/ui/contrast"
import { describe, expect, it } from "vitest"

const read = (path: string): string =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8")

const css = read("../../../../packages/tokens/src/themes.css")
const palette = read("./search-palette.tsx")

describe("search palette placeholder", () => {
  const token = /placeholder:text-([a-z0-9-]+)/.exec(palette)?.[1]

  it("names a theme token", () => {
    expect(token).toBeDefined()
  })

  // The palette sits on `raised`. Placeholder text carries the field's
  // hint, so it is held to text contrast (it was mut, 2.7:1 on paper).
  it.each(presetNames)("reads at 4.5:1 or more in %s", (preset) => {
    expect(
      tokenContrast(css, preset, token ?? "missing", "raised"),
    ).toBeGreaterThanOrEqual(4.5)
  })
})
