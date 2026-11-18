// Initial JS per console route in brotli, against a running preview on the
// memory store (`pnpm preview` with .dev.vars from the example). Fails over
// 120 kB, or when a first-paint chunk holds wallet code (by module, from the
// build's dist/chunk-modules.json). Signed-in pages are measured signed in:
// the memory store's dev sign-in (a 404 outside memory mode) gives the
// cookie, otherwise every route would measure the sign-in page it
// redirects to.
// Usage: node scripts/measure.mjs [baseUrl] [--json]
import { readFileSync } from "node:fs"
import { measure } from "@matchbox/perf/measure"

const budgetKb = 120
const base =
  process.argv.find((arg) => arg.startsWith("http")) ?? "http://localhost:5175"
const asJson = process.argv.includes("--json")
const chunkModules = JSON.parse(
  readFileSync(new URL("../dist/chunk-modules.json", import.meta.url), "utf8"),
)

const signedIn = await fetch(`${base}/api/auth/dev-sign-in`, {
  method: "POST",
  headers: { origin: base },
})
if (!signedIn.ok) {
  throw new Error(`dev sign-in answered ${signedIn.status}; memory store?`)
}
const cookie = signedIn.headers
  .getSetCookie()
  .map((value) => value.split(";")[0])
  .join("; ")

async function read(path) {
  const response = await fetch(`${base}${path}`, { headers: { cookie } })
  if (!response.ok) throw new Error(`${path} answered ${response.status}`)
  return response.json()
}

const me = await read("/api/me")
const org = me.organizations[0].id
const apps = (await read(`/api/orgs/${org}/apps`)).data
const app = apps.find((entry) => entry.name === "Gauge Board") ?? apps[0]
const reviews = (await read("/api/admin/reviews")).data

const signedOutRoutes = ["/sign-in", "/invite/measure"]
const signedInRoutes = [
  "/",
  "/apps",
  "/usage",
  "/organization",
  "/account",
  ...["environment", "keys", "secrets", "oauth", "usage", "settings"].map(
    (tab) => `/apps/${app.id}?env=live&tab=${tab}`,
  ),
  "/admin",
  ...(reviews[0] === undefined ? [] : [`/admin/reviews/${reviews[0].id}`]),
  "/admin/apps",
  "/admin/quotas",
  "/admin/audit",
]

const withCookie = (url, init = {}) =>
  fetch(url, { ...init, headers: { ...init.headers, cookie } })

const results = [
  ...(await measure({ base, routes: signedOutRoutes, budgetKb, chunkModules })),
  ...(await measure({
    base,
    routes: signedInRoutes,
    budgetKb,
    chunkModules,
    fetch: withCookie,
  })),
]

if (asJson) {
  console.log(JSON.stringify(results, null, 2))
} else {
  for (const result of results) {
    console.log(
      `${result.brotliKb.toFixed(2).padStart(7)} kB br  ${result.gzipKb.toFixed(2).padStart(7)} kB gz  ${result.status}  ${result.wallet ? "WALLET " : ""}${result.over ? "OVER " : ""}${result.route.replace(app.id, "{app}")}`,
    )
  }
  console.log(`budget ${budgetKb} kB brotli per route`)
}
if (results.some((result) => result.over)) process.exitCode = 1
