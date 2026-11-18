import {
  endUserKey,
  minSaltBytes,
  saltUsable,
} from "@matchbox/contracts/blockscout"
import {
  docsAskLimits,
  docsAskPath,
  docsAskRequestSchema,
} from "@matchbox/docs/ask"
import { type Logger, logger as rootLogger } from "@matchbox/logger"
import {
  clientIp,
  createDurableRateLimitClient,
  createMemoryRateLimitClient,
  ipPrefix,
  type RateLimitClient,
  type RateLimiterNamespace,
} from "@matchbox/server"
import {
  proposalRefreshRequestSchema,
  STUART_PATHS,
  type StuartStatus,
  type StuartStreamEvent,
  searchResponseSchema,
  stuartRequestSchema,
  supportReportSubmitSchema,
} from "@matchbox/stuart-ui/contract"
import { type Context, Hono } from "hono"
import { type SSEStreamingApi, streamSSE } from "hono/streaming"
import { z } from "zod"
import {
  type AnswerCache,
  answerCacheKey,
  cacheApiAnswerCache,
  isCacheable,
  memoryAnswerCache,
} from "./query/answerCache"
import { type MessageCreator, sdkMessageCreator } from "./query/claude"
import { createLiveProviders, type StuartProviders } from "./query/context"
import { proposalSecret } from "./query/crypto"
import answerDocsQuestion from "./query/docsAsk"
import {
  claudeAvailable,
  readStuartConfig,
  type StuartConfig,
  supportAvailable,
} from "./query/env"
import {
  assertOriginAllowed,
  originAllowed,
  readJsonBody,
  StuartHttpError,
  stuartError,
  stuartJson,
} from "./query/http"
import { handleMcpRequest, MCP_PROTOCOL_VERSION } from "./query/mcp"
import {
  isDeterministicRequest,
  runStuart,
  type StuartRuntime,
} from "./query/orchestrator"
import { apiBlockscout } from "./query/providers/blockscout"
import {
  apiScanReader,
  createChainActivity,
} from "./query/providers/chainActivity"
import {
  type ApiFetcher,
  createApiReadModels,
  createFixtureReadModels,
  type ReadModelSource,
} from "./query/providers/readModels"
import {
  fixtureRewardContracts,
  rpcRewardContracts,
} from "./query/providers/rewardContracts"
import { createMezoClient, rpcUrlsFrom } from "./query/providers/rpc"
import { checkStuartLimits, type StuartRoute } from "./query/rateLimit"
import { refreshProposal } from "./query/refresh"
import { searchQuery } from "./query/search"
import {
  createSpendMeter,
  durableSpendBucket,
  memorySpendBucket,
  type SpendBucket,
} from "./query/spend"
import { submitSupportReport } from "./query/supportReport"

// matchbox-stuart: Stuart's HTTP surface for Pro (and later Matchscan).
// POST /chat streams operational status lines, then one validated answer.

export type StuartBindings = {
  /** Service binding to matchbox-developer-api (read models). */
  API?: ApiFetcher
  /** RateLimiter Durable Object namespace (request limits and spend). */
  RATE_LIMITER?: RateLimiterNamespace
  ENVIRONMENT?: string
  MCP_ENABLED?: string
  STUART_DAILY_BUDGET_USD?: string
  STUART_SPEND_CAP?: string
  STUART_EFFORT?: string
  STUART_ALLOWED_ORIGINS?: string
  STUART_CLAUDE_ENABLED?: string
  ANTHROPIC_MODEL?: string
  ANTHROPIC_API_KEY?: string
  PROPOSAL_HMAC_SECRET?: string
  SUPABASE_URL?: string
  SUPABASE_SERVICE_ROLE_KEY?: string
  MEZO_RPC_URL?: string
  /**
   * Salt (32 bytes or more) for the visitor's key at the API's Blockscout
   * proxy, as Scan and Pro send it. Without it every Stuart visitor shares
   * one anonymous bucket there.
   */
  BLOCKSCOUT_CALLER_SALT?: string
}

type StuartEnv = { Bindings: StuartBindings }

type LogEvent = Record<string, unknown>

