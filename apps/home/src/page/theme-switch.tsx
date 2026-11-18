import {
  applyPreset,
  type ColorScheme,
  colorSchemes,
  readAppearance,
  resolvePreset,
  writeAppearance,
} from "@matchbox/tokens"
import { Icon, type IconName } from "@matchbox/ui/icons"
import { type ReactNode, useEffect, useState } from "react"

/**
 * The Light, Dark and System switch (in the header, and in the phone's
 * menu): a radio group that works
 * from first paint without the shared ThemeProvider. The inline theme
 * script has already painted the right preset; this reads the stored
 * mode once hydrated, writes the shared cookie and storage on change (so
 * every Matchbox app follows) and repaints. In System mode it follows
 * the device.
 */

const labels: Record<ColorScheme, { label: string; icon: IconName }> = {
  light: { label: "Light", icon: "sun" },
  dark: { label: "Dark", icon: "moon" },
  system: { label: "System", icon: "monitor" },
}

function storage(): Storage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

function paint(mode: ColorScheme): void {
  const appearance = { ...readAppearance(storage(), document.cookie), mode }
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches
  applyPreset(document.documentElement, resolvePreset(appearance, prefersDark))
}

export type ThemeMode = {
  mode: ColorScheme
  choose: (next: ColorScheme) => void
}

/**
 * The stored mode and the way to change it, shared by the header's switch
 * and the phone menu's, so the two always agree.
 */
export function useThemeMode(): ThemeMode {
  const [mode, setMode] = useState<ColorScheme>("system")

  useEffect(() => {
    setMode(readAppearance(storage(), document.cookie).mode)
  }, [])

  useEffect(() => {
    if (mode !== "system") return
    const query = window.matchMedia("(prefers-color-scheme: dark)")
    const follow = (): void => paint("system")
    query.addEventListener("change", follow)
    return () => query.removeEventListener("change", follow)
  }, [mode])

  function choose(next: ColorScheme): void {
    setMode(next)
    const appearance = {
      ...readAppearance(storage(), document.cookie),
      mode: next,
    }
    writeAppearance(storage(), appearance, document)
    paint(next)
  }

  return { mode, choose }
}

/** One radio group; `name` keeps two switches on the page apart. */
export function ThemeSwitch({
  name,
  mode,
  choose,
}: ThemeMode & { name: string }): ReactNode {
  return (
    <fieldset className="ts">
      <legend className="sr-only">Theme</legend>
      {colorSchemes.map((scheme) => (
        <label key={scheme} title={labels[scheme].label}>
          <input
            type="radio"
            name={name}
            value={scheme}
            checked={mode === scheme}
            onChange={() => choose(scheme)}
            aria-label={labels[scheme].label}
          />
          <Icon name={labels[scheme].icon} size={17} strokeWidth={1.8} />
        </label>
      ))}
    </fieldset>
  )
}
