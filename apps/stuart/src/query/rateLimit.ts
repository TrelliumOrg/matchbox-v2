import type { RateLimitPolicy } from "@matchbox/contracts/rate-limits"
import type { RateLimitClient } from "@matchbox/server"

// Per-IP-prefix and per-wallet limits, counted in the RateLimiter Durable
// Object (one instance per key). A rejected request does not consume quota.

export type StuartRoute =
  | "chat"
  | "refresh"
  | "support"
  | "mcp"
  | "search"
  | "docs"

export const STUART_LIMITS: Record<
  StuartRoute,
  { ip: RateLimitPolicy; wallet: RateLimitPolicy }
> = {
  chat: {
    ip: { perMinute: 20, perDay: 600 },
    wallet: { perMinute: 12, perDay: 300 },
  },
  refresh: {
    ip: { perMinute: 30, perDay: 2_000 },
    wallet: { perMinute: 30, perDay: 2_000 },
  },
  support: {
    ip: { perMinute: 3, perDay: 20 },
    wallet: { perMinute: 3, perDay: 10 },
  },
  mcp: {
    ip: { perMinute: 30, perDay: 2_000 },
    wallet: { perMinute: 30, perDay: 2_000 },
  },
  // The Ctrl K bar searches as people type (debounced); read only.
  search: {
    ip: { perMinute: 90, perDay: 5_000 },
    wallet: { perMinute: 90, perDay: 5_000 },
  },
  // "Ask about this page" on Matchbox Docs: anonymous, one request per
  // question, keyword search over reviewed notes. No wallet is ever sent.
  docs: {
    ip: { perMinute: 20, perDay: 500 },
    wallet: { perMinute: 20, perDay: 500 },
  },
}

export type LimitOutcome =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number }

/**
 * Checks the IP prefix, then the wallet (when there is one). Keys look like
 * `stuart:chat:ip:203.0.113.0/24` and `stuart:chat:wallet:0xabc…`.
 */
export async function checkStuartLimits(input: {
  client: RateLimitClient
  route: StuartRoute
  ipPrefix: string | null
  wallet: string | null
}): Promise<LimitOutcome> {
  const policies = STUART_LIMITS[input.route]
  const checks: Array<{ key: string; policy: RateLimitPolicy }> = [
    {
      key: `stuart:${input.route}:ip:${input.ipPrefix ?? "unknown"}`,
      policy: policies.ip,
    },
  ]
  if (input.wallet !== null) {
    checks.push({
      key: `stuart:${input.route}:wallet:${input.wallet.toLowerCase()}`,
      policy: policies.wallet,
    })
  }
  for (const check of checks) {
    const result = await input.client.consume(check.key, check.policy)
    if (!result.allowed) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, result.retryAfterSeconds),
      }
    }
  }
  return { allowed: true }
}
