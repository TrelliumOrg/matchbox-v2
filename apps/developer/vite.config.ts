import { cloudflare } from "@cloudflare/vite-plugin"
import { chunkModules } from "@matchbox/perf/vite"
import tailwindcss from "@tailwindcss/vite"
import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import viteReact from "@vitejs/plugin-react"
import { defineConfig, type Plugin } from "vite"

/**
 * React, the router and Start load on every route: one chunk compresses
 * better than the dozen the default splitting makes (same grouping as Pro).
 */
const framework =
  /node_modules[/](\.pnpm[/][^/]+[/]node_modules[/])?(react|react-dom|scheduler|use-sync-external-store|@tanstack[/](react-router|router-core|history|store|react-store|start-client-core|react-start-client|react-start)|cookie-es)[/]/

/**
 * Start's hydration imports the server function fetcher and with it seroval
 * (about 10 kB brotli) on every first paint, though server functions only
 * run on later navigations. This loads the fetcher on the first call. Copied
 * from apps/pro (pro:lazy-server-fn-fetcher); it fails the build if Start
 * changes the file.
 */
const clientRpc = "/start-client-core/dist/esm/client-rpc/createClientRpc.js"
const fetcherImport = 'import { serverFnFetcher } from "./serverFnFetcher.js";'
const fetcherCall = "return serverFnFetcher(url, args, startFetch ?? fetch);"

function lazyServerFnFetcher(): Plugin {
  return {
    name: "developer:lazy-server-fn-fetcher",
    apply: "build",
    applyToEnvironment: (environment) => environment.name === "client",
    transform(code, id) {
      if (!id.replaceAll("\\", "/").endsWith(clientRpc)) return null
      if (!code.includes(fetcherImport) || !code.includes(fetcherCall)) {
        this.error(`${clientRpc} changed: update lazyServerFnFetcher`)
      }
      const lazy = code
        .replace(fetcherImport, "")
        .replace(
          fetcherCall,
          'return import("./serverFnFetcher.js").then((m) => m.serverFnFetcher(url, args, startFetch ?? fetch));',
        )
      return { code: lazy, map: null }
    },
  }
}

const serverFnClient =
  /[/](seroval|seroval-plugins)[/]|[/]ssr[/]serializer[/]|[/]client-rpc[/](serverFnFetcher|frame-decoder)|getDefaultSerovalPlugins/

export default defineConfig({
  build: { sourcemap: process.env.DEVELOPER_SOURCEMAP === "1" },
  environments: {
    client: {
      build: {
        rolldownOptions: {
          output: {
            codeSplitting: {
              groups: [
                {
                  name: "framework",
                  test: (id: string) =>
                    (framework.test(id) && !serverFnClient.test(id)) ||
                    id.includes("rolldown/runtime"),
                },
              ],
            },
          },
        },
      },
    },
  },
  plugins: [
    cloudflare({ viteEnvironment: { name: "ssr" } }),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
    lazyServerFnFetcher(),
    // For scripts/measure: which modules each client chunk holds.
    chunkModules({ file: "dist/chunk-modules.json" }),
  ],
})
