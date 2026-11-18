import http from "node:http"
import { describe, expect, it } from "vitest"
import { warmPaths } from "./compressing-proxy.mjs"
import { lighthouseConfig } from "./lighthouse.mjs"
import {
  assetUrls,
  inlineScripts,
  measure,
  serverTiming,
  uncached,
} from "./measure.mjs"
import { clientEnvironment, frameworkGroup, lazyServerFnFetcher } from "./vite"

const page = [
  "<html><head>",
  '<link rel="modulepreload" href="/assets/framework.js">',
  '<script type="module" src="/assets/main.js"></script>',
  "<script>window.theme = 1</script>",
  '<script>import("/assets/route.js")</script>',
  "</head></html>",
].join("")

function fakeFetch(files: Record<string, string>, status = 200) {
  return async (input: string | URL | Request): Promise<Response> => {
    const path = new URL(input instanceof Request ? input.url : input).pathname
    const body = files[path]
    return new Response(body ?? page, {
      status: body === undefined ? status : 200,
    })
  }
}

/** The build's chunk map for the fake page: React, the app, a route. */
const cleanChunks = {
  "assets/framework.js": ["/repo/node_modules/react/index.js"],
  "assets/main.js": ["/repo/apps/scan/src/router.tsx"],
  "assets/route.js": ["/repo/apps/scan/src/routes/index.tsx"],
}

describe("measure", () => {
  it("finds every script the first paint loads", () => {
    expect(assetUrls(page).sort()).toEqual([
      "/assets/framework.js",
      "/assets/main.js",
      "/assets/route.js",
    ])
    expect(inlineScripts(page)).toHaveLength(2)
  })

  it("passes a small route and fails one that ships wallet code", async () => {
    const small = await measure({
      routes: ["/"],
      chunkModules: cleanChunks,
      fetch: fakeFetch({
        "/assets/framework.js": "export const react = 1",
        "/assets/main.js": "export const main = 1",
        "/assets/route.js": "export const route = 1",
      }),
    })
    expect(small[0]).toMatchObject({ route: "/", wallet: false, over: false })
    const wallet = await measure({
      routes: ["/"],
      chunkModules: cleanChunks,
      fetch: fakeFetch({
        "/assets/framework.js": "createConfig({ chains })",
        "/assets/main.js": "",
        "/assets/route.js": "",
      }),
    })
    expect(wallet[0]).toMatchObject({ wallet: true, over: true })
  })

  it("fails a route whose own HTML is over its budget", async () => {
    // A list rendered whole: hundreds of distinct rows (distinct, so
    // brotli cannot fold them away as it would one row repeated).
    const rows = Array.from(
      { length: 800 },
      (_, index) =>
        `<tr><td>Gauge ${index * 7919}</td><td>${(index * 104729) % 99991} votes</td><td>0x${(index * 2654435761).toString(16)}</td></tr>`,
    ).join("")
    const files = {
      "/assets/framework.js": "export const react = 1",
      "/assets/main.js": "export const main = 1",
      "/assets/route.js": "export const route = 1",
    }
    const options = {
      routes: ["/"],
      chunkModules: cleanChunks,
      htmlBudgetKb: 10,
    }
    const whole = await measure({
      ...options,
      fetch: fakeFetch({ ...files, "/": page + rows }),
    })
    expect(whole[0]?.htmlKb).toBeGreaterThan(10)
    expect(whole[0]).toMatchObject({ heavy: true, over: true })
    const paged = await measure({
      ...options,
      fetch: fakeFetch({ ...files, "/": page + rows.slice(0, 2000) }),
    })
    expect(paged[0]).toMatchObject({ heavy: false, over: false })
    // Without a budget the HTML is measured but never fails a route.
    const unbudgeted = await measure({
      routes: ["/"],
      chunkModules: cleanChunks,
      fetch: fakeFetch({ ...files, "/": page + rows }),
    })
    expect(unbudgeted[0]).toMatchObject({ heavy: false, over: false })
  })

  it("finds minified wallet code by module, where text finds nothing", async () => {
    const minified = await measure({
      routes: ["/"],
      chunkModules: {
        ...cleanChunks,
        "assets/main.js": [
          "/repo/apps/scan/src/router.tsx",
          "/repo/node_modules/.pnpm/viem@2.57.17/node_modules/viem/_esm/index.js",
        ],
      },
      fetch: fakeFetch({
        "/assets/framework.js": "export const a=1",
        "/assets/main.js": "export const b=(c)=>c*2",
        "/assets/route.js": "export const d=1",
      }),
    })
    expect(minified[0]).toMatchObject({ wallet: true, over: true })
    expect(minified[0]?.violations.map((each) => each.rule)).toEqual(["viem"])
  })

  it("refuses to run without the chunk map", async () => {
    await expect(
      measure({ routes: ["/"], chunkModules: undefined, fetch: fakeFetch({}) }),
    ).rejects.toThrow("chunk modules map")
  })

  it("fails a route over budget or not found", async () => {
    const files = {
      "/assets/framework.js": "x",
      "/assets/main.js": "y",
      "/assets/route.js": "z",
    }
    const over = await measure({
      routes: ["/"],
      chunkModules: cleanChunks,
      budgetKb: 0,
      fetch: fakeFetch(files),
    })
    expect(over[0]?.over).toBe(true)
    const missing = await measure({
      routes: ["/nope"],
      chunkModules: cleanChunks,
      fetch: fakeFetch(files, 404),
    })
    expect(missing[0]).toMatchObject({ status: 404, over: true })
  })
})

