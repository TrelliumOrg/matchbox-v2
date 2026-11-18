import { SkeletonProvider } from "@matchbox/motion"
import {
  isColorScheme,
  isDarkPreset,
  isLightPreset,
  readAppearance,
  resolvePreset,
  writeAppearance,
} from "@matchbox/tokens"
import * as Theme from "@matchbox/ui/theme"
import * as Tooltip from "@matchbox/ui/tooltip"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import Kit from "./kit"
import "./styles.css"

// Kit only: ?mode=light|dark&light=linen&dark=onyx sets the appearance, so
// each preset can be opened (and screenshotted) directly.
const params = new URLSearchParams(window.location.search)
if (params.has("mode") || params.has("light") || params.has("dark")) {
  const stored = readAppearance(window.localStorage)
  const mode = params.get("mode")
  const light = params.get("light")
  const dark = params.get("dark")
  const next = {
    mode: isColorScheme(mode) ? mode : stored.mode,
    light: isLightPreset(light) ? light : stored.light,
    dark: isDarkPreset(dark) ? dark : stored.dark,
  }
  writeAppearance(window.localStorage, next)
  document.documentElement.setAttribute(
    "data-theme",
    resolvePreset(
      next,
      window.matchMedia("(prefers-color-scheme: dark)").matches,
    ),
  )
}

const root = document.getElementById("root")
if (root === null) throw new Error("Missing #root")

function App(): React.ReactNode {
  const { mode } = Theme.useTheme()
  return (
    <SkeletonProvider mode={mode}>
      <Kit />
    </SkeletonProvider>
  )
}

createRoot(root).render(
  <StrictMode>
    <Tooltip.Provider>
      <Theme.Provider>
        <App />
      </Theme.Provider>
    </Tooltip.Provider>
  </StrictMode>,
)
