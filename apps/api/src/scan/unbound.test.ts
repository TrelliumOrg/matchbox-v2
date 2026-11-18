import { errorBodySchema } from "@matchbox/contracts/errors"
import { createLogger } from "@matchbox/logger"
import { errorHandler, notFoundHandler, requestId } from "@matchbox/server"
import { Hono } from "hono"
import { describe, expect, it } from "vitest"
import type { ApiEnv } from "../context"
import registerScanRoutes from "./routes"

// Until matchbox-scan exists SCAN_DB is not bound (README, "Creating the
// database"): every route that reads it answers 503, and nothing throws.

function app() {
  const hono = new Hono<ApiEnv>()
  hono.use(requestId())
  hono.onError(errorHandler())
  hono.notFound(notFoundHandler)
  registerScanRoutes(hono, {
    scanDb: null,
    readDb: null,
    network: "mezo",
    cache: null,
    rateLimits: null,
    readPrices: async () => null,
    proxy: null,
    clock: async () => ({ height: null, lastActive: null }),
    logger: createLogger({ sink: () => undefined }),
  })
  return hono
}

describe("/internal/scan without SCAN_DB", () => {
  it("answers 503 service_disabled", async () => {
    for (const path of [
      "/activity",
      "/epochs",
      "/locks?escrow=vebtc",
      "/borrow/stability-pool",
      "/labels?address=0x0000000000000000000000000000000000000001",
    ]) {
      const response = await app().request(
        `https://api.internal/internal/scan${path}`,
      )
      expect(response.status, path).toBe(503)
      const body = errorBodySchema.parse(await response.json())
      expect(body.error.code).toBe("service_disabled")
    }
  })
})