/** A page whose uncached render reports `loader;dur=<ms>`, or no timing. */
function timedFetch(loaderMs: number | null, seen: string[] = []) {
  return async (input: string | URL | Request): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : input)
    seen.push(url.pathname + url.search)
    if (url.pathname.startsWith("/assets/")) return new Response("x")
    const timed = url.searchParams.has("_perf") && loaderMs !== null
    return new Response(page, {
      headers: timed ? { "server-timing": `loader;dur=${loaderMs}` } : {},
    })
  }
}

describe("loader timing", () => {
  it("reads one metric from a Server-Timing header", () => {
    expect(serverTiming("cache;desc=miss, loader;dur=42.5", "loader")).toBe(
      42.5,
    )
    expect(serverTiming("loader;desc=x;dur=7", "loader")).toBe(7)
    expect(serverTiming("render;dur=9", "loader")).toBeNull()
    expect(serverTiming("loader;dur=abc", "loader")).toBeNull()
    expect(serverTiming(null, "loader")).toBeNull()
  })

  it("asks for a query no cache holds, keeping the route's own", () => {
    expect(uncached("/", 1)).toBe("/?_perf=1")
    expect(uncached("/address/0xab?tab=transfers", 2)).toBe(
      "/address/0xab?tab=transfers&_perf=2",
    )
  })

  it("fails a slow loader and one that reports no timing", async () => {
    const seen: string[] = []
    const quick = await measure({
      routes: ["/"],
      chunkModules: cleanChunks,
      loaderBudgetMs: 100,
      fetch: timedFetch(40, seen),
    })
    expect(quick[0]).toMatchObject({ loaderMs: 40, slow: false, over: false })
    expect(seen.some((path) => path.startsWith("/?_perf="))).toBe(true)
    const slow = await measure({
      routes: ["/"],
      chunkModules: cleanChunks,
      loaderBudgetMs: 100,
      fetch: timedFetch(250),
    })
    expect(slow[0]).toMatchObject({ loaderMs: 250, slow: true, over: true })
    const untimed = await measure({
      routes: ["/"],
      chunkModules: cleanChunks,
      loaderBudgetMs: 100,
      fetch: timedFetch(null),
    })
    expect(untimed[0]).toMatchObject({ loaderMs: null, slow: true, over: true })
  })

  it("does not time loaders without a budget", async () => {
    const seen: string[] = []
    const result = await measure({
      routes: ["/"],
      chunkModules: cleanChunks,
      fetch: timedFetch(999, seen),
    })
    expect(result[0]).toMatchObject({ loaderMs: null, slow: false })
    expect(seen.some((path) => path.includes("_perf"))).toBe(false)
  })
})

