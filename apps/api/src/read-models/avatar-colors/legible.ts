import { presets } from "@matchbox/tokens"
import type { Rgb } from "./pick"

// A picked logo colour, made to read as a mark on every theme preset the way
// `gaugePalette` does: saturation clamped into a mid band (greys stay grey),
// then lightness moved just far enough that the colour keeps at least
// `minSurfaceContrast` against every light and dark surface token (bg, soft,
// soft2). Hue is kept.

/** Contrast every gauge colour keeps against each surface token. */
export const minSurfaceContrast = 2.5

const minSaturation = 0.4
const maxSaturation = 0.85
/** Below this HSL saturation a colour is a grey and keeps its saturation. */
const greySaturation = 0.12
/** Keeps rounding to whole RGB values from landing just outside the band. */
const bandMargin = 0.003

function channelLuminance(value: number): number {
  const scaled = value / 255
  return scaled <= 0.040_45 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4
}

function luminance({ r, g, b }: Rgb): number {
  return (
    0.2126 * channelLuminance(r) +
    0.7152 * channelLuminance(g) +
    0.0722 * channelLuminance(b)
  )
}

export function hexToRgb(hex: string): Rgb {
  const value = Number.parseInt(hex.slice(1), 16)
  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 }
}

export function rgbToHex({ r, g, b }: Rgb): string {
  const part = (value: number) =>
    Math.round(value).toString(16).padStart(2, "0").toUpperCase()
  return `#${part(r)}${part(g)}${part(b)}`
}

/** WCAG contrast ratio of two colours. */
export function contrastRatio(left: Rgb, right: Rgb): number {
  const a = luminance(left)
  const b = luminance(right)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

type Hsl = { h: number; s: number; l: number }

function rgbToHsl({ r, g, b }: Rgb): Hsl {
  const red = r / 255
  const green = g / 255
  const blue = b / 255
  const max = Math.max(red, green, blue)
  const min = Math.min(red, green, blue)
  const l = (max + min) / 2
  const chroma = max - min
  if (chroma === 0) return { h: 0, s: 0, l }
  const s = chroma / (1 - Math.abs(2 * l - 1))
  let h: number
  if (max === red) h = ((green - blue) / chroma + 6) % 6
  else if (max === green) h = (blue - red) / chroma + 2
  else h = (red - green) / chroma + 4
  return { h: h * 60, s, l }
}

function hslToRgb({ h, s, l }: Hsl): Rgb {
  const chroma = (1 - Math.abs(2 * l - 1)) * s
  const x = chroma * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - chroma / 2
  const sector = Math.floor(h / 60) % 6
  const [r, g, b] =
    sector === 0
      ? [chroma, x, 0]
      : sector === 1
        ? [x, chroma, 0]
        : sector === 2
          ? [0, chroma, x]
          : sector === 3
            ? [0, x, chroma]
            : sector === 4
              ? [x, 0, chroma]
              : [chroma, 0, x]
  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
  }
}

/** Surface tokens of every preset, split by mode. */
export const surfaces = (() => {
  const light: Rgb[] = []
  const dark: Rgb[] = []
  for (const preset of Object.values(presets)) {
    const { bg, soft, soft2 } = preset.palette
    const list = preset.mode === "light" ? light : dark
    list.push(hexToRgb(bg), hexToRgb(soft), hexToRgb(soft2))
  }
  return { light, dark }
})()

/** Relative-luminance band that keeps the contrast on every surface. */
export const luminanceBand = (() => {
  const max = Math.min(
    ...surfaces.light.map(
      (surface) => (luminance(surface) + 0.05) / minSurfaceContrast - 0.05,
    ),
  )
  const min = Math.max(
    ...surfaces.dark.map(
      (surface) => minSurfaceContrast * (luminance(surface) + 0.05) - 0.05,
    ),
  )
  return min <= max
    ? { min, max }
    : { min: (min + max) / 2, max: (min + max) / 2 }
})()

/** Lightness of `hsl`'s hue and saturation whose luminance is `target`. */
function lightnessFor(hsl: Hsl, target: number, low: number, high: number) {
  let lower = low
  let upper = high
  for (let step = 0; step < 24; step += 1) {
    const middle = (lower + upper) / 2
    if (luminance(hslToRgb({ ...hsl, l: middle })) < target) lower = middle
    else upper = middle
  }
  return (lower + upper) / 2
}

/** `color` adjusted to read on every preset, as upper-case `#RRGGBB`. */
export default function legibleColor(color: Rgb): string {
  const hsl = rgbToHsl(color)
  const s =
    hsl.s < greySaturation
      ? hsl.s
      : Math.min(maxSaturation, Math.max(minSaturation, hsl.s))
  const clamped = { ...hsl, s }
  const current = luminance(hslToRgb(clamped))
  let l = clamped.l
  if (current > luminanceBand.max) {
    l = lightnessFor(clamped, luminanceBand.max - bandMargin, 0, clamped.l)
  } else if (current < luminanceBand.min) {
    l = lightnessFor(clamped, luminanceBand.min + bandMargin, clamped.l, 1)
  }
  return rgbToHex(hslToRgb({ ...clamped, l }))
}
