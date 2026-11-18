// Lighthouse CI for the docs: LCP under 1.2s (mobile, simulated), CLS 0, on
// home, a long guide and an API operation. Docs use ports 4183 and 4184 so
// they never collide with the other apps' previews.
const { lighthouseConfig } = require("@matchbox/perf/lighthouse")
const { lighthouseRoutes } = require("./scripts/routes.mjs")

module.exports = lighthouseConfig({
  paths: lighthouseRoutes,
  lcpMs: 1200,
  proxyPort: 4184,
  previewPort: 4183,
})
