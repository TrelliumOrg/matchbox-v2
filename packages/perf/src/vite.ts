import type { Plugin } from "vite"

/**
 * The Vite pieces that keep a Matchbox frontend's first paint small, copied
 * from apps/pro/vite.config.ts. Erasable TypeScript only, so a vite config
 * loads it however Vite bundles it.
 */

/**
 * React, the router and Start load on every route: one chunk compresses
 * better than the dozen the default splitting makes. The server function
 * client and its serializer (seroval) stay out: see lazyServerFnFetcher.
 */
export const framework =
  /node_modules[/](\.pnpm[/][^/]+[/]node_modules[/])?(react|react-dom|scheduler|use-sync-external-store|@tanstack[/](react-router|router-core|history|store|react-store|start-client-core|react-start-client|react-start)|cookie-es)[/]/

export const serverFnClient =
  /[/](seroval|seroval-plugins)[/]|[/]ssr[/]serializer[/]|[/]client-rpc[/](serverFnFetcher|frame-decoder)|getDefaultSerovalPlugins/

/**
 * The framework chunk group. `firstPaintShared` adds an app's own modules
 * that every route's first paint uses (Pro's page shell, formatters and the
 * icon shapes on every screen), or null for none.
 */
export function frameworkGroup(firstPaintShared: RegExp | null): {
  name: string
  test: (id: string) => boolean
} {
  return {
    name: "framework",
    test: (id: string) =>
      (framework.test(id) && !serverFnClient.test(id)) ||
      (firstPaintShared?.test(id) ?? false) ||
      id.includes("rolldown/runtime"),
  }
}

/**
 * A chunk group after the framework one: modules many lazy routes share,
 * kept in one chunk rather than one small chunk each (each file costs its
 * own imports, exports and brotli framing, and a file name in the entry).
 */
export type SharedGroup = { name: string; test: RegExp }

/**
 * `environments.client` for defineConfig, with the framework chunk and any
 * `shared` groups after it.
 */
export function clientEnvironment(
  firstPaintShared: RegExp | null,
  shared: readonly SharedGroup[] = [],
) {
  return {
    build: {
      rolldownOptions: {
        output: {
          codeSplitting: {
            groups: [frameworkGroup(firstPaintShared), ...shared],
          },
        },
      },
    },
  }
}

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

export function lazyServerFnFetcher(): Plugin {
  return {
    name: "matchbox:lazy-server-fn-fetcher",
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

/** A route export TanStack Start can split into its own chunk. */
type SplitTarget =
  | "loader"
  | "component"
  | "pendingComponent"
  | "errorComponent"
  | "notFoundComponent"

/**
 * TanStack Start's router options: pending, error and not-found components
 * split from their routes, so pending skeletons with sample data stay out of
 * the entry. With `loaders`, each route's loader is split too: loaders are
 * otherwise all in the entry, so every route an app adds grows every
 * page's first paint. A hydrating page has its loader data already; the
 * loader chunk is fetched for client-side navigations.
 */
export function splitRouteComponents(options: { loaders?: boolean } = {}): {
  codeSplittingOptions: { defaultBehavior: SplitTarget[][] }
} {
  return {
    codeSplittingOptions: {
      defaultBehavior: [
        ...(options.loaders === true ? [["loader"] as SplitTarget[]] : []),
        ["component"],
        ["pendingComponent"],
        ["errorComponent"],
        ["notFoundComponent"],
      ],
    },
  }
}

/**
 * Writes `file`: each client chunk's file name and the module ids it holds,
 * for measure.mjs to check first paint by module (see first-paint.mjs).
 * Write it outside the client output directory: it is a build record, not
 * something to serve.
 */
export function chunkModules(options: { file: string }): Plugin {
  return {
    name: "matchbox:chunk-modules",
    apply: "build",
    applyToEnvironment: (environment) => environment.name === "client",
    async writeBundle(_output, bundle) {
      const map: Record<string, string[]> = {}
      for (const [fileName, output] of Object.entries(bundle)) {
        if (output.type !== "chunk") continue
        map[fileName] = output.moduleIds.map((id) => id.replaceAll("\\", "/"))
      }
      const { mkdir, writeFile } = await import("node:fs/promises")
      const { dirname } = await import("node:path")
      await mkdir(dirname(options.file), { recursive: true })
      await writeFile(options.file, JSON.stringify(map, null, 1))
    },
  }
}
