// Lighthouse CI config for a Matchbox frontend: mobile emulation, simulated
// throttling, three runs, behind the compressing proxy. Asserts LCP (median
// run) and CLS 0 (every run). The root lighthouserc.json Pro uses, as a
// factory. An app's lighthouserc.cjs requires this and exports the result.

/**
 * Options: `paths` (route paths), `lcpMs` (1500 for Pro, 1200 for
 * Matchscan), `proxyPort` and `previewPort` (4174 and 4173), `proxyScript`
 * (the app's compressing proxy script), `runs` (3) and `warm` (false:
 * when true the proxy requests every path before Lighthouse starts, so no
 * run measures a route's first server-side module evaluation).
 */
export function lighthouseConfig({
  paths,
  lcpMs,
  proxyPort = 4174,
  previewPort = 4173,
  proxyScript = "scripts/compressing-proxy.mjs",
  runs = 3,
  warm = false,
}) {
  const warmArg = warm ? ` --warm=${paths.join(",")}` : ""
  return {
    ci: {
      collect: {
        startServerCommand: `node ${proxyScript} ${proxyPort} ${previewPort} --with-preview${warmArg}`,
        startServerReadyPattern: "compressing proxy on",
        startServerReadyTimeout: 60000,
        url: paths.map((path) => `http://localhost:${proxyPort}${path}`),
        numberOfRuns: runs,
        settings: {
          onlyCategories: ["performance"],
          chromeFlags: "--headless=new --no-sandbox",
        },
      },
      assert: {
        assertions: {
          "largest-contentful-paint": [
            "error",
            { maxNumericValue: lcpMs, aggregationMethod: "median-run" },
          ],
          "cumulative-layout-shift": [
            "error",
            { maxNumericValue: 0, aggregationMethod: "pessimistic" },
          ],
        },
      },
      upload: { target: "filesystem", outputDir: ".lighthouseci" },
    },
  }
}
