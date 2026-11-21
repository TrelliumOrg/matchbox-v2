// After `vite build` has prerendered every page into dist/client:
//
// 1. 404.html becomes a page with no framework JavaScript. The asset layer
//    serves it for every missing path, where the router would otherwise
//    hydrate against a URL it was not rendered for. A small inline script
//    fills in the path and the likely pages from the search index.
// 2. Every HTML file gets a <meta> Content-Security-Policy whose script-src
//    lists the SHA-256 of each inline script on that page and nothing else
//    inline: no 'unsafe-inline', no 'unsafe-eval'. public/_headers adds the
//    directives a meta tag cannot carry (frame-ancestors). connect-src adds
//    Stuart's origin when the build has one, for "Ask about this page".
//    script-src also names Cloudflare's Web Analytics beacon, which the
//    zone injects into every page as it is served (see cloudflareBeacon).
// 3. The link checker: every same-site link and fragment in the built HTML
//    must land on a file, a page or a redirect rule, and the fragment must
//    be an id on the target page. A miss fails the build.
// 4. Every page must be whole without JavaScript: a Suspense boundary that
//    was still pending when the prerenderer flushed leaves its content in
//    a hidden <div id="S:n"> that only an inline script reveals. Any page
//    with one fails the build.
//
// Usage: node scripts/postbuild.mjs [--check-only]
import { createHash } from "node:crypto"
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import { feedbackOrigin, turnstileOrigin } from "./feedback-origin.mjs"
import { stuartOrigin } from "./stuart-origin.mjs"

const root = fileURLToPath(new URL("../dist/client/", import.meta.url))
const checkOnly = process.argv.includes("--check-only")
const stuart = stuartOrigin()
const feedback = feedbackOrigin()

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

// The not-found page, without the router: fills itself in from the URL.
const notFoundScript = `(function(){try{var p=location.pathname,w=p.split(/[\\/_.-]+/).filter(function(x){return x&&x!=="docs"});var m=document.querySelector("[data-missing-path]");if(m&&p!=="/404"){m.textContent="Nothing lives at ";var c=document.createElement("code");c.className="font-mono text-ink2";c.textContent=p;m.appendChild(c)}var q=document.querySelector("[data-search-query]");if(q&&w.length){q.textContent=w.join(" ");q.className="flex-1 text-ink"}var b=document.querySelector("[data-search-trigger]");if(b)b.addEventListener("click",function(){location.href="/?q="+encodeURIComponent(w.join(" "))});if(!w.length)return;fetch("/search-index.json").then(function(r){return r.json()}).then(function(ix){var hits=[];ix.entries.forEach(function(e){if(e.k==="heading")return;var t=(e.t+" "+e.w).toLowerCase(),s=0;w.forEach(function(x){x=x.toLowerCase();if(e.t.toLowerCase().indexOf(x)>=0)s+=10;else if(t.indexOf(x)>=0)s+=1});if(s>0)hits.push({e:e,s:s})});hits.sort(function(a,b){return b.s-a.s});var box=document.querySelector("[data-likely]"),ul=box&&box.querySelector("ul");if(!ul||!hits.length)return;hits.slice(0,3).forEach(function(h){var li=document.createElement("li"),a=document.createElement("a");a.href=h.e.u;a.className="-mx-3 flex items-center gap-4 rounded-[20px] px-3 py-3 outline-none hover:bg-soft focus-visible:outline-2 focus-visible:outline-ink";var t=document.createElement("span");t.className="min-w-0 flex-1";var a1=document.createElement("span");a1.className="block text-base font-semibold text-ink";a1.textContent=h.e.t;var a2=document.createElement("span");a2.className="block text-[14.5px] text-sec";a2.textContent=h.e.p;t.appendChild(a1);t.appendChild(a2);a.appendChild(t);li.appendChild(a);ul.appendChild(li)});box.hidden=false})}catch(e){}})()`

/** Keeps the pre-paint theme and platform scripts, drops the router's. */
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
    .replace("</body>", `<script>${notFoundScript}</script></body>`)
}

function hash(text) {
  return `'sha256-${createHash("sha256").update(text, "utf8").digest("base64")}'`
}

/**
 * Cloudflare Web Analytics: the zone adds
 * `<script type="module" src="https://static.cloudflareinsights.com/beacon.min.js/…">`
 * before </body> of every page it serves, with no nonce (this policy has
 * none to copy). The beacon reports to the page's own origin
 * (`/cdn-cgi/rum`), which connect-src 'self' already covers, so only its
 * script host is named.
 */
const cloudflareBeacon = "https://static.cloudflareinsights.com"

function contentSecurityPolicy(hashes) {
  return [
    "default-src 'self'",
    // Turnstile's script, for the feedback panel's check (no
    // 'strict-dynamic' here, so its host is named), and the beacon's.
    `script-src 'self' ${cloudflareBeacon}${feedback === null ? "" : ` ${turnstileOrigin}`} ${hashes.join(" ")}`.trim(),
    // Inline style attributes (React style props): styles cannot run code.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    // Stuart first: the e2e reads it as connect-src's second source.
    `connect-src 'self'${stuart === null ? "" : ` ${stuart}`}${feedback === null ? "" : ` ${feedback} ${turnstileOrigin}`}`,
    ...(feedback === null ? [] : [`frame-src ${turnstileOrigin}`]),
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
  ].join("; ")
}

const problems = []
let scripts = 0

if (!checkOnly) {
  for (const file of htmlFiles) {
    let html = readFileSync(file, "utf8")
    if (file.endsWith(`${join("", "404.html")}`) && pathOf(file) === "/404") {
      html = staticNotFound(html)
    }
    html = html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, "")
    const hashes = [
      ...new Set(
        [...html.matchAll(inlineScript)].map((match) => hash(match[2])),
      ),
    ]
    scripts += hashes.length
    if (/\son[a-z]+="/i.test(html))
      problems.push(`${pathOf(file)}: inline event handler`)
    const meta = `<meta http-equiv="Content-Security-Policy" content="${contentSecurityPolicy(hashes)}">`
    if (!/<head[^>]*>/.test(html)) problems.push(`${pathOf(file)}: no <head>`)
    html = html.replace(/<head([^>]*)>/, `<head$1>${meta}`)
    writeFileSync(file, html)
  }
}

// The link checker.
const pages = new Map()
for (const file of htmlFiles)
  pages.set(pathOf(file), readFileSync(file, "utf8"))

// Whole without JavaScript: no boundary left pending at the flush.
const pendingBoundary = /<!--\$\?-->|<div hidden id="S:|\$RC\(/
for (const [path, html] of pages) {
  if (pendingBoundary.test(html)) {
    problems.push(`${path}: content behind a pending Suspense boundary`)
  }
}
const assets = new Set(
  files.map((file) => `/${relative(root, file).replaceAll("\\", "/")}`),
)
const redirects = readFileSync(join(root, "_redirects"), "utf8")
  .split("\n")
  .filter((line) => line.trim() !== "" && !line.startsWith("#"))
  .map((line) => line.trim().split(/\s+/)[0])

function idsOf(html) {
  return new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]))
}

function redirected(path) {
  return redirects.some((from) =>
    from.endsWith("*") ? path.startsWith(from.slice(0, -1)) : from === path,
  )
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
      if (!assets.has(path) && !redirected(path))
        problems.push(`${from}: broken link ${href}`)
      continue
    }
    if (
      fragment !== undefined &&
      fragment !== "" &&
      fragment !== "top" &&
      !idsOf(target).has(fragment)
    ) {
      problems.push(`${from}: no #${fragment} on ${path}`)
    }
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
