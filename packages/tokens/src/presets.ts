/**
 * The eight Matchbox theme presets, exactly as the Doop guideline
 * `matchbox-themes` defines them. `themes.css` carries the same values as CSS
 * variables, and a test keeps the two in sync.
 */

export type ThemeMode = "light" | "dark"

export type LightPreset = "paper" | "linen" | "concrete" | "porcelain"

export type DarkPreset = "graphite" | "walnut" | "slate" | "onyx"

export type ThemePreset = LightPreset | DarkPreset

/** Token names, matching the CSS variable names (`--bg`, `--onAcc`, ...). */
export type BaseToken =
  | "bg"
  | "soft"
  | "soft2"
  | "line"
  | "edge"
  | "ink"
  | "ink2"
  | "sec"
  | "mut"
  | "acc"
  | "onAcc"
  | "accSoft"
  | "accInk"
  | "mezo"
  | "onMezo"
  | "mezoSoft"
  | "pos"
  | "neg"
  | "bandAcc"
  | "bandPos"
  | "bandNeg"

/** Tokens that only dark presets define. */
export type DarkToken = "posSoft" | "negSoft" | "onNeg"

export type ThemeToken = BaseToken | DarkToken

export type LightPalette = Record<BaseToken, string>

export type DarkPalette = Record<BaseToken | DarkToken, string>

export type PresetInfo =
  | {
      id: LightPreset
      name: string
      mode: "light"
      note: string | null
      palette: LightPalette
    }
  | {
      id: DarkPreset
      name: string
      mode: "dark"
      note: string | null
      palette: DarkPalette
    }

export const lightPresets: readonly LightPreset[] = [
  "paper",
  "linen",
  "concrete",
  "porcelain",
]

export const darkPresets: readonly DarkPreset[] = [
  "graphite",
  "walnut",
  "slate",
  "onyx",
]

export const defaultLightPreset: LightPreset = "paper"

export const defaultDarkPreset: DarkPreset = "graphite"

/**
 * Each preset's page background (`bg`), for the browser's theme-color: the
 * pre-paint script and the theme switch need these eight values without
 * the whole `presets` table. A test keeps them equal to the palettes.
 */
export const presetBackgrounds: Readonly<Record<ThemePreset, string>> = {
  paper: "#FFFFFF",
  linen: "#FAF7F2",
  concrete: "#F6F7F8",
  porcelain: "#FFFFFF",
  graphite: "#121212",
  walnut: "#16130F",
  slate: "#0F1216",
  onyx: "#000000",
}

/**
 * Every preset's palette. A plain literal (no spreads, nothing else reads
 * it at module level) so bundlers drop it from routes that only need the
 * preset names: `presetMode` and the guards below never touch it.
 */
