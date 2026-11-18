import { pageLoaders } from "@matchbox/docs/pages"
import type { PageData } from "@matchbox/docs/render"
import { use } from "react"

/**
 * Page bodies are JSON chunks, one per page, loaded from the static assets:
 * by the route loader before a client navigation (so the page appears
 * whole), during prerender on the server, and once while the first page
 * hydrates (React keeps the prerendered HTML until the chunk is in).
 */

const pending = new Map<string, Promise<PageData>>()
const loaded = new Map<string, PageData>()

export function hasPage(path: string): boolean {
  return Object.hasOwn(pageLoaders, path)
}

export function loadPage(path: string): Promise<PageData> {
  const known = pending.get(path)
  if (known !== undefined) return known
  const loader = pageLoaders[path]
  if (loader === undefined) return Promise.reject(new Error(`No page ${path}`))
  const promise = loader().then((module) => {
    loaded.set(path, module.default)
    return module.default
  })
  pending.set(path, promise)
  return promise
}

/** The page, suspending until its chunk has loaded. */
export function usePage(path: string): PageData {
  return loaded.get(path) ?? use(loadPage(path))
}
