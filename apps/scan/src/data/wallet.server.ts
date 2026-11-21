import { env } from "cloudflare:workers"
import { dataModeFrom } from "@matchbox/app-kit/read-model"
import {
  walletOverviewResponseSchema,
  walletRewardsResponseSchema,
} from "@matchbox/contracts/read-models"
import { epochIndexFor, epochStartForIndex } from "@matchbox/domain/epoch"
import { createLogger } from "@matchbox/logger"
import type { z } from "zod"
import {
  apiReadTimeoutMs,
  canonicalQuery,
  degrade,
  fetchApi,
  fixtureLatency,
} from "./caller.server"
import { nowSeconds } from "./clock.server"
import type { Section } from "./explorer"
import { fixtureResponse } from "./fixtures"
import {
  minimumRetryMs,
  readBudgetMs,
  readScan,
  routeOf,
} from "./scan/read.server"
import { scanSchemas } from "./scan/schemas"
import {
  type StreakView,
  streakWindow,
  votedEpochs,
  voteStreak,
  type WalletView,
  walletView,
} from "./wallet-views"

/**
 * A wallet's rewards, veMEZO votes and voting streak for the address
 * page. Rewards and votes are the read models Matchbox Pro reads
 * (`/internal/pro/wallets/{a}/rewards` and `/overview`, the API's claimable
 * read from the chain over the stored history); the streak is the
 * wallet's lock votes by epoch (`/internal/scan/owners/{a}/votes`). Read only for an address with locks, so a token or a
 * contract never makes the API build a wallet from the chain. Each part
 * degrades on its own.
 */

const log = createLogger({ fields: { service: "matchscan", area: "wallet" } })

type ProRead<T> =
  | { status: "ok"; data: T }
  | { status: "missing" }
  | { status: "rate-limited" }
  | { status: "unavailable" }

/** An answer from the API, or why there was none. */
type Answer =
  | { status: number; body: unknown }
  | { status: "failed"; reason: string }

async function askPro(path: string, timeoutMs: number): Promise<Answer> {
  try {
    const response = await fetchApi(path, timeoutMs)
    return {
      status: response.status,
      body: response.ok ? await response.json() : null,
    }
  } catch (error) {
    const name = error instanceof Error ? error.name : "Error"
    return {
      status: "failed",
      reason: name === "TimeoutError" ? `timeout ${timeoutMs} ms` : name,
    }
  }
}

/** Unreachable, late, or a 5xx other than a wallet still building. */
function passing(answer: Answer): boolean {
  return (
    answer.status === "failed" ||
    (answer.status >= 500 && answer.status !== 503)
  )
}

/**
 * One read, and once more (as `readScan` does) when it failed in passing
 * with at least `minimumRetryMs` of `readBudgetMs` left.
 */
async function askProTwice(path: string): Promise<Answer> {
  const started = Date.now()
  const first = await askPro(path, apiReadTimeoutMs)
  if (!passing(first)) return first
  const left = readBudgetMs - (Date.now() - started)
  const reason = first.status === "failed" ? first.reason : first.status
  if (left < minimumRetryMs) {
    log.warn({
      message: "Wallet read failed",
      route: routeOf(path),
      reason,
      retried: false,
      ms: Date.now() - started,
    })
    return first
  }
  const second = await askPro(path, Math.min(apiReadTimeoutMs, left))
  log.warn({
    message: "Wallet read retried",
    route: routeOf(path),
    reason,
    outcome: second.status === "failed" ? second.reason : second.status,
    ms: Date.now() - started,
  })
  return second
}

async function readPro<T>(
  path: string,
  schema: z.ZodType<{ data: T }>,
): Promise<ProRead<T>> {
  let status: number
  let body: unknown
  if (dataModeFrom(env.SCAN_DATA) === "fixtures") {
    await fixtureLatency()
    const answer = fixtureResponse(path)
    status = answer.status
    body = answer.body
  } else {
    const answer = await askProTwice(path)
    if (answer.status === "failed") {
      degrade()
      return { status: "unavailable" }
    }
    status = answer.status
    body = answer.body
  }
  if (status === 404) return { status: "missing" }
  if (status === 429) {
    degrade()
    return { status: "rate-limited" }
  }
  if (status < 200 || status >= 300) {
    degrade()
    return { status: "unavailable" }
  }
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    log.error({
      message: "Wallet read failed validation",
      route: routeOf(path),
      issues: parsed.error.issues.slice(0, 5).map((issue) => issue.path),
    })
    degrade()
    return { status: "unavailable" }
  }
  return { status: "ok", data: parsed.data.data }
}

export async function walletRewards(
  address: string,
): Promise<Section<WalletView>> {
  const [rewards, overview] = await Promise.all([
    readPro(
      `/internal/pro/wallets/${address}/rewards`,
      walletRewardsResponseSchema,
    ),
    readPro(
      `/internal/pro/wallets/${address}/overview`,
      walletOverviewResponseSchema,
    ),
  ])
  if (rewards.status === "rate-limited" || overview.status === "rate-limited")
    return { status: "rate-limited" }
  if (rewards.status === "unavailable" && overview.status === "unavailable")
    return { status: "unavailable" }
  return {
    status: "ok",
    data: walletView(
      rewards.status === "ok" ? rewards.data : null,
      overview.status === "ok" ? overview.data : null,
      nowSeconds(),
    ),
  }
}

/** Votes read at once: the API's largest page. */
const voteLimit = 100

function failed(status: string): Section<StreakView> {
  if (status === "rate-limited") return { status: "rate-limited" }
  if (status === "disabled") return { status: "disabled" }
  return { status: "unavailable" }
}

/**
 * The epochs in the streak window in which the wallet voted: one read of
 * every lock's votes (the Votes tab's), whole for most wallets, beside
 * one read of its locks, so a vote carried by a lock that had no power
 * left (expired, withdrawn, merged) does not count (votedEpochs). A
 * wallet with more votes than one page is asked, for each window epoch
 * that page did not show voted, about that epoch alone (one read each, in
 * parallel). Without the locks the votes count as they are.
 */
export async function walletStreak(
  address: string,
): Promise<Section<StreakView>> {
  const now = nowSeconds()
  const current = epochIndexFor(now - (now % 604_800))
  const window = Array.from(
    { length: streakWindow },
    (_, index) => current - index,
  )
  const [first, lockPage] = await Promise.all([
    readScan(
      `owners/${address}/votes`,
      canonicalQuery({ limit: voteLimit }),
      scanSchemas.ownerVotePage,
    ),
    readScan(
      `owners/${address}/locks`,
      canonicalQuery({ limit: voteLimit }),
      scanSchemas.lockPage,
    ),
  ])
  if (first.status !== "ok") return failed(first.status)
  const locks = lockPage.status === "ok" ? lockPage.data.data : null
  const voted = votedEpochs(first.data.data, locks)
  if (first.data.nextCursor !== null) {
    const unknown = window.filter((epoch) => !voted.has(epoch))
    const reads = await Promise.all(
      unknown.map((epoch) =>
        readScan(
          `owners/${address}/votes`,
          canonicalQuery({
            epoch: epochStartForIndex(epoch),
            limit: voteLimit,
          }),
          scanSchemas.ownerVotePage,
        ),
      ),
    )
    for (const [index, each] of reads.entries()) {
      if (each.status !== "ok") return failed(each.status)
      const epoch = unknown[index]
      if (
        epoch !== undefined &&
        votedEpochs(each.data.data, locks).has(epoch)
      ) {
        voted.add(epoch)
      }
    }
  }
  return { status: "ok", data: voteStreak(voted, current) }
}
