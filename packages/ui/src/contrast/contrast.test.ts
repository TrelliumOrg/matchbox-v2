// @vitest-environment node
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { statusColors } from "../status-chip/status-chip"
import {
  contrastRatio,
  presetNames,
  presetVariables,
  tokenContrast,
} from "./contrast"

const css = readFileSync(
  fileURLToPath(new URL("../../../tokens/src/themes.css", import.meta.url)),
  "utf8",
)

describe("contrast helper", () => {
  it("matches the WCAG reference values", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5)
    expect(contrastRatio("#777777", "#ffffff")).toBeCloseTo(4.48, 2)
  })

  it("resolves var() through the shared light treatments", () => {
    const paper = presetVariables(css, "paper")
    expect(paper.get("--posSoft")).toBe(paper.get("--bandPos"))
    expect(paper.get("--raised")).toBe("#ffffff")
  })

  it("reproduces the review's failing pair", () => {
    // pos on posSoft, the old chip text: under AA in paper.
    expect(tokenContrast(css, "paper", "pos", "posSoft")).toBeLessThan(4.5)
  })
})

describe("status chips meet WCAG 2.2 AA in every preset", () => {
  for (const preset of presetNames) {
    for (const [variant, tones] of Object.entries(statusColors)) {
      for (const [tone, colors] of Object.entries(tones)) {
        for (const background of colors.background) {
          it(`${preset} ${variant} ${tone} on ${background}`, () => {
            // The word: 4.5:1 for text. The icon: 3:1 for graphics.
            expect(
              tokenContrast(css, preset, colors.text, background),
            ).toBeGreaterThanOrEqual(4.5)
            expect(
              tokenContrast(css, preset, colors.icon, background),
            ).toBeGreaterThanOrEqual(3)
          })
        }
      }
    }
  }
})
