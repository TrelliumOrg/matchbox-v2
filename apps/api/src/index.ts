import { WorkerEntrypoint } from "cloudflare:workers"
import { buildErrorBody } from "@matchbox/contracts/errors"
import { epochStartOf } from "@matchbox/domain"
import { logger } from "@matchbox/logger"
import {
  createDurableRateLimitClient,
  createSupabaseAdmin,
  flags,
  generateRequestId,
} from "@matchbox/server"
import { type ApiApp, createApp } from "./app"
import { createHeadReader, unknownClock } from "./blockscout/head"
import { createBlockscoutProxy } from "./blockscout/proxy"
import {
  createLiveMezoClient,
  createMezoClient,
  liveReadTimeoutMs,
  scanReadTimeoutMs,
} from "./chain/client"
import { healthProbeCron, marketCron } from "./crons"
import { memoryModePepper, parseWorkerEnv, type WorkerEnv } from "./env"
import { defaultHeadRpcUrls } from "./heads/poller"
import { routeHeadsUpgrade } from "./heads/upgrade"
import runHealthProbes from "./health/probes"
import { markBindingRequest, usableInternalToken } from "./internal/access"
import {
  cachedMezoFromKv,
  type ReferencePrices,
  readReferencePrices,
} from "./market/prices"
import { createViemMarketReader, type MarketReader } from "./market/reader"
import {
  createD1MarketStore,
  createMemoryMarketStore,
  type MarketStore,
} from "./market/store"
import syncMarket from "./market/sync"
import { refreshVoterEpochs } from "./market/voter-epochs"
import { defaultExtractBudget } from "./read-models/avatar-colors/extract"
import { createBalanceReader } from "./read-models/balances"
import { createGaugeChainReader } from "./read-models/gauge-chain"
import { createGaugeDetailsReader } from "./read-models/gauge-details"
import { createGaugeLabelReader } from "./read-models/gauge-labels"
import {
  createGaugeVotesReader,
  refreshGaugeVotes,
} from "./read-models/gauge-votes"
import { pairFromSymbol, tokensBySymbol } from "./read-models/gauges"
import { createIdentityReader } from "./read-models/identity"
import {
  createLiveClaimableReader,
  createLockCountReader,
} from "./read-models/live-claimable"
import {
  createLatestLockIdsReader,
  createLiveLockReader,
  createLiveLocksReader,
  createOwnerLocksReader,
} from "./read-models/live-locks"
import { createLiveWalletReader } from "./read-models/live-wallet"
import {
  isGaugePublishMinute,
  publishGaugeReadModels,
  readPricesFromKv,
} from "./read-models/publish"
import {
  type ChainReader,
  createViemChainReader,
} from "./reconcile/chain-reader"
import reconcileChainState from "./reconcile/reconcile"
import { createLiveTxReader } from "./scan/live-tx"
import { createMezoIdResolver } from "./scan/mezo-ids"
import type { ApiStore } from "./store/api-store"
import { devApiKeys } from "./store/memory-seed"
import { createMemoryApiStore } from "./store/memory-store"
import { createSupabaseApiStore } from "./store/supabase-store"

export { RateLimiter } from "@matchbox/server/rate-limiter"
export { BlockHub } from "./heads/block-hub"

/** `name=value` lines (field names containing "secret" would be redacted). */
function devKeyLines(): string[] {
  return Object.entries(devApiKeys).map(([name, value]) => `${name}=${value}`)
}

type Runtime = {
  env: WorkerEnv
  store: ApiStore
  market: MarketStore | null
  app: ApiApp
}

function marketStoreFor(env: WorkerEnv): MarketStore | null {
  if (env.MARKET_DB !== undefined) return createD1MarketStore(env.MARKET_DB)
  return env.PLATFORM_STORE === "memory" ? createMemoryMarketStore() : null
}

type RuntimeResult = { ok: true; runtime: Runtime } | { ok: false }

let cached: { raw: unknown; runtime: Promise<RuntimeResult> } | null = null

