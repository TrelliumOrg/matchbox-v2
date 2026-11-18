// Initial JS per route, in brotli (what Cloudflare serves), against a running
// preview. Fails when a route is over budget or ships wallet code. Copied
// from apps/pro/scripts/measure.mjs with the routes and budget as options.
import { readFileSync } from "node:fs"
import { brotliCompressSync, constants, gzipSync } from "node:zlib"
import { firstPaintViolations } from "./first-paint.mjs"

export const defaultBudgetKb = 120

/**
 * A page's HTML in brotli at quality 5, as the edge (and the compressing
 * proxy Lighthouse loads through) sends it, in bytes.
 */
export function htmlBrotli(/** @type {string} */ html) {
  return brotliCompressSync(html, {
    params: { [constants.BROTLI_PARAM_QUALITY]: 5 },
  }).length
}
export const defaultWalletMarkers = [
  "WagmiProvider",
  "createConfig({",
  "walletconnect",
]
const browser =
  "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0 Mobile Safari/537.36"

function brotli(body) {
  return brotliCompressSync(body, {
    params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
  }).length
}

/** Every script the page loads before any interaction. */
export function assetUrls(html) {
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

/**
 * The duration of one Server-Timing metric (`loader;dur=12.5`), or null
 * when the header does not carry it.
 */
export function serverTiming(header, name) {
  if (header === null || header === undefined) return null
  for (const entry of header.split(",")) {
    const [metric, ...params] = entry.trim().split(";")
    if (metric?.trim() !== name) continue
    for (const param of params) {
      const [key, value] = param.trim().split("=")
      if (key === "dur" && value !== undefined) {
        const ms = Number(value)
        return Number.isFinite(ms) ? ms : null
      }
    }
  }
  return null
}

/**
 * The route with a query no one else asks for, so the page cache misses
 * and the server runs the route's loaders.
 */
export function uncached(route, run) {
  const url = new URL(route, "http://measure.invalid")
  url.searchParams.set("_perf", String(run))
  return url.pathname + url.search
}

export function inlineScripts(html) {
  return [
    ...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g),
  ].map((match) => match[1])
}

/**
 * Measures each route. Options: `base` (preview URL), `routes`, `budgetKb`
 * (brotli, default 120), `chunkModules` (the build's chunk to modules map,
 * from chunkModules in ./vite.ts: the wallet check), `walletMarkers` (text
 * that also means wallet code, a second check), `loaderBudgetMs` (the
 * slowest a route's loaders may take, read from the page's
 * `Server-Timing: loader;dur=` on an uncached request; a route without the
 * metric fails rather than passing unmeasured), `htmlBudgetKb` (the
 * largest the page's own HTML may be in brotli, quality 5: a page that
 * renders a whole production list at once fails it), `fetch` (for tests).
 */
