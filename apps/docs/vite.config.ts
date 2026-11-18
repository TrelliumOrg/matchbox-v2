import { randomBytes } from "node:crypto"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
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
import { stuartOrigin } from "./scripts/stuart-origin.mjs"

/**
 * Every docs page is prerendered at build time. The page list comes from
 * the content manifest (packages/docs dist/routes.json) and the crawler
 * follows links from there, so a page that nothing lists still fails the
 * link checker rather than vanishing. The Worker renders only requests
 * that carry this build's prerender token (src/server.ts), which only the
 * prerender crawler sends.
 */

const routesFile = fileURLToPath(
  new URL("../../packages/docs/dist/routes.json", import.meta.url),
)

function contentRoutes(): string[] {
  const raw: unknown = JSON.parse(readFileSync(routesFile, "utf8"))
  if (!Array.isArray(raw) || !raw.every((item) => typeof item === "string")) {
    throw new Error(`${routesFile} is not a list of paths`)
  }
  return raw
}

// One token per build process: Vite may load this file more than once
// (the prerender's preview server loads it again), and every load must
// agree with the Worker bundle the first one built.
process.env.DOCS_PRERENDER_TOKEN ??= randomBytes(16).toString("hex")
const prerenderToken = process.env.DOCS_PRERENDER_TOKEN

/** Files, not pages: the crawler leaves them to the assets. */
const fileExtension = /\.[a-z0-9]+$/i

export default defineConfig(({ command, mode }) => {
  const routes = command === "build" ? contentRoutes() : []
  return {
    // Assembled by scripts/prebuild.mjs: public/ plus the files packages/docs builds.
    publicDir: "dist/public",
    define: {
      __DOCS_PRERENDER_TOKEN__: JSON.stringify(
        command === "build" ? prerenderToken : "",
      ),
      // "Ask about this page" posts here; null opens search instead.
      __DOCS_STUART_ORIGIN__: JSON.stringify(stuartOrigin(mode)),
    },
    environments: { client: clientEnvironment(null) },
    plugins: [
      cloudflare({ viteEnvironment: { name: "ssr" } }),
      tailwindcss(),
      tanstackStart({
        router: splitRouteComponents({ loaders: true }),
        pages: [
          { path: "/" },
          ...routes.map((path) => ({ path })),
          // The not-found page, served by the asset layer for every miss.
          { path: "/404", prerender: { outputPath: "/404.html" } },
        ],
        prerender: {
          enabled: true,
          crawlLinks: true,
          autoSubfolderIndex: true,
          failOnError: true,
          headers: { "x-docs-prerender": prerenderToken },
          filter: ({ path }) =>
            !fileExtension.test(path.split(/[?#]/)[0] ?? ""),
        },
      }),
      viteReact(),
      lazyServerFnFetcher(),
      chunkModules({ file: "dist/chunk-modules.json" }),
    ],
  }
})
