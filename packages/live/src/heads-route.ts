/**
 * `/live/heads`: forwards the BlockHub WebSocket from the API Worker so the
 * browser stays same-origin. `api` is the API service binding, or null when
 * there is no BlockHub (fixtures mode, or no binding in local dev).
 */
export function headsRoute(
  request: Request,
  api: Pick<Fetcher, "fetch"> | null,
): Promise<Response> | Response {
  if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
    return new Response("Expected a WebSocket upgrade", { status: 426 })
  }
  if (api === null) {
    return new Response("No BlockHub in this environment", { status: 503 })
  }
  return api.fetch(new Request("https://api.internal/internal/heads", request))
}

export const headsPath = "/live/heads"
