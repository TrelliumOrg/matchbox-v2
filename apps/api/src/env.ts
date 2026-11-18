import type { RateLimiterNamespace } from "@matchbox/server"
import { z } from "zod"

/**
 * Worker bindings, validated once per isolate. Secrets come from
 * `wrangler secret put`; vars from `wrangler.jsonc`.
 */

function hasFunctions(value: unknown, names: readonly string[]): boolean {
  if (typeof value !== "object" || value === null) return false
  return names.every((name) => typeof Reflect.get(value, name) === "function")
}

function isRateLimiterNamespace(value: unknown): value is RateLimiterNamespace {
  return hasFunctions(value, ["idFromName", "get"])
}

function isAnalyticsDataset(value: unknown): value is AnalyticsEngineDataset {
  return hasFunctions(value, ["writeDataPoint"])
}

function isD1Database(value: unknown): value is D1Database {
  return hasFunctions(value, ["prepare", "batch"])
}

function isKvNamespace(value: unknown): value is KVNamespace {
  return hasFunctions(value, ["get", "put", "list"])
}

function isDurableObjectNamespace(
  value: unknown,
): value is DurableObjectNamespace {
  return hasFunctions(value, ["idFromName", "get"])
}

const optionalText = z
  .string()
  .trim()
  .optional()
  .transform((value) =>
    value === undefined || value.length === 0 ? null : value,
  )

/** `PUBLISHABLE_QUOTA_SHARE`: a number in (0, 1]; blank = default. */
const quotaShareSchema = optionalText.transform((value, context) => {
  if (value === null) return null
  const share = Number(value)
  if (!Number.isFinite(share) || share <= 0 || share > 1) {
    context.addIssue({
      code: "custom",
      message: "PUBLISHABLE_QUOTA_SHARE must be a number in (0, 1]",
    })
    return z.NEVER
  }
  return share
})

export const platformStoreSchema = z.enum(["supabase", "memory"])

/** Blockscout lags the head by a few blocks; 30 is about two minutes. */
export const defaultFinalityDepth = 30

export type PlatformStore = z.infer<typeof platformStoreSchema>

/** Fixed pepper for memory mode only; production requires a real secret. */
export const memoryModePepper = "matchbox-local-memory-mode-pepper"

