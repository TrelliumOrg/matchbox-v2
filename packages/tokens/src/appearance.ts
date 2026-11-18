import {
  type DarkPreset,
  darkPresets,
  defaultDarkPreset,
  defaultLightPreset,
  isDarkPreset,
  isLightPreset,
  type LightPreset,
  lightPresets,
  presetBackgrounds,
  type ThemePreset,
} from "./presets"

/** The picker's mode control. System follows prefers-color-scheme. */
export type ColorScheme = "light" | "dark" | "system"

export type Appearance = {
  mode: ColorScheme
  light: LightPreset
  dark: DarkPreset
}

export const colorSchemes: readonly ColorScheme[] = ["light", "dark", "system"]

/** Defaults from the picker rules: System, Paper, Graphite. */
export const defaultAppearance: Appearance = {
  mode: "system",
  light: defaultLightPreset,
  dark: defaultDarkPreset,
}

/** localStorage keys used while signed out (and as the pre-paint cache). */
export const appearanceStorageKeys = {
  mode: "mbx-mode",
  light: "mbx-light",
  dark: "mbx-dark",
} as const

/**
 * A cookie on the parent domain, so a signed-out visitor's theme follows them
 * between the products. Its value is `<mode>.<light>.<dark>`.
 */
export const appearanceCookieName = "mbx-appearance"

const appearanceCookieAttributes =
  "Domain=.matchbox.markets; Path=/; Max-Age=31536000; SameSite=Lax; Secure"

type ReadableStorage = Pick<Storage, "getItem">

type WritableStorage = Pick<Storage, "setItem">

/** `document`, or anything else with a `cookie` string to assign to. */
type CookieJar = { cookie: string }

export function isColorScheme(value: unknown): value is ColorScheme {
  return colorSchemes.some((scheme) => scheme === value)
}

function safeGet(storage: ReadableStorage, key: string): string | null {
  try {
    return storage.getItem(key)
  } catch {
    return null
  }
}

/** The `Set-Cookie`-style string that stores the appearance for a year. */
export function appearanceCookie(appearance: Appearance): string {
  return `${appearanceCookieName}=${appearance.mode}.${appearance.light}.${appearance.dark}; ${appearanceCookieAttributes}`
}

/**
 * The appearance in a `document.cookie` string, or null when the cookie is
 * absent or any of its three parts is not a known value.
 */
export function parseAppearanceCookie(cookies: string): Appearance | null {
  for (const pair of cookies.split("; ")) {
    const [name, value] = pair.split("=")
    if (name !== appearanceCookieName || value === undefined) continue
    const [mode, light, dark, ...rest] = value.split(".")
    if (
      rest.length === 0 &&
      isColorScheme(mode) &&
      isLightPreset(light) &&
      isDarkPreset(dark)
    ) {
      return { mode, light, dark }
    }
    return null
  }
  return null
}

/**
 * Reads the appearance: the shared cookie when it holds one, else the stored
 * copy, falling back to the defaults per field.
 */
export function readAppearance(
  storage: ReadableStorage | null,
  cookies: string | null = null,
): Appearance {
  const shared = cookies === null ? null : parseAppearanceCookie(cookies)
  if (shared !== null) return shared
  if (storage === null) return defaultAppearance
  const mode = safeGet(storage, appearanceStorageKeys.mode)
  const light = safeGet(storage, appearanceStorageKeys.light)
  const dark = safeGet(storage, appearanceStorageKeys.dark)
  return {
    mode: isColorScheme(mode) ? mode : defaultAppearance.mode,
    light: isLightPreset(light) ? light : defaultAppearance.light,
    dark: isDarkPreset(dark) ? dark : defaultAppearance.dark,
  }
}

/**
 * Stores the appearance, and sets the shared cookie when given a jar. Storage
 * can throw (private mode, quota); the result reports the storage write only.
 * Off matchbox.markets the browser drops the cookie and storage is the copy.
 */
export function writeAppearance(
  storage: WritableStorage | null,
  appearance: Appearance,
  jar: CookieJar | null = null,
): boolean {
  if (jar !== null) {
    try {
      jar.cookie = appearanceCookie(appearance)
    } catch {
      // A sandboxed document refuses cookies; storage still holds the copy.
    }
  }
  if (storage === null) return false
  try {
    storage.setItem(appearanceStorageKeys.mode, appearance.mode)
    storage.setItem(appearanceStorageKeys.light, appearance.light)
    storage.setItem(appearanceStorageKeys.dark, appearance.dark)
    return true
  } catch {
    return false
  }
}

