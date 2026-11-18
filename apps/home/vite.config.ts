import { cloudflare } from "@cloudflare/vite-plugin"
import { chunkModules, clientEnvironment } from "@matchbox/perf/vite"
import tailwindcss from "@tailwindcss/vite"
import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import viteReact from "@vitejs/plugin-react"
import { defineConfig } from "vite"

/**
 * One id per build, in the figures snapshot's cache key
 * (src/data/figures.server.ts), as Scan's page cache key has: a snapshot
 * stored by an earlier build may have another shape.
 */
const buildId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`

/**
 * One page, server rendered. The client environment splits the framework
 * from the page as Scan's does; nothing else is grouped.
 */
export default defineConfig({
  build: { sourcemap: process.env.HOME_SOURCEMAP === "1" },
  define: { __HOME_BUILD_ID__: JSON.stringify(buildId) },
  environments: { client: clientEnvironment(null) },
  plugins: [
    cloudflare({ viteEnvironment: { name: "ssr" } }),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
    // For scripts/measure.mjs: which modules each client chunk holds.
    chunkModules({ file: "dist/chunk-modules.json" }),
  ],
})
