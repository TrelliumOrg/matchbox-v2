// Lighthouse CI for Matchbench: LCP under 1.2s (mobile, simulated) and CLS
// 0 on every page. Ports 4203 and 4204 keep it clear of the other apps'
// previews.
const { lighthouseConfig } = require("@matchbox/perf/lighthouse")

module.exports = lighthouseConfig({
  paths: ["/", "/questions", "/method", "/runs"],
  lcpMs: 1200,
  proxyPort: 4204,
  previewPort: 4203,
})