/** What the app needs from the outside world; tests swap each one. */
export type StuartAppDeps = {
  now: () => Date
  logger: Logger
  providers: (input: {
    env: StuartBindings
    config: StuartConfig
    log: (event: LogEvent) => void
    /** The visitor's key at the Blockscout proxy; null shares one bucket. */
    endUser: string | null
  }) => StuartProviders
  /** The chain block answers are cached under; null disables the cache. */
  snapshotBlock: (env: StuartBindings) => Promise<bigint | null>
  limiter: (env: StuartBindings) => RateLimitClient
  spendBucket: (env: StuartBindings) => SpendBucket
  answerCache: (env: StuartBindings) => AnswerCache | null
  messageCreator: (apiKey: string) => MessageCreator
  supportFetch: typeof globalThis.fetch
}

const BODY_LIMITS = {
  chat: 16 * 1024,
  refresh: 128 * 1024,
  support: 32 * 1024,
  mcp: 16 * 1024,
} as const

const MAX_STATUS_EVENTS = 12

function readModelsFor(env: StuartBindings): ReadModelSource {
  return env.API ? createApiReadModels(env.API) : createFixtureReadModels()
}

// Per-isolate fallbacks when the Durable Object or Cache API is missing
// (local dev without bindings). Production always has both.
const isolateLimiter = createMemoryRateLimitClient()
const isolateSpend = memorySpendBucket()
const isolateAnswers = memoryAnswerCache()

function defaultAnswerCache(): AnswerCache {
  return typeof caches === "undefined"
    ? isolateAnswers
    : cacheApiAnswerCache(caches.default)
}

export const defaultDeps: StuartAppDeps = {
  now: () => new Date(),
  logger: rootLogger.child({ service: "matchbox-stuart" }),
  providers: ({ env, config, log, endUser }) => {
    const rpc = createMezoClient(rpcUrlsFrom(config.mezoRpcUrl))
    const blockscout = apiBlockscout(env.API ?? null, endUser)
    return createLiveProviders({
      readModels: readModelsFor(env),
      rpc,
      rewardContracts: env.API
        ? rpcRewardContracts(rpc)
        : fixtureRewardContracts(),
      blockscout,
      chain: createChainActivity({
        blockscout,
        scan: apiScanReader(env.API ?? null),
        rpc: env.API ? rpc : null,
      }),
      now: () => new Date(),
      log,
    })
  },
  snapshotBlock: async (env) => {
    const head = await readModelsFor(env).head()
    return BigInt(head.block)
  },
  limiter: (env) =>
    env.RATE_LIMITER
      ? createDurableRateLimitClient(env.RATE_LIMITER)
      : isolateLimiter,
  spendBucket: (env) =>
    env.RATE_LIMITER ? durableSpendBucket(env.RATE_LIMITER) : isolateSpend,
  answerCache: () => defaultAnswerCache(),
  messageCreator: sdkMessageCreator,
  supportFetch: (input, init) => globalThis.fetch(input, init),
}

function logWith(logger: Logger): (event: LogEvent) => void {
  return function log(event) {
    const { message, ...fields } = event
    logger.info({
      message: typeof message === "string" ? message : "stuart.event",
      ...fields,
    })
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 200) : "unknown"
}

let saltWarned = false

/**
 * The visitor's key at the API's Blockscout proxy: a salted hash of their
 * IP prefix (@matchbox/contracts/blockscout), so one visitor's chain
 * questions spend their own bucket. Null without the salt or an IP.
 */
async function visitorKey(
  request: Request,
  env: StuartBindings,
  log: (event: LogEvent) => void,
): Promise<string | null> {
  const salt = env.BLOCKSCOUT_CALLER_SALT
  if (!saltUsable(salt)) {
    if (!saltWarned) {
      saltWarned = true
      log({
        message: `stuart.blockscout_salt ${salt === undefined || salt === "" ? "missing" : `shorter than ${minSaltBytes} bytes`}: every visitor shares Stuart's anonymous Blockscout bucket`,
      })
    }
    return null
  }
  return endUserKey(clientIp(request), salt)
}