/** The preset to paint, given the appearance and the device preference. */
export function resolvePreset(
  appearance: Appearance,
  prefersDark: boolean,
): ThemePreset {
  const dark =
    appearance.mode === "dark" || (appearance.mode === "system" && prefersDark)
  return dark ? appearance.dark : appearance.light
}

const quotedList = (values: readonly string[]): string =>
  values.map((value) => `"${value}"`).join(",")

/** The id of the theme-color meta the theme script and paintThemeColor own. */
export const themeColorMarker = "mbx-theme-color"

/** `paper:"#FFFFFF",…` for the script's preset to background lookup. */
const backgroundList = Object.entries(presetBackgrounds)
  .map(([preset, color]) => `${preset}:"${color}"`)
  .join(",")

/**
 * Inline this in <head> before any stylesheet paints. It mirrors
 * readAppearance + resolvePreset in ES5 with no dependencies, and always sets
 * data-theme, falling back to Paper when storage or matchMedia throw. The
 * shared cookie wins over localStorage, and only when all three parts are
 * known values. The separators are written [.] because a backslash escape
 * inside this template literal is dropped, leaving a dot that matches any
 * character. It also puts a theme-color meta of its own first in <head>,
 * set to the painted preset's background: the first matching theme-color
 * wins, so a phone's browser bar follows the Appearance choice and not only
 * the device's scheme. The document's two per-scheme metas are left as
 * rendered (React matches them by every attribute when it hydrates, and
 * adds a second pair if one changed); they are what a page with scripting
 * off shows.
 */
export const themeScript = `(function(){var d=document.documentElement,t="${defaultLightPreset}",c,m,l,k;try{c=/(?:^|; )${appearanceCookieName}=(${colorSchemes.join("|")})[.](${lightPresets.join("|")})[.](${darkPresets.join("|")})(?:;|$)/.exec(document.cookie)}catch(e){}try{if(c){m=c[1];l=c[2];k=c[3]}else{var s=window.localStorage;m=s.getItem("${appearanceStorageKeys.mode}");l=s.getItem("${appearanceStorageKeys.light}");k=s.getItem("${appearanceStorageKeys.dark}")}if([${quotedList(lightPresets)}].indexOf(l)<0)l="${defaultLightPreset}";if([${quotedList(darkPresets)}].indexOf(k)<0)k="${defaultDarkPreset}";t=m==="dark"||(m!=="light"&&window.matchMedia("(prefers-color-scheme: dark)").matches)?k:l}catch(e){}d.setAttribute("data-theme",t);try{var h=document.head,q=document.getElementById("${themeColorMarker}");if(!q){q=document.createElement("meta");q.setAttribute("name","theme-color");q.id="${themeColorMarker}";h.insertBefore(q,h.firstChild)}q.content={${backgroundList}}[t]}catch(e){}})()`

/**
 * The parts of a document paintThemeColor uses, structurally: Worker builds
 * (no DOM lib, a different HTMLElement) still typecheck this module.
 */
type ThemeColorElement = {
  id: string
  content: string
  setAttribute(name: string, value: string): void
}

type ThemeColorDocument = {
  head: {
    insertBefore(node: ThemeColorElement, child: unknown): unknown
    firstChild: unknown
  } | null
  getElementById(id: string): unknown
  createElement(tag: "meta"): ThemeColorElement
}

/**
 * Points the page's own theme-color meta (first in <head>, made by the
 * theme script, or here if it is missing) at the preset's background, so a
 * phone's browser bar follows the Appearance choice.
 */
export function paintThemeColor(page: object, preset: ThemePreset): void {
  // A Document: typed by what is used here, so Worker builds typecheck.
  const doc = page as ThemeColorDocument
  const head = doc.head
  if (head === null) return
  let meta = doc.getElementById(themeColorMarker) as ThemeColorElement | null
  if (meta === null) {
    meta = doc.createElement("meta")
    meta.setAttribute("name", "theme-color")
    meta.id = themeColorMarker
    head.insertBefore(meta, head.firstChild)
  }
  meta.content = presetBackgrounds[preset]
}

/**
 * Applies a preset to the document (client only), and points the browser
 * bar's theme-color at its background.
 */
export function applyPreset(root: HTMLElement, preset: ThemePreset): void {
  root.setAttribute("data-theme", preset)
  const doc = (root as unknown as { ownerDocument?: ThemeColorDocument | null })
    .ownerDocument
  if (doc !== undefined && doc !== null) paintThemeColor(doc, preset)
}