async function buildRuntime(raw: unknown): Promise<RuntimeResult> {
  const parsed = parseWorkerEnv(raw)
  if (!parsed.ok) {
    logger.error({
      message: "Invalid Worker configuration",
      problems: parsed.problems,
    })
    return { ok: false }
  }
  const env = parsed.env
  const pepper = env.API_KEY_PEPPER ?? memoryModePepper
  let store: ApiStore
  if (env.PLATFORM_STORE === "memory") {
    store = await createMemoryApiStore({ pepper })
    logger.warn({
      message: "PLATFORM_STORE=memory: serving sample data with dev keys",
      environment: env.ENVIRONMENT,
      devKeys: devKeyLines(),
    })
  } else {
    store = createSupabaseApiStore({
      supabase: createSupabaseAdmin({
        SUPABASE_URL: env.SUPABASE_URL ?? "",
        SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY ?? "",
      }),
      logger,
    })
  }
  const market = marketStoreFor(env)
  const mezo = createMezoClient(mezoRpcUrls(env))
  // Pro's page-view reads wait 4 s at most: an endpoint gets 2 s and no
  // retry, at either level, each RPC once (the configured primary is also
  // the first public fallback), the fallbacks kept for one that refuses.
  // No client batching: the live readers send their own Multicall3
  // requests side by side (createLiveMezoClient).
  const mezoLive = createLiveMezoClient(
    [...new Set(mezoRpcUrls(env))],
    liveReadTimeoutMs,
  )
  // Matchscan's public pages: the primary RPC only, 1.2 s, no retry, and
  // one request per step (scan/live-locks.ts).
  const scanChain = createLiveMezoClient(
    mezoRpcUrls(env).slice(0, 1),
    scanReadTimeoutMs,
  )
  const scanRequests = { attempts: 1 }
  const rateLimits = createDurableRateLimitClient(env.RATE_LIMITER)
  const hub = env.BLOCK_HUB
  // One head reader and one proxy, shared by the proxy route and Scan's
  // composed documents (so both see the same cache, coalescing and budget).
  const clock =
    hub === undefined
      ? async () => unknownClock
      : createHeadReader({
          read: () =>
            hub.get(hub.idFromName("mezo")).fetch("https://block-hub/head"),
        })
  const proxy = createBlockscoutProxy({
    apiKey: env.BLOCKSCOUT_API_KEY,
    fetch: (url, init) => fetch(url, init),
    // Its own cache namespace, apart from the Pro read models'.
    cache:
      typeof caches === "undefined" ? null : await caches.open("blockscout"),
    clock,
    rateLimits,
    finalityDepth: env.BLOCKSCOUT_FINALITY_DEPTH,
    revalidateBlocks: env.BLOCKSCOUT_REVALIDATE_BLOCKS,
    logger: logger.child({ task: "blockscout-proxy" }),
  })
  const app = createApp({
    store,
    market,
    rateLimits,
    analytics: env.REQUEST_LOG ?? null,
    now: () => new Date(),
    flags: { gaugeProfileApi: flags(env).gaugeProfileApi },
    internalPro: {
      readDb: env.READ_DB ?? null,
      readPrices: async () =>
        env.PRICES === undefined ? null : readPricesFromKv(env.PRICES),
      cache: typeof caches === "undefined" ? null : caches.default,
      heads: env.BLOCK_HUB ?? null,
      network: "mezo",
      rateLimits,
      liveWallet: createLiveWalletReader(mezo),
      liveClaimable: createLiveClaimableReader(mezoLive),
      liveLocks: createLiveLocksReader(mezoLive),
      lockCount: createLockCountReader(mezoLive),
      balances: createBalanceReader(mezo),
      identity: createIdentityReader({
        fetcher: (url, init) => fetch(url, init),
        logger: logger.child({ task: "mezo-id" }),
      }),
      logger: logger.child({ task: "internal-pro" }),
    },
    blockscout: proxy,
    scan: {
      scanDb: env.SCAN_DB ?? null,
      readDb: env.READ_DB ?? null,
      network: "mezo",
      // Its own cache namespace.
      cache: typeof caches === "undefined" ? null : await caches.open("scan"),
      rateLimits,
      readPrices: async () =>
        env.PRICES === undefined ? null : readPricesFromKv(env.PRICES),
      marketDb: env.MARKET_DB ?? null,
      proxy,
      clock,
      mezoIds: createMezoIdResolver({
        fetcher: (url, init) => fetch(url, init),
        logger: logger.child({ task: "mezo-id" }),
      }),
      chain: {
        lock: createLiveLockReader(scanChain, undefined, scanRequests),
        owner: createOwnerLocksReader(scanChain, undefined, scanRequests),
        latest: createLatestLockIdsReader(scanChain, undefined, scanRequests),
        tx: createLiveTxReader(scanChain),
      },
      gauges:
        market === null
          ? null
          : async () => {
              const epoch = await market.latestEpoch(
                "mezo",
                epochStartOf(Math.floor(Date.now() / 1000)),
              )
              return epoch === null
                ? []
                : market.listGauges("mezo", epoch.epochStart, {
                    voter: null,
                    gauges: null,
                  })
            },
      logger: logger.child({ task: "scan-routes" }),
    },
    config: {
      apiKeyPepper: pepper,
      version: env.API_VERSION,
      environment: env.ENVIRONMENT,
      ...(env.PUBLISHABLE_QUOTA_SHARE === null
        ? {}
        : { publishableQuotaShare: env.PUBLISHABLE_QUOTA_SHARE }),
      internalToken: usableInternalToken(env.INTERNAL_TOKEN, env.ENVIRONMENT),
    },

    logger,
  })
  return { ok: true, runtime: { env, store, market, app } }
}