function runtimeFor(input: {
  env: StuartBindings
  config: StuartConfig
  deps: StuartAppDeps
  log: (event: LogEvent) => void
  onStatus?: (text: string) => void
  endUser?: string | null
  /** The request's IP prefix, for its own daily model budget. */
  ipPrefix?: string | null
}): StuartRuntime {
  const { config, deps } = input
  const key = config.anthropicApiKey
  return {
    providers: deps.providers({
      env: input.env,
      config,
      log: input.log,
      endUser: input.endUser ?? null,
    }),
    secret: proposalSecret(config.proposalSecret),
    now: deps.now,
    claude:
      claudeAvailable(config) && key !== null
        ? {
            create: deps.messageCreator(key),
            model: config.model,
            effort: config.effort,
          }
        : null,
    spend: createSpendMeter({
      bucket: deps.spendBucket(input.env),
      budgetMicroUsd: config.dailyBudgetMicroUsd,
      visitor:
        input.ipPrefix === undefined || input.ipPrefix === null
          ? null
          : {
              key: input.ipPrefix,
              budgetMicroUsd: config.ipDailyBudgetMicroUsd,
            },
      forced: config.spendCapForced,
      now: () => deps.now().getTime(),
    }),
    ...(input.onStatus ? { onStatus: input.onStatus } : {}),
    log: input.log,
  }
}

async function limitOrThrow(input: {
  deps: StuartAppDeps
  env: StuartBindings
  route: StuartRoute
  request: Request
  wallet: string | null
}): Promise<void> {
  const outcome = await checkStuartLimits({
    client: input.deps.limiter(input.env),
    route: input.route,
    ipPrefix: ipPrefix(input.request),
    wallet: input.wallet,
  })
  if (!outcome.allowed) {
    throw new StuartHttpError(
      429,
      "rate_limited",
      "Too many requests. Try again shortly.",
      outcome.retryAfterSeconds,
    )
  }
}

function corsHeaders(origin: string): Record<string, string> {
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-max-age": "600",
    vary: "Origin",
  }
}

async function writeEvent(
  stream: SSEStreamingApi,
  event: StuartStreamEvent,
): Promise<void> {
  await stream.writeSSE({ event: event.type, data: JSON.stringify(event) })
}

