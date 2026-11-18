import { cloudflare } from "@cloudflare/vite-plugin"
import {
  chunkModules,
  clientEnvironment,
  lazyServerFnFetcher,
  splitRouteComponents,
} from "@matchbox/perf/vite"
import tailwindcss from "@tailwindcss/vite"
import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import viteReact from "@vitejs/plugin-react"
import { defineConfig } from "vite"

/**
 * One id per build, in the page cache key (src/html-cache.ts): a page
 * cached by an earlier build names asset files this one no longer serves.
 */
const buildId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`

/**
 * The framework chunk holds React, the router, Start and whatever the
 * routes' unsplit parts (validateSearch, loaderDeps, head) import, so a
 * route file imports only light modules for those: Pools importing
 * `searchOf` from its page put the whole Pools table, the data table and
 * the explorer parts in the entry (6.5 kB brotli). Grouping the shell,
 * icons and motion there measured 138 kB brotli per route against 103 kB
 * without (modules only lazy chunks use were pulled into the entry). The
 * hash chip, copy button, untrusted text and section state words are on
 * nearly every page's first paint, so they join it, and so do the
 * sub-tabs and their scroll row: a chunk of their own measured 0.5 kB
 * brotli more on each route with tabs, here at most 0.2 kB. The explorer
 * parts (links, section states, pager) and their tooltip are on most
 * pages but not the token pages, so they are one shared chunk rather
 * than a few small ones.
 */
const firstPaintShared =
  /apps[/]scan[/]src[/]explorer[/]section-text[.]ts$|packages[/]ui[/]src[/](hash-chip|copy|untrusted-text|sub-tabs|scroll-row)[/]/

const explorerParts = {
  name: "explorer",
  test: /apps[/]scan[/]src[/]explorer[/]parts[.]tsx$|packages[/]ui[/]src[/]floating[/]/,
}

export default defineConfig({
  build: { sourcemap: process.env.SCAN_SOURCEMAP === "1" },
  define: { __SCAN_BUILD_ID__: JSON.stringify(buildId) },
  environments: {
    client: clientEnvironment(firstPaintShared, [explorerParts]),
  },
  plugins: [
    cloudflare({ viteEnvironment: { name: "ssr" } }),
    tailwindcss(),
    tanstackStart({ router: splitRouteComponents({ loaders: true }) }),
    viteReact(),
    lazyServerFnFetcher(),
    // For scripts/measure.mjs: which modules each client chunk holds.
    chunkModules({ file: "dist/chunk-modules.json" }),
  ],
})
