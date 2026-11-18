import { themeScript } from "@matchbox/tokens"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig, type Plugin } from "vite"

/** Inlines the pre-paint theme resolver so the ground never flashes. */
function prePaintTheme(): Plugin {
  return {
    name: "matchbox-pre-paint-theme",
    transformIndexHtml: () => [
      { tag: "script", children: themeScript, injectTo: "head-prepend" },
    ],
  }
}

export default defineConfig({
  plugins: [prePaintTheme(), tailwindcss(), react()],
})
