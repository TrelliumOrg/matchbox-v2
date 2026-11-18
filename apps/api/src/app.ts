import { issuesFromZodError } from "@matchbox/contracts/errors"
import {
  type GaugeProfile,
  type GaugeProfileDetail,
  type GaugeProfileList,
  gaugeProfileCursorCodec,
  type HealthResponse,
  parseGaugeProfileListQuery,
  sourceMetaFor,
  vebtcGaugeProfileParamsSchema,
} from "@matchbox/contracts/gauge-profiles"
import { describeNetwork, readableNetworks } from "@matchbox/contracts/network"
import openApiDocument from "@matchbox/contracts/openapi.json"
import { type Logger, logger as rootLogger } from "@matchbox/logger"
import {
  errorHandler,
  notFoundHandler,
  PlatformError,
  type RateLimitClient,
  requestId,
  securityHeaders,
} from "@matchbox/server"
import { Hono } from "hono"
import { z } from "zod"
import registerBlockscoutProxy from "./blockscout/endpoint"
import type { BlockscoutProxy } from "./blockscout/proxy"
import type { ApiContext, ApiEnv } from "./context"
import { allowedNetwork, requireAuth } from "./guards"
import { found, publicCacheControl, respondJson } from "./http"
import { internalAccess } from "./internal/access"
import registerMarketRoutes from "./market/routes"
import type { MarketStore } from "./market/store"
import { authenticate, createAuthState } from "./middleware/authenticate"
import { cors } from "./middleware/cors"
import {
  createOverrideCache,
  defaultPublishableQuotaShare,
  rateLimit,
} from "./middleware/rate-limit"
import { type RequestLogSink, requestLog } from "./middleware/request-log"
import registerInternalProRoutes, {
  type InternalProDeps,
} from "./read-models/routes"
import registerScanRoutes, { type ScanRouteDeps } from "./scan/routes"
import type { ApiStore } from "./store/api-store"

export type AppDeps = {
  store: ApiStore
  /** Gauge/incentive snapshots; null when no market database is bound. */
  market: MarketStore | null
  rateLimits: RateLimitClient
  /** Analytics Engine dataset (`REQUEST_LOG`); null disables request logs. */
  analytics: RequestLogSink | null
  now: () => Date
  flags: { gaugeProfileApi: boolean }
  config: {
    apiKeyPepper: string
    version: string
    environment: string
    /** Publishable keys' share of the environment quota; default 0.5. */
    publishableQuotaShare?: number
    /**
     * `INTERNAL_TOKEN`: lets a public caller reach `/internal/*` (local
     * development). Absent or null, only service binding callers can.
     */
    internalToken?: string | null
  }
  logger?: Logger
  /** `/internal/pro/*` read models; absent leaves those routes unmounted. */
  internalPro?: InternalProDeps
  /**
   * `/internal/blockscout/*` proxy; absent leaves it unmounted, null
   * answers 503.
   */
  blockscout?: BlockscoutProxy | null
  /** `/internal/scan/*` (Matchscan); absent leaves it unmounted. */
  scan?: ScanRouteDeps
}

const gaugeAddressParamSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/)
  .transform((value) => value.toLowerCase())

/** Runs work after the response (`ctx.waitUntil`), or detached in tests. */
function runInBackground(c: ApiContext, task: Promise<unknown>): void {
  try {
    c.executionCtx.waitUntil(task)
  } catch {
    // No ExecutionContext (e.g. `app.request()` in tests): the promise is
    // already running and handles its own errors.
  }
}

function detail(profile: GaugeProfile): GaugeProfileDetail {
  return { data: profile, meta: sourceMetaFor([profile]) }
}

