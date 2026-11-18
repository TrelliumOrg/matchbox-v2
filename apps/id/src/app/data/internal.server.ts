import { getRequest } from "@tanstack/react-start/server"
import { internalReads } from "../../execution.server"

/**
 * Reads the OIDC server's own `/api/*` GET routes in-process for server
 * rendering, as the browser would: same cookie, user agent and client IP,
 * same origin. Only GET: every write still comes from the browser, so the
 * server's same-origin and rate-limit checks see the real request.
 */

const forwarded = [
  "cookie",
  "user-agent",
  "cf-connecting-ip",
  "x-forwarded-for",
  "accept-language",
]

export function readInternal(path: string): Promise<Response> {
  const request = getRequest()
  const headers = new Headers({ accept: "application/json" })
  for (const name of forwarded) {
    const value = request.headers.get(name)
    if (value !== null) headers.set(name, value)
  }
  const read = internalReads.getStore()
  if (read === undefined) {
    throw new Error("readInternal ran outside a page request")
  }
  return read(new URL(path, request.url).href, headers)
}