describe("lighthouse config", () => {
  it("asserts LCP on the median run and CLS 0 on every run", () => {
    const config = lighthouseConfig({ paths: ["/", "/network"], lcpMs: 1200 })
    expect(config.ci.collect.url).toEqual([
      "http://localhost:4174/",
      "http://localhost:4174/network",
    ])
    expect(config.ci.collect.startServerCommand).toBe(
      "node scripts/compressing-proxy.mjs 4174 4173 --with-preview",
    )
    expect(config.ci.assert.assertions["largest-contentful-paint"]).toEqual([
      "error",
      { maxNumericValue: 1200, aggregationMethod: "median-run" },
    ])
    expect(config.ci.assert.assertions["cumulative-layout-shift"]?.[1]).toEqual(
      { maxNumericValue: 0, aggregationMethod: "pessimistic" },
    )
  })
})

describe("vite preset", () => {
  const pnpm = "/repo/node_modules/.pnpm/react-dom@19.3.1/node_modules"

  it("groups the framework and an app's first-paint modules", () => {
    const group = frameworkGroup(/[/]apps[/]scan[/]src[/]shell[/]/)
    expect(group.test(`${pnpm}/react-dom/index.js`)).toBe(true)
    expect(group.test("/repo/apps/scan/src/shell/top-bar.tsx")).toBe(true)
    expect(group.test("/repo/node_modules/seroval/dist/index.js")).toBe(false)
    expect(group.test("/repo/apps/scan/src/routes/tx.tsx")).toBe(false)
    expect(frameworkGroup(null).test("/repo/apps/scan/src/a.ts")).toBe(false)
  })

  it("puts shared groups after the framework group", () => {
    const shared = { name: "explorer", test: /[/]explorer[/]parts[.]tsx$/ }
    const groups = (env: ReturnType<typeof clientEnvironment>) =>
      env.build.rolldownOptions.output.codeSplitting.groups
    expect(groups(clientEnvironment(null)).map((g) => g.name)).toEqual([
      "framework",
    ])
    const [framework, explorer] = groups(clientEnvironment(null, [shared]))
    expect(framework?.name).toBe("framework")
    expect(explorer).toBe(shared)
  })

  it("defers the server function fetcher and fails when Start changes", () => {
    const plugin = lazyServerFnFetcher()
    const transform = plugin.transform
    if (typeof transform !== "function") throw new Error("No transform")
    const id =
      "/x/node_modules/@tanstack/start-client-core/dist/esm/client-rpc/createClientRpc.js"
    const source = [
      'import { serverFnFetcher } from "./serverFnFetcher.js";',
      "function call(url, args, startFetch) {",
      "  return serverFnFetcher(url, args, startFetch ?? fetch);",
      "}",
    ].join("\n")
    const errors: string[] = []
    const context = {
      error(message: string): never {
        errors.push(message)
        throw new Error(message)
      },
    }
    const result = transform.call(context as never, source, id) as {
      code: string
    }
    expect(result.code).toContain('import("./serverFnFetcher.js")')
    expect(result.code).not.toContain("import { serverFnFetcher }")
    expect(transform.call(context as never, source, "/other.js")).toBeNull()
    expect(() => transform.call(context as never, "changed", id)).toThrow()
    expect(errors).toHaveLength(1)
  })
})

describe("warming the preview before Lighthouse", () => {
  it("adds the paths to the proxy command only when asked", () => {
    const cold = lighthouseConfig({ paths: ["/", "/a"], lcpMs: 1200 })
    expect(cold.ci.collect.startServerCommand).not.toContain("--warm")
    const warm = lighthouseConfig({
      paths: ["/", "/a"],
      lcpMs: 1200,
      warm: true,
    })
    expect(warm.ci.collect.startServerCommand).toBe(
      "node scripts/compressing-proxy.mjs 4174 4173 --with-preview --warm=/,/a",
    )
  })

  it("requests every path twice before the proxy opens", async () => {
    const seen: string[] = []
    const server = http.createServer((request, response) => {
      seen.push(request.url ?? "")
      response.end("ok")
    })
    await new Promise<void>((resolve) => server.listen(0, resolve))
    const address = server.address()
    const port =
      typeof address === "object" && address !== null ? address.port : 0
    const answered = await warmPaths(port, ["/", "/block/1"])
    server.close()
    expect(answered).toBe(4)
    expect(seen).toEqual(["/", "/block/1", "/", "/block/1"])
  })
})
