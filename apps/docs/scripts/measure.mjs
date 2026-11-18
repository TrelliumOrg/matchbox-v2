// Initial JS per docs route in brotli (what Cloudflare serves), against a
// running preview (port 4183). Fails over 120 kB or when a first-paint
// chunk holds wallet code: docs ship none.
// Usage: node scripts/measure.mjs [baseUrl] [--json]
import { measureCli } from "@matchbox/perf/measure"
import { docsRoutes } from "./routes.mjs"

if (!process.argv.some((arg) => arg.startsWith("http"))) {
  process.argv.push("http://localhost:4183")
}

await measureCli({
  routes: docsRoutes,
  budgetKb: 120,
  chunkModulesFile: new URL("../dist/chunk-modules.json", import.meta.url),
})
