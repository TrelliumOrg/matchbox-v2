import type {
  RateLimitPolicy,
  RateLimitResult,
} from "@matchbox/contracts/rate-limits"
import { rateLimitResultSchema } from "@matchbox/contracts/rate-limits"
import {
  consumeRateLimit,
  dayMs,
  emptyRateLimitSnapshot,
  type RateLimiterNamespace,
  type RateLimitSnapshot,
  rateLimitSnapshotSchema,
} from "@matchbox/server"

// Daily model spend, metered in micro-USD through the same RateLimiter
// Durable Object namespace as the request limits: one bucket per UTC day
// (`stuart-spend:2026-11-08`) whose daily limit is the budget. Questions
// that need the model check it first; deterministic answers cost nothing
// and never check it. Each IP prefix also has its own daily bucket
// (`stuart-spend:2026-11-08:ip:203.0.113.0/24`), so one visitor cannot
// spend the whole day's budget for everyone.

export type SpendCheck =
  | { capped: false }
  | { capped: true; retryAfterSeconds: number }

export type SpendMeter = {
  check: () => Promise<SpendCheck>
  /** Adds one turn's estimated cost; fills the bucket when it overflows. */
  record: (costMicroUsd: bigint) => Promise<void>
}

/** The bucket operations the meter needs; a Durable Object or memory. */
export type SpendBucket = {
  consume: (
    key: string,
    policy: RateLimitPolicy,
    cost: number,
  ) => Promise<RateLimitResult>
  peek: (key: string) => Promise<RateLimitSnapshot>
}

export function durableSpendBucket(
  namespace: RateLimiterNamespace,
): SpendBucket {
  return {
    async consume(key, policy, cost) {
      const stub = namespace.get(namespace.idFromName(key))
      return rateLimitResultSchema.parse(await stub.consume(policy, cost))
    },
    async peek(key) {
      const stub = namespace.get(namespace.idFromName(key))
      return rateLimitSnapshotSchema.parse(await stub.peek())
    },
  }
}

/** Same window maths in memory, for tests and local dev. */
export function memorySpendBucket(now: () => number = Date.now): SpendBucket {
  const snapshots = new Map<string, RateLimitSnapshot>()
  return {
    async consume(key, policy, cost) {
      const stored = snapshots.get(key) ?? emptyRateLimitSnapshot
      const { state, result } = consumeRateLimit(
        stored.state,
        policy,
        now(),
        cost,
      )
      if (result.allowed) snapshots.set(key, { state, policy })
      return result
    },
    async peek(key) {
      return structuredClone(snapshots.get(key) ?? emptyRateLimitSnapshot)
    },
  }
}

export function spendKey(nowMs: number, visitor?: string): string {
  const day = `stuart-spend:${new Date(nowMs).toISOString().slice(0, 10)}`
  return visitor === undefined ? day : `${day}:ip:${visitor}`
}

function secondsToNextDay(nowMs: number): number {
  const next = (Math.floor(nowMs / dayMs) + 1) * dayMs
  return Math.max(1, Math.ceil((next - nowMs) / 1000))
}

// Bucket counters are integers; micro-USD stays far below 2^53 for any
// daily budget (25 USD = 25,000,000).
function counter(value: bigint): number {
  return Number(value)
}

export function createSpendMeter(input: {
  bucket: SpendBucket
  budgetMicroUsd: bigint
  /** The visitor's IP prefix and its own daily budget; null skips it. */
  visitor?: { key: string; budgetMicroUsd: bigint } | null
  forced: boolean
  now: () => number
}): SpendMeter {
  const budget = counter(input.budgetMicroUsd)
  const visitor = input.visitor ?? null
  // Every bucket the meter spends: the day's, then the visitor's.
  const buckets = (nowMs: number) => [
    { key: spendKey(nowMs), budget },
    ...(visitor === null
      ? []
      : [
          {
            key: spendKey(nowMs, visitor.key),
            budget: counter(visitor.budgetMicroUsd),
          },
        ]),
  ]
  function used(snapshot: RateLimitSnapshot, nowMs: number): number {
    const day = snapshot.state.day
    return day !== null && day.window === Math.floor(nowMs / dayMs)
      ? day.count
      : 0
  }
  return {
    async check() {
      const nowMs = input.now()
      if (input.forced || budget <= 0) {
        return { capped: true, retryAfterSeconds: secondsToNextDay(nowMs) }
      }
      for (const bucket of buckets(nowMs)) {
        if (bucket.budget <= 0) continue
        const snapshot = await input.bucket.peek(bucket.key)
        if (used(snapshot, nowMs) >= bucket.budget) {
          return { capped: true, retryAfterSeconds: secondsToNextDay(nowMs) }
        }
      }
      return { capped: false }
    },
    async record(costMicroUsd) {
      if (costMicroUsd <= 0n) return
      const nowMs = input.now()
      const cost = counter(costMicroUsd)
      for (const bucket of buckets(nowMs)) {
        if (bucket.budget <= 0) continue
        const policy: RateLimitPolicy = {
          perMinute: bucket.budget,
          perDay: bucket.budget,
        }
        const result = await input.bucket.consume(bucket.key, policy, cost)
        if (result.allowed) continue
        // Over budget: fill the bucket so the next check sees the cap.
        const remaining =
          bucket.budget - used(await input.bucket.peek(bucket.key), nowMs)
        if (remaining > 0) {
          await input.bucket.consume(bucket.key, policy, remaining)
        }
      }
    },
  }
}
