import { describe, expect, it } from "vitest"
import { gaugePalette } from "../colors"
import legibleColor, {
  contrastRatio,
  hexToRgb,
  minSurfaceContrast,
  surfaces,
} from "./legible"
import pickColor from "./pick"
import type { PixelSample } from "./sample"

type Rgba = readonly [number, number, number, number]

/** A 10 × 10 sample filled with `fill`, the first `count` cells `paint`. */
function sample(fill: Rgba, ...paints: (readonly [Rgba, number])[]) {
  const rgba = new Uint8Array(400)
  for (let i = 0; i < 100; i += 1) rgba.set(fill, i * 4)
  let cell = 0
  for (const [color, count] of paints) {
    for (let i = 0; i < count; i += 1) {
      rgba.set(color, cell * 4)
      cell += 1
    }
  }
  const result: PixelSample = {
    width: 10,
    height: 10,
    columns: 10,
    rows: 10,
    rgba,
  }
  return result
}

const white: Rgba = [255, 255, 255, 255]
const black: Rgba = [10, 10, 10, 255]
const clear: Rgba = [0, 0, 0, 0]
const orange: Rgba = [247, 147, 26, 255]
const darkerOrange: Rgba = [230, 120, 20, 255]
const blue: Rgba = [31, 94, 255, 255]

describe("pickColor", () => {
  it("picks the brand colour over a white background", () => {
    const picked = pickColor(sample(white, [orange, 30]))
    expect(picked).toEqual({ kind: "brand", color: { r: 247, g: 147, b: 26 } })
  })

  it("weights by area: the larger colour wins", () => {
    const picked = pickColor(sample(white, [blue, 20], [orange, 35]))
    expect(picked?.color).toEqual({ r: 247, g: 147, b: 26 })
    const flipped = pickColor(sample(white, [blue, 35], [orange, 20]))
    expect(flipped?.color).toEqual({ r: 31, g: 94, b: 255 })
  })

  it("merges neighbouring shades of one hue", () => {
    // 20 blue against 15 + 15 oranges a few degrees apart.
    const picked = pickColor(
      sample(white, [blue, 20], [orange, 15], [darkerOrange, 15]),
    )
    expect(picked?.kind).toBe("brand")
    expect(picked?.color.r).toBeGreaterThan(200)
    expect(picked?.color.b).toBeLessThan(40)
  })

  it("ignores transparent, near-black and grey pixels", () => {
    const grey: Rgba = [128, 130, 128, 255]
    const hiddenRed: Rgba = [255, 0, 0, 0]
    const picked = pickColor(
      sample(clear, [black, 30], [grey, 30], [hiddenRed, 30], [orange, 5]),
    )
    expect(picked).toEqual({ kind: "brand", color: { r: 247, g: 147, b: 26 } })
  })

  it("falls back to the dominant colour for a monochrome logo", () => {
    const picked = pickColor(sample(white, [black, 70]))
    expect(picked).toEqual({ kind: "dominant", color: { r: 10, g: 10, b: 10 } })
  })

  it("returns null for a fully transparent image", () => {
    expect(pickColor(sample(clear))).toBeNull()
  })
})

describe("legibleColor", () => {
  const everySurface = [...surfaces.light, ...surfaces.dark]
  const minContrast = (hex: string) =>
    Math.min(
      ...everySurface.map((surface) => contrastRatio(hexToRgb(hex), surface)),
    )

  it("reads on every light and dark surface token", () => {
    const inputs = [
      { r: 255, g: 255, b: 0 },
      { r: 255, g: 250, b: 240 },
      { r: 5, g: 5, b: 30 },
      { r: 0, g: 255, b: 255 },
      { r: 247, g: 147, b: 26 },
      { r: 120, g: 0, b: 200 },
      { r: 128, g: 128, b: 128 },
      { r: 0, g: 0, b: 0 },
      { r: 255, g: 255, b: 255 },
    ]
    for (let hue = 0; hue < 360; hue += 15) {
      const radians = (hue * Math.PI) / 180
      inputs.push({
        r: Math.round(127 + 127 * Math.cos(radians)),
        g: Math.round(127 + 127 * Math.cos(radians - 2.1)),
        b: Math.round(127 + 127 * Math.cos(radians + 2.1)),
      })
    }
    for (const input of inputs) {
      const hex = legibleColor(input)
      expect(hex).toMatch(/^#[0-9A-F]{6}$/)
      expect(minContrast(hex)).toBeGreaterThanOrEqual(minSurfaceContrast)
    }
  })

  it("keeps the hue and leaves greys grey", () => {
    const yellow = hexToRgb(legibleColor({ r: 255, g: 230, b: 0 }))
    // Still a yellow (red and green high, blue low), just darker.
    expect(yellow.b).toBeLessThan(yellow.g)
    expect(yellow.r).toBeGreaterThanOrEqual(yellow.g)
    const grey = hexToRgb(legibleColor({ r: 250, g: 250, b: 250 }))
    expect(grey.r).toBe(grey.g)
    expect(grey.g).toBe(grey.b)
  })

  it("leaves colours already in the band nearly unchanged", () => {
    const steel = gaugePalette[0]
    const adjusted = hexToRgb(legibleColor(hexToRgb(steel)))
    const original = hexToRgb(steel)
    expect(Math.abs(adjusted.r - original.r)).toBeLessThanOrEqual(2)
    expect(Math.abs(adjusted.g - original.g)).toBeLessThanOrEqual(2)
    expect(Math.abs(adjusted.b - original.b)).toBeLessThanOrEqual(2)
  })
})
