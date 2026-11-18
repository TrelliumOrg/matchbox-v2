// Lighthouse CI for Matchscan: LCP under 1.2s (mobile, simulated), CLS 0, on
// the routes that read the Blockscout proxy (recorded fixtures) and Home.
// warm: the preview renders every path twice before the runs, so no run
// measures a route's first server-side module evaluation (visitors meet a
// warm Worker).
const { lighthouseConfig } = require("@matchbox/perf/lighthouse")
const { lighthouseRoutes } = require("./scripts/routes.mjs")

module.exports = lighthouseConfig({
  paths: lighthouseRoutes,
  lcpMs: 1200,
  warm: true,
})