export async function measure({
  base = "http://localhost:4173",
  routes,
  budgetKb = defaultBudgetKb,
  chunkModules,
  walletMarkers = defaultWalletMarkers,
  loaderBudgetMs = /** @type {number | undefined} */ (undefined),
  htmlBudgetKb = /** @type {number | undefined} */ (undefined),
  fetch: fetcher = fetch,
}) {
  if (chunkModules === undefined || chunkModules === null) {
    throw new Error("measure needs the build's chunk modules map")
  }
  const results = []
  let run = 0
  for (const route of routes) {
    const response = await fetcher(base + route, {
      headers: { "user-agent": browser },
    })
    const html = await response.text()
    let br = 0
    let gz = 0
    let wallet = false
    const files = []
    const urls = assetUrls(html)
    const violations = firstPaintViolations(
      chunkModules,
      urls.filter((url) => url.endsWith(".js")),
    )
    if (violations.length > 0) wallet = true
    for (const url of urls) {
      const body = await (await fetcher(new URL(url, base))).text()
      const size = brotli(body)
      br += size
      gz += gzipSync(body, { level: 9 }).length
      files.push({ url, brotliKb: +(size / 1024).toFixed(2) })
      if (walletMarkers.some((marker) => body.includes(marker))) wallet = true
    }
    const inline = inlineScripts(html).join("\n")
    br += brotli(inline)
    gz += gzipSync(inline, { level: 9 }).length
    const brotliKb = +(br / 1024).toFixed(2)
    let loaderMs = null
    if (loaderBudgetMs !== undefined) {
      run += 1
      const timed = await fetcher(
        base + uncached(route, `${Date.now()}-${run}`),
        {
          headers: { "user-agent": browser },
        },
      )
      await timed.text()
      loaderMs = serverTiming(timed.headers.get("server-timing"), "loader")
    }
    const slow =
      loaderBudgetMs !== undefined &&
      (loaderMs === null || loaderMs > loaderBudgetMs)
    const htmlKb = +(htmlBrotli(html) / 1024).toFixed(2)
    const heavy = htmlBudgetKb !== undefined && htmlKb > htmlBudgetKb
    results.push({
      route,
      status: response.status,
      brotliKb,
      gzipKb: +(gz / 1024).toFixed(2),
      htmlKb,
      heavy,
      wallet,
      violations,
      loaderMs,
      slow,
      over:
        brotliKb > budgetKb ||
        wallet ||
        slow ||
        heavy ||
        response.status !== 200,
      files,
    })
  }
  return results
}

function htmlText(result, htmlBudgetKb) {
  if (htmlBudgetKb === undefined) return ""
  return `${result.htmlKb.toFixed(2).padStart(6)} kB html${result.heavy ? " HEAVY" : ""}  `
}

function loaderText(result, loaderBudgetMs) {
  if (loaderBudgetMs === undefined) return ""
  const ms =
    result.loaderMs === null
      ? "   no timing"
      : `${String(Math.round(result.loaderMs)).padStart(5)} ms loader`
  return `${ms}${result.slow ? " SLOW" : ""}  `
}

/**
 * The command line, `node scripts/measure.mjs [baseUrl] [--json]`, for an
 * app script that passes its routes and the build's chunk modules file.
 * A missing file fails: without it the wallet check could not run.
 */
export async function measureCli({
  routes,
  budgetKb = defaultBudgetKb,
  loaderBudgetMs = /** @type {number | undefined} */ (undefined),
  htmlBudgetKb = /** @type {number | undefined} */ (undefined),
  chunkModulesFile,
}) {
  const base =
    process.argv.find((arg) => arg.startsWith("http")) ??
    "http://localhost:4173"
  const asJson = process.argv.includes("--json")
  const chunkModules = JSON.parse(readFileSync(chunkModulesFile, "utf8"))
  const results = await measure({
    base,
    routes,
    budgetKb,
    loaderBudgetMs,
    htmlBudgetKb,
    chunkModules,
  })
  if (asJson) {
    console.log(JSON.stringify(results, null, 2))
  } else {
    for (const result of results) {
      console.log(
        `${result.brotliKb.toFixed(2).padStart(7)} kB br  ${result.gzipKb.toFixed(2).padStart(7)} kB gz  ${htmlText(result, htmlBudgetKb)}${loaderText(result, loaderBudgetMs)}${result.status}  ${result.wallet ? "WALLET " : ""}${result.route}`,
      )
      const grouped = new Map()
      for (const violation of result.violations) {
        const key = `${violation.rule} in ${violation.file}`
        const seen = grouped.get(key)
        grouped.set(key, {
          count: (seen?.count ?? 0) + 1,
          first: seen?.first ?? violation.module,
        })
      }
      for (const [key, { count, first }] of grouped) {
        console.log(
          `        ${key}: ${count} module${count === 1 ? "" : "s"}${first === null ? "" : `, first ${first}`}`,
        )
      }
    }
    console.log(
      `budget ${budgetKb} kB brotli per route${htmlBudgetKb === undefined ? "" : `, HTML ${htmlBudgetKb} kB brotli`}${loaderBudgetMs === undefined ? "" : `, loaders ${loaderBudgetMs} ms`}`,
    )
  }
  if (results.some((result) => result.over)) process.exitCode = 1
  return results
}
