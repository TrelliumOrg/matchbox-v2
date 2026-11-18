export {
  type Appearance,
  appearanceCookie,
  appearanceCookieName,
  appearanceStorageKeys,
  applyPreset,
  type ColorScheme,
  colorSchemes,
  defaultAppearance,
  isColorScheme,
  paintThemeColor,
  parseAppearanceCookie,
  readAppearance,
  resolvePreset,
  themeColorMarker,
  themeScript,
  writeAppearance,
} from "./appearance"
export {
  type BaseToken,
  type DarkPalette,
  type DarkPreset,
  type DarkToken,
  darkPresets,
  defaultDarkPreset,
  defaultLightPreset,
  isDarkPreset,
  isLightPreset,
  type LightPalette,
  type LightPreset,
  lightPresets,
  type PresetInfo,
  presetBackgrounds,
  presetMode,
  presets,
  type ThemeMode,
  type ThemePreset,
  type ThemeToken,
} from "./presets"

/** Motion curves from the guideline's Build notes. */
export const easing = {
  /** Rolls and slides. */
  roll: "cubic-bezier(.2,.8,.2,1)",
  /** Text. */
  text: "cubic-bezier(.19,1,.22,1)",
} as const
