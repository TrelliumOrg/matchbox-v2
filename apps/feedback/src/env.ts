import type { RateLimiterNamespace } from "@matchbox/server"
import { z } from "zod"

/** The Worker's bindings, vars and secrets (wrangler.jsonc lists them). */
export type FeedbackBindings = {
  FEEDBACK_DB: D1Database
  SCREENSHOTS: R2Bucket
  /** Absent in local dev without bindings and in tests. */
  RATE_LIMITER?: RateLimiterNamespace
  ENVIRONMENT?: string
  TURNSTILE_SITE_KEY?: string
  TURNSTILE_SECRET_KEY?: string
  DISCORD_BOT_TOKEN?: string
  DISCORD_FEEDBACK_CHANNEL_ID?: string
  FEEDBACK_ALLOWED_ORIGINS?: string
}

export type FeedbackConfig = {
  environment: string
  allowedOrigins: readonly string[]
  turnstile: { siteKey: string; secretKey: string } | null
  discord: { botToken: string; channelId: string } | null
}

/**
 * The v2 surfaces in production. Preview and staging hosts come from
 * FEEDBACK_ALLOWED_ORIGINS (wrangler.jsonc, env.preview), and the local dev
 * and preview servers are allowed only outside production.
 */
export const PRODUCTION_ORIGINS = [
  "https://pro.matchbox.markets",
  "https://beta.matchbox.markets",
  "https://scan.matchbox.markets",
  "https://docs.matchbox.markets",
  "https://id.matchbox.markets",
  "https://developer.matchbox.markets",
  "https://matchbox.markets",
  "https://www.matchbox.markets",
] as const

/** Each app's `vite dev` and `vite preview` port (apps/<app>/package.json). */
const LOCAL_PORTS = [
  3000, 3001, 3005, 3006, 4173, 4183, 4193, 5175, 5180,
] as const

export const LOCAL_ORIGINS: readonly string[] = LOCAL_PORTS.flatMap((port) => [
  `http://localhost:${port}`,
  `http://127.0.0.1:${port}`,
])

/**
 * A var still holding its wrangler.jsonc placeholder counts as unset, so a
 * deploy that forgot to replace it fails closed instead of half working.
 */
const configured = z
  .string()
  .trim()
  .min(1)
  .refine((value) => !value.startsWith("REPLACE_WITH_"))
  .optional()
  .catch(undefined)
  .transform((value) => value ?? null)

const envSchema = z.object({
  ENVIRONMENT: configured,
  TURNSTILE_SITE_KEY: configured,
  TURNSTILE_SECRET_KEY: configured,
  DISCORD_BOT_TOKEN: configured,
  DISCORD_FEEDBACK_CHANNEL_ID: configured,
  FEEDBACK_ALLOWED_ORIGINS: configured,
})

function originList(value: string | null): string[] {
  return (value ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => /^https?:\/\/[^/\s]+$/.test(origin))
}

export function readFeedbackConfig(env: object): FeedbackConfig {
  const parsed = envSchema.parse(env)
  const environment = parsed.ENVIRONMENT ?? "development"
  return {
    environment,
    allowedOrigins: [
      ...PRODUCTION_ORIGINS,
      ...(environment === "production" ? [] : LOCAL_ORIGINS),
      ...originList(parsed.FEEDBACK_ALLOWED_ORIGINS),
    ],
    turnstile:
      parsed.TURNSTILE_SITE_KEY !== null && parsed.TURNSTILE_SECRET_KEY !== null
        ? {
            siteKey: parsed.TURNSTILE_SITE_KEY,
            secretKey: parsed.TURNSTILE_SECRET_KEY,
          }
        : null,
    discord:
      parsed.DISCORD_BOT_TOKEN !== null &&
      parsed.DISCORD_FEEDBACK_CHANNEL_ID !== null &&
      /^[0-9]{5,25}$/.test(parsed.DISCORD_FEEDBACK_CHANNEL_ID)
        ? {
            botToken: parsed.DISCORD_BOT_TOKEN,
            channelId: parsed.DISCORD_FEEDBACK_CHANNEL_ID,
          }
        : null,
  }
}
