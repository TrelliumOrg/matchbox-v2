import { internalCaller } from "../internal/access"

// WebSocket upgrades for /internal/heads go straight to the BlockHub Durable
// Object, ahead of the Hono app. The app's middleware (request id, CORS,
// security headers) adds headers to every response, and a 101 response can
// neither be copied (status outside 200 to 599) nor have its headers changed,
// so routing the upgrade through the app returned a 500 and Pro's block
// ticker never connected.
//
// Only internal callers (src/internal/access.ts) are routed here. A public
// upgrade falls through to the app, whose /internal/* gate answers 404.

export const headsPath = "/internal/heads"

type HubNamespace = Pick<DurableObjectNamespace, "get" | "idFromName">

function hubFrom(env: unknown): HubNamespace | null {
  if (typeof env !== "object" || env === null) return null
  const hub = (env as { BLOCK_HUB?: unknown }).BLOCK_HUB
  if (typeof hub !== "object" || hub === null) return null
  if (!("get" in hub) || !("idFromName" in hub)) return null
  return hub as HubNamespace
}

function isHeadsUpgrade(request: Request): boolean {
  if (request.method !== "GET") return false
  if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
    return false
  }
  return new URL(request.url).pathname === headsPath
}

/**
 * The BlockHub's response for an internal caller's heads upgrade, or null
 * for anything else (including a public caller's upgrade).
 */
export async function routeHeadsUpgrade(
  request: Request,
  env: unknown,
  internalToken: string | null,
  network = "mezo",
): Promise<Response | null> {
  if (!isHeadsUpgrade(request)) return null
  const hub = hubFrom(env)
  if (hub === null) return null
  if ((await internalCaller(request, internalToken)) === "denied") return null
  return hub.get(hub.idFromName(network)).fetch(request)
}
