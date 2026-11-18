// Initial JS per Matchbench page in brotli (what Cloudflare serves), against
// a running preview (`pnpm preview`, port 4203). Fails over 120 kB, when a
// first-paint chunk holds wallet code (the site has none), or when a page's
// own HTML is over 40 kB brotli.
// Usage: node scripts/measure.mjs [baseUrl] [--json]
import { measureCli } from "@matchbox/perf/measure"
import { benchRoutes } from "./routes.mjs"

if (!process.argv.some((arg) => arg.startsWith("http"))) {
  process.argv.push("http://localhost:4203")
}

await measureCli({
  routes: benchRoutes,
  budgetKb: 120,
  htmlBudgetKb: 40,
  chunkModulesFile: new URL("../dist/chunk-modules.json", import.meta.url),
})
