// Lighthouse CI for the homepage: LCP under 1.2s (mobile, simulated), CLS 0,
// with the fixture figures. warm: the preview renders the page twice before
// the runs, so no run measures the first server-side module evaluation.
const { lighthouseConfig } = require("@matchbox/perf/lighthouse")

module.exports = lighthouseConfig({
  paths: ["/"],
  lcpMs: 1200,
  proxyPort: 4194,
  previewPort: 4193,
  warm: true,
})