/** The configured Mezo RPC first, then the public fallbacks. */
function mezoRpcUrls(env: WorkerEnv): string[] {
  return env.MEZO_MAINNET_RPC_URL === null
    ? [...defaultHeadRpcUrls]
    : [env.MEZO_MAINNET_RPC_URL, ...defaultHeadRpcUrls]
}

/** Parses bindings once per isolate (rebuilt if the env object changes). */
function loadRuntime(raw: unknown): Promise<RuntimeResult> {
  if (cached === null || cached.raw !== raw) {
    cached = { raw, runtime: buildRuntime(raw) }
  }
  return cached.runtime
}

function misconfigured(): Response {
  const requestId = generateRequestId()
  return Response.json(buildErrorBody({ code: "internal_error", requestId }), {
    status: 500,
    headers: { "Cache-Control": "no-store", "X-Request-Id": requestId },
  })
}

function chainReaders(
  env: WorkerEnv,
): Partial<Record<"mezo" | "mezo-testnet", ChainReader>> {
  const readers: Partial<Record<"mezo" | "mezo-testnet", ChainReader>> = {}
  if (env.MEZO_MAINNET_RPC_URL !== null) {
    readers.mezo = createViemChainReader("mezo", env.MEZO_MAINNET_RPC_URL)
  }
  if (env.MEZO_TESTNET_RPC_URL !== null) {
    readers["mezo-testnet"] = createViemChainReader(
      "mezo-testnet",
      env.MEZO_TESTNET_RPC_URL,
    )
  }
  return readers
}

function marketReaders(
  env: WorkerEnv,
): Partial<Record<"mezo" | "mezo-testnet", MarketReader>> {
  const readers: Partial<Record<"mezo" | "mezo-testnet", MarketReader>> = {}
  if (env.MEZO_MAINNET_RPC_URL !== null) {
    readers.mezo = createViemMarketReader("mezo", env.MEZO_MAINNET_RPC_URL)
  }
  if (env.MEZO_TESTNET_RPC_URL !== null) {
    readers["mezo-testnet"] = createViemMarketReader(
      "mezo-testnet",
      env.MEZO_TESTNET_RPC_URL,
    )
  }
  return readers
}

