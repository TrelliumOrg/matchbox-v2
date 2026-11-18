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
  canonicalQuery,
  degrade,
  fetchApi,
  fixtureLatency,
} from "./caller.server"
import { nowSeconds } from "./clock.server"
import type { Section } from "./explorer"
import { fixtureResponse } from "./fixtures"
import { readScan } from "./scan/read.server"
import { scanSchemas } from "./scan/schemas"
import {
  type StreakView,
  streakWindow,
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
    try {
      const response = await fetchApi(path)
      status = response.status
      body = response.ok ? await response.json() : null
    } catch (error) {
      log.warn({
        message: "Wallet read failed",
        path,
        error: error instanceof Error ? error.message : String(error),
      })
      degrade()
      return { status: "unavailable" }
    }
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
      path,
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
 * The epochs in the streak window in which any of the wallet's locks had
 * votes: one read of every lock's votes (the Votes tab's), whole for most
 * wallets. A wallet with more votes than one page is asked, for each
 * window epoch that page did not show voted, whether it voted then (one
 * single-row read each, in parallel).
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
  const first = await readScan(
    `owners/${address}/votes`,
    canonicalQuery({ limit: voteLimit }),
    scanSchemas.ownerVotePage,
  )
  if (first.status !== "ok") return failed(first.status)
  const voted = new Set(
    first.data.data.map((vote) => epochIndexFor(vote.epoch_start)),
  )
  if (first.data.nextCursor !== null) {
    const unknown = window.filter((epoch) => !voted.has(epoch))
    const reads = await Promise.all(
      unknown.map((epoch) =>
        readScan(
          `owners/${address}/votes`,
          canonicalQuery({ epoch: epochStartForIndex(epoch), limit: 1 }),
          scanSchemas.ownerVotePage,
        ),
      ),
    )
    for (const [index, each] of reads.entries()) {
      if (each.status !== "ok") return failed(each.status)
      const epoch = unknown[index]
      if (epoch !== undefined && each.data.data.length > 0) voted.add(epoch)
    }
  }
  return { status: "ok", data: voteStreak(voted, current) }
}
