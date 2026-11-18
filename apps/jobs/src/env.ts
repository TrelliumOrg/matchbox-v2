import { z } from "zod"

/** Worker bindings, validated once per invocation. */

function hasFunctions(value: unknown, names: readonly string[]): boolean {
  if (typeof value !== "object" || value === null) return false
  return names.every((name) => typeof Reflect.get(value, name) === "function")
}

const optionalText = z
  .string()
  .trim()
  .optional()
  .transform((value) =>
    value === undefined || value.length === 0 ? null : value,
  )

/** A positive integer, or null when unset. */
const optionalPositiveInt = optionalText.transform((value, context) => {
  if (value === null) return null
  const parsed = Number.parseInt(value, 10)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    context.addIssue({ code: "custom", message: "Expected a positive integer" })
    return z.NEVER
  }
  return parsed
})

function positiveInt(fallback: number) {
  return optionalText.transform((value, context) => {
    if (value === null) return fallback
    const parsed = Number.parseInt(value, 10)
    if (!Number.isInteger(parsed) || parsed <= 0) {
      context.addIssue({
        code: "custom",
        message: "Expected a positive integer",
      })
      return z.NEVER
    }
    return parsed
  })
}

export const jobsEnvSchema = z.object({
  ENVIRONMENT: z.string().trim().min(1).default("production"),
  READ_DB: z.custom<D1Database>(
    (value) => hasFunctions(value, ["prepare", "batch"]),
    { message: "READ_DB must be a D1 database" },
  ),
  PRICES: z.custom<KVNamespace>(
    (value) => hasFunctions(value, ["get", "put"]),
    { message: "PRICES must be a KV namespace" },
  ),
  /** Comma-separated Mezo RPCs, primary first; defaults to Mezo's public. */
  MEZO_RPC_URLS: optionalText.transform((value) =>
    value === null
      ? null
      : value
          .split(",")
          .map((url) => url.trim())
          .filter((url) => url.length > 0),
  ),
  /** Preferred Base RPC for the MEZO fallback; public Base RPCs follow it. */
  BASE_RPC_URL: optionalText,
  /** CoinGecko key (secret); unset calls the keyless public API. */
  COINGECKO_API_KEY: optionalText,
  /** "demo" (api.coingecko.com) or "pro" (pro-api.coingecko.com). */
  COINGECKO_API_PLAN: z.enum(["demo", "pro"]).default("demo"),
  /**
   * Seconds a CoinGecko reading is reused. Unset: 90 keyless or with a
   * paid key, 360 with a Demo key, and a Demo key never goes below 300
   * (src/coingecko-budget.ts, README "CoinGecko call budget").
   */
  COINGECKO_REFRESH_SECONDS: optionalPositiveInt,
  /**
   * Preferred Ethereum and BNB Chain RPCs for the cross-chain reads (secrets
   * when keyed); public RPCs follow them (src/crosschain/rpc.ts).
   */
  ETHEREUM_RPC_URL: optionalText,
  BSC_RPC_URL: optionalText,
  /**
   * Neon connection string for the read-only `matchbox_api_ro` role
   * (secret). Absent: the warehouse snapshot is skipped.
   */
  WAREHOUSE_DATABASE_URL: optionalText,
  /**
   * Most wallets the rotating sweep rebuilds per warehouse run, on top of
   * changed and requested ones. The run adapts its sweep below this to stay
   * near 20 s. 150 keeps D1 near 45,000 row writes a day: a swept wallet
   * with decaying voting power rewrites its overview on every visit.
   */
  WAREHOUSE_SWEEP_WALLETS: positiveInt(150),
  /** eth_getLogs windows (10,000 blocks) per live run for Morpho accounts. */
  MORPHO_LOG_WINDOWS_PER_RUN: positiveInt(20),
  /**
   * Validator uptime: the CometBFT RPC and Cosmos REST base URLs read
   * first (default Pathrock's public archive node) and the live fallback
   * (default Lavender Five's pruned node, which only holds recent heights).
   * README "Validator uptime".
   */
  UPTIME_RPC_URL: optionalText,
  UPTIME_REST_URL: optionalText,
  UPTIME_FALLBACK_RPC_URL: optionalText,
  UPTIME_FALLBACK_REST_URL: optionalText,
  /** Most heights one uptime run reads (about 16 are produced a minute). */
  UPTIME_HEIGHTS_PER_RUN: positiveInt(120),
})

export type JobsEnv = z.output<typeof jobsEnvSchema>

export type JobsEnvResult =
  | { ok: true; env: JobsEnv }
  | { ok: false; problems: string[] }

export function parseJobsEnv(raw: unknown): JobsEnvResult {
  const parsed = jobsEnvSchema.safeParse(raw)
  if (parsed.success) return { ok: true, env: parsed.data }
  return {
    ok: false,
    problems: parsed.error.issues.map(
      (issue) => `${issue.path.join(".")}: ${issue.message}`,
    ),
  }
}