export const presets = {
  paper: {
    id: "paper",
    name: "Paper",
    mode: "light",
    note: null,
    palette: {
      acc: "#F7931A",
      onAcc: "#1A1206",
      onMezo: "#FFFFFF",
      bg: "#FFFFFF",
      soft: "#F2F2F0",
      soft2: "#E9E9E6",
      line: "#E9E9E6",
      edge: "transparent",
      ink: "#0E0F0C",
      ink2: "#3B3D39",
      sec: "#6A6C68",
      mut: "#9C9E99",
      accSoft: "#FDEBD3",
      accInk: "#9A4F0C",
      mezo: "#D23A61",
      mezoSoft: "#FCE3EA",
      pos: "#1F7A4D",
      neg: "#B42318",
      bandAcc: "#F9C784",
      bandPos: "#AEDBC0",
      bandNeg: "#F1B5AC",
    },
  },
  linen: {
    id: "linen",
    name: "Linen",
    mode: "light",
    note: null,
    palette: {
      acc: "#F7931A",
      onAcc: "#1A1206",
      onMezo: "#FFFFFF",
      bg: "#FAF7F2",
      soft: "#F1ECE4",
      soft2: "#E7E1D6",
      line: "#E4DDD1",
      edge: "transparent",
      ink: "#1B1814",
      ink2: "#433D35",
      sec: "#6B6358",
      mut: "#A39B8F",
      accSoft: "#FBE4C6",
      accInk: "#904809",
      mezo: "#D23A61",
      mezoSoft: "#F9DEE3",
      pos: "#1D7247",
      neg: "#AB2416",
      bandAcc: "#F7C47F",
      bandPos: "#ABD6B8",
      bandNeg: "#EFB2A6",
    },
  },
  concrete: {
    id: "concrete",
    name: "Concrete",
    mode: "light",
    note: null,
    palette: {
      acc: "#F7931A",
      onAcc: "#1A1206",
      onMezo: "#FFFFFF",
      bg: "#F6F7F8",
      soft: "#E9ECEF",
      soft2: "#DEE2E6",
      line: "#DDE0E4",
      edge: "transparent",
      ink: "#0F1215",
      ink2: "#383D43",
      sec: "#5E656D",
      mut: "#959CA4",
      accSoft: "#FCE7CD",
      accInk: "#924A0A",
      mezo: "#D23A61",
      mezoSoft: "#F8DFE6",
      pos: "#1C754A",
      neg: "#AE2317",
      bandAcc: "#F8C583",
      bandPos: "#ACD8BF",
      bandNeg: "#EFB4AC",
    },
  },
  porcelain: {
    id: "porcelain",
    name: "Porcelain",
    mode: "light",
    note: "High contrast",
    palette: {
      acc: "#F7931A",
      onAcc: "#1A1206",
      onMezo: "#FFFFFF",
      bg: "#FFFFFF",
      soft: "#EDEDEA",
      soft2: "#DEDED9",
      line: "#C9C9C3",
      edge: "#C9C9C3",
      ink: "#000000",
      ink2: "#1F201E",
      sec: "#474945",
      mut: "#6E706B",
      accSoft: "#FBDDB5",
      accInk: "#733905",
      mezo: "#D23A61",
      mezoSoft: "#F8D3DE",
      pos: "#145C38",
      neg: "#951B11",
      bandAcc: "#F6BC6E",
      bandPos: "#9CCFB1",
      bandNeg: "#EBA598",
    },
  },
  graphite: {
    id: "graphite",
    name: "Graphite",
    mode: "dark",
    note: null,
    palette: {
      acc: "#F7931A",
      onAcc: "#1A1206",
      onMezo: "#FFFFFF",
      bg: "#121212",
      soft: "#1E1E1C",
      soft2: "#2A2A27",
      line: "#2E2E2B",
      edge: "transparent",
      ink: "#F4F4F2",
      ink2: "#D9DAD5",
      sec: "#A3A49F",
      mut: "#8E908A",
      accSoft: "#3A2A14",
      accInk: "#F7B055",
      mezo: "#C7365C",
      mezoSoft: "#3A1A24",
      pos: "#5BC48A",
      neg: "#F0796B",
      bandAcc: "#5A3F18",
      bandPos: "#1F4A33",
      bandNeg: "#5C2620",
      posSoft: "#1F4A33",
      negSoft: "#3A1D1A",
      onNeg: "#1F0A07",
    },
  },
  walnut: {
    id: "walnut",
    name: "Walnut",
    mode: "dark",
    note: null,
    palette: {
      acc: "#F7931A",
      onAcc: "#1A1206",
      onMezo: "#FFFFFF",
      bg: "#16130F",
      soft: "#221E19",
      soft2: "#2E2923",
      line: "#352F28",
      edge: "transparent",
      ink: "#F6F1EA",
      ink2: "#DDD5CA",
      sec: "#AEA497",
      mut: "#8F8577",
      accSoft: "#3E2C14",
      accInk: "#F8B562",
      mezo: "#C7365C",
      mezoSoft: "#3C1B22",
      pos: "#62C48D",
      neg: "#F07C6C",
      bandAcc: "#5E4219",
      bandPos: "#244A32",
      bandNeg: "#5E2A21",
      posSoft: "#244A32",
      negSoft: "#3C1F19",
      onNeg: "#1F0A07",
    },
  },
  slate: {
    id: "slate",
    name: "Slate",
    mode: "dark",
    note: null,
    palette: {
      acc: "#F7931A",
      onAcc: "#1A1206",
      onMezo: "#FFFFFF",
      bg: "#0F1216",
      soft: "#1A1E24",
      soft2: "#252A31",
      line: "#2B3139",
      edge: "transparent",
      ink: "#F1F3F5",
      ink2: "#D3D8DE",
      sec: "#9CA4AE",
      mut: "#7D8691",
      accSoft: "#362916",
      accInk: "#F7B055",
      mezo: "#C9395F",
      mezoSoft: "#371A26",
      pos: "#5BC48A",
      neg: "#F07A6E",
      bandAcc: "#573E1B",
      bandPos: "#1E4733",
      bandNeg: "#5A2724",
      posSoft: "#1E4733",
      negSoft: "#371D1C",
      onNeg: "#1F0A07",
    },
  },
  onyx: {
    id: "onyx",
    name: "Onyx",
    mode: "dark",
    note: "OLED",
    palette: {
      acc: "#F7931A",
      onAcc: "#1A1206",
      onMezo: "#FFFFFF",
      bg: "#000000",
      soft: "#0E0E0D",
      soft2: "#1B1B19",
      line: "#2A2A27",
      edge: "#2A2A27",
      ink: "#F4F4F2",
      ink2: "#D9DAD5",
      sec: "#A3A49F",
      mut: "#85877F",
      accSoft: "#2B1E0C",
      accInk: "#F7AE4E",
      mezo: "#C7365C",
      mezoSoft: "#2E1219",
      pos: "#5BC48A",
      neg: "#F0796B",
      bandAcc: "#4D3514",
      bandPos: "#173D29",
      bandNeg: "#4E1F1A",
      posSoft: "#173D29",
      negSoft: "#2E1513",
      onNeg: "#1F0A07",
    },
  },
} as const satisfies { [K in ThemePreset]: PresetInfo & { id: K } }

export function presetMode(preset: ThemePreset): ThemeMode {
  return isLightPreset(preset) ? "light" : "dark"
}

export function isLightPreset(value: unknown): value is LightPreset {
  return lightPresets.some((preset) => preset === value)
}

export function isDarkPreset(value: unknown): value is DarkPreset {
  return darkPresets.some((preset) => preset === value)
}
