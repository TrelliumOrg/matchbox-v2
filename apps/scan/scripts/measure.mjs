// Initial JS per Scan route in brotli, against a running preview. Fails over
// 120 kB, when a first-paint chunk holds wagmi, viem, WalletConnect or the
// wallet runtime (by module, from the build's dist/chunk-modules.json), or
// when a route's loaders take longer than 250 ms on an uncached render
// (Server-Timing `loader`; fixtures answer after SCAN_FIXTURE_LATENCY_MS, so
// reads made one after another add up and fail), or when a page's own HTML
// is over 40 kB brotli. The first round trip of a connection carries about
// 14.6 kB (TCP slow start, as Lighthouse models it) and the second about
// 29.2 kB more, and each trip after that adds about 150 ms to the mobile LCP
// budget of 1.2 s. 40 kB keeps every page within two trips (pages are 8 to
// 15 kB today); a list rendered whole, like the 780 gauges once were
// (78 kB), fails.
// Usage: node scripts/measure.mjs [baseUrl] [--json]
import { measureCli } from "@matchbox/perf/measure"
import { scanRoutes } from "./routes.mjs"

await measureCli({
  routes: scanRoutes,
  budgetKb: 120,
  loaderBudgetMs: 250,
  htmlBudgetKb: 40,
  chunkModulesFile: new URL("../dist/chunk-modules.json", import.meta.url),
})
