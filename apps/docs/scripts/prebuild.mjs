// Assembles the folder Vite publishes as static assets (dist/public, set as
// `publicDir` in vite.config.ts): the app's own files in public/
// (favicon.svg, _headers) plus everything packages/docs builds for the site
// (search index, llms.txt, sitemap, robots, _redirects, Markdown copies,
// openapi.json). It lives under dist/, which git and Prettier ignore, so
// generated files never mix with source.
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs"
import { fileURLToPath } from "node:url"

const site = fileURLToPath(
  new URL("../../../packages/docs/dist/site/", import.meta.url),
)
const own = fileURLToPath(new URL("../public/", import.meta.url))
const target = fileURLToPath(new URL("../dist/public/", import.meta.url))

if (!existsSync(site)) {
  console.error(
    "packages/docs/dist/site is missing: build @matchbox/docs first",
  )
  process.exit(1)
}
rmSync(target, { recursive: true, force: true })
mkdirSync(target, { recursive: true })
cpSync(site, target, { recursive: true })
cpSync(own, target, { recursive: true })
console.log("assembled dist/public from public/ and packages/docs")