export function createStuartApp(deps: StuartAppDeps = defaultDeps) {
  const app = new Hono<StuartEnv>()
  const log = logWith(deps.logger)

  /** The docs origins reach the public docs endpoint and nothing else. */
  function originsFor(path: string, config: StuartConfig): readonly string[] {
    return path === docsAskPath
      ? [...config.allowedOrigins, ...config.docsOrigins]
      : config.allowedOrigins
  }

  // MCP is for agents, not browsers on Pro: open CORS, its own limiter.
  app.use("*", async function cors(c, next) {
    if (c.req.path === STUART_PATHS.mcp) {
      await next()
      return
    }
    const config = readStuartConfig(c.env ?? {})
    const origin = c.req.header("origin") ?? null
    const allowed = originAllowed(c.req.raw, originsFor(c.req.path, config))
    if (c.req.method === "OPTIONS") {
      if (!allowed || origin === null) {
        return stuartError(
          new StuartHttpError(403, "forbidden_origin", "Origin not allowed."),
        )
      }
      return new Response(null, { status: 204, headers: corsHeaders(origin) })
    }
    await next()
    if (origin !== null && allowed) {
      for (const [name, value] of Object.entries(corsHeaders(origin))) {
        c.res.headers.set(name, value)
      }
    }
  })

  function guarded(
    name: string,
    handler: (c: Context<StuartEnv>, config: StuartConfig) => Promise<Response>,
  ) {
    return async function handle(c: Context<StuartEnv>): Promise<Response> {
      try {
        const config = readStuartConfig(c.env ?? {})
        assertOriginAllowed(c.req.raw, originsFor(c.req.path, config))
        return await handler(c, config)
      } catch (error) {
        if (error instanceof StuartHttpError) return stuartError(error)
        if (error instanceof z.ZodError) {
          return stuartError(
            new StuartHttpError(
              400,
              "invalid_request",
              "Request does not match the contract.",
            ),
          )
        }
        log({
          message: "stuart.route_error",
          route: name,
          error: errorText(error),
        })
        return stuartError(
          new StuartHttpError(
            500,
            "internal",
            "Stuart is unavailable right now.",
          ),
        )
      }
    }
  }

  // The Ctrl K bar: gauges, a pasted wallet or a pasted transaction.
  app.get(
    STUART_PATHS.search,
    guarded("search", async (c) => {
      const env = c.env ?? {}
      await limitOrThrow({
        deps,
        env,
        route: "search",
        request: c.req.raw,
        wallet: null,
      })
      const response = await searchQuery(
        c.req.query("q") ?? "",
        readModelsFor(env),
      )
      return new Response(
        JSON.stringify(searchResponseSchema.parse(response)),
        {
          headers: {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "public, max-age=15",
          },
        },
      )
    }),
  )

  // "Ask about this page" on Matchbox Docs: anonymous and public. Counted
  // before the body is read, so a malformed request still spends quota.
  app.post(
    docsAskPath,
    guarded("docs", async (c) => {
      await limitOrThrow({
        deps,
        env: c.env ?? {},
        route: "docs",
        request: c.req.raw,
        wallet: null,
      })
      const parsed = docsAskRequestSchema.safeParse(
        await readJsonBody(c.req.raw, docsAskLimits.body),
      )
      if (!parsed.success) {
        throw new StuartHttpError(
          400,
          "invalid_request",
          "Request does not match the contract.",
        )
      }
      return stuartJson(answerDocsQuestion(parsed.data))
    }),
  )

  app.get(STUART_PATHS.status, (c) => {
    const config = readStuartConfig(c.env ?? {})
    const live = claudeAvailable(config)
    const status: StuartStatus = {
      stuart: live ? "claude" : "deterministic",
      model: live ? config.model : null,
      supportReports: supportAvailable(config),
    }
    return stuartJson(status)
  })

  app.post(
    STUART_PATHS.chat,
    guarded("chat", async (c, config) => {
      const env = c.env ?? {}
      const request = stuartRequestSchema.parse(
        await readJsonBody(c.req.raw, BODY_LIMITS.chat),
      )
      const raw = c.req.raw
      return streamSSE(c, async (stream) => {
        const requestId = crypto.randomUUID()
        function requestLog(event: LogEvent) {
          log({ requestId, ...event })
        }
        try {
          const limited = await checkStuartLimits({
            client: deps.limiter(env),
            route: "chat",
            ipPrefix: ipPrefix(raw),
            wallet: request.wallet?.address ?? null,
          })
          if (!limited.allowed) {
            await writeEvent(stream, {
              type: "busy",
              reason: "rate_limited",
              retryAfterSeconds: limited.retryAfterSeconds,
            })
            return
          }
          const cache = isDeterministicRequest(request)
            ? deps.answerCache(env)
            : null
          const block =
            cache === null
              ? null
              : await deps.snapshotBlock(env).catch((error: unknown) => {
                  requestLog({
                    message: "stuart.snapshot_block_unavailable",
                    error: errorText(error),
                  })
                  return null
                })
          const key =
            cache !== null && block !== null
              ? await answerCacheKey({ request, snapshotBlock: block })
              : null
          if (cache !== null && key !== null) {
            const hit = await cache.get(key).catch(() => null)
            if (hit !== null) {
              requestLog({ message: "stuart.cache_hit" })
              await writeEvent(stream, {
                type: "answer",
                response: hit,
                cached: true,
              })
              return
            }
          }
          let statuses = 0
          let lastStatus = ""
          let pending: Promise<void> = Promise.resolve()
          function onStatus(text: string) {
            const line = text.replace(/\s+/g, " ").trim().slice(0, 120)
            if (line.length === 0 || line === lastStatus) return
            if (statuses >= MAX_STATUS_EVENTS) return
            statuses += 1
            lastStatus = line
            pending = pending.then(() =>
              writeEvent(stream, { type: "status", text: line }),
            )
          }
          const run = await runStuart(
            request,
            runtimeFor({
              env,
              config,
              deps,
              log: requestLog,
              onStatus,
              endUser: await visitorKey(raw, env, requestLog),
              ipPrefix: ipPrefix(raw),
            }),
          )
          await pending
          if (run.kind === "busy") {
            await writeEvent(stream, {
              type: "busy",
              reason: run.reason,
              retryAfterSeconds: run.retryAfterSeconds,
            })
            return
          }
          if (
            cache !== null &&
            key !== null &&
            run.deterministic &&
            isCacheable(run.response)
          ) {
            await cache.put(key, run.response).catch((error: unknown) => {
              requestLog({
                message: "stuart.cache_put_failed",
                error: errorText(error),
              })
            })
          }
          await writeEvent(stream, {
            type: "answer",
            response: run.response,
            cached: false,
          })
        } catch (error) {
          requestLog({ message: "stuart.chat_error", error: errorText(error) })
          await writeEvent(stream, {
            type: "error",
            code: "internal",
            message: "Stuart is unavailable right now.",
          })
        } finally {
          await writeEvent(stream, { type: "done" })
        }
      })
    }),
  )

  app.post(
    STUART_PATHS.refresh,
    guarded("refresh", async (c, config) => {
      const env = c.env ?? {}
      const body = proposalRefreshRequestSchema.parse(
        await readJsonBody(c.req.raw, BODY_LIMITS.refresh),
      )
      await limitOrThrow({
        deps,
        env,
        route: "refresh",
        request: c.req.raw,
        wallet: body.wallet.address,
      })
      return stuartJson(
        await refreshProposal(body, runtimeFor({ env, config, deps, log })),
      )
    }),
  )

  app.post(
    STUART_PATHS.support,
    guarded("support", async (c, config) => {
      if (!supportAvailable(config)) {
        throw new StuartHttpError(
          503,
          "support_unavailable",
          "Support reports are not available right now.",
        )
      }
      const env = c.env ?? {}
      await limitOrThrow({
        deps,
        env,
        route: "support",
        request: c.req.raw,
        wallet: null,
      })
      const body = supportReportSubmitSchema.parse(
        await readJsonBody(c.req.raw, BODY_LIMITS.support),
      )
      const result = await submitSupportReport({
        body,
        secret: proposalSecret(config.proposalSecret),
        ip: ipPrefix(c.req.raw) ?? "unknown",
        now: deps.now(),
        sink: {
          supabaseUrl: config.supabaseUrl,
          serviceRoleKey: config.supabaseServiceRoleKey,
          fetch: deps.supportFetch,
        },
      })
      log({ message: "stuart.support_report", ref: result.ref })
      return stuartJson(result, 201)
    }),
  )

  // External agents; the public Matchbox MCP in Phase 3. Off unless
  // MCP_ENABLED="true". Deterministic tools only, never signable.
  app.post(STUART_PATHS.mcp, async (c) => {
    const env = c.env ?? {}
    const config = readStuartConfig(env)
    if (!config.mcpEnabled) return c.notFound()
    try {
      await limitOrThrow({
        deps,
        env,
        route: "mcp",
        request: c.req.raw,
        wallet: null,
      })
      const body = await readJsonBody(c.req.raw, BODY_LIMITS.mcp)
      const runtime = runtimeFor({
        env,
        config,
        deps,
        log,
        endUser: await visitorKey(c.req.raw, env, log),
      })
      const result = await handleMcpRequest({
        body,
        headers: c.req.raw.headers,
        runtime: { ...runtime, claude: null },
      })
      return new Response(JSON.stringify(result.body), {
        status: result.status,
        headers: {
          "content-type": "application/json",
          "cache-control": "no-store",
          "access-control-allow-origin": "*",
          "mcp-protocol-version": MCP_PROTOCOL_VERSION,
        },
      })
    } catch (error) {
      if (error instanceof StuartHttpError) return stuartError(error)
      log({ message: "stuart.mcp_error", error: errorText(error) })
      return stuartError(
        new StuartHttpError(500, "internal", "MCP is unavailable right now."),
      )
    }
  })

  app.notFound(() =>
    stuartError(new StuartHttpError(404, "invalid_request", "Not found.")),
  )

  return app
}