export function createApp(deps: AppDeps) {
  const log = deps.logger ?? rootLogger
  const nowMs = () => deps.now().getTime()
  const app = new Hono<ApiEnv>()

  app.use(requestLog({ sink: deps.analytics, now: deps.now, logger: log }))
  app.use(requestId({ logger: log }))
  // Before securityHeaders and cors: a denied /internal/* call answers like
  // a missing route, with no CORS headers (src/internal/access.ts).
  app.use(internalAccess({ internalToken: deps.config.internalToken ?? null }))
  app.use(securityHeaders())
  app.use(cors())
  app.onError(errorHandler())
  app.notFound(notFoundHandler)

  app.get("/v1/health", (c) => {
    c.set("routeTemplate", "/v1/health")
    c.set("cors", { kind: "public" })
    const body: HealthResponse = {
      status: "ok",
      version: deps.config.version,
      flags: { gaugeProfileApi: deps.flags.gaugeProfileApi },
    }
    return c.json(body, 200, { "Cache-Control": "no-store" })
  })

  app.get("/openapi.json", (c) => {
    c.set("routeTemplate", "/openapi.json")
    c.set("cors", { kind: "public" })
    return respondJson(c, openApiDocument, publicCacheControl)
  })

  app.use("/v1/*", async function gaugeProfileApiFlag(_c, next) {
    if (!deps.flags.gaugeProfileApi) {
      throw new PlatformError("service_disabled")
    }
    await next()
  })
  app.use(
    "/v1/*",
    authenticate({
      store: deps.store,
      rateLimits: deps.rateLimits,
      pepper: deps.config.apiKeyPepper,
      now: deps.now,
      logger: log,
      state: createAuthState(nowMs),
      background: runInBackground,
    }),
  )
  app.use(
    "/v1/*",
    rateLimit({
      store: deps.store,
      rateLimits: deps.rateLimits,
      now: deps.now,
      logger: log,
      overrides: createOverrideCache(nowMs),
      publishableQuotaShare:
        deps.config.publishableQuotaShare ?? defaultPublishableQuotaShare,
    }),
  )

  app.get("/v1/networks", (c) => {
    c.set("routeTemplate", "/v1/networks")
    requireAuth(c)
    return respondJson(c, { data: readableNetworks.map(describeNetwork) })
  })

  app.get("/v1/gauge-profiles", async (c) => {
    c.set("routeTemplate", "/v1/gauge-profiles")
    requireAuth(c)
    const parsed = parseGaugeProfileListQuery(new URL(c.req.url).searchParams)
    if (!parsed.ok) {
      throw new PlatformError("invalid_request", {
        ...(parsed.error === "invalid-cursor"
          ? { message: "Invalid cursor." }
          : { issues: issuesFromZodError(parsed.error) }),
      })
    }
    const { query, cursor } = parsed
    const network = allowedNetwork(query.network)
    const page = await deps.store.listGaugeProfiles({
      network,
      profileType: query.profileType ?? null,
      tag: query.tag ?? null,
      updatedSince: query.updatedSince ?? null,
      addresses: query.address ?? null,
      limit: query.limit,
      cursor,
    })
    const body: GaugeProfileList = {
      data: page.profiles,
      nextCursor:
        page.nextCursor === null
          ? null
          : gaugeProfileCursorCodec.encode(page.nextCursor),
      meta: sourceMetaFor(page.profiles),
    }
    return respondJson(c, body)
  })

  app.get("/v1/gauge-profiles/:network/:gaugeAddress", async (c) => {
    c.set("routeTemplate", "/v1/gauge-profiles/{network}/{gaugeAddress}")
    requireAuth(c)
    const network = allowedNetwork(c.req.param("network"))
    const address = gaugeAddressParamSchema.safeParse(
      c.req.param("gaugeAddress"),
    )
    if (!address.success) throw new PlatformError("not_found")
    const profile = found(
      await deps.store.getGaugeProfile(network, address.data),
    )
    return respondJson(c, detail(profile))
  })

  app.get("/v1/vebtc/:network/:tokenId/gauge-profile", async (c) => {
    c.set("routeTemplate", "/v1/vebtc/{network}/{tokenId}/gauge-profile")
    requireAuth(c)
    const network = allowedNetwork(c.req.param("network"))
    const params = vebtcGaugeProfileParamsSchema.safeParse({
      network,
      tokenId: c.req.param("tokenId"),
    })
    if (!params.success) throw new PlatformError("not_found")
    const profile = found(
      await deps.store.getGaugeProfileByVebtc(network, params.data.tokenId),
    )
    return respondJson(c, detail(profile))
  })

  registerMarketRoutes(app, { market: deps.market, now: deps.now })
  if (deps.internalPro !== undefined) {
    registerInternalProRoutes(app, deps.internalPro)
  }
  if (deps.blockscout !== undefined) {
    registerBlockscoutProxy(app, deps.blockscout)
  }
  if (deps.scan !== undefined) {
    registerScanRoutes(app, deps.scan)
  }

  return app
}

export type ApiApp = ReturnType<typeof createApp>
