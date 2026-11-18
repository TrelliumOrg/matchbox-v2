import type { PixelSample } from "./sample"

// The dominant brand-like colour of a logo. Transparent, near-white,
// near-black and greyish pixels are set aside; the rest vote by area into
// 10° hue bins and the strongest neighbourhood of bins wins. A logo with
// too little colour falls back to its most common colour overall.

export type Rgb = { r: number; g: number; b: number }

export type PickedColor = {
  color: Rgb
  /** `brand`: from coloured pixels; `dominant`: a near-monochrome logo. */
  kind: "brand" | "dominant"
}

const hueBins = 36
/** Brand pixels needed, as a share of opaque ones, before the fallback. */
const minBrandShare = 0.03
/** Smallest max − min channel spread that counts as colour (0 to 255). */
const minChroma = 40
const minLightness = 0.1
const maxLightness = 0.92

function hueOf(r: number, g: number, b: number, max: number, chroma: number) {
  let hue: number
  if (max === r) hue = ((g - b) / chroma + 6) % 6
  else if (max === g) hue = (b - r) / chroma + 2
  else hue = (r - g) / chroma + 4
  return hue * 60
}

type Bin = { count: number; r: number; g: number; b: number }

function emptyBins(size: number): Bin[] {
  return Array.from({ length: size }, () => ({ count: 0, r: 0, g: 0, b: 0 }))
}

function add(bin: Bin, r: number, g: number, b: number): void {
  bin.count += 1
  bin.r += r
  bin.g += g
  bin.b += b
}

function meanOf(bins: readonly Bin[]): Rgb {
  let count = 0
  let r = 0
  let g = 0
  let b = 0
  for (const bin of bins) {
    count += bin.count
    r += bin.r
    g += bin.g
    b += bin.b
  }
  return count === 0
    ? { r: 0, g: 0, b: 0 }
    : {
        r: Math.round(r / count),
        g: Math.round(g / count),
        b: Math.round(b / count),
      }
}

/** Null when the image has no opaque pixel. */
export default function pickColor(sample: PixelSample): PickedColor | null {
  const { rgba } = sample
  const brand = emptyBins(hueBins)
  // 4 bits per channel for the monochrome fallback.
  const all = new Map<number, Bin>()
  let opaque = 0
  let colored = 0
  for (let offset = 0; offset < rgba.length; offset += 4) {
    if ((rgba[offset + 3] ?? 0) < 128) continue
    const r = rgba[offset] ?? 0
    const g = rgba[offset + 1] ?? 0
    const b = rgba[offset + 2] ?? 0
    opaque += 1
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4)
    const bucket = all.get(key) ?? { count: 0, r: 0, g: 0, b: 0 }
    add(bucket, r, g, b)
    all.set(key, bucket)
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    const chroma = max - min
    const lightness = (max + min) / 510
    if (chroma < minChroma) continue
    if (lightness < minLightness || lightness > maxLightness) continue
    const bin = brand[Math.floor(hueOf(r, g, b, max, chroma) / 10) % hueBins]
    if (bin === undefined) continue
    add(bin, r, g, b)
    colored += 1
  }
  if (opaque === 0) return null
  if (colored >= Math.max(1, opaque * minBrandShare)) {
    let best = 0
    let bestScore = -1
    for (let index = 0; index < hueBins; index += 1) {
      const left = brand[(index + hueBins - 1) % hueBins]?.count ?? 0
      const right = brand[(index + 1) % hueBins]?.count ?? 0
      const score = (brand[index]?.count ?? 0) + (left + right) / 2
      if (score > bestScore) {
        best = index
        bestScore = score
      }
    }
    const neighbourhood = [-1, 0, 1].flatMap((step) => {
      const bin = brand[(best + step + hueBins) % hueBins]
      return bin === undefined ? [] : [bin]
    })
    return { color: meanOf(neighbourhood), kind: "brand" }
  }
  let dominant: Bin | null = null
  for (const bucket of all.values()) {
    if (dominant === null || bucket.count > dominant.count) dominant = bucket
  }
  return dominant === null
    ? null
    : { color: meanOf([dominant]), kind: "dominant" }
}
