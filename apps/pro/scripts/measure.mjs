// What a route sends before anything is tapped, in brotli (what Cloudflare
// serves), against a running preview. Two figures per route, each with its
// own limit: the script files its HTML loads, and the data inlined in the
// HTML. Fails when a route is over either, or ships wallet code.
// Usage: node scripts/measure.mjs [baseUrl] [--json]
import { brotliCompressSync, constants, gzipSync } from "node:zlib"

const base =
  process.argv.find((arg) => arg.startsWith("http")) ?? "http://localhost:4173"
const asJson = process.argv.includes("--json")

// Script files: 125 kB since 13 Nov 2026 (was 120). Measured that day from
// a sourcemap build: the chunk every route loads is 104 kB brotli, and of
// its 383 kB minified, react-dom, react and scheduler are 57% and TanStack
// router and Start 23%, neither of which we can trim; @matchbox/ui is 7%
// and Pro's own code 12%, with no file over 3.4 kB. Routes add 5 to 15 kB.
// The budget moves only with a measurement like this one that shows
// nothing of ours is left to take out, never to let a change through.
//
// Until 13 Nov 2026 this one number also counted the data inlined in the
// HTML, measured on the demo fixtures. That hid what Vote sends: the
// fixtures have about 45 gauges and mainnet 782, and Vote inlines every
// one, so the same rule read 124 kB here and 154 kB against a directory
// the size of mainnet's. The two are measured apart now. This limit is on
// code we ship; the limits below are on data.
const scriptBudgetKb = 125

// Inlined data, per route, on the demo fixtures: 8 kB. Set on 13 Nov 2026,
// when the routes measured 2.06 to 2.82 kB and Vote 5.18 kB: room for a
// route to carry a little more, not to grow by a list.
const dataBudgetKb = 8

// Vote's inlined data against a directory the size of mainnet's (782
// gauges on 13 Nov 2026, served by the fixtures when asked with the header
// below): 44.73 kB that day. The live page's own data, compressed the same
// way, was 48.18 kB, so the fixture stands in for it within a tenth. The
// limit is 47 kB, the day's figure with 5% of room: it starts at what Vote
// really sends and fails when a change adds to every gauge's record. It is
// high because Vote inlines the whole directory; a change that trims the
// record or inlines less must bring this number down with it.
const liveDataBudgetKb = 47
const liveDirectoryHeader = { "x-pro-fixture-directory": "live" }

// The demo wallet by address (clean wallet URLs, decided 9 Nov).
const viewer = "/0x7c21095156ab25e989c3c084bcb06037c6539e0b"
export const routes = [
  "/",
  viewer,
  `${viewer}/vote`,
  `${viewer}/rewards`,
  `${viewer}/activity`,
  "/protocol",
  "/gauges/0x4da4c05483324ea9cfc951510a5e77cc79541159",
]
/** Routes whose inlined data grows with the protocol: measured live-sized. */
const liveSizedRoutes = [`${viewer}/vote`]
const walletMarkers = ["WagmiProvider", "createConfig({", "walletconnect"]
const browser =
  "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0 Mobile Safari/537.36"

function brotli(body) {
  return brotliCompressSync(body, {
    params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
  }).length
}

function assetUrls(html) {
  const urls = new Set()
  for (const match of html.matchAll(/<script[^>]*\bsrc="([^"]+)"/g))
    urls.add(match[1])
  for (const match of html.matchAll(
    /<link[^>]*rel="modulepreload"[^>]*href="([^"]+)"/g,
  ))
    urls.add(match[1])
  for (const match of html.matchAll(
    /<link[^>]*href="([^"]+)"[^>]*rel="modulepreload"/g,
  ))
    urls.add(match[1])
  for (const match of html.matchAll(/import\(["']([^"']+\.js)["']\)/g))
    urls.add(match[1])
  return [...urls]
}

function inlineScripts(html) {
  return [
    ...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g),
  ].map((match) => match[1])
}

const kb = (bytes) => +(bytes / 1024).toFixed(2)

/** The data inlined in a route's HTML, brotli bytes. */
async function inlinedData(route, headers = {}) {
  const response = await fetch(base + route, {
    headers: { "user-agent": browser, ...headers },
  })
  const html = await response.text()
  return { response, html, bytes: brotli(inlineScripts(html).join("\n")) }
}

const results = []
let failed = false
for (const route of routes) {
  const { response, html, bytes: dataBytes } = await inlinedData(route)
  let br = 0
  let gz = 0
  let wallet = false
  const files = []
  for (const url of assetUrls(html)) {
    const body = await (await fetch(new URL(url, base))).text()
    const size = brotli(body)
    br += size
    gz += gzipSync(body, { level: 9 }).length
    files.push({ url, brotliKb: kb(size) })
    if (walletMarkers.some((marker) => body.includes(marker))) wallet = true
  }
  const scriptKb = kb(br)
  const dataKb = kb(dataBytes)
  // A second request for the same route with the directory at mainnet's
  // size. If it does not answer 200 its figure means nothing: fail.
  const live = liveSizedRoutes.includes(route)
    ? await inlinedData(route, liveDirectoryHeader)
    : null
  const liveDataKb = live === null ? null : kb(live.bytes)
  const liveBroken = live !== null && live.response.status !== 200
  const over =
    scriptKb > scriptBudgetKb ||
    dataKb > dataBudgetKb ||
    (liveDataKb !== null && liveDataKb > liveDataBudgetKb) ||
    wallet ||
    liveBroken ||
    response.status !== 200
  failed ||= over
  results.push({
    route,
    status: response.status,
    scriptKb,
    dataKb,
    liveDataKb,
    // Script files and fixture data together: the single figure this
    // script printed until 13 Nov 2026, kept for comparison with old runs.
    brotliKb: kb(br + dataBytes),
    gzipKb: kb(gz),
    wallet,
    over,
    files,
  })
}

if (asJson) {
  console.log(JSON.stringify(results, null, 2))
} else {
  console.log(" scripts     data  live data  route (kB brotli)")
  for (const result of results) {
    console.log(
      `${result.scriptKb.toFixed(2).padStart(8)} ${result.dataKb.toFixed(2).padStart(8)} ${(result.liveDataKb === null ? "" : result.liveDataKb.toFixed(2)).padStart(10)}  ${result.status}  ${result.wallet ? "WALLET " : ""}${result.over ? "OVER " : ""}${result.route}`,
    )
  }
  console.log(
    `limits: script files ${scriptBudgetKb} kB, inlined data ${dataBudgetKb} kB, Vote's inlined data at mainnet's size ${liveDataBudgetKb} kB`,
  )
}
if (failed) process.exitCode = 1
