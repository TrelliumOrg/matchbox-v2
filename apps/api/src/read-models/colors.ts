import type { VoterKind } from "@matchbox/contracts/market"
import type { TokenRef } from "@matchbox/contracts/read-models"

// Gauge colours for allocation marks and split bars. A curated profile's
// `brand_color` wins (see gauges.ts); without one, pool gauges take their
// lead token's brand colour and every other gauge a stable pick from a
// palette that reads on both the light and dark presets.

/** Official brand colours of the tokens Mezo pools pair. */
const tokenColors: Readonly<Record<string, string>> = {
  BTC: "#F7931A",
  MEZO: "#D23A61",
  MUSD: "#1F5EFF",
  mUSDC: "#2775CA",
  mUSDT: "#26A17B",
  SolvBTC: "#E8A23A",
  xSolvBTC: "#B97A1E",
}

/** Twelve mid-tone hues, distinct from the accent orange and Mezo pink. */
export const gaugePalette = [
  "#3E7CB1",
  "#6A4C93",
  "#2A9D8F",
  "#E76F51",
  "#8D6E63",
  "#5C7AEA",
  "#B5651D",
  "#C44536",
  "#1F7A4D",
  "#7B8C2A",
  "#A23E8C",
  "#3D8FA8",
] as const

/** A stable palette index from an address (FNV-1a over its hex). */
function paletteIndex(address: string): number {
  let state = 2_166_136_261
  for (const char of address.toLowerCase()) {
    state = Math.imul(state ^ char.charCodeAt(0), 16_777_619) >>> 0
  }
  return state % gaugePalette.length
}

/** The brand colour of a token symbol, ignoring a wrapped "m" prefix. */
export function tokenColor(symbol: string): string | null {
  return tokenColors[symbol] ?? tokenColors[symbol.replace(/^m/, "")] ?? null
}

/**
 * A gauge's colour: the first paired token with a brand colour for pool
 * gauges, else a palette pick from the gauge address.
 */
export function gaugeColor(
  address: string,
  voter: VoterKind,
  pair: readonly TokenRef[] | null,
): string {
  if (voter === "pools" && pair !== null) {
    for (const token of pair) {
      const color = tokenColor(token.symbol)
      if (color !== null) return color
    }
  }
  return gaugePalette[paletteIndex(address)] ?? gaugePalette[0]
}
