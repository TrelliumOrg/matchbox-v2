import { env } from "cloudflare:workers"
import { baseSecurityHeaders } from "@matchbox/app-kit/security"
import handler, { createServerEntry } from "@tanstack/react-start/server-entry"
import results from "../data/results.json"
import { parseResults } from "./data/schema"

/**
 * The Matchbench Worker. Every page is static HTML written at build time and
 * served by the asset layer before this Worker runs, so in production it
 * only sees requests that match no asset and are not navigations (a
 * navigation miss gets 404.html from the asset layer). It answers those
 * with the static not-found page and never renders: TanStack Start renders
 * only for the build's prerender crawler (which sends this build's token)
 * and in `vite dev`. `x-bench-worker` marks every response it makes, so the
 * end to end tests can prove a page view never reached it.
 */

const prerenderHeader = "x-bench-prerender"

function mayRender(request: Request): boolean {
  if (import.meta.env.DEV) return true
  return (
    __BENCH_PRERENDER_TOKEN__ !== "" &&
    request.headers.get(prerenderHeader) === __BENCH_PRERENDER_TOKEN__
  )
}

async function notFound(request: Request): Promise<Response> {
  const page = await env.ASSETS.fetch(new URL("/404.html", request.url))
  const headers = new Headers({
    "content-type": "text/html; charset=utf-8",
    "cache-control": "public, max-age=0, must-revalidate",
    "x-bench-worker": "not-found",
  })
  for (const [name, value] of Object.entries(baseSecurityHeaders)) {
    headers.set(name, value)
  }
  headers.set(
    "content-security-policy",
    "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
  )
  return new Response(request.method === "HEAD" ? null : page.body, {
    status: 404,
    headers,
  })
}

/**
 * The results file is checked against the schema (the runner's contract and
 * the page's own cross-checks) before the first render. The prerender is
 * the only caller, so a bad file fails the build with the schema's message.
 */
let checked = false

function checkResults(): void {
  if (checked) return
  parseResults(results)
  checked = true
}

export default createServerEntry({
  async fetch(request) {
    if (!mayRender(request)) return notFound(request)
    checkResults()
    const response = await handler.fetch(request)
    const headers = new Headers(response.headers)
    headers.set("x-bench-worker", "render")
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    })
  },
})