export const workerEnvSchema = z
  .object({
    ENVIRONMENT: z.string().trim().min(1).default("production"),
    API_VERSION: z.string().trim().min(1).default("2.1.0"),
    GAUGE_PROFILE_API_ENABLED: z.string().default("false"),
    PLATFORM_STORE: platformStoreSchema.default("supabase"),
    PUBLISHABLE_QUOTA_SHARE: quotaShareSchema,

    SUPABASE_URL: optionalText,
    SUPABASE_SERVICE_ROLE_KEY: optionalText,
    API_KEY_PEPPER: optionalText,
    MEZO_MAINNET_RPC_URL: optionalText.pipe(z.url().nullable()),
    MEZO_TESTNET_RPC_URL: optionalText.pipe(z.url().nullable()),
    /** Preferred Base RPC for the MEZO/USD fallback; public RPCs follow it. */
    BASE_RPC_URL: optionalText.pipe(z.url().nullable()),
    /** CoinGecko key (secret); unset calls the keyless public API. */
    COINGECKO_API_KEY: optionalText,
    /** "demo" (api.coingecko.com) or "pro" (pro-api.coingecko.com). */
    COINGECKO_API_PLAN: z.enum(["demo", "pro"]).default("demo"),
    /** Market snapshots (gauges, incentives); absent → market routes 503. */
    MARKET_DB: z
      .custom<D1Database>(isD1Database, {
        message: "MARKET_DB must be a D1 database",
      })
      .optional(),
    /** Pro read models (`read_models` and live tables, apps/jobs migrations). */
    READ_DB: z
      .custom<D1Database>(isD1Database, {
        message: "READ_DB must be a D1 database",
      })
      .optional(),
    /**
     * matchbox-scan: Matchscan's explorer rows (apps/jobs/scan-migrations),
     * read by /internal/scan; absent answers 503 there.
     */
    SCAN_DB: z
      .custom<D1Database>(isD1Database, {
        message: "SCAN_DB must be a D1 database",
      })
      .optional(),
    /** Prices written by matchbox-jobs (`prices:v1`). */
    PRICES: z
      .custom<KVNamespace>(isKvNamespace, {
        message: "PRICES must be a KV namespace",
      })
      .optional(),
    /** BlockHub Durable Object (`/internal/heads`). */
    BLOCK_HUB: z
      .custom<DurableObjectNamespace>(isDurableObjectNamespace, {
        message: "BLOCK_HUB must be a Durable Object namespace",
      })
      .optional(),
    /**
     * Supabase project URL and publishable key for curated gauge profiles
     * (public tables). Set on the preview, whose memory store has none.
     */
    PROFILES_SUPABASE_URL: optionalText.pipe(z.url().nullable()),
    PROFILES_SUPABASE_KEY: optionalText,
    /**
     * Bearer token that lets a public caller reach `/internal/*` (local
     * development). Unset: only service binding callers can.
     */
    INTERNAL_TOKEN: optionalText,
    /** Blockscout API key for the proxy (`apikey`); optional. */
    BLOCKSCOUT_API_KEY: optionalText,
    /**
     * Blocks behind the head before the proxy caches a block or
     * transaction as immutable (default 30).
     */
    BLOCKSCOUT_FINALITY_DEPTH: z.coerce
      .number()
      .int()
      .min(0)
      .max(10_000)
      .default(defaultFinalityDepth),
    /**
     * N for the proxy's address views: answered from the stored copy and
     * refreshed at most once per N blocks (default 4, about 15 s).
     */
    BLOCKSCOUT_REVALIDATE_BLOCKS: z.coerce
      .number()
      .int()
      .min(1)
      .max(100)
      .default(4),
    /** Health cron targets; blank skips that probe. */
    HEALTH_API_URL: optionalText.pipe(z.url().nullable()),
    HEALTH_ID_URL: optionalText.pipe(z.url().nullable()),
    RATE_LIMITER: z.custom<RateLimiterNamespace>(isRateLimiterNamespace, {
      message: "RATE_LIMITER Durable Object binding is missing",
    }),
    REQUEST_LOG: z
      .custom<AnalyticsEngineDataset>(isAnalyticsDataset, {
        message: "REQUEST_LOG must be an Analytics Engine dataset",
      })
      .optional(),
    /** `mbx_platform_health`; absent disables probe writes. */
    HEALTH_LOG: z
      .custom<AnalyticsEngineDataset>(isAnalyticsDataset, {
        message: "HEALTH_LOG must be an Analytics Engine dataset",
      })
      .optional(),
  })
  .superRefine((env, context) => {
    if (env.PLATFORM_STORE === "memory") {
      if (env.ENVIRONMENT === "production") {
        context.addIssue({
          code: "custom",
          path: ["PLATFORM_STORE"],
          message:
            "PLATFORM_STORE=memory is refused when ENVIRONMENT=production",
        })
      }
      return
    }
    for (const name of [
      "SUPABASE_URL",
      "SUPABASE_SERVICE_ROLE_KEY",
      "API_KEY_PEPPER",
    ] as const) {
      if (env[name] === null) {
        context.addIssue({
          code: "custom",
          path: [name],
          message: `${name} is required`,
        })
      }
    }
    if (env.API_KEY_PEPPER !== null && env.API_KEY_PEPPER.length < 32) {
      context.addIssue({
        code: "custom",
        path: ["API_KEY_PEPPER"],
        message: "API_KEY_PEPPER must be at least 32 characters",
      })
    }
  })

export type WorkerEnv = z.output<typeof workerEnvSchema>

export type WorkerEnvResult =
  | { ok: true; env: WorkerEnv }
  | { ok: false; problems: string[] }

/** Validates bindings; reports problem paths without leaking values. */
export function parseWorkerEnv(raw: unknown): WorkerEnvResult {
  const parsed = workerEnvSchema.safeParse(raw)
  if (parsed.success) return { ok: true, env: parsed.data }
  return {
    ok: false,
    problems: parsed.error.issues.map(
      (issue) => `${issue.path.join(".")}: ${issue.message}`,
    ),
  }
}
