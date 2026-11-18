import { cloudflare } from "@cloudflare/vite-plugin"
import tailwindcss from "@tailwindcss/vite"
import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import viteReact from "@vitejs/plugin-react"
import { defineConfig, type Plugin } from "vite"

/**
 * React, the router and Start load on every route: one chunk compresses
 * better than the dozen the default splitting makes. The server function
 * client and its serializer (seroval) stay out: see lazyServerFnFetcher.
 */
const framework =
  /node_modules[/](\.pnpm[/][^/]+[/]node_modules[/])?(react|react-dom|scheduler|use-sync-external-store|@tanstack[/](react-router|router-core|history|store|react-store|start-client-core|react-start-client|react-start)|cookie-es)[/]/
const firstPaintShared =
  /[/]apps[/]pro[/]src[/](shell[/]page\.tsx|lib[/]format[/]|components[/](money|coins)\.tsx)|[/]packages[/](motion[/]src[/]animated-number|ui[/]src[/](gauge-card[/]picture|list-row[/]|coin-stack[/]|icons[/]shape[/](lock|plus|x|search|check|arrow-down|arrow-up|arrow-up-right|calendar-days|circle-alert|infinity|server|globe|droplets|timer|chevron-left|star)\.tsx))/
const serverFnClient =
  /[/](seroval|seroval-plugins)[/]|[/]ssr[/]serializer[/]|[/]client-rpc[/](serverFnFetcher|frame-decoder)|getDefaultSerovalPlugins/

/**
 * Start's hydration registers a serialization adapter that imports
 * `createClientRpc`, which imports the server function fetcher and with it
 * seroval: about 10 kB brotli on every route's first paint, though server
 * functions only run on later navigations and block refreshes. This loads
 * the fetcher on the first call instead. Fails the build if Start changes
 * the file, so an upgrade cannot silently drop or break the deferral.
 */
const clientRpc = "/start-client-core/dist/esm/client-rpc/createClientRpc.js"
const fetcherImport = 'import { serverFnFetcher } from "./serverFnFetcher.js";'
const fetcherCall = "return serverFnFetcher(url, args, startFetch ?? fetch);"

function lazyServerFnFetcher(): Plugin {
  return {
    name: "pro:lazy-server-fn-fetcher",
    apply: "build",
    applyToEnvironment: (environment) => environment.name === "client",
    transform(code, id) {
      if (!id.replaceAll("\\", "/").endsWith(clientRpc)) return null
      if (!code.includes(fetcherImport) || !code.includes(fetcherCall)) {
        this.error(`${clientRpc} changed: update lazyServerFnFetcher`)
      }
      // Same lines, so the existing sourcemap still holds.
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

/**
 * The Stuart Worker each deployed environment talks to. Without an origin
 * the panel and Ctrl K search play the canned Epoch 47 answers, which is
 * right for local fixtures and wrong in production: the live Pro shipped
 * that way until 12 Nov 2026 because the origin was only ever an optional
 * VITE_STUART_URL nobody set at deploy. `VITE_STUART_URL` still wins (CI
 * points it at a local Stuart).
 */
const stuartByEnvironment: Record<string, string> = {
  preview: "https://matchbox-stuart-preview.mallard.workers.dev",
}
const stuartUrl =
  process.env.VITE_STUART_URL ??
  stuartByEnvironment[process.env.CLOUDFLARE_ENV ?? ""] ??
  ""

export default defineConfig({
  define: { "import.meta.env.VITE_STUART_URL": JSON.stringify(stuartUrl) },
  build: { sourcemap: process.env.PRO_SOURCEMAP === "1" },
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
                    firstPaintShared.test(id) ||
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
    tanstackStart({
      router: {
        codeSplittingOptions: {
          // Pending skeletons carry sample data: keep them out of the entry.
          defaultBehavior: [
            ["component"],
            ["pendingComponent"],
            ["errorComponent"],
            ["notFoundComponent"],
          ],
        },
      },
    }),
    viteReact(),
    lazyServerFnFetcher(),
  ],
})
