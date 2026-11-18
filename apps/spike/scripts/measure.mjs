// Measures a running preview: initial JS per route (gzip) and SSR streaming.
// Usage: node scripts/measure.mjs [baseUrl]
import { brotliCompressSync, gzipSync } from "node:zlib"

const base = process.argv[2] ?? "http://localhost:4173"
const routes = ["/", "/gauge/1"]
const walletMarkers = ["wagmi", "WagmiProvider", "injected", "createConfig"]

async function timedFetch(url) {
  const start = performance.now()
  const response = await fetch(url, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0 Mobile Safari/537.36",
    },
  })
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  const chunks = []
  let html = ""
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    const text = decoder.decode(value, { stream: true })
    chunks.push({
      at: Math.round(performance.now() - start),
      bytes: value.length,
    })
    html += text
  }
  return { html, chunks, status: response.status }
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
  // Start also emits dynamic imports of the entry inside inline scripts.
  for (const match of html.matchAll(/import\(["']([^"']+\.js)["']\)/g))
    urls.add(match[1])
  return [...urls]
}

function inlineScripts(html) {
  return [
    ...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g),
  ].map((m) => m[1])
}

for (const route of routes) {
  const { html, chunks, status } = await timedFetch(base + route)
  const urls = assetUrls(html)
  let total = 0
  let totalBrotli = 0
  const rows = []
  let walletLeak = false
  for (const url of urls) {
    const body = await (await fetch(new URL(url, base))).text()
    const gz = gzipSync(body, { level: 9 }).length
    total += gz
    totalBrotli += brotliCompressSync(body).length
    rows.push([url, (gz / 1024).toFixed(2)])
    if (walletMarkers.some((marker) => body.includes(marker))) walletLeak = true
  }
  const inline = inlineScripts(html).join("")
  const inlineGz = gzipSync(inline, { level: 9 }).length
  console.log(`\n${route} (HTTP ${status})`)
  for (const [url, kb] of rows) console.log(`  ${kb.padStart(7)} kB  ${url}`)
  console.log(
    `  ${(inlineGz / 1024).toFixed(2).padStart(7)} kB  inline scripts`,
  )
  console.log(
    `  ${((total + inlineGz) / 1024).toFixed(2).padStart(7)} kB  total initial JS (gzip -9)`,
  )
  console.log(
    `  ${(totalBrotli / 1024).toFixed(2).padStart(7)} kB  external JS (brotli, as Cloudflare serves it)`,
  )
  console.log(`  wallet code in initial JS: ${walletLeak ? "YES" : "no"}`)
  console.log(
    `  HTML chunks (ms, bytes): ${chunks.map((c) => `${c.at}:${c.bytes}`).join(" ")}`,
  )
}
