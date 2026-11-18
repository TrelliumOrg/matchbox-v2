import { randomBytes } from "node:crypto"
import { cloudflare } from "@cloudflare/vite-plugin"
import {
  chunkModules,
  clientEnvironment,
  lazyServerFnFetcher,
} from "@matchbox/perf/vite"
import tailwindcss from "@tailwindcss/vite"
import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import viteReact from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import questionIndex from "./scripts/question-index.mjs"
import { benchRoutes } from "./scripts/routes.mjs"

/**
 * Every Matchbench page is prerendered at build time from data/results.json.
 * The Worker renders only requests that carry this build's prerender token
 * (src/server.ts), which only the prerender crawler sends, and it checks
 * the file against the results schema before the first one: a file the page
 * cannot render fails the prerender, so it never ships.
 */

// One token per build process: Vite may load this file more than once (the
// prerender's preview server loads it again), and every load must agree.
process.env.BENCH_PRERENDER_TOKEN ??= randomBytes(16).toString("hex")
const prerenderToken = process.env.BENCH_PRERENDER_TOKEN

const fileExtension = /\.[a-z0-9]+$/i

export default defineConfig(({ command }) => {
  return {
    define: {
      __BENCH_PRERENDER_TOKEN__: JSON.stringify(
        command === "build" ? prerenderToken : "",
      ),
    },
    environments: { client: clientEnvironment(null) },
    plugins: [
      cloudflare({ viteEnvironment: { name: "ssr" } }),
      tailwindcss(),
      questionIndex(),
      tanstackStart({
        pages: [
          ...benchRoutes.map((path) => ({ path })),
          // The not-found page, served by the asset layer for every miss.
          { path: "/404", prerender: { outputPath: "/404.html" } },
        ],
        prerender: {
          enabled: true,
          crawlLinks: true,
          autoSubfolderIndex: true,
          failOnError: true,
          headers: { "x-bench-prerender": prerenderToken },
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