async function runHealthCheck(raw: unknown): Promise<void> {
  try {
    const loaded = await loadRuntime(raw)
    if (!loaded.ok) return
    const { env, store } = loaded.runtime
    // A deployment with no probe targets (the v2 preview) shares the health
    // dataset with live and has no chain-sync rows of its own: it runs this
    // cron for the gauge votes only.
    if (env.HEALTH_API_URL === null && env.HEALTH_ID_URL === null) return
    const readers = chainReaders(env)
    await runHealthProbes({
      fetch: (input, init) => fetch(input, init),
      apiHealthUrl: env.HEALTH_API_URL,
      idDiscoveryUrl: env.HEALTH_ID_URL,
      latestChainSync: (network) => store.latestChainSync(network),
      headBlock: async (network) => {
        const reader = readers[network]
        return reader === undefined ? null : reader.blockNumber()
      },
      deployment: env.ENVIRONMENT,
      now: () => new Date(),
      sink: env.HEALTH_LOG ?? null,
      logger: logger.child({ task: "health-probes" }),
    })
  } catch (error) {
    logger.error({ message: "Scheduled health probes crashed", error })
  }
}

async function runReconciliation(raw: unknown): Promise<void> {
  try {
    const loaded = await loadRuntime(raw)
    if (!loaded.ok) return
    await reconcileChainState({
      store: loaded.runtime.store,
      readers: chainReaders(loaded.runtime.env),
      now: () => new Date(),
      logger: logger.child({ task: "reconcile-chain-state" }),
    })
  } catch (error) {
    logger.error({ message: "Scheduled reconciliation crashed", error })
  }
}

/** Boost gauge → veBTC token id from curated profiles on `network`. */
async function profileBoostTokens(
  store: ApiStore,
  network: "mezo" | "mezo-testnet",
): Promise<Map<string, string>> {
  const targets = await store.listProfilesForReconciliation()
  const tokens = new Map<string, string>()
  for (const target of targets) {
    if (
      target.network === network &&
      target.profileType === "boost-gauge" &&
      target.vebtcTokenId !== null
    ) {
      tokens.set(target.gaugeAddress, target.vebtcTokenId)
    }
  }
  return tokens
}

/**
 * The jobs Worker's MEZO reading in KV older than this is not reused. With
 * a Demo key that Worker reads CoinGecko every 6 minutes, so 8 leaves two
 * minutes of slack and this cron never spends a call of its own unless
 * that Worker stalls (apps/jobs README "CoinGecko call budget").
 */
const marketPriceCacheSeconds = 8 * 60

/**
 * Reference prices for the market snapshot. MEZO reuses the jobs Worker's
 * CoinGecko reading from KV while it is fresh, so this cron adds no
 * CoinGecko calls of its own unless that Worker stalls.
 */
async function marketPrices(env: WorkerEnv): Promise<ReferencePrices> {
  const kv =
    env.PRICES === undefined ? null : await readPricesFromKv(env.PRICES)
  const { btcUsd, mezoUsd } = await readReferencePrices({
    mezoMainnetRpcUrl: env.MEZO_MAINNET_RPC_URL,
    baseRpcUrl: env.BASE_RPC_URL,
    coingecko: { apiKey: env.COINGECKO_API_KEY, plan: env.COINGECKO_API_PLAN },
    cachedMezoUsd: cachedMezoFromKv(kv),
    cacheMaxAgeSeconds: marketPriceCacheSeconds,
    logger: logger.child({ task: "market-prices" }),
  })
  return { btcUsd, mezoUsd }
}

