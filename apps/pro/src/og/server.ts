import { waitUntil } from "cloudflare:workers"
import { createLogger } from "@matchbox/logger"
import type { z } from "zod"
import { epochReference } from "../data/inputs.server"
import { readModel } from "../data/source.server"
import { loadDefault, loadGauge, loadProtocol, type Sources } from "./data"
import { metaTags, type Page, pageFor, pageMeta } from "./meta"
import type { Card } from "./model"

/**
 * The Pro Worker's side of link previews: the `/og/*` images and the og
 * and twitter tags for each page, both from the API Worker's read models.
 * The image code and its renderer (Satori and resvg, WebAssembly) load on
 * the first image request, so pages never pay for them.
 */

const log = createLogger({ fields: { service: "matchbox-pro", area: "og" } })

function read<T>(path: string, schema: z.ZodType<T>): Promise<T | null> {
  return readModel(path, schema, true)
}

function sources(): Sources {
  return {
    read,
    reference: epochReference(),
    nowSeconds: Math.floor(Date.now() / 1000),
  }
}

export async function ogImageResponse(request: Request): Promise<Response> {
  const { ogImage } = await import("./routes")
  return ogImage(request, {
    sources: sources(),
    render: async (card, assets) =>
      (await import("./render")).renderPng(card, assets),
    // Profile pictures change rarely: the edge keeps them for a day.
    fetch: (url, init) =>
      fetch(url, { ...init, cf: { cacheEverything: true, cacheTtl: 86_400 } }),
    cache:
      typeof caches === "undefined" ? null : await caches.open("og-images"),
    waitUntil,
    log: (entry) => log.warn(entry),
  })
}

/** Cards for meta, per isolate: figures move slowly and pages are many. */
const memo = new Map<string, { at: number; card: Promise<Card | null> }>()
const memoMs = 5 * 60_000
const memoSize = 500
/** A page never waits longer than this for its preview figures. */
const metaTimeoutMs = 800

async function loadCard(page: Page, from: Sources): Promise<Card | null> {
  try {
    const own =
      page.kind === "gauge"
        ? await loadGauge(from, page.address)
        : page.kind === "protocol"
          ? await loadProtocol(from, page.epoch)
          : null
    if (own !== null) return own
  } catch {
    // Falls through to the default card.
  }
  return loadDefault(from)
}

function memoKey(page: Page): string {
  if (page.kind === "gauge") return `gauge:${page.address}`
  if (page.kind === "protocol") return `protocol:${page.epoch ?? "latest"}`
  return "default"
}

function cardFor(page: Page): Promise<Card | null> {
  const key = memoKey(page)
  const now = Date.now()
  const hit = memo.get(key)
  if (hit !== undefined && now - hit.at < memoMs) return hit.card
  if (memo.size >= memoSize) memo.clear()
  const card = loadCard(page, sources()).catch(() => null)
  memo.set(key, { at: now, card })
  // Without figures (the API failed), try again in 30s rather than 5 min.
  void card.then((found) => {
    if (
      found === null ||
      (found.kind === "default" && found.incentivesUsd === null)
    ) {
      memo.set(key, { at: now - memoMs + 30_000, card })
    }
  })
  return card
}

function within<T>(promise: Promise<T>, ms: number, otherwise: T): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => setTimeout(() => resolve(otherwise), ms)),
  ])
}

/**
 * The og and twitter tags for a page, on the request's own host. Never
 * rejects: a page without tags still renders.
 */
export async function linkPreviewTags(url: URL): Promise<string> {
  try {
    const page = pageFor(url.pathname)
    const card = await within(cardFor(page), metaTimeoutMs, null)
    const version = String(Math.floor(Date.now() / 3_600_000))
    return metaTags(pageMeta(page, card), url, version)
  } catch {
    return ""
  }
}
