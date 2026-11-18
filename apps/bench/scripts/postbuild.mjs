// After `vite build` has prerendered every page into dist/client:
//
// 1. 404.html loses its framework JavaScript. The asset layer serves it for
//    every missing path, where the router would otherwise hydrate against a
//    URL it was not rendered for.
// 2. Every HTML file gets a <meta> Content-Security-Policy whose script-src
//    lists the SHA-256 of each inline script on that page and nothing else
//    inline. connect-src is 'self' only: the site calls no API.
//    public/_headers adds what a meta tag cannot carry (frame-ancestors).
// 3. The link checker: every same-site link and fragment in the built HTML
//    must land on a file or a page, and the fragment must be an id there.
// 4. Every page must be whole without JavaScript: no Suspense boundary left
//    pending when the prerenderer flushed.
//
// Usage: node scripts/postbuild.mjs
import { createHash } from "node:crypto"
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import { isSample, withRobotsHeader } from "./robots.mjs"
import { benchRoutes } from "./routes.mjs"

const root = fileURLToPath(new URL("../dist/client/", import.meta.url))

function walk(directory) {
  const files = []
  for (const name of readdirSync(directory)) {
    const full = join(directory, name)
    if (statSync(full).isDirectory()) files.push(...walk(full))
    else files.push(full)
  }
  return files
}

const files = walk(root)
const htmlFiles = files.filter((file) => file.endsWith(".html"))

/** The URL path a built file answers (drop-trailing-slash html handling). */
function pathOf(file) {
  const rel = `/${relative(root, file).replaceAll("\\", "/")}`
  if (rel === "/index.html") return "/"
  if (rel.endsWith("/index.html")) return rel.slice(0, -"/index.html".length)
  if (rel.endsWith(".html")) return rel.slice(0, -".html".length)
  return rel
}

const inlineScript = /<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/g

/** Keeps the pre-paint theme script, drops the router's. */
function staticNotFound(html) {
  return html
    .replace(/<link[^>]*rel="modulepreload"[^>]*>/g, "")
    .replace(
      /<script\b([^>]*)>([\s\S]*?)<\/script>/g,
      (element, attributes, body) => {
        const router =
          /\bsrc=|type="module"|data-tsr/.test(attributes) ||
          body.includes("$_TSR") ||
          body.includes("import(")
        return router ? "" : element
      },
    )
}

function hash(text) {
  return `'sha256-${createHash("sha256").update(text, "utf8").digest("base64")}'`
}

function contentSecurityPolicy(hashes) {
  return [
    "default-src 'self'",
    `script-src 'self' ${hashes.join(" ")}`.trim(),
    // Inline style attributes (React style props): styles cannot run code.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ")
}

const problems = []
let scripts = 0

// noindex while the results file is a sample: the header here, the meta in
// the page head (src/data/site.ts).
const sample = isSample(
  JSON.parse(
    readFileSync(new URL("../data/results.json", import.meta.url), "utf8"),
  ),
)
const headersFile = join(root, "_headers")
writeFileSync(
  headersFile,
  withRobotsHeader(readFileSync(headersFile, "utf8"), sample),
)
for (const file of htmlFiles) {
  const noindex = /<meta name="robots" content="noindex"/.test(
    readFileSync(file, "utf8"),
  )
  if (sample && !noindex)
    problems.push(`${pathOf(file)}: sample without noindex`)
  if (!sample && noindex && pathOf(file) !== "/404")
    problems.push(`${pathOf(file)}: noindex on a real run`)
}

for (const file of htmlFiles) {
  let html = readFileSync(file, "utf8")
  if (pathOf(file) === "/404") html = staticNotFound(html)
  html = html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, "")
  const hashes = [
    ...new Set([...html.matchAll(inlineScript)].map((match) => hash(match[2]))),
  ]
  scripts += hashes.length
  if (/\son[a-z]+="/i.test(html))
    problems.push(`${pathOf(file)}: inline event handler`)
  if (!/<head[^>]*>/.test(html)) problems.push(`${pathOf(file)}: no <head>`)
  const meta = `<meta http-equiv="Content-Security-Policy" content="${contentSecurityPolicy(hashes)}">`
  html = html.replace(/<head([^>]*)>/, `<head$1>${meta}`)
  writeFileSync(file, html)
}

const pages = new Map()
for (const file of htmlFiles)
  pages.set(pathOf(file), readFileSync(file, "utf8"))

for (const route of [...benchRoutes, "/404"]) {
  if (!pages.has(route)) problems.push(`${route}: not prerendered`)
}

const pendingBoundary = /<!--\$\?-->|<div hidden id="S:|\$RC\(/
for (const [path, html] of pages) {
  if (pendingBoundary.test(html))
    problems.push(`${path}: content behind a pending Suspense boundary`)
}

const assets = new Set(
  files.map((file) => `/${relative(root, file).replaceAll("\\", "/")}`),
)

function idsOf(html) {
  return new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]))
}

let checked = 0
for (const [from, html] of pages) {
  for (const match of html.matchAll(/\shref="([^"]+)"/g)) {
    const href = match[1].replaceAll("&amp;", "&")
    if (/^(https?:|mailto:|data:)/.test(href)) continue
    checked += 1
    const [rawPath, fragment] = href.split("#")
    const path = (rawPath === "" ? from : rawPath.split("?")[0]).replace(
      /(.)\/$/,
      "$1",
    )
    const target = pages.get(path)
    if (target === undefined) {
      if (!assets.has(path)) problems.push(`${from}: broken link ${href}`)
      continue
    }
    if (
      fragment !== undefined &&
      fragment !== "" &&
      !idsOf(target).has(fragment)
    )
      problems.push(`${from}: no #${fragment} on ${path}`)
  }
}

if (problems.length > 0) {
  for (const problem of [...new Set(problems)]) console.error(problem)
  console.error(`${problems.length} problems in the built site`)
  process.exit(1)
}
console.log(
  `postbuild: ${htmlFiles.length} pages, ${scripts} inline scripts hashed, ${checked} links checked`,
)
