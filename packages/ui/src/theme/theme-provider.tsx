import {
  type Appearance,
  appearanceStorageKeys,
  applyPreset,
  type ColorScheme,
  type DarkPreset,
  defaultAppearance,
  isDarkPreset,
  type LightPreset,
  paintThemeColor,
  readAppearance,
  resolvePreset,
  type ThemeMode,
  type ThemePreset,
  writeAppearance,
} from "@matchbox/tokens"
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react"

/** Sync state shown as an icon beside the Appearance title. */
export type SyncState = "synced" | "saving" | "device"

export type ThemeContextValue = {
  appearance: Appearance
  /** The preset being painted right now. */
  preset: ThemePreset
  mode: ThemeMode
  sync: SyncState
  setScheme: (scheme: ColorScheme) => void
  /** Picks a light or dark preset; the matching slot is updated. */
  setPreset: (preset: LightPreset | DarkPreset) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

const darkQuery = "(prefers-color-scheme: dark)"

function subscribeDark(onChange: () => void): () => void {
  if (typeof window === "undefined" || window.matchMedia === undefined) {
    return () => {}
  }
  const media = window.matchMedia(darkQuery)
  media.addEventListener("change", onChange)
  return () => media.removeEventListener("change", onChange)
}

function prefersDarkSnapshot(): boolean {
  return typeof window !== "undefined" && window.matchMedia !== undefined
    ? window.matchMedia(darkQuery).matches
    : false
}

function browserStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage
  } catch {
    return null
  }
}

/** The document's cookies, or null on the server or where they are refused. */
function browserCookies(): string | null {
  try {
    return typeof document === "undefined" ? null : document.cookie
  } catch {
    return null
  }
}

/** The stored appearance: the shared cookie first, then this device's copy. */
function storedAppearance(): Appearance {
  return readAppearance(browserStorage(), browserCookies())
}

/** Saves to this device and to the cookie the other products read. */
function saveAppearance(appearance: Appearance): void {
  writeAppearance(
    browserStorage(),
    appearance,
    typeof document === "undefined" ? null : document,
  )
}

type ViewTransitionDocument = Document & {
  startViewTransition?: (update: () => void) => unknown
}

function paint(root: HTMLElement, preset: ThemePreset): void {
  if (root.getAttribute("data-theme") === preset) return
  const doc: ViewTransitionDocument = root.ownerDocument
  const reduced =
    doc.defaultView?.matchMedia?.("(prefers-reduced-motion: reduce)").matches ??
    false
  if (doc.startViewTransition !== undefined && !reduced) {
    // Theme switch crossfades through a view transition.
    doc.startViewTransition(() => applyPreset(root, preset))
  } else {
    applyPreset(root, preset)
  }
}

export type ThemeProviderProps = {
  children: ReactNode
  /**
   * Appearance from the Matchbox ID account when signed in. Takes priority over
   * the device copy and is written back to the device so the pre-paint script
   * agrees on the next load.
   */
  accountAppearance?: Appearance | null
  /** Called on every change, for syncing to Matchbox ID. */
  onAppearanceChange?: (appearance: Appearance) => void
  /** Defaults to "device" when there is no account. */
  sync?: SyncState
  /** Where data-theme is set. Defaults to <html>. */
  target?: () => HTMLElement | null
}

/**
 * Holds the appearance (mode plus the two chosen presets), follows the
 * device's colour scheme in System mode and repaints <html>. The inline
 * themeScript from @matchbox/tokens has already painted before hydration.
 */
export function ThemeProvider({
  children,
  accountAppearance = null,
  onAppearanceChange,
  sync,
  target,
}: ThemeProviderProps): ReactNode {
  const [appearance, setAppearance] = useState<Appearance>(
    accountAppearance ?? defaultAppearance,
  )
  // Paint only once the stored appearance is known, so the first effect never
  // repaints the pre-paint script's theme with the defaults.
  const [ready, setReady] = useState(false)
  const prefersDark = useSyncExternalStore(
    subscribeDark,
    prefersDarkSnapshot,
    () => false,
  )

  useEffect(() => {
    if (accountAppearance !== null) {
      setAppearance(accountAppearance)
      saveAppearance(accountAppearance)
    } else {
      setAppearance((current) => (ready ? current : storedAppearance()))
    }
    setReady(true)
  }, [accountAppearance, ready])

  useEffect(() => {
    function onStorage(event: StorageEvent): void {
      const keys: readonly (string | null)[] = Object.values(
        appearanceStorageKeys,
      )
      if (keys.includes(event.key)) {
        setAppearance(storedAppearance())
      }
    }
    window.addEventListener("storage", onStorage)
    return () => window.removeEventListener("storage", onStorage)
  }, [])

  const preset = resolvePreset(appearance, prefersDark)

  useEffect(() => {
    if (!ready) return
    const root = target?.() ?? document.documentElement
    if (root !== null) paint(root, preset)
    // Also when the preset is already painted: hydration put the metas
    // back to their per-scheme values after the pre-paint script set them.
    paintThemeColor(document, preset)
  }, [preset, ready, target])

  const update = useCallback(
    (next: Appearance) => {
      setAppearance(next)
      saveAppearance(next)
      onAppearanceChange?.(next)
    },
    [onAppearanceChange],
  )

  const value = useMemo<ThemeContextValue>(
    () => ({
      appearance,
      preset,
      // Not presetMode: it reads the palettes, which first paint never needs.
      mode: isDarkPreset(preset) ? "dark" : "light",
      sync: sync ?? (accountAppearance === null ? "device" : "synced"),
      setScheme: (scheme) => update({ ...appearance, mode: scheme }),
      setPreset: (next) =>
        update(
          isDarkPreset(next)
            ? { ...appearance, dark: next }
            : { ...appearance, light: next },
        ),
    }),
    [appearance, preset, sync, accountAppearance, update],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

ThemeProvider.displayName = "ThemeProvider"

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext)
  if (context === null) {
    throw new Error("useTheme must be used inside <ThemeProvider>")
  }
  return context
}