async function runMarketSync(raw: unknown): Promise<void> {
  try {
    const loaded = await loadRuntime(raw)
    if (!loaded.ok) return
    const { env, store, market } = loaded.runtime
    if (market === null) return
    await syncMarket({
      store: market,
      readers: marketReaders(env),
      readPrices: () => marketPrices(env),
      profileBoostTokens: (network) => profileBoostTokens(store, network),
      now: () => new Date(),
      logger: logger.child({ task: "market-snapshot" }),
    })
    const now = new Date()
    if (env.MARKET_DB !== undefined) {
      await refreshVoterEpochs({
        db: env.MARKET_DB,
        network: "mezo",
        nowSeconds: Math.floor(now.getTime() / 1000),
        logger: logger.child({ task: "voter-epochs" }),
      })
    }
    if (env.READ_DB !== undefined && isGaugePublishMinute(now)) {
      const client = createMezoClient(mezoRpcUrls(env))
      await publishGaugeReadModels({
        network: "mezo",
        market,
        store,
        publicProfiles:
          env.PROFILES_SUPABASE_URL === null ||
          env.PROFILES_SUPABASE_KEY === null
            ? null
            : {
                url: env.PROFILES_SUPABASE_URL,
                key: env.PROFILES_SUPABASE_KEY,
              },
        readDb: env.READ_DB,
        prices: env.PRICES ?? null,
        chain: createGaugeChainReader(client),
        labels:
          env.MARKET_DB === undefined
            ? null
            : createGaugeLabelReader({
                db: env.MARKET_DB,
                network: "mezo",
                client,
                fetcher: (url, init) => fetch(url, init),
                knownPair: (symbol) =>
                  pairFromSymbol(symbol, tokensBySymbol([])) !== null,
                logger: logger.child({ task: "gauge-labels" }),
              }),
        details: createGaugeDetailsReader({
          client,
          db: env.MARKET_DB ?? null,
          network: "mezo",
          logger: logger.child({ task: "gauge-details" }),
        }),
        avatars: {
          fetcher: (url, init) => fetch(url, init),
          budget: defaultExtractBudget,
        },
        now: () => now,
        logger: logger.child({ task: "gauge-read-models" }),
      })
    }
  } catch (error) {
    logger.error({ message: "Scheduled market snapshot crashed", error })
  }
}

/**
 * Every minute: each gauge's votes from the chain into the gauge directory,
 * written only when a vote changed them (read-models/gauge-votes.ts).
 */
async function runGaugeVotesRefresh(raw: unknown): Promise<void> {
  try {
    const loaded = await loadRuntime(raw)
    if (!loaded.ok) return
    const { env, market } = loaded.runtime
    if (env.READ_DB === undefined) return
    const readers = createGaugeVotesReader(createMezoClient(mezoRpcUrls(env)))
    await refreshGaugeVotes({
      network: "mezo",
      readDb: env.READ_DB,
      market,
      votes: readers.votes,
      boosts: readers.boosts,
      now: () => new Date(),
      logger: logger.child({ task: "gauge-votes" }),
    })
  } catch (error) {
    logger.warn({ message: "Gauge votes refresh failed", error })
  }
}

async function handleFetch(
  request: Request,
  env: unknown,
  ctx: ExecutionContext,
): Promise<Response> {
  const loaded = await loadRuntime(env)
  if (!loaded.ok) return misconfigured()
  const upgrade = await routeHeadsUpgrade(
    request,
    env,
    usableInternalToken(
      loaded.runtime.env.INTERNAL_TOKEN,
      loaded.runtime.env.ENVIRONMENT,
    ),
  )
  if (upgrade !== null) return upgrade
  return loaded.runtime.app.fetch(request, env, ctx)
}

/**
 * Named entrypoint for service bindings (`"entrypoint": "InternalApi"` in
 * the caller's binding). Routes and workers.dev only reach the default
 * export, so every request here is a binding call and may use
 * `/internal/*` whatever URL the caller built (src/internal/access.ts).
 */
export class InternalApi extends WorkerEntrypoint<unknown> {
  override fetch(request: Request): Promise<Response> {
    markBindingRequest(request)
    return handleFetch(request, this.env, this.ctx)
  }
}

export default {
  fetch(
    request: Request,
    env: unknown,
    ctx: ExecutionContext,
  ): Promise<Response> {
    return handleFetch(request, env, ctx)
  },

  async scheduled(
    controller: ScheduledController,
    env: unknown,
    ctx: ExecutionContext,
  ): Promise<void> {
    if (controller.cron === healthProbeCron) {
      ctx.waitUntil(runHealthCheck(env))
      ctx.waitUntil(runGaugeVotesRefresh(env))
      return
    }
    if (controller.cron === marketCron) {
      ctx.waitUntil(runMarketSync(env))
      return
    }
    ctx.waitUntil(runReconciliation(env))
  },
} satisfies ExportedHandler<unknown>
