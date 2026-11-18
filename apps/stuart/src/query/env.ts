import { z } from "zod"
import { usdToMicro } from "./providers/units"

// The Worker's vars and secrets (wrangler.jsonc lists them). Bindings are
// read in src/index.ts; this file only parses text configuration.

export const DEFAULT_STUART_MODEL = "claude-sonnet-5-5"
export const DEFAULT_DAILY_BUDGET_USD = "25"
// Per IP prefix: one visitor cannot spend the whole day's budget.
export const DEFAULT_IP_DAILY_BUDGET_USD = "3"

export const effortSchema = z.enum(["low", "medium", "high", "xhigh", "max"])

export type StuartEffort = z.infer<typeof effortSchema>

export type StuartConfig = {
  environment: string
  anthropicApiKey: string | null
  model: string
  // Latency-sensitive router: low unless STUART_EFFORT says otherwise.
  effort: StuartEffort
  // Kill switch: STUART_CLAUDE_ENABLED="false" forces deterministic answers.
  claudeEnabled: boolean
  proposalSecret: string | null
  supabaseUrl: string | null
  supabaseServiceRoleKey: string | null
  allowedOrigins: string[]
  // Origins that may call only the public docs endpoint, beside the above.
  docsOrigins: string[]
  mcpEnabled: boolean
  // Daily model spend cap in micro-USD (STUART_DAILY_BUDGET_USD).
  dailyBudgetMicroUsd: bigint
  // Daily model spend per IP prefix in micro-USD (STUART_IP_DAILY_BUDGET_USD).
  ipDailyBudgetMicroUsd: bigint
  // STUART_SPEND_CAP="on" forces the cap (no model calls today).
  spendCapForced: boolean
  mezoRpcUrl: string | null
}

const optionalText = z
  .string()
  .trim()
  .min(1)
  .optional()
  .catch(undefined)
  .transform((value) => value ?? null)

const envSchema = z.object({
  ENVIRONMENT: optionalText,
  ANTHROPIC_API_KEY: optionalText,
  ANTHROPIC_MODEL: optionalText,
  STUART_EFFORT: optionalText,
  STUART_CLAUDE_ENABLED: optionalText,
  PROPOSAL_HMAC_SECRET: optionalText,
  SUPABASE_URL: optionalText,
  SUPABASE_SERVICE_ROLE_KEY: optionalText,
  STUART_ALLOWED_ORIGINS: optionalText,
  MCP_ENABLED: optionalText,
  STUART_DAILY_BUDGET_USD: optionalText,
  STUART_IP_DAILY_BUDGET_USD: optionalText,
  STUART_SPEND_CAP: optionalText,
  MEZO_RPC_URL: optionalText,
})

export const DEFAULT_ALLOWED_ORIGINS = [
  "https://pro.matchbox.markets",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
] as const

/**
 * Matchbox Docs, its preview Worker and its local dev and preview servers.
 * They reach only POST /docs/ask: reviewed notes, no model, no user data.
 */
export const DOCS_ALLOWED_ORIGINS = [
  "https://docs.matchbox.markets",
  "https://matchbox-docs-preview.mallard.workers.dev",
  "http://localhost:3005",
  "http://127.0.0.1:3005",
  "http://localhost:4183",
  "http://127.0.0.1:4183",
] as const

const budgetSchema = z.string().regex(/^(0|[1-9][0-9]*)(\.[0-9]+)?$/)

function budgetMicro(
  value: string | null,
  fallback: string = DEFAULT_DAILY_BUDGET_USD,
): bigint {
  const parsed = budgetSchema.safeParse(value)
  return usdToMicro(parsed.success ? parsed.data : fallback)
}

/** Reads text vars and secrets; anything missing or blank is null. */
export function readStuartConfig(env: object): StuartConfig {
  const parsed = envSchema.parse(env)
  const effort = effortSchema.safeParse(parsed.STUART_EFFORT)
  return {
    environment: parsed.ENVIRONMENT ?? "development",
    anthropicApiKey: parsed.ANTHROPIC_API_KEY,
    model: parsed.ANTHROPIC_MODEL ?? DEFAULT_STUART_MODEL,
    effort: effort.success ? effort.data : "low",
    claudeEnabled: parsed.STUART_CLAUDE_ENABLED !== "false",
    proposalSecret: parsed.PROPOSAL_HMAC_SECRET,
    supabaseUrl: parsed.SUPABASE_URL,
    supabaseServiceRoleKey: parsed.SUPABASE_SERVICE_ROLE_KEY,
    allowedOrigins: [
      ...DEFAULT_ALLOWED_ORIGINS,
      ...(parsed.STUART_ALLOWED_ORIGINS ?? "")
        .split(",")
        .map((origin) => origin.trim())
        .filter((origin) => origin.length > 0),
    ],
    docsOrigins: [...DOCS_ALLOWED_ORIGINS],
    mcpEnabled: parsed.MCP_ENABLED === "true",
    dailyBudgetMicroUsd: budgetMicro(parsed.STUART_DAILY_BUDGET_USD),
    ipDailyBudgetMicroUsd: budgetMicro(
      parsed.STUART_IP_DAILY_BUDGET_USD,
      DEFAULT_IP_DAILY_BUDGET_USD,
    ),
    spendCapForced: parsed.STUART_SPEND_CAP === "on",
    mezoRpcUrl: parsed.MEZO_RPC_URL,
  }
}

export function claudeAvailable(config: StuartConfig): boolean {
  return config.claudeEnabled && config.anthropicApiKey !== null
}

export function supportAvailable(config: StuartConfig): boolean {
  return config.supabaseUrl !== null && config.supabaseServiceRoleKey !== null
}
