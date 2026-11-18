import { dataUriBytes, fetchPicture, type PictureFetch } from "./assets"
import type { CardAssets } from "./cards"
import {
  clockEpoch,
  loadDefault,
  loadGauge,
  loadProtocol,
  type Sources,
} from "./data"
import fallbackPng from "./fallback.png?inline"
import type { Card } from "./model"

/**
 * The link preview images: `/og/default.png`, `/og/gauge/<address>.png`
 * and `/og/protocol/<n>.png` (or `latest`). Each is cached for the hour in
 * the Cache API, keyed by path, hour and epoch, and never fails: missing
 * figures fall back to the default card, a failed render to a bundled
 * brand card. Dependencies are passed in so tests run it without a Worker.
 */

export type OgTarget =
  | { kind: "default" }
  | { kind: "gauge"; address: string }
  | { kind: "protocol"; epoch: number | null }

export function ogTarget(pathname: string): OgTarget | null {
  if (pathname === "/og/default.png") return { kind: "default" }
  const gauge = /^\/og\/gauge\/(0x[0-9a-fA-F]{40})\.png$/.exec(pathname)
  if (gauge?.[1] !== undefined) {
    return { kind: "gauge", address: gauge[1].toLowerCase() }
  }
  const protocol = /^\/og\/protocol\/(latest|\d{1,6})\.png$/.exec(pathname)
  if (protocol?.[1] !== undefined) {
    return {
      kind: "protocol",
      epoch: protocol[1] === "latest" ? null : Number(protocol[1]),
    }
  }
  return null
}

export type Render = (card: Card, assets: CardAssets) => Promise<Uint8Array>

export type ImageDeps = {
  sources: Sources
  render: Render
  fetch: PictureFetch
  cache: Pick<Cache, "match" | "put"> | null
  waitUntil: (promise: Promise<unknown>) => void
  log: (entry: { message: string; path: string; error: string }) => void
}

/** Max age for a card with live figures, and for a fallback. */
export const freshSeconds = 3600
export const fallbackSeconds = 300

type Resolved =
  | { card: Card; degraded: boolean }
  /** No such gauge or epoch: one cached default image serves them all. */
  | { redirect: string }

async function resolve(target: OgTarget, sources: Sources): Promise<Resolved> {
  if (target.kind === "default") {
    const card = await loadDefault(sources)
    return { card, degraded: card.incentivesUsd === null }
  }
  try {
    const card =
      target.kind === "gauge"
        ? await loadGauge(sources, target.address)
        : await loadProtocol(sources, target.epoch)
    if (card !== null) return { card, degraded: false }
    return {
      redirect:
        target.kind === "protocol" && target.epoch !== null
          ? "/og/protocol/latest.png"
          : "/og/default.png",
    }
  } catch {
    // The API failed: the default card, from whatever still loads.
    return { card: await loadDefault(sources), degraded: true }
  }
}

function png(bytes: Uint8Array, maxAge: number): Response {
  return new Response(bytes.slice(), {
    headers: {
      "content-type": "image/png",
      "cache-control": `public, max-age=${maxAge}`,
    },
  })
}

let fallback: ArrayBuffer | null = null

/** The bundled brand card, for when rendering itself fails. */
function fallbackImage(): Response {
  fallback ??= dataUriBytes(fallbackPng)
  return png(new Uint8Array(fallback), fallbackSeconds)
}

async function render(
  resolved: { card: Card; degraded: boolean },
  host: string,
  deps: ImageDeps,
): Promise<Response> {
  const { card } = resolved
  const picture =
    card.kind === "gauge" && card.picture.kind === "image"
      ? await fetchPicture(card.picture.url, deps.fetch)
      : null
  const image = await deps.render(card, { host, picture })
  return png(image, resolved.degraded ? fallbackSeconds : freshSeconds)
}

/** HEAD gets the same answer without the body. */
function forMethod(request: Request, response: Response): Response {
  if (request.method !== "HEAD") return response
  return new Response(null, {
    status: response.status,
    headers: response.headers,
  })
}

export async function ogImage(
  request: Request,
  deps: ImageDeps,
): Promise<Response> {
  const url = new URL(request.url)
  const target = ogTarget(url.pathname)
  if (target === null) return new Response("Not found", { status: 404 })
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed", {
      status: 405,
      headers: { allow: "GET, HEAD" },
    })
  }
  const hour = Math.floor(deps.sources.nowSeconds / 3600)
  const key = new Request(
    `${url.origin}${url.pathname}?hour=${hour}&epoch=${clockEpoch(deps.sources)}`,
  )
  const cached = await deps.cache?.match(key).catch(() => undefined)
  if (cached !== undefined) return forMethod(request, cached)

  let response: Response
  try {
    const resolved = await resolve(target, deps.sources)
    if ("redirect" in resolved) {
      return new Response(null, {
        status: 302,
        headers: {
          location: resolved.redirect,
          "cache-control": `public, max-age=${freshSeconds}`,
        },
      })
    }
    response = await render(resolved, url.host, deps)
  } catch (error) {
    deps.log({
      message: "og render failed",
      path: url.pathname,
      error: error instanceof Error ? error.message : String(error),
    })
    response = fallbackImage()
  }
  if (deps.cache !== null) {
    deps.waitUntil(deps.cache.put(key, response.clone()).catch(() => undefined))
  }
  return forMethod(request, response)
}
