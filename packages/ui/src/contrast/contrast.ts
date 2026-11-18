/**
 * WCAG contrast from the theme tokens themselves, for tests: reads
 * `@matchbox/tokens/themes.css`, resolves each preset's custom properties
 * (including `var()` chains and shared blocks such as the light treatments),
 * and computes contrast ratios, so a component's colour pairs are checked
 * in every preset rather than by eye in one.
 */

export const presetNames = [
  "paper",
  "linen",
  "concrete",
  "porcelain",
  "graphite",
  "walnut",
  "slate",
  "onyx",
] as const

export type PresetName = (typeof presetNames)[number]

type Block = { selectors: string[]; declarations: Map<string, string> }

function parseBlocks(css: string): Block[] {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "")
  const blocks: Block[] = []
  for (const match of withoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = (match[1] ?? "").split(",").map((part) => part.trim())
    const declarations = new Map<string, string>()
    for (const declaration of (match[2] ?? "").split(";")) {
      const at = declaration.indexOf(":")
      if (at === -1) continue
      const name = declaration.slice(0, at).trim()
      if (name.startsWith("--")) {
        declarations.set(name, declaration.slice(at + 1).trim())
      }
    }
    blocks.push({ selectors, declarations })
  }
  return blocks
}

/** Every custom property a preset sets, with `var()` resolved. */
export function presetVariables(
  css: string,
  preset: PresetName,
): Map<string, string> {
  const selector = `[data-theme="${preset}"]`
  const raw = new Map<string, string>()
  for (const block of parseBlocks(css)) {
    if (!block.selectors.includes(selector)) continue
    for (const [name, value] of block.declarations) raw.set(name, value)
  }
  function resolve(value: string, depth: number): string {
    if (depth > 10) throw new Error(`var() loop in ${preset}`)
    return value.replace(/var\((--[\w-]+)\)/g, (_all, name: string) => {
      const target = raw.get(name)
      if (target === undefined) throw new Error(`${preset} has no ${name}`)
      return resolve(target, depth + 1)
    })
  }
  const resolved = new Map<string, string>()
  for (const [name, value] of raw) resolved.set(name, resolve(value, 0))
  return resolved
}

function channels(hex: string): [number, number, number] {
  const match = /^#([0-9a-f]{6})$/i.exec(hex.trim())
  if (match?.[1] === undefined) throw new Error(`Not a #rrggbb colour: ${hex}`)
  const value = match[1]
  return [0, 2, 4].map((at) =>
    Number.parseInt(value.slice(at, at + 2), 16),
  ) as [number, number, number]
}

function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((channel) => {
    const c = channel / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** The WCAG 2 contrast ratio of two #rrggbb colours (1 to 21). */
export function contrastRatio(foreground: string, background: string): number {
  const a = luminance(foreground)
  const b = luminance(background)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

/** The ratio of two tokens (`"pos"`, `"posSoft"`) in one preset. */
export function tokenContrast(
  css: string,
  preset: PresetName,
  foreground: string,
  background: string,
): number {
  const variables = presetVariables(css, preset)
  const fg = variables.get(`--${foreground}`)
  const bg = variables.get(`--${background}`)
  if (fg === undefined || bg === undefined) {
    throw new Error(`${preset} lacks --${foreground} or --${background}`)
  }
  return contrastRatio(fg, bg)
}
