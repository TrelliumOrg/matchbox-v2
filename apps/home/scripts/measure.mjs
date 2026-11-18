// Initial JS of the homepage in brotli, against a running preview
// (`pnpm preview`, port 4193). Fails over 120 kB, when a first-paint chunk
// holds wallet code (wagmi, viem, WalletConnect: the page has none), when
// the page's loaders take longer than 250 ms on an uncached render
// (Server-Timing `loader`), or when the page's own HTML is over 40 kB
// brotli.
// Usage: node scripts/measure.mjs [baseUrl] [--json]
import { measureCli } from "@matchbox/perf/measure"

// The homepage previews on 4193, not the shared default of 4173.
if (!process.argv.some((arg) => arg.startsWith("http"))) {
  process.argv.push("http://localhost:4193")
}

await measureCli({
  routes: ["/"],
  budgetKb: 120,
  loaderBudgetMs: 250,
  htmlBudgetKb: 40,
  chunkModulesFile: new URL("../dist/chunk-modules.json", import.meta.url),
})
