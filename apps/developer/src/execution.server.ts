import { AsyncLocalStorage } from "node:async_hooks"

/**
 * Reads one of the server's own GET routes in-process. The Worker entry
 * provides it for each page request (see `servePage`), so server functions
 * reach the Hono app with the request's ExecutionContext without importing
 * the server code themselves.
 */
export type InternalRead = (url: string, headers: Headers) => Promise<Response>

type Answer = Response | Promise<Response>

export const internalReads = new AsyncLocalStorage<InternalRead>()

/** Headers on every Start response: HTML, server functions and redirects. */
export const baseHeaders = {
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains",
  "X-Content-Type-Options": "nosniff",
  // Pages and server-function JSON carry account data; Classic only ever
  // served it as /api JSON with no-store.
  "Cache-Control": "private, no-store",
} as const

export type PageOptions = {
  request: Request
  /** The in-process GET to the Hono server (the real Worker in production). */
  read: (url: string, headers: Headers) => Answer
  /** TanStack Start's handler. */
  start: (request: Request) => Answer
  /** Request header that carries the CSP nonce to the router. */
  nonceHeader: string
  nonce: string
  /** Security headers (and the CSP) for an HTML document. */
  documentHeaders: (pathname: string) => Record<string, string>
  /** Rewrites an HTML document before it is sent (link previews). */
  rewrite?: (response: Response, url: URL) => Response
}

/**
 * Serves one page or server-function request through Start. Every
 * `Set-Cookie` the server's own routes answer while it renders (a session
 * that slid, or one that ended) is passed on to the browser, as it would
 * have been had the browser called /api itself.
 */
export async function servePage(options: PageOptions): Promise<Response> {
  const cookies: string[] = []
  const read: InternalRead = async (url, headers) => {
    const response = await options.read(url, headers)
    cookies.push(...response.headers.getSetCookie())
    return response
  }
  // Only this Worker sets the nonce; a client's header of that name is dropped.
  const headers = new Headers(options.request.headers)
  headers.set(options.nonceHeader, options.nonce)
  let response: Response
  try {
    response = await internalReads.run(read, () =>
      options.start(new Request(options.request, { headers })),
    )
  } catch (error) {
    // Start threw instead of answering. The browser still gets the base
    // headers and every cookie the reads set (a slid session, or one that
    // ended), on a generic error that says nothing about the failure.
    console.error({
      message: "Page render threw",
      error: error instanceof Error ? error.name : typeof error,
    })
    response = new Response("Something went wrong", {
      status: 500,
      headers: { "content-type": "text/plain; charset=utf-8" },
    })
  }
  const url = new URL(options.request.url)
  const type = response.headers.get("content-type") ?? ""
  const html = type.includes("text/html")
  const body =
    html && options.rewrite !== undefined
      ? options.rewrite(response, url)
      : response
  const out = new Response(body.body, response)
  for (const [name, value] of Object.entries(baseHeaders)) {
    out.headers.set(name, value)
  }
  if (html) {
    for (const [name, value] of Object.entries(
      options.documentHeaders(url.pathname),
    )) {
      out.headers.set(name, value)
    }
  }
  for (const cookie of cookies) out.headers.append("Set-Cookie", cookie)
  return out
}
