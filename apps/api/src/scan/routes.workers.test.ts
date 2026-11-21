import {
  applyD1Migrations,
  createExecutionContext,
  waitOnExecutionContext,
} from "cloudflare:test"
import { env } from "cloudflare:workers"
import {
  blockscoutClientHeader,
  blockscoutEndUserHeader,
} from "@matchbox/contracts/blockscout"
import { errorBodySchema } from "@matchbox/contracts/errors"
import type { Gauge } from "@matchbox/contracts/market"
import type { RateLimitPolicy } from "@matchbox/contracts/rate-limits"
import type { Escrow } from "@matchbox/contracts/read-models"
import {
  demoGaugeDirectory,
  demoGaugeProfile,
} from "@matchbox/contracts/read-models/fixtures"
import {
  scanActivityItemSchema,
  scanAddressDocumentSchema,
  scanAggregateMetaSchema,
  scanAggregatePageSchema,
  scanBlockDocumentSchema,
  scanBorrowEventsSchema,
  scanBorrowPositionsSchema,
  scanBorrowTotalsResponseSchema,
  scanBridgeFlowsSchema,
  scanCrossChainPoolsSchema,
  scanCrossChainPricesSchema,
  scanCrossChainSupplySchema,
  scanEnclaveEventItemSchema,
  scanEnclaveLockSchema,
  scanEnclavePositionSummarySchema,
  scanEpochDetailSchema,
  scanEpochDocumentSchema,
  scanEpochItemSchema,
  scanGaugeEpochAggregateSchema,
  scanGaugeEpochItemSchema,
  scanGaugeRankingSchema,
  scanIncentiveItemSchema,
  scanLabelItemSchema,
  scanLabelMapSchema,
  scanLiquidationItemSchema,
  scanLiveSnapshotSchema,
  scanLockDocumentSchema,
  scanLockItemSchema,
  scanLockVoteItemSchema,
  scanMarketsSchema,
  scanMorphoEventItemSchema,
  scanMorphoMarketSchema,
  scanMorphoPositionSchema,
  scanOwnerVotesPageSchema,
  scanPageSchema,
  scanPriceHistorySchema,
  scanPriceSeriesSchema,
  scanSearchResultSchema,
  scanSeriesSchema,
  scanSeriesSplitSchema,
  scanStabilityPoolSchema,
  scanStatusSchema,
  scanTokenListSchema,
  scanTransactionDocumentSchema,
  scanTroveEventItemSchema,
  scanTroveSchema,
  scanValidatorsSchema,
} from "@matchbox/contracts/scan"
import { EPOCH_ZERO_START } from "@matchbox/domain"
import { createLogger } from "@matchbox/logger"
import {
  createMemoryRateLimitClient,
  errorHandler,
  notFoundHandler,
  type RateLimitClient,
  requestId,
} from "@matchbox/server"
import { Hono } from "hono"
import { beforeEach, describe, expect, it } from "vitest"
import { z } from "zod"
import addressFixture from "../blockscout/fixtures/address.json"
import addressCounters from "../blockscout/fixtures/address-counters.json"
import block from "../blockscout/fixtures/block.json"
import blockTransactions from "../blockscout/fixtures/block-transactions.json"
import transaction from "../blockscout/fixtures/transaction.json"
import transactionLogs from "../blockscout/fixtures/transaction-logs.json"
import transactionTokenTransfers from "../blockscout/fixtures/transaction-token-transfers.json"
import type { ChainClock } from "../blockscout/head"
import { createBlockscoutProxy } from "../blockscout/proxy"
import type { ApiEnv } from "../context"
import { internalAccess } from "../internal/access"
import { cors } from "../middleware/cors"
import { ClaimableUnread } from "../read-models/live-claimable"
import type {
  LatestLockIds,
  LiveLockRead,
  OwnerLocks,
} from "../read-models/live-locks"
import type { LiveLock } from "../read-models/live-wallet"
import { writeReadModels } from "../read-models/store"
import { fulfilledWithin } from "../test-timing"
import { bounded, composedLabelsMs, composedPartsMs } from "./entities"
import {
  activityCount,
  currentEpoch,
  gauge,
  gaugeVoterCount,
  lastEpoch,
  market,
  musd,
  otherGauge,
  people,
  positionId,
  recordRun,
  scanNow,
  seedRead,
  seedScan,
  troveBorrower,
  txHash,
  vebtc,
  vemezo,
  writeStatus,
} from "./fixtures"
import {
  budgetCallMs,
  type ScanChainReaders,
  scanChainBudgetKey,
  scanLiveDeadlineMs,
} from "./live-locks"
import type { LiveTxRead } from "./live-tx"
import liveFixtures from "./live-tx.fixtures.json"
import registerScanRoutes from "./routes"
import { scanEndUserPolicy, scanRateLimitKey } from "./serve"

const base = "https://api.internal/internal/scan"
const blockTx =
  "0x45e0962d6c0fa8ae9d30ba18cf7351ac0fcf3c0487fd231107510ebb0db66988"
const endUser = "aGFzaGVkLWlwLXByZWZpeC0wMDE"

type Reply = { status: number; body?: unknown; delayMs?: number }

/** A fake Blockscout keyed by path below /api/v2/. */
function fakeBlockscout() {
  const replies = new Map<string, Reply>()
  const calls: string[] = []
  /** Full upstream URLs, query included. */
  const urls: string[] = []
  return {
    calls,
    urls,
    reply(path: string, reply: Reply) {
      replies.set(path, reply)
    },
    async fetch(url: string): Promise<Response> {
      const path = new URL(url).pathname.replace("/api/v2/", "")
      calls.push(path)
      urls.push(url)
      const reply = replies.get(path) ?? { status: 404, body: {} }
      if (reply.delayMs !== undefined) {
        await new Promise((resolve) => setTimeout(resolve, reply.delayMs))
      }
      return Response.json(reply.body ?? {}, {
        status: reply.status,
        headers: {
          "x-ratelimit-remaining": "290",
          "x-ratelimit-reset": "1000",
        },
      })
    },
  }
}

let cacheNumber = 0

/**
 * The ExecutionContext of every request so far: the routes hand their edge
 * and D1 writes to waitUntil, and `settled()` waits for those writes
 * themselves, where a fixed pause was too short on a loaded machine.
 */
const contexts: ExecutionContext[] = []

// Only this test's requests: an earlier one may have left a read that
// never answers (on purpose) in its waitUntil.
beforeEach(() => {
  contexts.length = 0
})

/** Waits for the background work (waitUntil) of every request so far. */
async function settled(): Promise<void> {
  await Promise.all(contexts.splice(0).map(waitOnExecutionContext))
}

function harness(
  options: {
    rateLimits?: RateLimitClient | null
    cache?: Cache | null
    /** The proxy's limiter (none by default). */
    proxyRateLimits?: RateLimitClient | null
    /** SCAN_DB; the test database by default. */
    scanDb?: D1Database | null
    /** READ_DB; the test database by default. */
    readDb?: D1Database | null
    /** Matchscan's chain readers; none by default. */
    chain?: ScanChainReaders | null
    /** This epoch's gauges, for decoding live receipts. */
    gauges?: () => Promise<readonly Gauge[]>
    /** The routes' head clock; `state.clock` at once by default. */
    clock?: () => Promise<ChainClock>
  } = {},
) {
  const blockscout = fakeBlockscout()
  const state = {
    now: scanNow * 1000,
    clock: { height: 13_200_000, lastActive: 13_100_000 } as ChainClock,
    prices: { btc: "74000.5" as string | null },
  }
  const logger = createLogger({ sink: () => undefined })
  let cachePromise: Promise<Cache | null> | null = null
  function cache(): Promise<Cache | null> {
    if (options.cache !== undefined) return Promise.resolve(options.cache)
    cachePromise ??= (async () => {
      cacheNumber += 1
      return caches.open(`scan-test-${cacheNumber}`)
    })()
    return cachePromise
  }
  async function build() {
    const shared = await cache()
    const proxy = createBlockscoutProxy({
      apiKey: null,
      fetch: (url) => blockscout.fetch(url),
      cache: null,
      clock: async () => state.clock,
      rateLimits: options.proxyRateLimits ?? null,
      finalityDepth: 30,
      now: () => state.now,
      logger,
    })
    const app = new Hono<ApiEnv>()
    app.use(requestId({ logger }))
    app.use(internalAccess({ internalToken: null }))
    app.use(cors())
    app.onError(errorHandler())
    app.notFound(notFoundHandler)
    // As in production: Pro's routes mark /internal/* public first.
    app.use("/internal/*", async (c, next) => {
      c.set("cors", { kind: "public" })
      await next()
    })
    registerScanRoutes(app, {
      scanDb: options.scanDb === undefined ? env.SCAN_DB : options.scanDb,
      readDb: options.readDb === undefined ? env.READ_DB : options.readDb,
      network: "mezo",
      cache: shared,
      rateLimits:
        options.rateLimits === undefined
          ? createMemoryRateLimitClient(() => state.now)
          : options.rateLimits,
      readPrices: async () => ({
        btc:
          state.prices.btc === null
            ? null
            : {
                usd: state.prices.btc,
                change24h: null,
                source: "mezo-oracle",
                updatedAt: scanNow,
              },
        mezo: null,
      }),
      proxy,
      clock: options.clock ?? (async () => state.clock),
      chain: options.chain ?? null,
      gauges: options.gauges ?? null,
      logger,
      now: () => state.now,
    })
    return app
  }
  let current = build()
  async function get(path: string, init?: RequestInit): Promise<Response> {
    const app = await current
    const ctx = createExecutionContext()
    contexts.push(ctx)
    return app.request(`${base}${path}`, init, undefined, ctx)
  }
  async function json<T>(path: string, schema: z.ZodType<T>): Promise<T> {
    const response = await get(path)
    expect(response.status, `${path}: ${response.status}`).toBe(200)
    return schema.parse(await response.json())
  }
  return {
    blockscout,
    state,
    get,
    json,
    isolate() {
      current = build()
    },
  }
}

/** A UTC day relative to scanNow. */
function day(offset: number): string {
  return new Date((scanNow + offset * 86_400) * 1000).toISOString().slice(0, 10)
}

async function errorCode(response: Response): Promise<string> {
  return errorBodySchema.parse(await response.json()).error.code
}

/** Every page of a list, following nextCursor to the end. */
async function allPages<T>(
  h: ReturnType<typeof harness>,
  path: string,
  item: z.ZodType<T>,
  limit: number,
): Promise<{ items: T[]; pages: number }> {
  const schema = scanPageSchema(item)
  const items: T[] = []
  let cursor: string | null = null
  let pages = 0
  do {
    const separator = path.includes("?") ? "&" : "?"
    const query: string =
      cursor === null
        ? `${separator}limit=${limit}`
        : `${separator}limit=${limit}&cursor=${cursor}`
    const body = await h.json(`${path}${query}`, schema)
    items.push(...body.data)
    cursor = body.nextCursor
    pages += 1
    expect(pages).toBeLessThan(100)
  } while (cursor !== null)
  return { items, pages }
}

let h: ReturnType<typeof harness>

beforeEach(async () => {
  await applyD1Migrations(env.READ_DB, env.TEST_MIGRATIONS)
  await applyD1Migrations(env.SCAN_DB, env.SCAN_MIGRATIONS)
  await seedScan(env.SCAN_DB)
  await seedRead(env.READ_DB)
  h = harness()
})

describe("activity", () => {
  it("pages the global feed to the end, newest first, without repeats", async () => {
    const { items, pages } = await allPages(
      h,
      "/activity",
      scanActivityItemSchema,
      7,
    )
    expect(pages).toBe(5)
    expect(items).toHaveLength(activityCount)
    expect(new Set(items.map((item) => item.id)).size).toBe(activityCount)
    const times = items.map((item) => item.timestamp)
    expect([...times].sort((a, b) => b - a)).toEqual(times)
    expect(items[0]?.extra).toMatchObject({ note: expect.any(String) })
  })

  it("serves a transaction's rows in log order", async () => {
    const body = await h.json(
      `/activity/tx/${txHash}`,
      scanPageSchema(scanActivityItemSchema),
    )
    expect(body.data).toHaveLength(2)
    expect(body.nextCursor).toBeNull()
  })

  it("merges an address's rows as actor and recipient, once each", async () => {
    const { items } = await allPages(
      h,
      `/activity/address/${people.alice}`,
      scanActivityItemSchema,
      4,
    )
    expect(items).toHaveLength(activityCount)
    const bob = await allPages(
      h,
      `/activity/address/${people.bob}?role=recipient`,
      scanActivityItemSchema,
      100,
    )
    expect(bob.items).toHaveLength(activityCount - activityCount / 3)
  })

  it("filters by gauge, lock, epoch and action", async () => {
    const page = scanPageSchema(scanActivityItemSchema)
    expect(
      (await h.json(`/activity/gauge/${gauge}?limit=100`, page)).data,
    ).toHaveLength(activityCount / 2)
    expect(
      (await h.json(`/activity/lock/vemezo/7?limit=100`, page)).data,
    ).toHaveLength(activityCount / 2)
    expect(
      (await h.json(`/activity/epoch/${lastEpoch}?limit=100`, page)).data,
    ).toHaveLength(20)
    const votes = await allPages(
      h,
      "/activity/action/BOOST_VOTE",
      scanActivityItemSchema,
      4,
    )
    expect(votes.items).toHaveLength(activityCount / 2)
  })

  it("answers an empty page for an unknown address", async () => {
    const body = await h.json(
      `/activity/address/${people.nobody}`,
      scanPageSchema(scanActivityItemSchema),
    )
    expect(body).toEqual({ data: [], nextCursor: null, meta: { skipped: 0 } })
  })

  it("rejects bad cursors, other lists' cursors and oversized pages", async () => {
    const first = await h.json(
      "/activity?limit=2",
      scanPageSchema(scanActivityItemSchema),
    )
    const cursor = first.nextCursor ?? ""
    // A cursor from another list.
    expect(
      (await h.get(`/activity/gauge/${gauge}?cursor=${cursor}`)).status,
    ).toBe(400)
    for (const bad of ["x", "AAAAAAAA", `${cursor}x`, "!!!!"]) {
      const response = await h.get(`/activity?cursor=${bad}`)
      expect(response.status, bad).toBe(400)
      expect(await errorCode(response)).toBe("invalid_request")
    }
    expect((await h.get("/activity?limit=101")).status).toBe(400)
    expect((await h.get("/activity?limit=0")).status).toBe(400)
    expect((await h.get("/activity?limit=5&limit=6")).status).toBe(400)
    expect((await h.get("/activity?unknown=1")).status).toBe(400)
    expect((await h.get("/activity/tx/0x123")).status).toBe(404)
    // Default page size.
    const page = await h.json(
      "/activity",
      scanPageSchema(scanActivityItemSchema),
    )
    expect(page.data).toHaveLength(25)
  })
})

describe("locks", () => {
  const page = scanPageSchema(scanLockItemSchema)

  it("lists live locks by amount, unlock and age", async () => {
    const byAmount = await allPages(
      h,
      "/locks?escrow=vebtc",
      scanLockItemSchema,
      2,
    )
    expect(byAmount.items.map((lock) => lock.token_id)).toEqual([
      "3",
      "1",
      "2",
      "4",
    ])
    const byUnlock = await h.json("/locks?escrow=vebtc&order=unlock", page)
    // Timed locks soonest first; the permanent lock (3) after them.
    expect(byUnlock.data.map((lock) => lock.token_id)).toEqual([
      "2",
      "4",
      "1",
      "3",
    ])
    const byCreated = await allPages(
      h,
      `/locks?escrow=${vebtc}&order=created`,
      scanLockItemSchema,
      2,
    )
    // Newest first, the withdrawn lock included.
    expect(byCreated.items.map((lock) => lock.token_id)).toEqual([
      "4",
      "3",
      "2",
      "1",
      "5",
    ])
    expect(byAmount.items[0]?.is_permanent).toBe(true)
    expect((await h.get("/locks?escrow=vexyz")).status).toBe(400)
  })

  it("serves a lock, its votes and an owner's locks", async () => {
    const lock = await h.json(
      "/locks/vebtc/1",
      z.object({ data: scanLockItemSchema }),
    )
    expect(lock.data).toMatchObject({ token_id: "1", owner: people.alice })
    expect(JSON.stringify(lock)).not.toContain("amount_key")
    expect((await h.get("/locks/vebtc/999")).status).toBe(404)
    const votes = await allPages(
      h,
      "/locks/vemezo/7/votes",
      scanLockVoteItemSchema,
      1,
    )
    expect(votes.items.map((vote) => vote.epoch_start)).toEqual([
      currentEpoch,
      currentEpoch,
      lastEpoch,
      lastEpoch,
    ])
    const owned = await allPages(
      h,
      `/owners/${people.alice}/locks`,
      scanLockItemSchema,
      2,
    )
    expect(owned.items.map((item) => item.token_id)).toEqual([
      "1",
      "2",
      "3",
      "5",
    ])
    expect((await h.json(`/owners/${people.nobody}/locks`, page)).data).toEqual(
      [],
    )
  })
})

describe("gauges, incentives and epochs", () => {
  it("pages a gauge's voters by weight, ties by token id", async () => {
    const { items } = await allPages(
      h,
      `/gauges/${gauge}/voters?epoch=${currentEpoch}`,
      scanLockVoteItemSchema,
      4,
    )
    expect(items).toHaveLength(gaugeVoterCount + 1)
    const weights = items.map((vote) => BigInt(vote.weight))
    for (let index = 1; index < weights.length; index += 1) {
      expect((weights[index - 1] ?? 0n) >= (weights[index] ?? 0n)).toBe(true)
    }
    // Without an epoch: the current one.
    const current = await h.json(
      `/gauges/${gauge}/voters?limit=100`,
      scanPageSchema(scanLockVoteItemSchema),
    )
    expect(current.data).toHaveLength(gaugeVoterCount + 1)
    expect((await h.get(`/gauges/${gauge}/voters?epoch=123`)).status).toBe(400)
  })

  it("lists incentives by gauge, epoch and depositor", async () => {
    const byGauge = await allPages(
      h,
      `/gauges/${gauge}/incentives`,
      scanIncentiveItemSchema,
      4,
    )
    expect(byGauge.items).toHaveLength(6)
    const byEpoch = await h.json(
      `/epochs/${lastEpoch}/incentives`,
      scanPageSchema(scanIncentiveItemSchema),
    )
    expect(byEpoch.data).toHaveLength(3)
    const byDepositor = await allPages(
      h,
      `/depositors/${people.bob}/incentives`,
      scanIncentiveItemSchema,
      5,
    )
    expect(byDepositor.items).toHaveLength(6)
  })

  it("serves a gauge's epochs and an epoch's ranking", async () => {
    const history = await allPages(
      h,
      `/gauges/${gauge}/epochs`,
      scanGaugeEpochItemSchema,
      2,
    )
    expect(history.items.map((row) => row.epoch_start)).toEqual([
      currentEpoch,
      lastEpoch,
      currentEpoch - 2 * 604_800,
    ])
    const ranking = await h.json(
      `/epochs/${currentEpoch}/gauges?source=BOOST_VOTER`,
      scanPageSchema(scanGaugeEpochItemSchema),
    )
    expect(ranking.data.map((row) => row.rank)).toEqual([1, 2])
    expect((await h.get(`/epochs/${currentEpoch}/gauges`)).status).toBe(400)
  })

  it("lists no epoch before Epoch 0", async () => {
    // Votes cast the week before Epoch 0 aggregated into an epoch -1 row.
    const before = EPOCH_ZERO_START - 604_800
    await env.SCAN_DB.batch([
      env.SCAN_DB.prepare(
        `INSERT INTO epoch_totals (epoch_start, emission, rebase,
           gauge_rewards, total_supply, vote_transactions, voters,
           vote_weight, gauges, incentives, fees, top_gauge, killed_weight,
           updated_at)
         SELECT ?1, emission, rebase, gauge_rewards, total_supply,
           vote_transactions, voters, vote_weight, gauges, incentives, fees,
           top_gauge, killed_weight, updated_at
         FROM epoch_totals WHERE epoch_start = ?2`,
      ).bind(before, lastEpoch),
      env.SCAN_DB.prepare(
        `INSERT INTO gauge_epoch (epoch_start, gauge, source, pool,
           vote_weight, weight_key, voters, incentives, fees, rank, killed,
           updated_at)
         SELECT ?1, gauge, source, pool, vote_weight, weight_key, voters,
           incentives, fees, rank, killed, updated_at
         FROM gauge_epoch WHERE epoch_start = ?2 AND gauge = ?3`,
      ).bind(before, lastEpoch, gauge),
    ])
    const epochs = await h.json("/epochs", scanPageSchema(scanEpochItemSchema))
    expect(epochs.data.map((epoch) => epoch.epoch_start)).toEqual([
      currentEpoch,
      lastEpoch,
    ])
    const history = await allPages(
      h,
      `/gauges/${gauge}/epochs`,
      scanGaugeEpochItemSchema,
      2,
    )
    expect(history.items.map((row) => row.epoch_start)).not.toContain(before)
  })

  it("serves Pro's gauge directory and profile, keyed by their etag", async () => {
    const directory = await h.get("/gauges")
    expect(directory.status).toBe(200)
    expect(directory.headers.get("X-Scan-Class")).toBe("doc")
    const profile = await h.get(
      `/gauges/${demoGaugeProfile.card.gauge.address}`,
    )
    expect(profile.status).toBe(200)
    expect((await h.get(`/gauges/${people.nobody}`)).status).toBe(404)
    expect((await h.get("/gauges")).headers.get("X-Cache")).toBe("memory")
    // A new publish changes the etag: the next read after the version memo
    // (five seconds) is a miss.
    await writeReadModels(env.READ_DB, [
      {
        network: "mezo",
        kind: "gauge-profile",
        key: demoGaugeProfile.card.gauge.address,
        data: { ...demoGaugeProfile, description: "Changed" },
        block: 13_000_001,
        source: "warehouse",
        updatedAt: scanNow,
      },
    ])
    h.state.now += 6_000
    const changed = await h.get(
      `/gauges/${demoGaugeProfile.card.gauge.address}`,
    )
    expect(changed.headers.get("X-Cache")).toBe("miss")
  })

  it("lists epochs and details one, sealed epochs kept for a day", async () => {
    const epochs = await h.json("/epochs", scanPageSchema(scanEpochItemSchema))
    expect(
      epochs.data.map((epoch) => [epoch.epoch_start, epoch.sealed]),
    ).toEqual([
      [currentEpoch, false],
      [lastEpoch, true],
    ])
    const current = await h.get(`/epochs/${currentEpoch}`)
    expect(current.headers.get("X-Scan-Class")).toBe("run")
    const detail = scanEpochDetailSchema.parse(
      z.object({ data: z.unknown() }).parse(await current.json()).data,
    )
    expect(detail.topGauges.BOOST_VOTER?.map((row) => row.rank)).toEqual([1, 2])
    expect(detail.incentives.data).toHaveLength(3)
    // An epoch the jobs have not aggregated yet: not computed, not zero.
    const missing = await h.json(
      `/epochs/${currentEpoch - 10 * 604_800}`,
      scanEpochDocumentSchema,
    )
    expect(missing).toMatchObject({
      data: null,
      meta: {
        computed: false,
        complete: false,
        asOf: scanNow - 100,
        // No status row in these fixtures: unknown, not false.
        aggregatesComplete: null,
        historyFilled: null,
        stale: false,
      },
    })
    // Before Epoch 0, or not started: no such epoch.
    expect((await h.get(`/epochs/${EPOCH_ZERO_START - 604_800}`)).status).toBe(
      404,
    )
    expect((await h.get(`/epochs/${currentEpoch + 604_800}`)).status).toBe(404)
    // No status row: history_filled unknown, so nothing is sealed.
    expect(
      (await h.get(`/epochs/${lastEpoch}`)).headers.get("X-Scan-Class"),
    ).toBe("run")
    // The last epoch ended two days ago, the history is filled and a run
    // finished since: sealed.
    await writeStatus(env.SCAN_DB)
    h.state.now += 6_000
    const sealed = await h.get(`/epochs/${lastEpoch}`)
    expect(sealed.headers.get("X-Scan-Class")).toBe("long")
    expect(sealed.headers.get("Cache-Control")).toBe("public, max-age=86400")
  })

  it("never seals an epoch before the history fill, or one with no row", async () => {
    await writeStatus(env.SCAN_DB, { history_filled: 0 })
    const unfilled = await h.get(`/epochs/${lastEpoch}`)
    expect(unfilled.headers.get("X-Scan-Class")).toBe("run")
    expect(unfilled.headers.get("Cache-Control")).toBe("public, max-age=30")
    // Filled, but an old epoch with no totals row: computed false, and never
    // kept a day (the next fill may write it).
    await writeStatus(env.SCAN_DB, { history_filled: 1 })
    h.state.now += 6_000
    const old = currentEpoch - 10 * 604_800
    const missing = await h.get(`/epochs/${old}`)
    expect(missing.headers.get("X-Scan-Class")).toBe("run")
    expect(scanEpochDocumentSchema.parse(await missing.json())).toMatchObject({
      data: null,
      meta: { computed: false, historyFilled: true },
    })
    // Its ranking and incentives are not kept a day either.
    for (const path of [
      `/epochs/${old}/gauges?source=BOOST_VOTER`,
      `/epochs/${old}/incentives`,
    ]) {
      expect((await h.get(path)).headers.get("X-Scan-Class")).toBe("run")
    }
  })

  it("keeps no sealed answer a day that skipped a bad row", async () => {
    await writeStatus(env.SCAN_DB)
    await env.SCAN_DB.prepare(
      `UPDATE gauge_epoch SET vote_weight = 'bad'
       WHERE epoch_start = ?1 AND gauge = ?2`,
    )
      .bind(lastEpoch, gauge)
      .run()
    const ranking = await h.get(
      `/epochs/${lastEpoch}/gauges?source=BOOST_VOTER`,
    )
    expect(ranking.status).toBe(200)
    expect(ranking.headers.get("X-Scan-Class")).toBe("run")
    const body = scanGaugeRankingSchema.parse(await ranking.json())
    expect(body.meta.skipped).toBe(1)
    // The whole document of the same sealed epoch is still kept a day.
    await env.SCAN_DB.prepare(
      `UPDATE gauge_epoch SET vote_weight = '1'
       WHERE epoch_start = ?1 AND gauge = ?2`,
    )
      .bind(lastEpoch, gauge)
      .run()
    const whole = harness()
    expect(
      (
        await whole.get(`/epochs/${lastEpoch}/gauges?source=BOOST_VOTER`)
      ).headers.get("X-Scan-Class"),
    ).toBe("long")
  })

  it("marks epochs, rankings and history that are still filling", async () => {
    await env.SCAN_DB.batch([
      env.SCAN_DB.prepare(
        "INSERT INTO scan_dirty (kind, key) VALUES ('epoch', ?1), ('epoch', ?2)",
      ).bind(String(currentEpoch), String(lastEpoch)),
    ])
    const epochs = await h.json(
      "/epochs",
      scanAggregatePageSchema(scanEpochItemSchema),
    )
    expect(epochs.data.map((epoch) => epoch.complete)).toEqual([false, false])
    expect(epochs.meta).toMatchObject({ complete: false, asOf: scanNow - 100 })
    const detail = await h.get(`/epochs/${lastEpoch}`)
    // A dirty epoch is not sealed, so it is keyed by the run.
    expect(detail.headers.get("X-Scan-Class")).toBe("run")
    const body = scanEpochDocumentSchema.parse(await detail.json())
    expect(body.meta).toMatchObject({ complete: false, computed: true })
    const ranking = await h.json(
      `/epochs/${currentEpoch}/gauges?source=BOOST_VOTER`,
      scanAggregatePageSchema(scanGaugeEpochItemSchema),
    )
    expect(ranking.meta.complete).toBe(false)
    const history = await h.json(
      `/gauges/${gauge}/epochs`,
      scanAggregatePageSchema(scanGaugeEpochAggregateSchema),
    )
    expect(history.data.map((row) => row.complete)).toEqual([
      false,
      false,
      true,
    ])
  })

  it("says complete once nothing is left to recompute", async () => {
    const ranking = await h.json(
      `/epochs/${currentEpoch}/gauges?source=BOOST_VOTER`,
      scanAggregatePageSchema(scanGaugeEpochItemSchema),
    )
    expect(ranking.meta).toMatchObject({ complete: true, asOf: scanNow - 100 })
  })
})

describe("borrow", () => {
  it("serves markets, positions with health, and market history", async () => {
    const markets = await h.json(
      "/borrow/markets",
      z.object({ data: z.array(scanMorphoMarketSchema) }),
    )
    expect(markets.data[0]).toMatchObject({
      market_id: market,
      utilization: "500000000000000000",
    })
    const detail = await h.get(`/borrow/markets/${market}`)
    expect(detail.headers.get("X-Scan-Class")).toBe("live")
    const positions = await allPages(
      h,
      `/borrow/markets/${market}/positions`,
      scanMorphoPositionSchema,
      1,
    )
    expect(positions.items).toHaveLength(2)
    const alice = positions.items.find((item) => item.account === people.alice)
    expect(alice?.health.band).toBe("healthy")
    // About 30,000 mUSDC against 1 BTC at 74,000: 40.5% LTV.
    expect(alice?.borrow_assets.startsWith("300000")).toBe(true)
    expect(alice?.health.ltv?.startsWith("405")).toBe(true)
    expect(alice?.health.liquidation_price?.startsWith("3488")).toBe(true)
    const bob = positions.items.find((item) => item.account === people.bob)
    expect(bob?.health.band).toBe("no_debt")
    const events = await h.json(
      `/borrow/markets/${market}/events`,
      scanPageSchema(scanMorphoEventItemSchema),
    )
    expect(events.data).toHaveLength(3)
    const positionEvents = await h.json(
      `/borrow/markets/${market}/positions/${people.alice}/events`,
      scanPageSchema(scanMorphoEventItemSchema),
    )
    expect(positionEvents.data).toHaveLength(3)
    expect((await h.get(`/borrow/markets/0x${"bb".repeat(32)}`)).status).toBe(
      404,
    )
  })

  it("serves troves with health at MUSD's PriceFeed price", async () => {
    const troves = await h.json(
      "/borrow/troves",
      scanPageSchema(scanTroveSchema),
    )
    // Only the open one.
    expect(troves.data.map((trove) => trove.owner)).toEqual([troveBorrower])
    const trove = troves.data[0]
    // 1 BTC at the PriceFeed's 80,000 against 50,000 MUSD: ICR 160%,
    // healthy. At the market's 74,000.5 it would be 148%, at risk.
    expect(trove?.health.band).toBe("healthy")
    expect(trove?.health.collateral_ratio).toBe("1600000000000000000")
    expect(trove?.health.liquidation_price).toBe("55000000000000000000000")
    expect(trove?.health_basis).toEqual({
      source: "price_feed",
      btc_usd: "80000",
      estimate: false,
      block: 13_000_000,
      // Read by the run that last wrote the pool: current.
      stale: false,
      lag_blocks: 0,
    })
    // The owner document prices its trove the same way.
    const owner = await h.json(
      `/borrow/owners/${troveBorrower}`,
      z.object({ data: scanBorrowPositionsSchema }),
    )
    expect(owner.data.trove?.health.band).toBe("healthy")
    const events = await allPages(
      h,
      `/borrow/troves/${troveBorrower}/events`,
      scanTroveEventItemSchema,
      3,
    )
    expect(events.items).toHaveLength(4)
  })

  it("bands troves unknown without a PriceFeed price, whatever the market says", async () => {
    // A reverted read: all three columns NULL, the market price still live.
    await env.READ_DB.prepare(
      `UPDATE stability_pool SET musd_btc_price_raw = NULL,
         musd_btc_price_scale = NULL, musd_btc_price_block = NULL`,
    ).run()
    expect(h.state.prices.btc).not.toBeNull()
    const unpriced = await h.json(
      `/borrow/troves/${troveBorrower}`,
      z.object({ data: scanTroveSchema }),
    )
    expect(unpriced.data.health.band).toBe("unknown")
    expect(unpriced.data.health.collateral_ratio).toBeNull()
    expect(unpriced.data.health.health_factor).toBeNull()
    expect(unpriced.data.health_basis).toEqual({
      source: "price_feed",
      btc_usd: null,
      estimate: false,
      block: null,
      stale: null,
      lag_blocks: null,
    })
    // Its liquidation price needs no price.
    expect(unpriced.data.health.liquidation_price).toBe(
      "55000000000000000000000",
    )
    const list = await h.json("/borrow/troves", scanPageSchema(scanTroveSchema))
    expect(list.data.map((trove) => trove.health.band)).toEqual(["unknown"])
  })

  it("bands troves unknown when the PriceFeed price is older than the trove", async () => {
    // A later run rewrote the trove at 13,000,079 and failed to write the
    // price, last written at 13,000,000.
    await env.READ_DB.prepare(
      "UPDATE troves SET block = 13000079 WHERE owner = ?1",
    )
      .bind(troveBorrower)
      .run()
    const stale = await h.json(
      `/borrow/troves/${troveBorrower}`,
      z.object({ data: scanTroveSchema }),
    )
    expect(stale.data.health.band).toBe("unknown")
    expect(stale.data.health.collateral_ratio).toBeNull()
    expect(stale.data.health_basis).toMatchObject({
      btc_usd: "80000",
      block: 13_000_000,
      stale: true,
      lag_blocks: 79,
    })
    // The owner document and the list say the same.
    const owner = await h.json(
      `/borrow/owners/${troveBorrower}`,
      z.object({ data: scanBorrowPositionsSchema }),
    )
    expect(owner.data.trove?.health.band).toBe("unknown")
  })

  it("bands troves unknown with only the raw price or only its scale", async () => {
    await env.READ_DB.prepare(
      "UPDATE stability_pool SET musd_btc_price_scale = NULL",
    ).run()
    const scaleless = await h.json(
      `/borrow/troves/${troveBorrower}`,
      z.object({ data: scanTroveSchema }),
    )
    expect(scaleless.data.health.band).toBe("unknown")
    await env.READ_DB.prepare(
      `UPDATE stability_pool SET musd_btc_price_scale = 18,
         musd_btc_price_raw = NULL`,
    ).run()
    h.state.now += 400_000
    const rawless = await h.json(
      `/borrow/troves/${troveBorrower}`,
      z.object({ data: scanTroveSchema }),
    )
    expect(rawless.data.health.band).toBe("unknown")
  })

  it("bands a Morpho position with debt and no oracle price unknown", async () => {
    await env.READ_DB.prepare(
      "UPDATE morpho_markets SET oracle_price_raw = NULL",
    ).run()
    const positions = await h.json(
      `/borrow/markets/${market}/positions`,
      scanPageSchema(scanMorphoPositionSchema),
    )
    const borrowing = positions.data.filter(
      (position) => position.borrow_assets !== "0",
    )
    expect(borrowing.length).toBeGreaterThan(0)
    for (const position of borrowing) {
      expect(position.health.band).toBe("unknown")
    }
    const events = await allPages(
      h,
      `/borrow/troves/${troveBorrower}/events`,
      scanTroveEventItemSchema,
      3,
    )
    expect(events.items).toHaveLength(4)
  })

  it("lists liquidations and redemptions, and the stability pool", async () => {
    const liquidations = await h.json(
      "/borrow/liquidations",
      scanPageSchema(scanTroveEventItemSchema),
    )
    expect(liquidations.data.map((row) => row.action)).toEqual([
      "LOAN_LIQUIDATED",
    ])
    const redemptions = await h.json(
      "/borrow/redemptions",
      scanPageSchema(scanTroveEventItemSchema),
    )
    expect(redemptions.data.map((row) => row.action)).toEqual(["LOAN_REDEEMED"])
    const pool = await h.json(
      "/borrow/stability-pool",
      z.object({ data: scanStabilityPoolSchema }),
    )
    expect(pool.data.total_musd_deposits).toBe("12000000000000000000000000")
  })

  it("serves an owner's open positions and Enclave history", async () => {
    const owner = await h.json(
      `/borrow/owners/${people.alice}`,
      z.object({ data: scanBorrowPositionsSchema }),
    )
    expect(owner.data.morpho).toHaveLength(1)
    expect(owner.data.trove).toBeNull()
    expect(owner.data.enclave.map((position) => position.position_id)).toEqual([
      positionId,
    ])
    const history = await allPages(
      h,
      `/borrow/enclave/positions/${positionId}/events`,
      scanEnclaveEventItemSchema,
      1,
    )
    expect(history.items.map((row) => row.ve_btc_token_id)).toEqual([
      "12",
      "11",
    ])
    expect(history.items[0]?.pledged_ve_btc).toEqual(["11", "12"])
    const byBorrower = await h.json(
      `/borrow/enclave/borrowers/${people.alice}/events`,
      scanPageSchema(scanEnclaveEventItemSchema),
    )
    expect(byBorrower.data).toHaveLength(2)
  })
})

describe("series, prices, labels and search", () => {
  it("serves a series with the first and last day present", async () => {
    const series = await h.json(
      `/series?metric=chain.transactions&from=${day(-30)}&to=${day(0)}`,
      z.object({ data: scanSeriesSchema }),
    )
    expect(series.data.points).toHaveLength(10)
    expect(series.data.firstDay).toBe(day(-10))
    expect(series.data.lastDay).toBe(day(-1))
    expect(series.data.points[0]).toEqual({
      day: day(-10),
      value: "800",
      partial: false,
    })
    // Described from the registry, at request time.
    expect(series.data).toMatchObject({
      unit: "count",
      decimals: null,
      kind: "flow",
      signed: false,
      endsOn: null,
    })
    const empty = await h.json(
      `/series?metric=locks.net&dimension=vebtc&from=${day(-5)}&to=${day(-1)}`,
      z.object({ data: scanSeriesSchema }),
    )
    expect(empty.data).toMatchObject({
      points: [],
      firstDay: null,
      lastDay: null,
    })
  })

  it("flags today's point and days still to recompute as partial", async () => {
    // A metric the copy step's day aggregates write (scanMetricRecomputed).
    await env.SCAN_DB.batch([
      env.SCAN_DB.prepare(
        `INSERT INTO daily (metric, dimension, day, value, source, updated_at)
         VALUES ('savings.deposited', '', ?1, '12', 'copy', 1)`,
      ).bind(day(0)),
      ...[-3, -2, -1].map((offset) =>
        env.SCAN_DB.prepare(
          `INSERT INTO daily (metric, dimension, day, value, source, updated_at)
           VALUES ('savings.deposited', '', ?1, '5', 'copy', 1)`,
        ).bind(day(offset)),
      ),
      env.SCAN_DB.prepare(
        "INSERT INTO scan_dirty (kind, key) VALUES ('day', ?1)",
      ).bind(day(-2)),
    ])
    const series = await h.json(
      `/series?metric=savings.deposited&from=${day(-3)}&to=${day(0)}`,
      z.object({ data: scanSeriesSchema }),
    )
    expect(
      series.data.points.map((point) => [point.day, point.partial]),
    ).toEqual([
      [day(-3), false],
      [day(-2), true],
      [day(-1), false],
      [day(0), true],
    ])
  })

  it("says when a backfill-only series ends", async () => {
    await env.SCAN_DB.prepare(
      `INSERT INTO daily (metric, dimension, day, value, source, updated_at)
       VALUES ('chain.active_addresses', '', ?1, '40', 'backfill:chain', 1)`,
    )
      .bind(day(-5))
      .run()
    const series = await h.json(
      `/series?metric=chain.active_addresses&from=${day(-9)}&to=${day(0)}`,
      z.object({ data: scanSeriesSchema }),
    )
    expect(series.data.endsOn).toBe(day(-5))
  })

  it("keeps settled past ranges a day and today's by the half hour", async () => {
    await writeStatus(env.SCAN_DB, { copied_through: scanNow })
    const past = await h.get(
      `/series?metric=chain.transactions&from=${day(-30)}&to=${day(-3)}`,
    )
    expect(past.headers.get("X-Scan-Class")).toBe("long")
    const today = await h.get(
      `/series?metric=chain.transactions&from=${day(-30)}&to=${day(0)}`,
    )
    expect(today.headers.get("X-Scan-Class")).toBe("run")
  })

  it("validates metric, dimension and range", async () => {
    for (const query of [
      `metric=chain.nope&from=${day(-3)}&to=${day(0)}`,
      `metric=chain.transactions&dimension=x&from=${day(-3)}&to=${day(0)}`,
      `metric=locks.net&dimension=vexyz&from=${day(-3)}&to=${day(0)}`,
      `metric=chain.transactions&from=${day(0)}&to=${day(-3)}`,
      `metric=chain.transactions&from=${day(-800)}&to=${day(0)}`,
      `metric=chain.transactions&from=yesterday&to=${day(0)}`,
    ]) {
      expect((await h.get(`/series?${query}`)).status, query).toBe(400)
    }
  })

  it("splits a token rollup by token in one read, each with its decimals", async () => {
    const btcToken = "0x7b7c000000000000000000000000000000000000"
    const usdcToken = "0x04671c72aab5ac02a03c1098314b1bb6b560c197"
    const insert = (dimension: string, at: string, value: string) =>
      env.SCAN_DB.prepare(
        `INSERT INTO daily (metric, dimension, day, value, source, updated_at)
         VALUES ('pool.token_balance', ?1, ?2, ?3, 'live', 1)`,
      ).bind(dimension, at, value)
    await env.SCAN_DB.batch([
      insert(btcToken, day(-2), "54050000000000000000"),
      insert(usdcToken, day(-2), "2539600000000"),
      insert(btcToken, day(-1), "54100000000000000000"),
      insert(btcToken, day(0), "54200000000000000000"),
    ])
    await writeStatus(env.SCAN_DB, { copied_through: scanNow })
    const split = await h.json(
      `/series/split?metric=pool.token_balance&from=${day(-3)}&to=${day(0)}`,
      z.object({ data: scanSeriesSplitSchema }),
    )
    expect(split.data).toMatchObject({
      metric: "pool.token_balance",
      to: day(0),
      truncated: false,
      kind: "level",
      decimals: "token",
    })
    expect(split.data.series).toEqual([
      {
        dimension: usdcToken,
        token: { address: usdcToken, symbol: "mUSDC" },
        resolvedDecimals: 6,
        points: [{ day: day(-2), value: "2539600000000", partial: false }],
      },
      {
        dimension: btcToken,
        token: { address: btcToken, symbol: "BTC" },
        resolvedDecimals: 18,
        points: [
          { day: day(-2), value: "54050000000000000000", partial: false },
          { day: day(-1), value: "54100000000000000000", partial: false },
          { day: day(0), value: "54200000000000000000", partial: true },
        ],
      },
    ])
    // A settled past range is kept a day, as /series is.
    const past = await h.get(
      `/series/split?metric=pool.token_balance&from=${day(-30)}&to=${day(-3)}`,
    )
    expect(past.headers.get("X-Scan-Class")).toBe("long")
  })

  it("cuts the oldest days past the row limit, never the newest", async () => {
    // 9 tokens a day for 700 days: 6,300 rows, past the 6,000 read.
    await env.SCAN_DB.prepare(
      `WITH RECURSIVE n(i) AS (SELECT 0 UNION ALL SELECT i + 1 FROM n WHERE i < 699),
         t(k) AS (SELECT 1 UNION ALL SELECT k + 1 FROM t WHERE k < 9)
       INSERT INTO daily (metric, dimension, day, value, source, updated_at)
       SELECT 'dex.token_volume_in', printf('0x%040d', k),
         date(?1, '-' || i || ' days'), '1', 'live', 1 FROM n, t`,
    )
      .bind(day(-1))
      .run()
    const split = await h.json(
      `/series/split?metric=dex.token_volume_in&from=${day(-720)}&to=${day(-1)}`,
      z.object({ data: scanSeriesSplitSchema }),
    )
    expect(split.data.truncated).toBe(true)
    expect(split.data.to).toBe(day(-1))
    // 6,001 rows read reach back 667 days into a 9-token day: that day is
    // dropped, so the answer starts the day after it.
    expect(split.data.from).toBe(day(-666))
    for (const series of split.data.series) {
      expect(series.points[0]?.day).toBe(day(-666))
      expect(series.points.at(-1)?.day).toBe(day(-1))
      expect(series.points).toHaveLength(666)
    }
  })

  it("answers Network's markets in one read", async () => {
    const btcToken = "0x7b7c000000000000000000000000000000000000"
    const pool = `0x${"5".repeat(40)}`
    const insert = (metric: string, dimension: string, at: string) =>
      env.SCAN_DB.prepare(
        `INSERT INTO daily (metric, dimension, day, value, source, updated_at)
         VALUES (?1, ?2, ?3, '7', 'live', 1)`,
      ).bind(metric, dimension, at)
    await env.SCAN_DB.batch([
      insert("pool.token_balance", btcToken, day(-1)),
      // Outside the 7 days asked: not served.
      insert("pool.token_balance", btcToken, day(-9)),
      // Volume reads 31 days whatever the period.
      insert("dex.token_volume_in", btcToken, day(-20)),
      insert("dex.volume_in", `${pool}:${btcToken}`, day(-1)),
      // Outside the last three days: not served.
      insert("dex.volume_in", `${pool}:${btcToken}`, day(-4)),
    ])
    const markets = await h.json(
      "/markets?days=7",
      z.object({ data: scanMarketsSchema }),
    )
    expect(markets.data.days).toBe(7)
    expect(markets.data.balances.from).toBe(day(-6))
    expect(markets.data.balances.series[0]?.points.map((p) => p.day)).toEqual([
      day(-1),
    ])
    expect(markets.data.volume.from).toBe(day(-30))
    expect(markets.data.volume.series[0]?.points.map((p) => p.day)).toEqual([
      day(-20),
    ])
    expect(markets.data.pools.series[0]).toMatchObject({
      dimension: `${pool}:${btcToken}`,
      token: { address: btcToken, symbol: "BTC" },
    })
    expect(markets.data.pools.series[0]?.points).toHaveLength(1)
    expect(markets.data.prices.btc.length).toBeGreaterThan(0)
    expect((await h.get("/markets?days=0")).status).toBe(400)
    expect((await h.get("/markets?days=800")).status).toBe(400)
  })

  it("flags a day still to recompute only for the copy step's metrics", async () => {
    // Re-aggregating the trove history marks every past trove day dirty;
    // the rollups and live closes on those days do not change with it.
    const btcToken = "0x7b7c000000000000000000000000000000000000"
    const insert = (metric: string, dimension: string) =>
      env.SCAN_DB.prepare(
        `INSERT INTO daily (metric, dimension, day, value, source, updated_at)
         VALUES (?1, ?2, ?3, '7', 'live', 1)`,
      ).bind(metric, dimension, day(-2))
    await env.SCAN_DB.batch([
      insert("pool.token_balance", btcToken),
      insert("fees.voters", btcToken),
      insert("musd.borrowed", ""),
      insert("escrow.supply", "vebtc"),
      env.SCAN_DB.prepare(
        "INSERT INTO scan_dirty (kind, key) VALUES ('day', ?1)",
      ).bind(day(-2)),
    ])
    const split = (metric: string) =>
      h.json(
        `/series/split?metric=${metric}&from=${day(-3)}&to=${day(-1)}`,
        z.object({ data: scanSeriesSplitSchema }),
      )
    const partial = async (metric: string) =>
      (await split(metric)).data.series[0]?.points[0]?.partial
    expect(await partial("pool.token_balance")).toBe(false)
    expect(await partial("fees.voters")).toBe(true)
    const series = (metric: string, dimension: string) =>
      h.json(
        `/series?metric=${metric}&dimension=${dimension}&from=${day(-3)}&to=${day(-1)}`,
        z.object({ data: scanSeriesSchema }),
      )
    expect(
      (await series("musd.borrowed", "")).data.points.find(
        (point) => point.day === day(-2),
      )?.partial,
    ).toBe(true)
    expect(
      (await series("escrow.supply", "vebtc")).data.points.find(
        (point) => point.day === day(-2),
      )?.partial,
    ).toBe(false)
  })

  it("keeps Network's settled market days past a new data version", async () => {
    const btcToken = "0x7b7c000000000000000000000000000000000000"
    const insert = (at: string) =>
      env.SCAN_DB.prepare(
        `INSERT INTO daily (metric, dimension, day, value, source, updated_at)
         VALUES ('pool.token_balance', ?1, ?2, '7', 'live', 1)`,
      ).bind(btcToken, at)
    await env.SCAN_DB.batch([
      insert(day(-40)),
      insert(day(-20)),
      insert(day(-1)),
    ])
    await writeStatus(env.SCAN_DB, { copied_through: scanNow })
    const read = async () =>
      (
        await h.json("/markets?days=60", z.object({ data: scanMarketsSchema }))
      ).data.balances.series[0]?.points.map((point) => point.day)
    expect(await read()).toEqual([day(-40), day(-20), day(-1)])
    // The settled days are kept apart from the answer: a new data version
    // re-reads the last three days only. (Rows deleted here stand for
    // rows the miss would otherwise read again.)
    await env.SCAN_DB.batch([
      env.SCAN_DB.prepare(
        "DELETE FROM daily WHERE metric = 'pool.token_balance' AND day < ?1",
      ).bind(day(-3)),
      env.SCAN_DB.prepare(
        "UPDATE scan_status SET data_version = data_version + 1 WHERE id = 1",
      ),
    ])
    h.state.now += 6_000
    expect(await read()).toEqual([day(-40), day(-20), day(-1)])
  })

  it("serves a pool-token metric's split over a week at most", async () => {
    const pool = `0x${"5".repeat(40)}`
    const musdToken = "0xdd468a1ddc392dcdbef6db6e34e89aa338f9f186"
    await env.SCAN_DB.prepare(
      `INSERT INTO daily (metric, dimension, day, value, source, updated_at)
       VALUES ('pool.balance', ?1, ?2, '5706374', 'live', 1)`,
    )
      .bind(`${pool}:${musdToken}`, day(-1))
      .run()
    const split = await h.json(
      `/series/split?metric=pool.balance&from=${day(-1)}&to=${day(0)}`,
      z.object({ data: scanSeriesSplitSchema }),
    )
    expect(split.data.series).toEqual([
      {
        dimension: `${pool}:${musdToken}`,
        token: { address: musdToken, symbol: "MUSD" },
        resolvedDecimals: 18,
        points: [{ day: day(-1), value: "5706374", partial: false }],
      },
    ])
    for (const query of [
      `metric=pool.balance&from=${day(-8)}&to=${day(0)}`,
      // Totals and markets have no split here.
      `metric=chain.transactions&from=${day(-3)}&to=${day(0)}`,
      `metric=morpho.total_borrow&from=${day(-3)}&to=${day(0)}`,
      `metric=pool.nope&from=${day(-3)}&to=${day(0)}`,
      `metric=pool.token_balance&from=${day(0)}&to=${day(-3)}`,
      `metric=pool.token_balance&from=${day(-800)}&to=${day(0)}`,
    ]) {
      expect((await h.get(`/series/split?${query}`)).status, query).toBe(400)
    }
  })

  it("serves price history", async () => {
    const prices = await h.json(
      `/prices/btc?from=${day(-30)}&to=${day(0)}`,
      z.object({ data: scanPriceSeriesSchema }),
    )
    expect(prices.data.points).toHaveLength(10)
    expect(prices.data.points[0]?.price).toBe("74000.25")
    expect(
      (await h.get(`/prices/eth?from=${day(-3)}&to=${day(0)}`)).status,
    ).toBe(404)
  })

  it("looks labels up in batches and by prefix", async () => {
    const batch = await h.json(
      `/labels?address=${people.alice},${gauge},${people.nobody}`,
      z.object({ data: scanLabelMapSchema }),
    )
    expect(Object.keys(batch.data).sort()).toEqual([people.alice, gauge].sort())
    const tooMany = Array.from({ length: 51 }, () => people.alice).join(",")
    expect((await h.get(`/labels?address=${tooMany}`)).status).toBe(400)
    const byName = await h.json(
      "/labels/search?q=Gauge",
      z.object({ data: z.array(scanLabelItemSchema) }),
    )
    expect(byName.data.map((label) => label.address)).toEqual([gauge])
    const byAddress = await h.json(
      `/labels/search?by=address&q=${people.alice.slice(0, 41)}`,
      z.object({ data: z.array(scanLabelItemSchema) }),
    )
    expect(byAddress.data.map((label) => label.address)).toEqual([people.alice])
  })

  it("searches labels, gauge names, epochs and locks without Blockscout", async () => {
    const names = await h.json(
      "/search?kind=name&q=gauge",
      z.object({ data: scanSearchResultSchema }),
    )
    expect(names.data.hits[0]).toMatchObject({ type: "label" })
    const epoch = await h.json(
      `/search?kind=epoch&q=${currentEpoch}`,
      z.object({ data: scanSearchResultSchema }),
    )
    expect(epoch.data.hits).toEqual([
      { type: "epoch", epoch_start: currentEpoch },
    ])
    const lock = await h.json(
      "/search?kind=lock&q=vebtc:3",
      z.object({ data: scanSearchResultSchema }),
    )
    expect(lock.data.hits).toEqual([
      { type: "lock", escrow: vebtc, token_id: "3" },
    ])
    const address = await h.json(
      `/search?kind=address&q=${people.alice}`,
      z.object({ data: scanSearchResultSchema }),
    )
    expect(address.data.hits).toHaveLength(1)
    expect((await h.get("/search?kind=tx&q=0x1")).status).toBe(400)
    expect(h.blockscout.calls).toEqual([])
  })
})

describe("composed documents", () => {
  it("merges a transaction, its logs and transfers with our rows and labels", async () => {
    // The copy has read past the recorded transaction's time.
    await env.SCAN_DB.prepare(
      "UPDATE scan_cursors SET value = '1900000000' WHERE name = 'copy:activity'",
    ).run()
    h.blockscout.reply(`transactions/${blockTx}`, {
      status: 200,
      body: { ...transaction, has_error_in_internal_transactions: false },
    })
    h.blockscout.reply(`transactions/${blockTx}/logs`, {
      status: 200,
      body: transactionLogs,
    })
    h.blockscout.reply(`transactions/${blockTx}/token-transfers`, {
      status: 200,
      body: transactionTokenTransfers,
    })
    const response = await h.get(`/entities/tx/${blockTx}`)
    expect(response.status).toBe(200)
    const document = scanTransactionDocumentSchema.parse(
      z.object({ data: z.unknown() }).parse(await response.json()).data,
    )
    expect(document.transaction.status).toBe("ok")
    expect(document.logs.status).toBe("ok")
    expect(document.tokenTransfers.status).toBe("ok")
    expect(document.activity).toEqual({ status: "ok", data: [] })
    expect(Object.keys(document.labels)).toEqual([])
    // Final: every Blockscout part is final and the copy is past its block.
    expect(document.final).toBe(true)
    expect(response.headers.get("X-Scan-Class")).toBe("long")
    h.state.clock = { height: 13_300_000, lastActive: 13_300_000 }
    h.isolate()
    const again = await h.get(`/entities/tx/${blockTx}`)
    expect(again.headers.get("X-Cache")).toBe("edge")
  })

  it("is not final until the copy has read past the transaction", async () => {
    h.blockscout.reply(`transactions/${blockTx}`, {
      status: 200,
      body: { ...transaction, has_error_in_internal_transactions: false },
    })
    h.blockscout.reply(`transactions/${blockTx}/logs`, {
      status: 200,
      body: transactionLogs,
    })
    h.blockscout.reply(`transactions/${blockTx}/token-transfers`, {
      status: 200,
      body: transactionTokenTransfers,
    })
    const response = await h.get(`/entities/tx/${blockTx}`)
    expect(response.headers.get("X-Scan-Class")).toBe("head")
  })

  it("degrades a failing or rate-limited part and still answers", async () => {
    h.blockscout.reply(`transactions/${txHash}`, { status: 503 })
    h.blockscout.reply(`transactions/${txHash}/logs`, { status: 429 })
    h.blockscout.reply(`transactions/${txHash}/token-transfers`, {
      status: 200,
      body: { items: [], next_page_params: null },
    })
    const response = await h.get(`/entities/tx/${txHash}`)
    expect(response.status).toBe(200)
    const document = scanTransactionDocumentSchema.parse(
      z.object({ data: z.unknown() }).parse(await response.json()).data,
    )
    expect(document.transaction).toEqual({
      status: "unavailable",
      reason: "upstream",
    })
    expect(document.logs).toEqual({
      status: "unavailable",
      reason: "rate_limited",
    })
    // Our own rows still arrive, with labels for the addresses in them.
    expect(document.activity.status).toBe("ok")
    if (document.activity.status === "ok") {
      expect(document.activity.data).toHaveLength(2)
    }
    expect(document.labels[people.alice]?.name).toBe("Alice Treasury")
    expect(document.final).toBe(false)
    // Neither failure holds for the next caller: stored nowhere.
    expect(response.headers.get("Cache-Control")).toBe("private, no-store")
  })

  it("composes an address with locks, borrow and activity", async () => {
    h.blockscout.reply(`addresses/${people.alice}`, {
      status: 200,
      body: { ...addressFixture, hash: people.alice },
    })
    h.blockscout.reply(`addresses/${people.alice}/counters`, {
      status: 200,
      body: addressCounters,
    })
    const response = await h.get(`/entities/address/${people.alice}`)
    const document = scanAddressDocumentSchema.parse(
      z.object({ data: z.unknown() }).parse(await response.json()).data,
    )
    expect(document.summary.status).toBe("ok")
    expect(document.label?.name).toBe("Alice Treasury")
    expect(
      document.locks.status === "ok" && document.locks.data.data,
    ).toHaveLength(4)
    expect(
      document.borrow.status === "ok" && document.borrow.data.morpho,
    ).toHaveLength(1)
    expect(
      document.activity.status === "ok" && document.activity.data.data,
    ).toHaveLength(25)
    // Unknown on Blockscout: that part only.
    const nobody = await h.get(`/entities/address/${people.nobody}`)
    const empty = scanAddressDocumentSchema.parse(
      z.object({ data: z.unknown() }).parse(await nobody.json()).data,
    )
    expect(empty.summary).toEqual({
      status: "unavailable",
      reason: "not_found",
    })
    expect(empty.locks).toEqual({
      status: "ok",
      data: { data: [], nextCursor: null, meta: { skipped: 0 } },
    })
  })

  it("answers by its deadline when one Blockscout read is slow, and has it next time", async () => {
    // Slower than Matchscan's 3 s for the whole document, inside the
    // proxy's own 4 s.
    h.blockscout.reply(`addresses/${people.alice}`, {
      status: 200,
      body: { ...addressFixture, hash: people.alice },
      delayMs: 3_300,
    })
    h.blockscout.reply(`addresses/${people.alice}/counters`, {
      status: 200,
      body: addressCounters,
    })
    const read = async () => {
      const started = Date.now()
      const response = await h.get(`/entities/address/${people.alice}`)
      const document = scanAddressDocumentSchema.parse(
        z.object({ data: z.unknown() }).parse(await response.json()).data,
      )
      return { ms: Date.now() - started, document, response }
    }
    const first = await read()
    expect(first.ms).toBeLessThan(composedPartsMs + 600)
    // That card only; the others are served.
    expect(first.document.summary).toEqual({
      status: "unavailable",
      reason: "upstream",
    })
    expect(first.document.counters.status).toBe("ok")
    expect(first.document.locks.status).toBe("ok")
    expect(first.document.borrow.status).toBe("ok")
    expect(first.document.activity.status).toBe("ok")
    // A document missing a part for a passing reason is not kept.
    expect(first.response.headers.get("Cache-Control")).toBe(
      "private, no-store",
    )
    // The late read finished in the background: the next request has it.
    await settled()
    const second = await read()
    expect(second.document.summary.status).toBe("ok")
  })

  it("answers inside Matchscan's 3 s with everything before and around the render at its worst", async () => {
    const pause = (ms: number) =>
      new Promise((resolve) => setTimeout(resolve, ms))
    // SCAN_DB whose copy-run version and label reads hang for 5 s.
    const slowSql = /scan_status|FROM labels WHERE address IN/
    function slowStatement(
      statement: D1PreparedStatement,
    ): D1PreparedStatement {
      return new Proxy(statement, {
        get(target, property) {
          const value: unknown = Reflect.get(target, property, target)
          if (typeof value !== "function") return value
          if (property === "bind") {
            return (...binds: unknown[]) =>
              slowStatement(Reflect.apply(value, target, binds))
          }
          return async (...args: unknown[]) => {
            await pause(5_000)
            return Reflect.apply(value, target, args)
          }
        },
      })
    }
    const scanDb = new Proxy(env.SCAN_DB, {
      get(target, property) {
        const value: unknown = Reflect.get(target, property, target)
        if (property === "prepare") {
          return (sql: string) =>
            slowSql.test(sql)
              ? slowStatement(target.prepare(sql))
              : target.prepare(sql)
        }
        return typeof value === "function" ? value.bind(target) : value
      },
    })
    // Edge lookups and the rate-limit call that take a second each, and a
    // head read that takes its own 0.3 s bound.
    const edge = await caches.open(`scan-slow-${crypto.randomUUID()}`)
    const cache = {
      async match(request: RequestInfo) {
        await pause(1_000)
        return edge.match(request)
      },
      put: (request: RequestInfo, response: Response) =>
        edge.put(request, response),
      delete: (request: RequestInfo) => edge.delete(request),
    } as Cache
    const memory = createMemoryRateLimitClient()
    const rateLimits: RateLimitClient = {
      async consume(key, policy) {
        await pause(1_000)
        return memory.consume(key, policy)
      },
    }
    const slow = harness({
      scanDb,
      cache,
      rateLimits,
      clock: async () => {
        await pause(300)
        return { height: 13_200_000, lastActive: 13_100_000 }
      },
    })
    // And a Blockscout read past the proxy's patience.
    slow.blockscout.reply(`addresses/${people.alice}`, {
      status: 200,
      body: { ...addressFixture, hash: people.alice },
      delayMs: 3_300,
    })
    slow.blockscout.reply(`addresses/${people.alice}/counters`, {
      status: 200,
      body: addressCounters,
    })
    const started = Date.now()
    const response = await slow.get(`/entities/address/${people.alice}`)
    const document = scanAddressDocumentSchema.parse(
      z.object({ data: z.unknown() }).parse(await response.json()).data,
    )
    const ms = Date.now() - started
    // The labels' deadline, 2.6 s after arrival, and a little for the
    // document itself: inside Matchscan's 3 s with room for the hop.
    expect(ms).toBeLessThan(2_900)
    expect(ms).toBeGreaterThanOrEqual(composedLabelsMs - 50)
    expect(document.summary).toEqual({
      status: "unavailable",
      reason: "upstream",
    })
    expect(document.counters.status).toBe("ok")
    expect(document.labels).toEqual({})
    // Not kept: parts were missing for passing reasons.
    expect(response.headers.get("Cache-Control")).toBe("private, no-store")
  })

  it("hands a late read to waitUntil with its failure caught", async () => {
    // The copy run's version read, failing after its deadline.
    let fail: (error: Error) => void = () => undefined
    const version = new Promise<string>((_resolve, reject) => {
      fail = reject
    })
    const handed: Promise<unknown>[] = []
    const served = await bounded(
      "version",
      version,
      Date.now() + 10,
      null,
      (task) => handed.push(task),
      {},
    )
    expect(served).toBeNull()
    fail(new Error("D1_ERROR: Network connection lost."))
    expect(handed).toHaveLength(1)
    await expect(handed[0]).resolves.toBeUndefined()
  })

  it("composes a block with its transactions and the proposer's label", async () => {
    const height = block.height
    await env.SCAN_DB.prepare(
      `INSERT INTO labels (address, name, name_lower, kind, tags, source, updated_at)
       VALUES (?1, 'Validator One', 'validator one', 'validator', '[]', 'curated', 1)`,
    )
      .bind(block.miner.hash.toLowerCase())
      .run()
    h.blockscout.reply(`blocks/${height}`, { status: 200, body: block })
    h.blockscout.reply(`blocks/${height}/transactions`, {
      status: 200,
      body: blockTransactions,
    })
    const response = await h.get(`/entities/block/${height}`)
    const document = scanBlockDocumentSchema.parse(
      z.object({ data: z.unknown() }).parse(await response.json()).data,
    )
    expect(document.block.status).toBe("ok")
    expect(document.labels[block.miner.hash.toLowerCase()]?.name).toBe(
      "Validator One",
    )
    expect(document.final).toBe(true)
  })
})

describe("caching", () => {
  it("answers from memory, then the edge, and retires on a new run", async () => {
    const first = await h.get("/activity?limit=3")
    expect(first.headers.get("X-Cache")).toBe("miss")
    expect(first.headers.get("Cache-Control")).toBe("public, max-age=30")
    expect(first.headers.get("X-Scan-Class")).toBe("run")
    expect((await h.get("/activity?limit=3")).headers.get("X-Cache")).toBe(
      "memory",
    )
    h.isolate()
    expect((await h.get("/activity?limit=3")).headers.get("X-Cache")).toBe(
      "edge",
    )
    // A new copy run: the version changes once the memo (5 s) lapses.
    await recordRun(env.SCAN_DB, scanNow)
    h.state.now += 6_000
    expect((await h.get("/activity?limit=3")).headers.get("X-Cache")).toBe(
      "miss",
    )
  })

  it("answers If-None-Match with 304", async () => {
    const first = await h.get("/epochs")
    const etag = first.headers.get("ETag") ?? ""
    expect(etag).not.toBe("")
    const again = await h.get("/epochs", { headers: { "If-None-Match": etag } })
    expect(again.status).toBe(304)
  })

  it("keys live Borrow state by the five-minute snapshot slot", async () => {
    await h.get("/borrow/stability-pool")
    expect((await h.get("/borrow/stability-pool")).headers.get("X-Cache")).toBe(
      "memory",
    )
    h.state.now += 300_000
    expect((await h.get("/borrow/stability-pool")).headers.get("X-Cache")).toBe(
      "miss",
    )
  })

  it("sends no CORS headers", async () => {
    const response = await h.get("/epochs", {
      headers: { Origin: "https://scan.matchbox.markets" },
    })
    expect(response.status).toBe(200)
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull()
  })

  it("is closed to the public origin", async () => {
    const app = new Hono<ApiEnv>()
    app.use(internalAccess({ internalToken: null }))
    app.notFound(notFoundHandler)
    expect(
      (await app.request("https://api.matchbox.markets/internal/scan/epochs"))
        .status,
    ).toBe(404)
  })
})

describe("the scan rate-limit class", () => {
  function counting(deny = false) {
    const spent: { key: string; policy: RateLimitPolicy }[] = []
    const memory = createMemoryRateLimitClient()
    const client: RateLimitClient = {
      async consume(key, policy) {
        spent.push({ key, policy })
        if (deny) {
          return {
            allowed: false,
            limit: 120,
            remaining: 0,
            resetAt: 0,
            retryAfterSeconds: 9,
          }
        }
        return memory.consume(key, policy)
      },
    }
    return { spent, client }
  }

  it("spends the caller's scan bucket on misses only", async () => {
    const { spent, client } = counting()
    const limited = harness({ rateLimits: client })
    const headers = {
      [blockscoutClientHeader]: "scan",
      [blockscoutEndUserHeader]: endUser,
    }
    await limited.get("/epochs", { headers })
    await limited.get("/epochs", { headers })
    expect(spent).toEqual([
      {
        key: scanRateLimitKey({ client: "scan", endUser }),
        policy: scanEndUserPolicy,
      },
    ])
    expect(spent[0]?.key).toBe(`scan:caller:scan:${endUser}`)
  })

  it("answers 429 when the bucket is spent", async () => {
    const { client } = counting(true)
    const limited = harness({ rateLimits: client })
    const response = await limited.get("/epochs")
    expect(response.status).toBe(429)
    expect(response.headers.get("Retry-After")).toBe("9")
  })

  it("rejects malformed caller headers", async () => {
    expect(
      (
        await h.get("/epochs", {
          headers: { [blockscoutEndUserHeader]: "1.2.3.4" },
        })
      ).status,
    ).toBe(400)
  })
})

describe("the jobs Worker's status row", () => {
  const status = z.object({ data: scanStatusSchema })

  it("falls back to scan_runs without the row", async () => {
    const body = await h.json("/status", status)
    expect(body.data).toMatchObject({
      source: "runs",
      asOf: scanNow - 100,
      aggregatesComplete: null,
      historyFilled: null,
      stale: false,
    })
  })

  it("reports the row, without its error text", async () => {
    await writeStatus(env.SCAN_DB, {
      last_ok_at: scanNow - 50,
      aggregates_complete: 0,
      history_filled: 1,
      last_error: "neon: connection refused at 10.0.0.1",
      refill_reason: "decoder v7 rebuild",
    })
    const response = await h.get("/status")
    const text = await response.text()
    expect(text).not.toContain("connection refused")
    expect(text).not.toContain("decoder v7")
    expect(status.parse(JSON.parse(text)).data).toMatchObject({
      source: "status",
      asOf: scanNow - 50,
      aggregatesComplete: false,
      historyFilled: true,
      refillRequired: false,
      stale: false,
    })
  })

  it("puts asOf, aggregatesComplete, historyFilled and stale on aggregates", async () => {
    await writeStatus(env.SCAN_DB, { last_ok_at: scanNow - 50 })
    const epochs = await h.json(
      "/epochs",
      scanAggregatePageSchema(scanEpochItemSchema),
    )
    expect(epochs.meta).toEqual({
      complete: true,
      asOf: scanNow - 50,
      aggregatesComplete: true,
      historyFilled: true,
      stale: false,
      refillPending: false,
      skipped: 0,
    })
    const series = await h.json(
      `/series?metric=chain.transactions&from=${day(-30)}&to=${day(-1)}`,
      z.object({ data: scanSeriesSchema, meta: scanAggregateMetaSchema }),
    )
    expect(series.meta).toMatchObject({ asOf: scanNow - 50, stale: false })
  })

  it("is stale while copies fail, and never sealed then", async () => {
    await writeStatus(env.SCAN_DB, { consecutive_failures: 2 })
    const failing = await h.json(
      "/epochs",
      scanAggregatePageSchema(scanEpochItemSchema),
    )
    expect(failing.meta).toMatchObject({ stale: true, refillPending: false })
    const sealed = await h.get(`/epochs/${lastEpoch}`)
    expect(sealed.headers.get("X-Scan-Class")).toBe("run")
  })

  it("reports a due re-fill on its own, not as stale, and never seals then", async () => {
    await writeStatus(env.SCAN_DB, { refill_required: 1 })
    h.isolate()
    const refill = await h.json("/status", status)
    expect(refill.data).toMatchObject({
      stale: false,
      refillRequired: true,
      consecutiveFailures: 0,
      halted: false,
    })
    const epochs = await h.json(
      "/epochs",
      scanAggregatePageSchema(scanEpochItemSchema),
    )
    expect(epochs.meta).toMatchObject({ stale: false, refillPending: true })
    // Figures may still change: nothing is sealed while it is due.
    expect(
      (await h.get(`/epochs/${lastEpoch}`)).headers.get("X-Scan-Class"),
    ).toBe("run")
  })

  it("keys run entries on last_ok_at, so a skipped run keeps them", async () => {
    await writeStatus(env.SCAN_DB)
    expect((await h.get("/activity?limit=3")).headers.get("X-Cache")).toBe(
      "miss",
    )
    // A skipped run moves last_run_at (and updated_at), not last_ok_at.
    await writeStatus(env.SCAN_DB, {
      last_run_status: "skipped",
      last_run_at: scanNow,
      updated_at: scanNow,
    })
    h.state.now += 6_000
    expect((await h.get("/activity?limit=3")).headers.get("X-Cache")).toBe(
      "memory",
    )
    // A run that copied rows moves last_ok_at: a new version.
    await writeStatus(env.SCAN_DB, { last_ok_at: scanNow, updated_at: scanNow })
    h.state.now += 6_000
    expect((await h.get("/activity?limit=3")).headers.get("X-Cache")).toBe(
      "miss",
    )
  })

  it("marks the days the jobs Worker flags as partial", async () => {
    await env.SCAN_DB.prepare(
      "UPDATE daily SET partial = 1 WHERE metric = 'chain.transactions' AND day = ?1",
    )
      .bind(day(-4))
      .run()
    const series = await h.json(
      `/series?metric=chain.transactions&from=${day(-5)}&to=${day(-3)}`,
      z.object({ data: scanSeriesSchema, meta: scanAggregateMetaSchema }),
    )
    expect(series.data.points.map((point) => point.partial)).toEqual([
      false,
      true,
      false,
    ])
    expect(series.meta.complete).toBe(false)
  })
})

describe("the settled registry and the new indexes", () => {
  it("includes rows an address only sent, still once each", async () => {
    await env.SCAN_DB.prepare(
      `INSERT INTO activity (id, tx_hash, log_index, block_number, timestamp,
         epoch_start, action_type, source, contract_address, tx_from, actor,
         recipient, extra)
       VALUES ('poke-1', ?1, 3, 13000500, ?2, ?3, 'BOOST_POKE', 'BOOST_VOTER',
         ?4, ?5, NULL, NULL, '{}')`,
    )
      .bind(
        `0x${"5e".repeat(32)}`,
        lastEpoch + 9_000,
        lastEpoch,
        gauge,
        people.carol,
      )
      .run()
    const carol = await h.json(
      `/activity/address/${people.carol}`,
      scanPageSchema(scanActivityItemSchema),
    )
    expect(carol.data.map((row) => row.id)).toEqual(["poke-1"])
    const sent = await h.json(
      `/activity/address/${people.carol}?role=sender`,
      scanPageSchema(scanActivityItemSchema),
    )
    expect(sent.data).toHaveLength(1)
    // Alice is actor and sender of all 30 rows: still 30, not 60.
    const alice = await allPages(
      h,
      `/activity/address/${people.alice}`,
      scanActivityItemSchema,
      7,
    )
    expect(alice.items).toHaveLength(activityCount)
  })

  it("lists Morpho liquidations with trove liquidations, newest first", async () => {
    await env.SCAN_DB.prepare(
      `INSERT INTO morpho_events (tx_hash, log_index, block_number, timestamp,
         tx_from, market_id, action, caller, on_behalf, assets, shares,
         seized_assets)
       VALUES (?1, 1, 12950100, ?2, ?3, ?4, 'LIQUIDATED', ?3, ?5, '100', '1', '5')`,
    )
      .bind(
        `0x${"4f".repeat(32)}`,
        lastEpoch + 50,
        people.bob,
        market,
        people.alice,
      )
      .run()
    const { items } = await allPages(
      h,
      "/borrow/liquidations",
      scanLiquidationItemSchema,
      1,
    )
    expect(items.map((item) => [item.kind, item.block_number])).toEqual([
      ["morpho", 12_950_100],
      ["trove", 12_900_002],
    ])
  })

  it("lists every venue's latest borrow events, newest first", async () => {
    const body = await h.json("/borrow/events?limit=6", scanBorrowEventsSchema)
    expect(body.data.map((item) => [item.kind, item.block_number])).toEqual([
      ["trove", 12_900_003],
      ["morpho", 12_950_002],
      ["trove", 12_900_002],
      ["enclave", 12_960_001],
      ["morpho", 12_950_001],
      ["trove", 12_900_001],
    ])
    expect(body.meta.skipped).toBe(0)
    const enclave = body.data.find((item) => item.kind === "enclave")
    expect(enclave?.kind === "enclave" && enclave.pledged_ve_btc).toEqual([
      "11",
      "12",
    ])
    // Ten by default, 25 at most. The fixtures hold four trove events,
    // two Enclave events and three Morpho events, one of them a supply,
    // which is a lender's and left out.
    expect(
      (await h.json("/borrow/events", scanBorrowEventsSchema)).data,
    ).toHaveLength(8)
    expect((await h.get("/borrow/events?limit=26")).status).toBe(400)
  })

  it("keeps one row of an Enclave event that pledges several locks", async () => {
    await env.SCAN_DB.prepare(
      `INSERT INTO enclave_events (tx_hash, log_index, ve_btc_token_id,
         block_number, timestamp, tx_from, contract_address, enclave,
         position_id, borrower, action, amount, principal, interest_rate,
         originator_fee_rate, warning_cr, minimum_cr, lock_duration,
         other_ve_btc_token_id, pledged_ve_btc)
       SELECT tx_hash, log_index, '10', block_number, timestamp, tx_from,
         contract_address, enclave, position_id, borrower, action, NULL,
         principal, interest_rate, originator_fee_rate, warning_cr,
         minimum_cr, lock_duration, other_ve_btc_token_id, pledged_ve_btc
       FROM enclave_events WHERE block_number = 12960001`,
    ).run()
    const body = await h.json("/borrow/events?limit=25", scanBorrowEventsSchema)
    const rows = body.data.filter(
      (item) => item.kind === "enclave" && item.block_number === 12_960_001,
    )
    expect(rows).toHaveLength(1)
    // The amount is on one lock's row only (here not the first): kept.
    expect(rows[0]?.kind === "enclave" && rows[0].amount).toBe(
      "5000000000000000000000",
    )
  })

  it("counts a bad Enclave row once and reads on past a page of them", async () => {
    // 150 newer rows that fail their schema: a page and a half.
    await env.SCAN_DB.prepare(
      `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n
         WHERE i < 150)
       INSERT INTO enclave_events (tx_hash, log_index, ve_btc_token_id,
         block_number, timestamp, tx_from, contract_address, enclave,
         position_id, borrower, action, amount, principal, interest_rate,
         originator_fee_rate, warning_cr, minimum_cr, lock_duration,
         other_ve_btc_token_id, pledged_ve_btc)
       SELECT e.tx_hash, 1000 + n.i, e.ve_btc_token_id, e.block_number + 10,
         e.timestamp + 10, e.tx_from, e.contract_address, e.enclave,
         e.position_id, e.borrower, 'DEBT_INCREASED', 'bad', e.principal,
         e.interest_rate, e.originator_fee_rate, e.warning_cr, e.minimum_cr,
         e.lock_duration, e.other_ve_btc_token_id, e.pledged_ve_btc
       FROM enclave_events e, n WHERE e.block_number = 12960001`,
    ).run()
    const body = await h.json("/borrow/events?limit=25", scanBorrowEventsSchema)
    expect(body.meta.skipped).toBe(150)
    expect(
      body.data.filter((item) => item.kind === "enclave").length,
    ).toBeGreaterThan(0)
  })

  it("lists borrowers' actions, never settings or accruals", async () => {
    await env.SCAN_DB.prepare(
      `INSERT INTO enclave_events (tx_hash, log_index, ve_btc_token_id,
         block_number, timestamp, tx_from, contract_address, enclave,
         position_id, borrower, action, amount, principal, interest_rate,
         originator_fee_rate, warning_cr, minimum_cr, lock_duration,
         other_ve_btc_token_id, pledged_ve_btc)
       SELECT tx_hash, 9, ve_btc_token_id, block_number + 5, timestamp + 5,
         tx_from, contract_address, enclave, position_id, borrower,
         'INTEREST_RATE_SET', NULL, principal, interest_rate,
         originator_fee_rate, warning_cr, minimum_cr, lock_duration,
         other_ve_btc_token_id, pledged_ve_btc
       FROM enclave_events WHERE block_number = 12960001`,
    ).run()
    const body = await h.json("/borrow/events?limit=25", scanBorrowEventsSchema)
    expect(body.data.map((item) => item.action)).not.toContain(
      "INTEREST_RATE_SET",
    )
    expect(body.data.map((item) => item.action)).not.toContain("SUPPLIED")
  })

  it("accepts the token-destination dimension and rejects dropped metrics", async () => {
    const ok = await h.get(
      `/series?metric=bridge.out&dimension=${musd}:ethereum&from=${day(-3)}&to=${day(-1)}`,
    )
    expect(ok.status).toBe(200)
    for (const query of [
      `metric=bridge.out&dimension=${musd}:solana`,
      `metric=bridge.out&dimension=${musd}`,
      "metric=dex.volume&dimension=",
      "metric=musd.supply",
      `metric=token.supply&dimension=${musd}`,
    ]) {
      const response = await h.get(
        `/series?${query}&from=${day(-3)}&to=${day(-1)}`,
      )
      expect(response.status, query).toBe(400)
    }
  })

  it("describes a series with its note and ends backfill-only series", async () => {
    await env.SCAN_DB.prepare(
      `INSERT INTO daily (metric, dimension, day, value, source, updated_at)
       VALUES ('chain.new_addresses', '', ?1, '7', 'backfill:chain', 1)`,
    )
      .bind(day(-6))
      .run()
    const series = await h.json(
      `/series?metric=chain.new_addresses&from=${day(-9)}&to=${day(-1)}`,
      z.object({ data: scanSeriesSchema }),
    )
    expect(series.data.endsOn).toBe(day(-6))
    expect(series.data.note).toMatchObject({
      definition: expect.any(String),
      source: expect.any(String),
    })
  })
})

describe("killed gauges", () => {
  const killedGauge = `0x${"de".repeat(20)}`

  beforeEach(async () => {
    await env.SCAN_DB.batch([
      env.SCAN_DB.prepare(
        `INSERT INTO gauge_epoch (epoch_start, gauge, source, pool, vote_weight,
           weight_key, voters, incentives, fees, rank, killed, updated_at)
         VALUES (?1, ?2, 'BOOST_VOTER', NULL, '7000000000000000000', ?3, 2,
           '{}', '{}', NULL, 1, ?4)`,
      ).bind(
        currentEpoch,
        killedGauge,
        "7000000000000000000".padStart(40, "0"),
        scanNow,
      ),
      env.SCAN_DB.prepare(
        "UPDATE epoch_totals SET killed_weight = ?1 WHERE epoch_start = ?2",
      ).bind(
        JSON.stringify({ BOOST_VOTER: "7000000000000000000" }),
        currentEpoch,
      ),
    ])
  })

  it("lists them beside the ranking with their weight, unranked", async () => {
    const ranking = await h.json(
      `/epochs/${currentEpoch}/gauges?source=BOOST_VOTER`,
      scanGaugeRankingSchema,
    )
    expect(
      ranking.data.map((row) => [row.gauge, row.rank, row.killed]),
    ).toEqual([
      [otherGauge, 1, 0],
      [gauge, 2, 0],
    ])
    expect(ranking.killed).toMatchObject([
      {
        gauge: killedGauge,
        rank: null,
        killed: 1,
        vote_weight: "7000000000000000000",
      },
    ])
  })

  it("reports killed weight on the epoch and killed gauges in its detail", async () => {
    const epochs = await h.json(
      "/epochs",
      scanAggregatePageSchema(scanEpochItemSchema),
    )
    expect(epochs.data[0]?.killed_weight).toEqual({
      BOOST_VOTER: "7000000000000000000",
    })
    const detail = scanEpochDocumentSchema.parse(
      await (await h.get(`/epochs/${currentEpoch}`)).json(),
    )
    expect(
      detail.data?.killedGauges.BOOST_VOTER?.map((row) => row.gauge),
    ).toEqual([killedGauge])
    // Not a top gauge.
    expect(
      detail.data?.topGauges.BOOST_VOTER?.some(
        (row) => row.gauge === killedGauge,
      ),
    ).toBe(false)
  })

  it("flags the epoch in the gauge's own history", async () => {
    const history = await h.json(
      `/gauges/${killedGauge}/epochs`,
      scanAggregatePageSchema(scanGaugeEpochAggregateSchema),
    )
    expect(history.data.map((row) => [row.epoch_start, row.killed])).toEqual([
      [currentEpoch, 1],
    ])
  })
})

describe("composed documents and the caller", () => {
  const headersOf = (user: string) => ({
    [blockscoutClientHeader]: "scan",
    [blockscoutEndUserHeader]: user,
  })
  const limitedUser = "bGltaXRlZC1lbmQtdXNlci0wMDE"
  const otherUser = "b3RoZXItZW5kLXVzZXItMDAwMDE"

  /** The proxy's limiter: refuses one end user's bucket, allows the rest. */
  function refusing(user: string): RateLimitClient {
    return {
      async consume(key) {
        const allowed = !key.endsWith(`:${user}`)
        return {
          allowed,
          limit: 60,
          remaining: allowed ? 59 : 0,
          resetAt: 0,
          retryAfterSeconds: allowed ? 0 : 7,
        }
      },
    }
  }

  function replyTransaction(target: ReturnType<typeof harness>) {
    target.blockscout.reply(`transactions/${blockTx}`, {
      status: 200,
      body: { ...transaction, has_error_in_internal_transactions: false },
    })
    target.blockscout.reply(`transactions/${blockTx}/logs`, {
      status: 200,
      body: transactionLogs,
    })
    target.blockscout.reply(`transactions/${blockTx}/token-transfers`, {
      status: 200,
      body: transactionTokenTransfers,
    })
  }

  async function documentOf<T>(response: Response, schema: z.ZodType<T>) {
    expect(response.status).toBe(200)
    return schema.parse(
      z.object({ data: z.unknown() }).parse(await response.json()).data,
    )
  }

  it("never shares one caller's rate-limited parts with the next caller at the same head", async () => {
    const probe = harness({ proxyRateLimits: refusing(limitedUser) })
    replyTransaction(probe)
    const limited = await probe.get(`/entities/tx/${blockTx}`, {
      headers: headersOf(limitedUser),
    })
    expect(limited.headers.get("Cache-Control")).toBe("private, no-store")
    const first = await documentOf(limited, scanTransactionDocumentSchema)
    expect(first.transaction).toEqual({
      status: "unavailable",
      reason: "rate_limited",
    })
    // Same head, same isolate: the other caller is composed afresh.
    const other = await probe.get(`/entities/tx/${blockTx}`, {
      headers: headersOf(otherUser),
    })
    expect(other.headers.get("X-Cache")).toBe("miss")
    const second = await documentOf(other, scanTransactionDocumentSchema)
    expect(second.transaction.status).toBe("ok")
    expect(second.logs.status).toBe("ok")
  })

  it("never shares a stale copy one caller's limit fell back to", async () => {
    const probe = harness({ proxyRateLimits: refusing(limitedUser) })
    probe.blockscout.reply(`addresses/${people.alice}`, {
      status: 200,
      body: { ...addressFixture, hash: people.alice },
    })
    probe.blockscout.reply(`addresses/${people.alice}/counters`, {
      status: 200,
      body: addressCounters,
    })
    // The other caller fills the proxy's copies at one head ...
    await probe.get(`/entities/address/${people.alice}`, {
      headers: headersOf(otherUser),
    })
    // ... the head moves, and the limited caller is served them past their
    // window, its refresh refused.
    probe.state.clock = { height: 13_200_500, lastActive: 13_200_500 }
    probe.state.now += 120_000
    const limited = await probe.get(`/entities/address/${people.alice}`, {
      headers: headersOf(limitedUser),
    })
    const stale = await documentOf(limited, scanAddressDocumentSchema)
    expect(stale.summary.status).toBe("ok")
    expect(limited.headers.get("Cache-Control")).toBe("private, no-store")
    const calls = probe.blockscout.calls.length
    const other = await probe.get(`/entities/address/${people.alice}`, {
      headers: headersOf(otherUser),
    })
    expect(other.headers.get("X-Cache")).toBe("miss")
    // Read fresh for the caller whose bucket allows it.
    expect(probe.blockscout.calls.length).toBeGreaterThan(calls)
  })

  it("shares a document whose parts are unavailable for everyone alike", async () => {
    // Blockscout has no such address: not_found holds for every caller.
    const first = await h.get(`/entities/address/${people.nobody}`, {
      headers: headersOf(otherUser),
    })
    expect(first.headers.get("Cache-Control")).toBe("public, max-age=3")
    const again = await h.get(`/entities/address/${people.nobody}`, {
      headers: headersOf(limitedUser),
    })
    expect(again.headers.get("X-Cache")).toBe("memory")
  })

  it("answers all three documents with SCAN_DB unbound, its parts disabled", async () => {
    const unbound = harness({ scanDb: null })
    replyTransaction(unbound)
    unbound.blockscout.reply(`addresses/${people.alice}`, {
      status: 200,
      body: { ...addressFixture, hash: people.alice },
    })
    const tx = await documentOf(
      await unbound.get(`/entities/tx/${blockTx}`),
      scanTransactionDocumentSchema,
    )
    expect(tx.transaction.status).toBe("ok")
    expect(tx.activity).toEqual({ status: "unavailable", reason: "disabled" })
    expect(tx.final).toBe(false)
    const address = await documentOf(
      await unbound.get(`/entities/address/${people.alice}`),
      scanAddressDocumentSchema,
    )
    expect(address.locks).toEqual({ status: "unavailable", reason: "disabled" })
    expect(address.activity).toEqual({
      status: "unavailable",
      reason: "disabled",
    })
    // Blockscout's parts are unaffected.
    expect(address.summary.status).toBe("ok")
    unbound.blockscout.reply(`blocks/${block.height}`, {
      status: 200,
      body: block,
    })
    const blockDocument = await documentOf(
      await unbound.get(`/entities/block/${block.height}`),
      scanBlockDocumentSchema,
    )
    expect(blockDocument.block.status).toBe("ok")
    expect(blockDocument.final).toBe(false)
  })

  it("degrades parts, not the document, on a D1 error, and stores nothing", async () => {
    const failing = {
      prepare() {
        throw new Error("D1_ERROR: storage operation exceeded timeout")
      },
    } as unknown as D1Database
    const broken = harness({ scanDb: failing })
    replyTransaction(broken)
    const response = await broken.get(`/entities/tx/${blockTx}`)
    expect(response.headers.get("Cache-Control")).toBe("private, no-store")
    const tx = await documentOf(response, scanTransactionDocumentSchema)
    expect(tx.transaction.status).toBe("ok")
    expect(tx.activity).toEqual({ status: "unavailable", reason: "upstream" })
    const address = await documentOf(
      await broken.get(`/entities/address/${people.alice}`),
      scanAddressDocumentSchema,
    )
    expect(address.locks).toEqual({ status: "unavailable", reason: "upstream" })
    broken.blockscout.reply(`blocks/${block.height}`, {
      status: 200,
      body: block,
    })
    const blockResponse = await broken.get(`/entities/block/${block.height}`)
    expect(blockResponse.headers.get("Cache-Control")).toBe("private, no-store")
    const blockDocument = await documentOf(
      blockResponse,
      scanBlockDocumentSchema,
    )
    expect(blockDocument.block.status).toBe("ok")
  })
})

describe("a stored row that fails its schema", () => {
  type Item = Record<string, unknown>
  /** Breaks one stored row so its schema fails; keyed by a served item. */
  const corrupt: Record<
    string,
    { db: () => D1Database; sql: string; key: (item: Item) => unknown[] }
  > = {
    activity: {
      db: () => env.SCAN_DB,
      // Not a key column: the row stays in every index's range.
      sql: "UPDATE activity SET extra = '{' WHERE id = ?1",
      key: (item) => [item.id],
    },
    locks: {
      db: () => env.SCAN_DB,
      sql: "UPDATE locks SET amount = 'bad' WHERE escrow = ?1 AND token_id = ?2",
      key: (item) => [item.escrow, item.token_id],
    },
    lock_votes: {
      db: () => env.SCAN_DB,
      sql: `UPDATE lock_votes SET source = '' WHERE epoch_start = ?1
              AND gauge = ?2 AND escrow = ?3 AND token_id = ?4`,
      key: (item) => [item.epoch_start, item.gauge, item.escrow, item.token_id],
    },
    incentive_deposits: {
      db: () => env.SCAN_DB,
      sql: `UPDATE incentive_deposits SET timestamp = 'x'
            WHERE tx_hash = ?1 AND log_index = ?2`,
      key: (item) => [item.tx_hash, item.log_index],
    },
    gauge_epoch: {
      db: () => env.SCAN_DB,
      sql: `UPDATE gauge_epoch SET vote_weight = 'bad'
            WHERE gauge = ?1 AND epoch_start = ?2`,
      key: (item) => [item.gauge, item.epoch_start],
    },
    epoch_totals: {
      db: () => env.SCAN_DB,
      sql: "UPDATE epoch_totals SET vote_transactions = -1 WHERE epoch_start = ?1",
      key: (item) => [item.epoch_start],
    },
    trove_events: {
      db: () => env.SCAN_DB,
      sql: `UPDATE trove_events SET timestamp = 'x'
            WHERE tx_hash = ?1 AND log_index = ?2`,
      key: (item) => [item.tx_hash, item.log_index],
    },
    morpho_events: {
      db: () => env.SCAN_DB,
      sql: `UPDATE morpho_events SET timestamp = 'x'
            WHERE tx_hash = ?1 AND log_index = ?2`,
      key: (item) => [item.tx_hash, item.log_index],
    },
    enclave_events: {
      db: () => env.SCAN_DB,
      sql: `UPDATE enclave_events SET timestamp = 'x' WHERE tx_hash = ?1
              AND log_index = ?2 AND ve_btc_token_id = ?3`,
      key: (item) => [item.tx_hash, item.log_index, item.ve_btc_token_id],
    },
    morpho_markets: {
      db: () => env.READ_DB,
      sql: "UPDATE morpho_markets SET lltv_raw = 'bad' WHERE market_id = ?1",
      key: (item) => [item.market_id],
    },
    morpho_positions: {
      db: () => env.READ_DB,
      sql: `UPDATE morpho_positions SET collateral_raw = 'bad'
            WHERE market_id = ?1 AND account = ?2`,
      key: (item) => [item.market_id, item.account],
    },
    troves: {
      db: () => env.READ_DB,
      sql: "UPDATE troves SET coll_raw = 'bad' WHERE owner = ?1",
      key: (item) => [item.owner],
    },
  }

  const lists: { path: string; table: string; aggregate?: boolean }[] = [
    { path: "/activity?limit=100", table: "activity" },
    { path: `/activity/tx/${txHash}`, table: "activity" },
    { path: `/activity/address/${people.alice}?limit=100`, table: "activity" },
    { path: `/activity/gauge/${gauge}?limit=100`, table: "activity" },
    { path: `/activity/epoch/${lastEpoch}?limit=100`, table: "activity" },
    { path: "/activity/lock/vemezo/7?limit=100", table: "activity" },
    { path: "/activity/action/BOOST_VOTE?limit=100", table: "activity" },
    { path: "/locks?escrow=vebtc&limit=100", table: "locks" },
    { path: "/locks?escrow=vebtc&order=unlock&limit=100", table: "locks" },
    { path: "/locks?escrow=vebtc&order=created&limit=100", table: "locks" },
    { path: `/owners/${people.alice}/locks`, table: "locks" },
    { path: "/locks/vemezo/7/votes", table: "lock_votes" },
    {
      path: `/gauges/${gauge}/voters?epoch=${currentEpoch}&limit=100`,
      table: "lock_votes",
    },
    { path: `/gauges/${gauge}/incentives`, table: "incentive_deposits" },
    {
      path: `/depositors/${people.bob}/incentives`,
      table: "incentive_deposits",
    },
    { path: `/epochs/${lastEpoch}/incentives`, table: "incentive_deposits" },
    {
      path: `/gauges/${gauge}/epochs`,
      table: "gauge_epoch",
      aggregate: true,
    },
    {
      path: `/epochs/${currentEpoch}/gauges?source=BOOST_VOTER`,
      table: "gauge_epoch",
      aggregate: true,
    },
    { path: "/epochs", table: "epoch_totals", aggregate: true },
    { path: `/borrow/troves/${troveBorrower}/events`, table: "trove_events" },
    { path: "/borrow/redemptions", table: "trove_events" },
    { path: "/borrow/liquidations", table: "trove_events" },
    { path: `/borrow/markets/${market}/events`, table: "morpho_events" },
    {
      path: `/borrow/markets/${market}/positions/${people.alice}/events`,
      table: "morpho_events",
    },
    {
      path: `/borrow/enclave/positions/${positionId}/events`,
      table: "enclave_events",
    },
    {
      path: `/borrow/enclave/borrowers/${people.alice}/events`,
      table: "enclave_events",
    },
    { path: "/borrow/markets", table: "morpho_markets" },
    { path: `/borrow/markets/${market}/positions`, table: "morpho_positions" },
    { path: "/borrow/troves", table: "troves" },
  ]

  const listSchema = z.object({
    data: z.array(z.record(z.string(), z.unknown())),
    meta: z.object({ skipped: z.number(), complete: z.boolean().optional() }),
  })

  for (const list of lists) {
    it(`skips it on ${list.path}, logs it, and counts it in meta`, async () => {
      const before = listSchema.parse(await (await h.get(list.path)).json())
      expect(before.data.length).toBeGreaterThan(0)
      expect(before.meta.skipped).toBe(0)
      const victim = before.data[0] ?? {}
      const broken = corrupt[list.table]
      if (broken === undefined) throw new Error(list.table)
      const changed = await broken
        .db()
        .prepare(broken.sql)
        .bind(...broken.key(victim))
        .run()
      expect(changed.meta.changes).toBe(1)
      // A fresh cache, so the list is read again.
      const after = harness()
      const response = await after.get(list.path)
      expect(response.status).toBe(200)
      const body = listSchema.parse(await response.json())
      expect(body.meta.skipped).toBe(1)
      expect(body.data).toHaveLength(before.data.length - 1)
      expect(body.data).not.toContainEqual(victim)
      if (list.aggregate) expect(body.meta.complete).toBe(false)
    })
  }

  it("logs the table and primary key of the row it skipped", async () => {
    const lines: unknown[] = []
    const logged = createLogger({ sink: (_level, line) => lines.push(line) })
    const first = scanPageSchema(scanActivityItemSchema).parse(
      await (await h.get("/activity?limit=1")).json(),
    )
    const victim = first.data[0]
    await env.SCAN_DB.prepare("UPDATE activity SET extra = '{' WHERE id = ?1")
      .bind(victim?.id)
      .run()
    const app = new Hono<ApiEnv>()
    app.onError(errorHandler())
    registerScanRoutes(app, {
      scanDb: env.SCAN_DB,
      readDb: env.READ_DB,
      network: "mezo",
      cache: null,
      rateLimits: null,
      readPrices: async () => null,
      proxy: null,
      clock: async () => ({ height: null, lastActive: null }),
      logger: logged,
      now: () => scanNow * 1000,
    })
    const response = await app.request(`${base}/activity?limit=1`)
    expect(response.status).toBe(200)
    expect(lines.join(" ")).toContain(
      `"table":"activity","key":{"id":"${victim?.id}"}`,
    )
  })
})

describe("cache keys and the clock", () => {
  const series = (from: number, to: number) =>
    `/series?metric=chain.transactions&from=${day(from)}&to=${day(to)}`

  it("keeps a series range a day only once it is settled", async () => {
    // Copied up to the minute before scanNow (a UTC midnight).
    await writeStatus(env.SCAN_DB, { copied_through: scanNow - 60 })
    const settled = await h.get(series(-30, -3))
    expect(settled.headers.get("X-Scan-Class")).toBe("long")
    // Ends the day before copied_through's: may still take late rows.
    const recent = await h.get(series(-30, -2))
    expect(recent.headers.get("X-Scan-Class")).toBe("run")
  })

  it("does not keep yesterday a day just after midnight (the midnight case)", async () => {
    // Five minutes past midnight; the copy has not yet read past it.
    h.state.now = (scanNow + 300) * 1000
    await writeStatus(env.SCAN_DB, { copied_through: scanNow - 120 })
    const yesterday = await h.get(series(-9, -1))
    expect(yesterday.status).toBe(200)
    expect(yesterday.headers.get("X-Scan-Class")).toBe("run")
    expect(yesterday.headers.get("Cache-Control")).toBe("public, max-age=30")
  })

  it("never keeps a range a day while stale, without a status row, or with a partial point", async () => {
    // No status row (scan_runs only): copied_through is unknown.
    expect((await h.get(series(-30, -5))).headers.get("X-Scan-Class")).toBe(
      "run",
    )
    await writeStatus(env.SCAN_DB, {
      copied_through: scanNow,
      consecutive_failures: 2,
    })
    h.state.now += 6_000
    expect((await h.get(series(-30, -6))).headers.get("X-Scan-Class")).toBe(
      "run",
    )
    await writeStatus(env.SCAN_DB, { copied_through: scanNow })
    await env.SCAN_DB.prepare(
      "UPDATE daily SET partial = 1 WHERE metric = 'chain.transactions' AND day = ?1",
    )
      .bind(day(-10))
      .run()
    h.state.now += 6_000
    const partial = await h.get(series(-30, -7))
    expect(partial.headers.get("X-Scan-Class")).toBe("run")
    const again = await h.get(series(-30, -7))
    expect(again.headers.get("X-Cache")).toBe("memory")
    expect(again.headers.get("X-Scan-Class")).toBe("run")
  })

  it("keys aggregates on data_version, or updated_at before that column", async () => {
    // scan-migrations 0003 adds data_version; before it, updated_at.
    const columns = await env.SCAN_DB.prepare(
      "SELECT name FROM pragma_table_info('scan_status')",
    ).all()
    const hasDataVersion = columns.results.some(
      (row) => (row as { name?: unknown }).name === "data_version",
    )
    await writeStatus(env.SCAN_DB, { updated_at: scanNow - 100 })
    await h.get("/epochs")
    await h.get("/activity?limit=2")
    expect((await h.get("/epochs")).headers.get("X-Cache")).toBe("memory")
    // A skipped run rewrote aggregates: last_ok_at stays where it was.
    await env.SCAN_DB.prepare(
      hasDataVersion
        ? `UPDATE scan_status SET last_run_status = 'skipped', updated_at = ?1,
             data_version = data_version + 1 WHERE id = 1`
        : `UPDATE scan_status SET last_run_status = 'skipped', updated_at = ?1
           WHERE id = 1`,
    )
      .bind(scanNow - 10)
      .run()
    h.state.now += 6_000
    expect((await h.get("/epochs")).headers.get("X-Cache")).toBe("miss")
    // With data_version every served change retires run entries too;
    // before it, activity (not an aggregate) keys on last_ok_at alone.
    expect((await h.get("/activity?limit=2")).headers.get("X-Cache")).toBe(
      hasDataVersion ? "miss" : "memory",
    )
    await h.get("/epochs")
    // A skipped run that changed nothing: no new data_version.
    await env.SCAN_DB.prepare(
      "UPDATE scan_status SET updated_at = ?1 WHERE id = 1",
    )
      .bind(scanNow - 5)
      .run()
    h.state.now += 6_000
    expect((await h.get("/epochs")).headers.get("X-Cache")).toBe(
      hasDataVersion ? "memory" : "miss",
    )
  })

  it("reads data_version once the jobs Worker adds it, and keys every run entry on it", async () => {
    const columns = await env.SCAN_DB.prepare(
      "SELECT name FROM pragma_table_info('scan_status')",
    ).all()
    if (
      !columns.results.some(
        (row) => (row as { name?: unknown }).name === "data_version",
      )
    ) {
      // As scan-migrations 0003 does.
      await env.SCAN_DB.prepare(
        "ALTER TABLE scan_status ADD COLUMN data_version INTEGER NOT NULL DEFAULT 0",
      ).run()
    }
    await writeStatus(env.SCAN_DB)
    await env.SCAN_DB.prepare(
      "UPDATE scan_status SET data_version = 41 WHERE id = 1",
    ).run()
    // The status row is still read with the extra column.
    const status = await h.json("/status", z.object({ data: scanStatusSchema }))
    expect(status.data.source).toBe("status")
    await h.get("/activity?limit=2")
    expect((await h.get("/activity?limit=2")).headers.get("X-Cache")).toBe(
      "memory",
    )
    // A served row changed on a skipped run: last_ok_at stays.
    await env.SCAN_DB.prepare(
      "UPDATE scan_status SET data_version = 42, last_run_status = 'skipped' WHERE id = 1",
    ).run()
    h.state.now += 6_000
    expect((await h.get("/activity?limit=2")).headers.get("X-Cache")).toBe(
      "miss",
    )
  })

  it("keys a gauge's voters with no epoch on the epoch it resolved to", async () => {
    const path = `/gauges/${gauge}/voters`
    const now = await h.json(path, scanPageSchema(scanLockVoteItemSchema))
    expect(now.data.length).toBeGreaterThan(0)
    expect(now.data.every((vote) => vote.epoch_start === currentEpoch)).toBe(
      true,
    )
    // The epoch turns; nothing else changes.
    h.state.now = (currentEpoch + 604_800 + 60) * 1000
    const next = await h.get(path)
    expect(next.headers.get("X-Cache")).toBe("miss")
    const body = scanPageSchema(scanLockVoteItemSchema).parse(await next.json())
    expect(body.data.every((vote) => vote.epoch_start !== currentEpoch)).toBe(
      true,
    )
  })

  it("keys the epochs list on the clock's epoch, so sealed flips when it ends", async () => {
    const before = await h.json(
      "/epochs",
      scanAggregatePageSchema(scanEpochItemSchema),
    )
    const current = before.data.find((row) => row.epoch_start === currentEpoch)
    expect(current?.sealed).toBe(false)
    h.state.now = (currentEpoch + 604_800 + 60) * 1000
    const after = await h.get("/epochs")
    expect(after.headers.get("X-Cache")).toBe("miss")
    const body = scanAggregatePageSchema(scanEpochItemSchema).parse(
      await after.json(),
    )
    expect(
      body.data.find((row) => row.epoch_start === currentEpoch)?.sealed,
    ).toBe(true)
  })
})

describe("orderings and ties", () => {
  it("pages voters tied on weight and token id across escrows without a gap", async () => {
    // veMEZO #7 already votes weight 1; veBTC #7 ties it exactly.
    await env.SCAN_DB.prepare(
      `INSERT INTO lock_votes (epoch_start, gauge, escrow, token_id, source,
         pool, weight, weight_key, voted_at, carried)
       VALUES (?1, ?2, ?3, '7', 'BOOST_VOTER', NULL, '1', ?4, ?5, 0)`,
    )
      .bind(
        currentEpoch,
        gauge,
        vebtc,
        "1".padStart(40, "0"),
        currentEpoch + 3_600,
      )
      .run()
    const { items } = await allPages(
      h,
      `/gauges/${gauge}/voters?epoch=${currentEpoch}`,
      scanLockVoteItemSchema,
      1,
    )
    expect(items).toHaveLength(gaugeVoterCount + 2)
    const sevens = items.filter((vote) => vote.token_id === "7")
    expect(sevens.map((vote) => vote.escrow).sort()).toEqual(
      [vebtc, vemezo].sort(),
    )
  })

  describe("locks", () => {
    beforeEach(async () => {
      // A live lock with neither an unlock nor a creation time recorded.
      await env.SCAN_DB.prepare(
        `INSERT INTO locks (escrow, token_id, owner, amount, amount_key,
           unlock_at, created_at, last_extended_at, withdrawn_at,
           is_permanent, is_withdrawn, is_merged, merged_into_token_id,
           merged_at, boost, activity_count, updated_at)
         VALUES (?1, '6', ?2, '1', ?3, NULL, NULL, NULL, NULL, 0, 0, 0,
           NULL, NULL, NULL, 0, ?4)`,
      )
        .bind(vebtc, people.alice, "1".padStart(40, "0"), scanNow)
        .run()
    })

    it("lists timed locks soonest first, then permanent, then unknown", async () => {
      for (const limit of [1, 2, 100]) {
        const { items } = await allPages(
          h,
          "/locks?escrow=vebtc&order=unlock",
          scanLockItemSchema,
          limit,
        )
        expect(items.map((lock) => lock.token_id)).toEqual([
          "2",
          "4",
          "1",
          "3",
          "6",
        ])
      }
    })

    it("lists newest first, then the locks with no creation time", async () => {
      for (const limit of [1, 3, 100]) {
        const { items } = await allPages(
          h,
          "/locks?escrow=vebtc&order=created",
          scanLockItemSchema,
          limit,
        )
        expect(items.map((lock) => lock.token_id)).toEqual([
          "4",
          "3",
          "2",
          "1",
          "5",
          "6",
        ])
      }
    })
  })
})

describe("review notes", () => {
  /** READ_DB with every prepared statement recorded. */
  function countingReadDb() {
    const statements: string[] = []
    const db = new Proxy(env.READ_DB, {
      get(target, property) {
        if (property === "prepare") {
          return (sql: string) => {
            statements.push(sql)
            return target.prepare(sql)
          }
        }
        const value = Reflect.get(target, property)
        return typeof value === "function" ? value.bind(target) : value
      },
    })
    return { db, statements }
  }

  it("resolves a series' token and decimals from its dimension", async () => {
    const borrow = await h.json(
      `/series?metric=morpho.total_borrow&dimension=${market}&from=${day(-3)}&to=${day(-1)}`,
      z.object({ data: scanSeriesSchema }),
    )
    // The market's loan token: MEZO, 18 decimals.
    expect(borrow.data.decimals).toBe("token")
    expect(borrow.data.token).toEqual({ address: musd, symbol: "MEZO" })
    expect(borrow.data.resolvedDecimals).toBe(18)
    const collateral = await h.json(
      `/series?metric=morpho.total_collateral&dimension=${market}&from=${day(-3)}&to=${day(-1)}`,
      z.object({ data: scanSeriesSchema }),
    )
    // Its collateral token, which the registry does not know.
    expect(collateral.data.token?.address).not.toBe(musd)
    expect(collateral.data.token?.symbol).toBeNull()
    expect(collateral.data.resolvedDecimals).toBeNull()
    // All markets together: no one token.
    const total = await h.json(
      `/series?metric=morpho.total_borrow&from=${day(-3)}&to=${day(-1)}`,
      z.object({ data: scanSeriesSchema }),
    )
    expect(total.data.token).toBeNull()
    expect(total.data.resolvedDecimals).toBeNull()
    const count = await h.json(
      `/series?metric=chain.transactions&from=${day(-3)}&to=${day(-1)}`,
      z.object({ data: scanSeriesSchema }),
    )
    expect(count.data.resolvedDecimals).toBeNull()
    const locks = await h.json(
      `/series?metric=locks.net&dimension=vebtc&from=${day(-3)}&to=${day(-1)}`,
      z.object({ data: scanSeriesSchema }),
    )
    expect(locks.data.resolvedDecimals).toBe(18)
  })

  it("rejects a lock search with anything after the id", async () => {
    expect((await h.get("/search?kind=lock&q=vebtc:1:2")).status).toBe(400)
    expect((await h.get("/search?kind=lock&q=vebtc:1")).status).toBe(200)
  })

  it("parses the gauge directory once per etag for name search", async () => {
    const { db, statements } = countingReadDb()
    const counted = harness({ readDb: db })
    for (const q of ["gau", "gaug", "gauge"]) {
      expect((await counted.get(`/search?kind=name&q=${q}`)).status).toBe(200)
    }
    const bodies = statements.filter((sql) => sql.includes("SELECT body"))
    expect(bodies).toHaveLength(1)
  })

  it("keys name search on the directory's etag too", async () => {
    await h.get("/search?kind=name&q=gauge")
    expect(
      (await h.get("/search?kind=name&q=gauge")).headers.get("X-Cache"),
    ).toBe("memory")
    await writeReadModels(env.READ_DB, [
      {
        network: "mezo",
        kind: "gauges",
        key: "current",
        // A renamed gauge: a new etag.
        data: {
          ...demoGaugeDirectory,
          gauges: demoGaugeDirectory.gauges.map((card, index) =>
            index === 0
              ? { ...card, gauge: { ...card.gauge, name: "Gauge Renamed" } }
              : card,
          ),
        },
        block: 13_000_002,
        source: "warehouse",
        updatedAt: scanNow + 1,
      },
    ])
    h.state.now += 6_000
    expect(
      (await h.get("/search?kind=name&q=gauge")).headers.get("X-Cache"),
    ).toBe("miss")
  })

  it("reads the directory's version once per five seconds, not per request", async () => {
    const { db, statements } = countingReadDb()
    const counted = harness({ readDb: db })
    for (let index = 0; index < 4; index += 1) {
      expect((await counted.get("/gauges")).status).toBe(200)
    }
    const versions = statements.filter((sql) =>
      sql.includes("SELECT etag, updated_at FROM read_models"),
    )
    expect(versions).toHaveLength(1)
  })

  it("keys a label lookup on the set of addresses, not their spelling", async () => {
    const first = await h.get(`/labels?address=${people.alice},${gauge}`)
    expect(first.headers.get("X-Cache")).toBe("miss")
    const same = await h.get(
      `/labels?address=${gauge.toUpperCase().replace("0X", "0x")},${people.alice},${people.alice}`,
    )
    expect(same.headers.get("X-Cache")).toBe("memory")
    expect(await same.json()).toEqual(await first.json())
  })

  it("says when a transaction names more addresses than it labels", async () => {
    const many = Array.from(
      { length: 60 },
      (_, index) => `0x${(index + 1).toString(16).padStart(40, "0")}`,
    )
    const base = transactionLogs.items[0]
    h.blockscout.reply(`transactions/${blockTx}`, {
      status: 200,
      body: { ...transaction, has_error_in_internal_transactions: false },
    })
    h.blockscout.reply(`transactions/${blockTx}/logs`, {
      status: 200,
      body: {
        items: many.map((hash) => ({
          ...base,
          address: { ...base?.address, hash },
        })),
        next_page_params: null,
      },
    })
    h.blockscout.reply(`transactions/${blockTx}/token-transfers`, {
      status: 200,
      body: transactionTokenTransfers,
    })
    const response = await h.get(`/entities/tx/${blockTx}`)
    const document = scanTransactionDocumentSchema.parse(
      z.object({ data: z.unknown() }).parse(await response.json()).data,
    )
    expect(document.logs.status).toBe("ok")
    expect(document.labelLimit).toBe(50)
    expect(document.labelsTruncated).toBe(true)
    // A short one is not truncated.
    const short = await h.get(`/entities/tx/${txHash}`)
    const shortDocument = scanTransactionDocumentSchema.parse(
      z.object({ data: z.unknown() }).parse(await short.json()).data,
    )
    expect(shortDocument.labelsTruncated).toBe(false)
  })
})

describe("halted tables and status read errors", () => {
  it("is stale while the copy has halted a table, and says which", async () => {
    await writeStatus(env.SCAN_DB)
    await env.SCAN_DB.prepare(
      `UPDATE scan_status SET halted_tables = ?1 WHERE id = 1`,
    )
      .bind(JSON.stringify({ activity: "1,200 rows quarantined in one run" }))
      .run()
    const status = await h.json("/status", z.object({ data: scanStatusSchema }))
    expect(status.data).toMatchObject({
      source: "status",
      stale: true,
      halted: true,
      haltedTables: ["activity"],
      consecutiveFailures: 0,
      refillRequired: false,
    })
    // No reason text in the body.
    expect(JSON.stringify(status)).not.toContain("quarantined in one run")
    const epochs = await h.json(
      "/epochs",
      scanAggregatePageSchema(scanEpochItemSchema),
    )
    expect(epochs.meta.stale).toBe(true)
    // Never sealed while halted.
    expect(
      (await h.get(`/epochs/${lastEpoch}`)).headers.get("X-Scan-Class"),
    ).toBe("run")
  })

  it("counts a halted_tables value it cannot read as halted, and NULL as not", async () => {
    await writeStatus(env.SCAN_DB)
    await env.SCAN_DB.prepare(
      "UPDATE scan_status SET halted_tables = 'activity;locks' WHERE id = 1",
    ).run()
    const odd = await h.json("/status", z.object({ data: scanStatusSchema }))
    expect(odd.data).toMatchObject({
      stale: true,
      halted: true,
      haltedTables: [],
    })
    await env.SCAN_DB.prepare(
      "UPDATE scan_status SET halted_tables = NULL WHERE id = 1",
    ).run()
    h.state.now += 6_000
    const clear = await h.json("/status", z.object({ data: scanStatusSchema }))
    expect(clear.data).toMatchObject({
      stale: false,
      halted: false,
      haltedTables: [],
    })
  })

  /** SCAN_DB whose scan_status reads fail with `message`. */
  function statusFailing(message: string) {
    let failing = true
    const db = new Proxy(env.SCAN_DB, {
      get(target, property) {
        if (property === "prepare") {
          return (sql: string) => {
            if (failing && sql.includes("FROM scan_status")) {
              throw new Error(message)
            }
            return target.prepare(sql)
          }
        }
        const value = Reflect.get(target, property)
        return typeof value === "function" ? value.bind(target) : value
      },
    })
    return {
      db,
      recover() {
        failing = false
      },
    }
  }

  it("falls back to scan_runs only when scan_status does not exist", async () => {
    const missing = statusFailing(
      "D1_ERROR: no such table: scan_status: SQLITE_ERROR",
    )
    const before = harness({ scanDb: missing.db })
    const status = await before.json(
      "/status",
      z.object({ data: scanStatusSchema }),
    )
    expect(status.data.source).toBe("runs")
  })

  it("answers nothing cacheable when scan_status fails to read for any other reason", async () => {
    await writeStatus(env.SCAN_DB)
    const broken = statusFailing("D1_ERROR: Network connection lost.")
    const probe = harness({ scanDb: broken.db })
    const failed = await probe.get("/epochs")
    expect(failed.status).toBe(500)
    // A composed document still answers, but is stored nowhere.
    probe.blockscout.reply(`blocks/${block.height}`, {
      status: 200,
      body: block,
    })
    const document = await probe.get(`/entities/block/${block.height}`)
    expect(document.status).toBe(200)
    expect(document.headers.get("Cache-Control")).toBe("private, no-store")
    // Once it reads again, the answer is fresh from the status row.
    broken.recover()
    const epochs = await probe.get("/epochs")
    expect(epochs.status).toBe(200)
    expect(epochs.headers.get("X-Cache")).toBe("miss")
    const body = scanAggregatePageSchema(scanEpochItemSchema).parse(
      await epochs.json(),
    )
    expect(body.meta.historyFilled).toBe(true)
  })

  it("does not fall back when the status row fails its schema", async () => {
    await writeStatus(env.SCAN_DB, { consecutive_failures: 2 })
    // A row the contract cannot read (negative count).
    await env.SCAN_DB.prepare(
      "UPDATE scan_status SET consecutive_failures = -1 WHERE id = 1",
    ).run()
    const response = await h.get("/epochs")
    expect(response.status).toBe(500)
  })
})

describe("bad rows at page boundaries", () => {
  type Item = Record<string, unknown>
  const pageBody = z.object({
    data: z.array(z.record(z.string(), z.unknown())),
    nextCursor: z.string().nullable(),
    meta: z.object({ skipped: z.number() }),
  })

  /** Every page at `limit`: the items and the skips each page reported. */
  async function walk(path: string, limit: number) {
    const items: Item[] = []
    const skips: number[] = []
    let cursor: string | null = null
    do {
      const separator = path.includes("?") ? "&" : "?"
      const query = `${separator}limit=${limit}${cursor === null ? "" : `&cursor=${cursor}`}`
      const response = await harness().get(`${path}${query}`)
      expect(response.status).toBe(200)
      const body = pageBody.parse(await response.json())
      items.push(...body.data)
      skips.push(body.meta.skipped)
      cursor = body.nextCursor
      expect(skips.length).toBeLessThan(100)
    } while (cursor !== null)
    return { items, skips }
  }

  const breakRow: Record<string, (item: Item) => Promise<unknown>> = {
    activity: (item) =>
      env.SCAN_DB.prepare("UPDATE activity SET extra = '{' WHERE id = ?1")
        .bind(item.id)
        .run(),
    locks: (item) =>
      env.SCAN_DB.prepare(
        "UPDATE locks SET amount = 'bad' WHERE escrow = ?1 AND token_id = ?2",
      )
        .bind(item.escrow, item.token_id)
        .run(),
    events: (item) =>
      env.SCAN_DB.batch(
        ["trove_events", "morpho_events"].map((table) =>
          env.SCAN_DB.prepare(
            `UPDATE ${table} SET timestamp = 'x'
             WHERE tx_hash = ?1 AND log_index = ?2`,
          ).bind(item.tx_hash, item.log_index),
        ),
      ),
  }

  const lists = [
    { path: "/activity", kind: "activity" },
    { path: `/activity/address/${people.alice}`, kind: "activity" },
    { path: "/locks?escrow=vebtc&order=unlock", kind: "locks" },
    { path: "/borrow/liquidations", kind: "events" },
  ]

  beforeEach(async () => {
    // Liquidations enough for pages: three Morpho ones beside the trove's,
    // one sharing the trove's block.
    await env.SCAN_DB.batch(
      [12_950_100, 12_950_050, 12_900_002].map((blockNumber, index) =>
        env.SCAN_DB.prepare(
          `INSERT INTO morpho_events (tx_hash, log_index, block_number,
             timestamp, tx_from, market_id, action, caller, on_behalf, assets,
             shares, seized_assets)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'LIQUIDATED', ?5, ?7, '100', '1',
             '5')`,
        ).bind(
          `0x${(index + 0x50).toString(16).repeat(32)}`,
          90 + index,
          blockNumber,
          lastEpoch + 50 + index,
          people.bob,
          market,
          people.alice,
        ),
      ),
    )
  })

  for (const list of lists) {
    it(`steps over a whole page of bad rows on ${list.path}, each counted once`, async () => {
      const before = await walk(list.path, 100)
      expect(before.items.length).toBeGreaterThanOrEqual(3)
      // The first two rows: the whole first page at limit 2.
      const victims = before.items.slice(0, 2)
      for (const victim of victims) await breakRow[list.kind]?.(victim)
      const after = await walk(list.path, 2)
      expect(after.skips[0]).toBe(2)
      expect(after.items).toEqual(before.items.slice(2))
      // Stepped over once: not re-read and counted again.
      expect(after.skips.reduce((sum, skip) => sum + skip, 0)).toBe(2)
    })

    it(`skips a bad row at a page's end once on ${list.path}`, async () => {
      const before = await walk(list.path, 100)
      expect(before.items.length).toBeGreaterThanOrEqual(3)
      // The last row of the first page at limit 2.
      const victim = before.items[1] ?? {}
      await breakRow[list.kind]?.(victim)
      const after = await walk(list.path, 2)
      expect(after.items).toEqual(
        before.items.filter((_, index) => index !== 1),
      )
      expect(after.skips.reduce((sum, skip) => sum + skip, 0)).toBe(1)
    })

    it(`counts a bad row just past a page once, on its own page, on ${list.path}`, async () => {
      const before = await walk(list.path, 100)
      expect(before.items.length).toBeGreaterThanOrEqual(3)
      // The first row of the second page at limit 2: read ahead by the
      // first page, but not part of it.
      const victim = before.items[2] ?? {}
      await breakRow[list.kind]?.(victim)
      const after = await walk(list.path, 2)
      expect(after.items).toEqual(
        before.items.filter((_, index) => index !== 2),
      )
      expect(after.skips[0]).toBe(0)
      expect(after.skips.reduce((sum, skip) => sum + skip, 0)).toBe(1)
    })
  }
})

describe("b6d1e17's defaulted fields, sent by the API", () => {
  // The contract defaults these for older fixtures; the API itself must
  // send each one, so Scan never shows a default as data.
  it("sends killed, killed_weight, killedGauges and every meta flag", async () => {
    await writeStatus(env.SCAN_DB)
    const raw = async (path: string) =>
      (await (await h.get(path)).json()) as Record<string, unknown>
    const ranking = await raw(
      `/epochs/${currentEpoch}/gauges?source=BOOST_VOTER`,
    )
    expect(ranking).toHaveProperty("killed")
    expect(ranking.meta).toMatchObject({
      aggregatesComplete: true,
      historyFilled: true,
      stale: false,
      skipped: 0,
    })
    const ranked = (ranking.data as Record<string, unknown>[])[0]
    expect(ranked).toHaveProperty("killed", 0)
    const epochs = await raw("/epochs")
    expect((epochs.data as Record<string, unknown>[])[0]).toHaveProperty(
      "killed_weight",
    )
    const detail = await raw(`/epochs/${currentEpoch}`)
    expect(detail.data).toHaveProperty("killedGauges")
    const series = await raw(
      `/series?metric=chain.transactions&from=${day(-3)}&to=${day(-1)}`,
    )
    expect(series.data).toHaveProperty("note")
    expect(series.data).toHaveProperty("endsOn")
    expect(series.meta).toHaveProperty("stale", false)
    // Without a status row they are sent as null, not left out.
    await env.SCAN_DB.prepare("DELETE FROM scan_status").run()
    h.state.now += 6_000
    const bare = await raw(`/epochs/${lastEpoch}/gauges?source=BOOST_VOTER`)
    expect(bare.meta).toMatchObject({
      aggregatesComplete: null,
      historyFilled: null,
      stale: false,
    })
  })
})

describe("an owner's votes in one read", () => {
  const voter = people.bob
  /** veMEZO locks the fixtures' votes are on, now owned by `voter`. */
  const owned = ["7", "100", "101", "102", "103"]

  beforeEach(async () => {
    const lock = (escrow: string, tokenId: string) =>
      env.SCAN_DB.prepare(
        `INSERT INTO locks (escrow, token_id, owner, amount, amount_key,
           unlock_at, created_at, last_extended_at, withdrawn_at,
           is_permanent, is_withdrawn, is_merged, merged_into_token_id,
           merged_at, boost, activity_count, updated_at)
         VALUES (?1, ?2, ?3, '1', ?4, ?5, ?6, NULL, NULL, 0, 0, 0, NULL,
           NULL, NULL, 0, ?6)`,
      ).bind(
        escrow,
        tokenId,
        voter,
        "1".padStart(40, "0"),
        scanNow + 86_400,
        scanNow - 86_400,
      )
    await env.SCAN_DB.batch([
      ...owned.map((tokenId) => lock(vemezo, tokenId)),
      // A veBTC lock with the same id as a veMEZO one, voting the same gauge.
      lock(vebtc, "7"),
      env.SCAN_DB.prepare(
        `INSERT INTO lock_votes (epoch_start, gauge, escrow, token_id, source,
           pool, weight, weight_key, voted_at, carried)
         VALUES (?1, ?2, ?3, '7', 'BOOST_VOTER', NULL, '1', ?4, ?5, 0)`,
      ).bind(currentEpoch, gauge, vebtc, "1".padStart(40, "0"), currentEpoch),
    ])
  })

  /** What Scan reads today: the owner's locks, then each lock's votes. */
  async function fanOut() {
    const locks = await allPages(
      h,
      `/owners/${voter}/locks`,
      scanLockItemSchema,
      100,
    )
    const votes = []
    for (const lock of locks.items) {
      const name = lock.escrow === vebtc ? "vebtc" : "vemezo"
      const page = await allPages(
        h,
        `/locks/${name}/${lock.token_id}/votes`,
        scanLockVoteItemSchema,
        100,
      )
      votes.push(...page.items)
    }
    return votes
  }

  const ownerPage = scanOwnerVotesPageSchema

  async function walk(path: string, limit: number) {
    const items: z.infer<typeof scanLockVoteItemSchema>[] = []
    let cursor: string | null = null
    let pages = 0
    do {
      const separator = path.includes("?") ? "&" : "?"
      const body: z.infer<typeof ownerPage> = await h.json(
        `${path}${separator}limit=${limit}${cursor === null ? "" : `&cursor=${cursor}`}`,
        ownerPage,
      )
      items.push(...body.data)
      cursor = body.nextCursor
      pages += 1
      expect(pages).toBeLessThan(200)
    } while (cursor !== null)
    return items
  }

  it("answers what the fan-out did, in the same order, at any page size", async () => {
    const expected = await fanOut()
    expect(expected.length).toBeGreaterThan(owned.length)
    expect(new Set(expected.map((vote) => vote.escrow)).size).toBe(2)
    for (const limit of [1, 3, 100]) {
      expect(await walk(`/owners/${voter}/votes`, limit)).toEqual(expected)
    }
  })

  it("keeps one epoch with ?epoch=", async () => {
    const expected = (await fanOut()).filter(
      (vote) => vote.epoch_start === lastEpoch,
    )
    expect(expected.length).toBeGreaterThan(0)
    for (const limit of [1, 100]) {
      expect(
        await walk(`/owners/${voter}/votes?epoch=${lastEpoch}`, limit),
      ).toEqual(expected)
    }
  })

  it("labels the page's gauges, and is empty for an address with no locks", async () => {
    const body = await h.json(`/owners/${voter}/votes?limit=100`, ownerPage)
    expect(body.labels[gauge]?.name).toBe("Gauge MUSD Boost")
    expect(body.labelLimit).toBe(50)
    expect(body.labelsTruncated).toBe(false)
    const gauges = new Set(body.data.map((vote) => vote.gauge))
    for (const address of Object.keys(body.labels)) {
      expect(gauges.has(address)).toBe(true)
    }
    const nobody = await h.json(`/owners/${people.nobody}/votes`, ownerPage)
    expect(nobody).toMatchObject({ data: [], nextCursor: null, labels: {} })
  })

  it("validates the cursor, epoch and page size like the other lists", async () => {
    const other = await h.json(
      `/owners/${voter}/votes?epoch=${lastEpoch}&limit=1`,
      ownerPage,
    )
    expect(other.nextCursor).not.toBeNull()
    // A cursor from the one-epoch list, or from another list, is a 400.
    expect(
      (await h.get(`/owners/${voter}/votes?cursor=${other.nextCursor}`)).status,
    ).toBe(400)
    for (const query of ["epoch=123", "limit=101", "limit=0", "order=x"]) {
      expect((await h.get(`/owners/${voter}/votes?${query}`)).status).toBe(400)
    }
    expect((await h.get("/owners/0x123/votes")).status).toBe(404)
  })
})

describe("labels in the address document", () => {
  it("labels the addresses its parts name, the address first", async () => {
    h.blockscout.reply(`addresses/${people.alice}`, {
      status: 200,
      body: { ...addressFixture, hash: people.alice },
    })
    const response = await h.get(`/entities/address/${people.alice}`)
    const document = scanAddressDocumentSchema.parse(
      z.object({ data: z.unknown() }).parse(await response.json()).data,
    )
    expect(document.label?.name).toBe("Alice Treasury")
    expect(document.labels?.[people.alice]?.name).toBe("Alice Treasury")
    // Alice's activity names the gauge, which is labelled.
    expect(document.labels?.[gauge]?.name).toBe("Gauge MUSD Boost")
    expect(document.labelLimit).toBe(50)
    expect(document.labelsTruncated).toBe(false)
  })

  it("says when the parts name more addresses than it labels", async () => {
    // Sixty activity rows for Alice, each naming three new addresses.
    await env.SCAN_DB.batch(
      Array.from({ length: 60 }, (_, index) =>
        env.SCAN_DB.prepare(
          `INSERT INTO activity (id, tx_hash, log_index, block_number,
             timestamp, epoch_start, action_type, source, contract_address,
             tx_from, actor, recipient, lock_escrow, token_id, amount, token,
             gauge, pool, reward_contract, weight, extra)
           VALUES (?1, ?2, 0, ?3, ?4, ?5, 'TRANSFER', 'test', ?6, ?7, ?7, ?8,
             NULL, NULL, NULL, NULL, ?9, NULL, NULL, NULL, '{}')`,
        ).bind(
          `many-${index}`,
          `0x${(index + 1).toString(16).padStart(64, "0")}`,
          13_100_000 + index,
          scanNow - 10 + index,
          currentEpoch,
          // Three new addresses a row: contract, recipient, gauge.
          `0x${(index + 1).toString(16).padStart(40, "a")}`,
          people.alice,
          `0x${(index + 1).toString(16).padStart(40, "b")}`,
          `0x${(index + 1).toString(16).padStart(40, "c")}`,
        ),
      ),
    )
    const response = await h.get(`/entities/address/${people.alice}`)
    const document = scanAddressDocumentSchema.parse(
      z.object({ data: z.unknown() }).parse(await response.json()).data,
    )
    expect(document.activity.status).toBe("ok")
    expect(document.labelsTruncated).toBe(true)
    // The address itself is always among the labelled.
    expect(document.label?.name).toBe("Alice Treasury")
  })
})

describe("tokens", () => {
  const MUSD = "0xdd468a1ddc392dcdbef6db6e34e89aa338f9f186"
  const MEZO = "0x7b7c000000000000000000000000000000000001"
  const BTC = "0x7b7c000000000000000000000000000000000000"
  const MCBBTC = "0x6a7cd8e1384d49f502b4a4ce9ac9eb320835c5d7"
  const UNLISTED = "0xe2232789d4cf5bb1ffada1a105cc59b18d639318"
  const ref = (address: string, symbol: string, decimals: string | null) => ({
    address_hash: address,
    name: symbol,
    symbol,
    decimals,
    type: "ERC-20",
    icon_url: null,
  })

  it("adds the address's ERC-20 balances, valued by the registry's pricing", async () => {
    h.blockscout.reply(`addresses/${people.alice}/tokens`, {
      status: 200,
      body: {
        items: [
          {
            token: ref(MUSD, "MUSD", "18"),
            token_id: null,
            value: "2500000000000000000",
          },
          {
            token: ref(MCBBTC, "mcbBTC", "8"),
            token_id: null,
            value: "100000000",
          },
          {
            token: ref(MEZO, "MEZO", "18"),
            token_id: null,
            value: "7000000000000000000",
          },
          {
            token: ref(UNLISTED, "XYZ", "6"),
            token_id: null,
            value: "1234567",
          },
        ],
        next_page_params: { items_count: 50, value: "1", id: 9 },
      },
    })
    const response = await h.get(`/entities/address/${people.alice}`)
    const document = scanAddressDocumentSchema.parse(
      z.object({ data: z.unknown() }).parse(await response.json()).data,
    )
    // One read of the first page, ERC-20 only; never token-balances.
    expect(
      h.blockscout.urls.filter((url) =>
        url.includes(`/addresses/${people.alice}/token`),
      ),
    ).toEqual([
      `https://api.explorer.mezo.org/api/v2/addresses/${people.alice}/tokens?type=ERC-20`,
    ])
    expect(document.tokens?.status).toBe("ok")
    if (document.tokens?.status !== "ok") return
    const tokens = document.tokens.data
    expect(
      tokens.items.map((item) => [
        item.token.symbol,
        item.token.decimals,
        item.value_usd,
        item.priced_as,
      ]),
    ).toEqual([
      // Taken as $1: the client may leave it out.
      ["MUSD", 18, "2.5", "usd"],
      // At BTC's price (74,000.5), 8 decimals from the registry.
      ["mcbBTC", 8, "74000.5", "btc"],
      // MEZO priced by MEZO's price, which the KV does not have here.
      ["MEZO", 18, null, "mezo"],
      // Not in the registry: Blockscout's decimals, never valued.
      ["XYZ", 6, null, null],
    ])
    expect(tokens.prices).toEqual({ btc_usd: "74000.5", mezo_usd: null })
    expect(tokens.next_page_params).toEqual({
      items_count: 50,
      value: "1",
      id: 9,
    })
  })

  it("degrades the part alone when Blockscout has no balances page", async () => {
    // The fake answers 404 for anything not replied.
    const response = await h.get(`/entities/address/${people.alice}`)
    const document = scanAddressDocumentSchema.parse(
      z.object({ data: z.unknown() }).parse(await response.json()).data,
    )
    expect(document.tokens).toEqual({
      status: "unavailable",
      reason: "not_found",
    })
    expect(document.locks.status).toBe("ok")
  })

  describe("the token list", () => {
    beforeEach(async () => {
      const row = (
        metric: string,
        token: string,
        offset: number,
        value: string,
        partial = 0,
      ) =>
        env.SCAN_DB.prepare(
          `INSERT INTO daily (metric, dimension, day, value, source, partial,
             updated_at)
           VALUES (?1, ?2, ?3, ?4, 'test', ?5, ?6)`,
        ).bind(metric, token, day(offset), value, partial, scanNow)
      await env.SCAN_DB.batch([
        row("token.total_supply", MUSD, -2, "18000000000000000000000000"),
        row("token.total_supply", MUSD, -1, "19000000000000000000000000"),
        row("token.holders", MUSD, -1, "29242"),
        row("token.total_supply", BTC, -1, "21000000000000000000"),
        // A token the jobs Worker reads that the registry does not list.
        row("token.total_supply", UNLISTED, -1, "5000000000"),
      ])
    })

    const list = scanTokenListSchema

    it("answers every token's price, latest supply and holders in one read", async () => {
      const body = await h.json("/tokens", list)
      const byAddress = new Map(body.data.map((row) => [row.address, row]))
      expect(byAddress.get(MUSD)).toMatchObject({
        symbol: "MUSD",
        priced_as: "usd",
        price_usd: "1",
        price_source: "registry",
        // The latest close, not a sum.
        supply: {
          value: "19000000000000000000000000",
          day: day(-1),
          partial: false,
        },
        supply_usd: "19000000",
        holders: { value: "29242", day: day(-1), partial: false },
      })
      expect(byAddress.get(BTC)).toMatchObject({
        price_usd: "74000.5",
        price_source: "mezo-oracle",
        supply_usd: "1554010.5",
        holders: null,
      })
      // No rows: null, never zero.
      expect(byAddress.get(MEZO)).toMatchObject({
        price_usd: null,
        price_source: null,
        supply: null,
        supply_usd: null,
        holders: null,
      })
      // Read by the jobs Worker, not in the registry: listed, unnamed.
      expect(byAddress.get(UNLISTED)).toMatchObject({
        symbol: null,
        decimals: null,
        supply: { value: "5000000000" },
        supply_usd: null,
      })
      expect(body.prices).toEqual({ btc_usd: "74000.5", mezo_usd: null })
      expect(body.meta.complete).toBe(true)
      // No Blockscout read at all.
      expect(h.blockscout.calls).toEqual([])
    })

    it("says a figure can still change, and caches by the live slot", async () => {
      await env.SCAN_DB.prepare(
        "UPDATE daily SET partial = 1 WHERE metric = 'token.holders'",
      ).run()
      const first = await h.get("/tokens")
      const body = list.parse(await first.json())
      expect(
        body.data.find((row) => row.address === MUSD)?.holders?.partial,
      ).toBe(true)
      expect(body.meta.complete).toBe(false)
      expect((await h.get("/tokens")).headers.get("X-Cache")).toBe("memory")
      // New KV prices land within the live slot.
      h.state.now += 300_000
      expect((await h.get("/tokens")).headers.get("X-Cache")).toBe("miss")
    })
  })
})

describe("the live snapshot's age", () => {
  const setBlock = (block: number | null) =>
    env.READ_DB.prepare("UPDATE stability_pool SET musd_btc_price_block = ?1")
      .bind(block)
      .run()
  const snapshotOf = z.object({ snapshot: scanLiveSnapshotSchema })

  it("is current when the last live run is within two runs of the head", async () => {
    // The harness head is 13,200,000.
    await setBlock(13_199_950)
    const expected = {
      block: 13_199_950,
      head: 13_200_000,
      behind_blocks: 50,
      stale: false,
      max_behind_blocks: 240,
    }
    const status = await h.json("/status", z.object({ data: scanStatusSchema }))
    expect(status.data.liveSnapshot).toEqual(expected)
    // On every live Borrow answer, documents and pages alike.
    for (const path of [
      "/borrow/markets",
      "/borrow/troves",
      `/borrow/troves/${troveBorrower}`,
      `/borrow/owners/${people.alice}`,
      "/borrow/stability-pool",
    ]) {
      expect((await h.json(path, snapshotOf)).snapshot, path).toEqual(expected)
    }
  })

  it("is stale when the live snapshot stopped", async () => {
    await setBlock(13_199_000)
    const answer = await h.json("/borrow/stability-pool", snapshotOf)
    expect(answer.snapshot).toMatchObject({ behind_blocks: 1_000, stale: true })
  })

  it("rides on the address document's borrow part", async () => {
    await setBlock(13_199_000)
    const response = await h.get(`/entities/address/${people.alice}`)
    const document = scanAddressDocumentSchema.parse(
      z.object({ data: z.unknown() }).parse(await response.json()).data,
    )
    if (document.borrow.status !== "ok") {
      throw new Error("the borrow part should be ok")
    }
    expect(document.borrow.snapshot).toEqual({
      block: 13_199_000,
      head: 13_200_000,
      behind_blocks: 1_000,
      stale: true,
      max_behind_blocks: 240,
    })
    // The positions themselves are as before.
    expect(document.borrow.data.owner).toBe(people.alice)
    expect(document.borrow.data.morpho).toHaveLength(1)
  })

  it("keeps no answer whose head the clock missed, so the next read has it", async () => {
    // A hub just woken: the clock's read times out once, then works.
    await setBlock(13_199_950)
    const woken = harness()
    woken.state.clock = { height: null, lastActive: null }
    for (const path of ["/borrow/markets", "/status"]) {
      const first = await woken.get(path)
      expect(first.headers.get("Cache-Control"), path).toBe("private, no-store")
    }
    woken.state.clock = { height: 13_200_000, lastActive: 13_200_000 }
    // Same live slot, same isolate: read again, not served from memory.
    const again = await woken.get("/borrow/markets")
    expect(again.headers.get("X-Cache")).toBe("miss")
    expect(snapshotOf.parse(await again.json()).snapshot).toMatchObject({
      head: 13_200_000,
      behind_blocks: 50,
      stale: false,
    })
    const status = await woken.json(
      "/status",
      z.object({ data: scanStatusSchema }),
    )
    expect(status.data.liveSnapshot?.head).toBe(13_200_000)
  })

  it("says nothing it does not know: no block, or no head", async () => {
    await setBlock(null)
    const unknownBlock = await h.json("/borrow/markets", snapshotOf)
    expect(unknownBlock.snapshot).toMatchObject({
      block: null,
      behind_blocks: null,
      stale: null,
    })
    await setBlock(13_199_950)
    const headless = harness()
    headless.state.clock = { height: null, lastActive: null }
    const noHead = await headless.json("/borrow/markets", snapshotOf)
    expect(noHead.snapshot).toMatchObject({
      block: 13_199_950,
      head: null,
      behind_blocks: null,
      stale: null,
    })
  })
})

describe("validators", () => {
  const v1 = `0x${"a1".repeat(20)}`
  const v2 = `0x${"b2".repeat(20)}`
  const v3 = `0x${"c3".repeat(20)}`
  const row = (
    metric: string,
    validator: string,
    offset: number,
    value: string,
  ) =>
    env.SCAN_DB.prepare(
      `INSERT INTO daily (metric, dimension, day, value, source, partial,
         updated_at)
       VALUES (?1, ?2, ?3, ?4, 'test', 0, ?5)`,
    ).bind(metric, validator, day(offset), value, scanNow)
  const total = (validator: string, offset: number, value: string) =>
    row("chain.blocks_proposed_total", validator, offset, value)
  const count = (validator: string, offset: number, value: string) =>
    row("chain.blocks_proposed", validator, offset, value)

  beforeEach(async () => {
    // Pro's directory: v1 is a ValidatorPool operator with a gauge.
    const [first, second] = demoGaugeDirectory.gauges
    if (first === undefined || second === undefined) throw new Error("cards")
    await writeReadModels(env.READ_DB, [
      {
        network: "mezo",
        kind: "gauges",
        key: "current",
        data: {
          ...demoGaugeDirectory,
          gauges: [
            {
              ...first,
              gauge: { ...first.gauge, name: "Northfield Nodes" },
              meta: { kind: "validator", operator: v1, status: "active" },
            },
            {
              ...second,
              meta: { kind: "validator", operator: null, status: "left" },
            },
          ],
        },
        block: 13_000_003,
        source: "warehouse",
        updatedAt: scanNow,
      },
    ])
  })

  const body = scanValidatorsSchema

  it("says not available yet before any daily read, never zero", async () => {
    const answer = await h.json("/validators", body)
    expect(answer.data).toMatchObject({
      available: false,
      day: null,
      day_total: null,
      shares_complete: false,
    })
    expect(answer.data.reason).toMatch(/two daily reads/)
    // The pool is still listed, with no counts.
    expect(answer.data.validators).toEqual([
      expect.objectContaining({
        address: v1,
        name: "Northfield Nodes",
        operator: v1,
        pool_status: "active",
        blocks: null,
        share_bps: null,
        blocks_total: null,
      }),
    ])
    expect(answer.data.pool_without_operator).toHaveLength(1)
    expect(answer.meta.complete).toBe(false)
  })

  it("is still not available after the first read: totals, no counts", async () => {
    await env.SCAN_DB.batch([total(v1, -1, "1000"), total(v2, -1, "500")])
    const answer = await h.json("/validators", body)
    expect(answer.data.available).toBe(false)
    expect(
      answer.data.validators.map((validator) => [
        validator.address,
        validator.blocks,
        validator.blocks_total?.value,
      ]),
    ).toEqual([
      [v1, null, "1000"],
      [v2, null, "500"],
    ])
  })

  /** Blocks the chain produced on a day (dimension ''). */
  const dayBlocks = (offset: number, value: string) =>
    row("chain.blocks", "", offset, value)

  it("gives each validator's share of every block the chain produced", async () => {
    await env.SCAN_DB.batch([
      total(v1, -2, "1000"),
      total(v2, -2, "500"),
      total(v1, -1, "1300"),
      total(v2, -1, "600"),
      count(v1, -2, "290"),
      count(v1, -1, "300"),
      count(v2, -1, "100"),
      // 500 blocks that day: 100 nobody known was counted for.
      dayBlocks(-1, "500"),
      // A total across validators ('' dimension) is not a validator.
      row("chain.blocks_proposed", "", -1, "400"),
      row("chain.blocks_proposed_total", "", -1, "1900"),
    ])
    const answer = await h.json("/validators", body)
    expect(answer.data).toMatchObject({
      available: true,
      reason: null,
      day: day(-1),
      day_total: "400",
      shares_complete: true,
      share_of: "all_blocks",
      blocks_in_day: "500",
      unattributed_blocks: "100",
      missing_counts: [],
    })
    expect(answer.data.validators).toEqual([
      expect.objectContaining({
        address: v1,
        name: "Northfield Nodes",
        gauge: demoGaugeDirectory.gauges[0]?.gauge.address.toLowerCase(),
        blocks: "300",
        // 300 of 500 blocks, not of the 400 the known validators made.
        share_bps: 6_000,
        blocks_total: { value: "1300", day: day(-1) },
      }),
      expect.objectContaining({
        address: v2,
        // Proposing, but not matched to a pool operator.
        name: null,
        operator: null,
        blocks: "100",
        share_bps: 2_000,
      }),
    ])
    expect(answer.meta.complete).toBe(true)
  })

  it("gives no shares without the day's block count, not shares of the known validators", async () => {
    await env.SCAN_DB.batch([
      total(v1, -1, "1300"),
      total(v2, -1, "600"),
      count(v1, -1, "300"),
      count(v2, -1, "100"),
      // A count of the day's blocks for another day only.
      dayBlocks(-2, "480"),
    ])
    const answer = await h.json("/validators", body)
    expect(answer.data).toMatchObject({
      available: true,
      day: day(-1),
      day_total: "400",
      shares_complete: false,
      share_of: null,
      blocks_in_day: null,
      unattributed_blocks: null,
    })
    expect(
      answer.data.validators.map((validator) => validator.share_bps),
    ).toEqual([null, null])
    expect(answer.meta.complete).toBe(false)
  })

  it("clamps the unattributed blocks at zero when the counts overshoot", async () => {
    // The height and the counters are read minutes apart.
    await env.SCAN_DB.batch([
      total(v1, -1, "1300"),
      count(v1, -1, "303"),
      dayBlocks(-1, "300"),
    ])
    const answer = await h.json("/validators", body)
    expect(answer.data).toMatchObject({
      blocks_in_day: "300",
      unattributed_blocks: "0",
      share_of: "all_blocks",
    })
    // Never past the whole.
    expect(answer.data.validators[0]?.share_bps).toBe(10_000)
  })

  it("shares what is counted when a validator's count for the day is missing", async () => {
    await env.SCAN_DB.batch([
      total(v1, -1, "1300"),
      total(v2, -1, "600"),
      total(v3, -1, "50"),
      count(v1, -1, "300"),
      count(v2, -1, "100"),
      // v3 was read for the first time: no count for the day.
      dayBlocks(-1, "500"),
    ])
    const answer = await h.json("/validators", body)
    expect(answer.data).toMatchObject({
      available: true,
      shares_complete: false,
      share_of: "all_blocks",
      unattributed_blocks: "100",
      missing_counts: [v3],
    })
    expect(
      answer.data.validators.map((validator) => [
        validator.address,
        validator.blocks,
        validator.share_bps,
      ]),
    ).toEqual([
      [v1, "300", 6_000],
      [v2, "100", 2_000],
      [v3, null, null],
    ])
    expect(answer.meta.complete).toBe(false)
  })
})

describe("every Morpho market the jobs Worker reads", () => {
  // The third market on Mezo: MUSD lent against BTC at 86% LLTV.
  const third =
    "0x4bff245ddc101cd43e365aa1faff97351ab36a225e43d9a76aab82ff763030b8"
  const MUSD = "0xdd468a1ddc392dcdbef6db6e34e89aa338f9f186"
  const BTC = "0x7b7c000000000000000000000000000000000000"
  const marketsBody = z.object({ data: z.array(scanMorphoMarketSchema) })

  beforeEach(async () => {
    await env.READ_DB.batch([
      env.READ_DB.prepare(
        `INSERT INTO morpho_markets (network, market_id, loan_token,
           collateral_token, oracle, irm, lltv_raw, total_supply_assets_raw,
           total_supply_shares_raw, total_borrow_assets_raw,
           total_borrow_shares_raw, fee_raw, last_update, borrow_rate_raw,
           oracle_price_raw, block, updated_at)
         VALUES ('mezo', ?1, ?2, ?3, ?4, ?5, '860000000000000000',
           '5000000000000000000000', '5000000000000000000000000000',
           '1000000000000000000000', '1000000000000000000000000000', '0',
           ?6, NULL, ?7, 13118800, ?6)`,
      ).bind(
        third,
        MUSD,
        BTC,
        `0x${"0e".repeat(20)}`,
        `0x${"1e".repeat(20)}`,
        scanNow - 60,
        (80_000n * 10n ** 36n).toString(),
      ),
      env.READ_DB.prepare(
        `INSERT INTO morpho_positions (network, market_id, account,
           supply_shares_raw, borrow_shares_raw, collateral_raw, block,
           updated_at)
         VALUES ('mezo', ?1, ?2, '0', '500000000000000000000000000',
           '1000000000000000000', 13118900, ?3)`,
      ).bind(third, people.alice, scanNow - 60),
    ])
  })

  const known = (
    market: string,
    loan: number | null,
    collateral: number | null,
  ) =>
    env.READ_DB.prepare(
      `INSERT OR REPLACE INTO morpho_known_markets (network, market_id,
         loan_token, collateral_token, oracle, irm, lltv_raw, loan_decimals,
         collateral_decimals, created_block, discovered_at)
       VALUES ('mezo', ?1, ?2, ?3, ?4, ?5, '860000000000000000', ?6, ?7,
         13118789, ?8)`,
    ).bind(
      market,
      MUSD,
      BTC,
      `0x${"0e".repeat(20)}`,
      `0x${"1e".repeat(20)}`,
      loan,
      collateral,
      scanNow,
    )

  it("lists, prices and reads positions in a discovered market", async () => {
    await known(third, 18, 18).run()
    const listed = await h.json("/borrow/markets", marketsBody)
    expect(listed.data.map((row) => row.market_id)).toContain(third)
    expect(listed.data.find((row) => row.market_id === third)).toMatchObject({
      loan_token: MUSD,
      collateral_token: BTC,
      lltv: "860000000000000000",
      loan_decimals: 18,
      collateral_decimals: 18,
    })
    const one = await h.json(
      `/borrow/markets/${third}`,
      z.object({ data: scanMorphoMarketSchema }),
    )
    expect(one.data.loan_decimals).toBe(18)
    const positions = await h.json(
      `/borrow/markets/${third}/positions`,
      scanPageSchema(scanMorphoPositionSchema),
    )
    expect(positions.data.map((row) => row.account)).toEqual([people.alice])
    expect(positions.data[0]?.health.band).not.toBe("unknown")
    // The owner document covers every market, the discovered one included.
    const owner = await h.json(
      `/borrow/owners/${people.alice}`,
      z.object({ data: scanBorrowPositionsSchema }),
    )
    expect(owner.data.morpho.map((row) => row.market_id)).toContain(third)
  })

  it("gives null decimals, not 18, for a token neither the chain nor the registry knows", async () => {
    // The fixture market lends MEZO (registry: 18) against a token the
    // registry does not list, whose decimals() did not answer.
    await known(market, null, null).run()
    const listed = await h.json("/borrow/markets", marketsBody)
    expect(listed.data.find((row) => row.market_id === market)).toMatchObject({
      loan_decimals: 18,
      collateral_decimals: null,
      // Amounts stay raw base units.
      total_supply_assets: "1000000000000",
    })
    // A decimals() the chain did answer is used for that token.
    await known(market, null, 8).run()
    const fresh = harness()
    fresh.state.now += 300_000
    const again = await fresh.json("/borrow/markets", marketsBody)
    expect(
      again.data.find((row) => row.market_id === market)?.collateral_decimals,
    ).toBe(8)
    // And the market's collateral series says so.
    const series = await fresh.json(
      `/series?metric=morpho.total_collateral&dimension=${market}&from=${day(-3)}&to=${day(-1)}`,
      z.object({ data: scanSeriesSchema }),
    )
    expect(series.data.resolvedDecimals).toBe(8)
  })

  it("works before migration 0006, from the registry alone", async () => {
    await env.READ_DB.prepare("DROP TABLE morpho_known_markets").run()
    const response = await h.get("/borrow/markets")
    expect(response.status).toBe(200)
    const listed = marketsBody.parse(await response.json())
    expect(listed.data.find((row) => row.market_id === third)).toMatchObject({
      loan_decimals: 18,
      collateral_decimals: 18,
    })
    expect(
      listed.data.find((row) => row.market_id === market)?.collateral_decimals,
    ).toBeNull()
  })
})

describe("borrow totals", () => {
  const MUSD = "0xdd468a1ddc392dcdbef6db6e34e89aa338f9f186"
  const MUSDC = "0x04671c72aab5ac02a03c1098314b1bb6b560c197"
  const BTC = "0x7b7c000000000000000000000000000000000000"
  const musdMarket = `0x${"4b".repeat(32)}`
  const musdcMarket = `0x${"6f".repeat(32)}`
  const e18 = 10n ** 18n
  /** The fixtures' open trove (49,000 plus 1,000 interest) and Enclave. */
  const troveDebt = 50_000n * e18
  const enclaveDebt = 5_000n * e18
  const marketDebt = 1_000n * e18

  const addMarket = (id: string, loanToken: string, borrowed: string) =>
    env.READ_DB.prepare(
      `INSERT INTO morpho_markets (network, market_id, loan_token,
         collateral_token, oracle, irm, lltv_raw, total_supply_assets_raw,
         total_supply_shares_raw, total_borrow_assets_raw,
         total_borrow_shares_raw, fee_raw, last_update, borrow_rate_raw,
         oracle_price_raw, block, updated_at)
       VALUES ('mezo', ?1, ?2, ?3, ?4, ?5, '860000000000000000', ?6,
         '1000000000000000000', ?6, '1000000000000000000', '0', ?7, NULL,
         NULL, 13118800, ?7)`,
    ).bind(
      id,
      loanToken,
      BTC,
      `0x${"0e".repeat(20)}`,
      `0x${"1e".repeat(20)}`,
      borrowed,
      scanNow - 60,
    )

  const close = (
    metric: string,
    dimension: string,
    offset: number,
    value: bigint,
  ) =>
    env.SCAN_DB.prepare(
      `INSERT OR REPLACE INTO daily (metric, dimension, day, value, source,
         updated_at) VALUES (?1, ?2, ?3, ?4, 'live', ?5)`,
    ).bind(metric, dimension, day(offset), value.toString(), scanNow)

  /** An Enclave event two days ago (plus `block` seconds mod 1,000). */
  const enclaveEvent = (
    position: string,
    block: number,
    action: string,
    principal: string | null,
  ) =>
    env.SCAN_DB.prepare(
      `INSERT INTO enclave_events (tx_hash, log_index, ve_btc_token_id,
         block_number, timestamp, tx_from, contract_address, enclave,
         position_id, borrower, action, amount, principal, interest_rate,
         originator_fee_rate, warning_cr, minimum_cr, lock_duration,
         other_ve_btc_token_id, pledged_ve_btc)
       VALUES (?1, 0, '7', ?2, ?3, ?4, ?4, ?4, ?5, ?4, ?6, NULL, ?7, 100,
         NULL, NULL, NULL, NULL, NULL, '["7"]')`,
    ).bind(
      `0x${block.toString(16).padStart(64, "0")}`,
      block,
      scanNow - 86_400 * 2 + (block % 1_000),
      `0x${"e9c".padStart(40, "0")}`,
      position,
      action,
      principal,
    )

  beforeEach(async () => {
    await env.READ_DB.batch([
      addMarket(musdMarket, MUSD, marketDebt.toString()),
      // 62,710.84 mUSDC: another token, never added to MUSD.
      addMarket(musdcMarket, MUSDC, "62710840000"),
    ])
  })

  async function totalsOf(harnessed = h) {
    const body = await harnessed.json(
      "/borrow/totals",
      scanBorrowTotalsResponseSchema,
    )
    return body.data
  }

  it("adds troves, Enclaves and MUSD markets in MUSD base units", async () => {
    const response = await h.get("/borrow/totals")
    expect(response.status).toBe(200)
    expect(response.headers.get("X-Scan-Class")).toBe("live")
    const totals = scanBorrowTotalsResponseSchema.parse(
      await response.json(),
    ).data
    expect(totals.unit).toEqual({ symbol: "MUSD", token: MUSD, decimals: 18 })
    const total = troveDebt + enclaveDebt + marketDebt
    expect(totals.total).toBe(total.toString())
    expect(totals.missing).toEqual([])
    // 5,000 of 56,000: 8.93%, 1e18-scaled and rounded down.
    expect(totals.enclaves_share).toBe("89285714285714285")
    expect(totals.enclaves_share).toBe(((enclaveDebt * e18) / total).toString())
    expect(totals.venues.troves).toEqual({
      status: "ok",
      data: {
        basis: "principal_plus_interest",
        debt: troveDebt.toString(),
        principal: (49_000n * e18).toString(),
        interest: (1_000n * e18).toString(),
        open: 1,
        block: 13_000_000,
      },
    })
    expect(totals.venues.enclaves).toEqual({
      status: "ok",
      data: {
        basis: "principal",
        debt: enclaveDebt.toString(),
        open: 1,
        positions: 1,
        latest_block: 12_960_001,
        latest_timestamp: lastEpoch + 1,
      },
    })
  })

  it("adds the BTC behind the loans per venue", async () => {
    // The open Enclave position pledges veBTC #11 and #12: #11 locks 2.5
    // BTC, #12 was withdrawn.
    await env.SCAN_DB.batch(
      [
        ["11", (25n * e18) / 10n, 0],
        ["12", 0n, 1],
      ].map(([id, amount, withdrawn]) =>
        env.SCAN_DB.prepare(
          `INSERT OR REPLACE INTO locks (escrow, token_id, owner, amount,
             amount_key, unlock_at, created_at, last_extended_at,
             withdrawn_at, is_permanent, is_withdrawn, is_merged,
             merged_into_token_id, merged_at, boost, activity_count,
             updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5, NULL, NULL, NULL, NULL, 1, ?6, 0,
             NULL, NULL, NULL, 0, ?7)`,
        ).bind(
          vebtc,
          id,
          `0x${"e9c".padStart(40, "0")}`,
          String(amount),
          String(amount).padStart(40, "0"),
          withdrawn,
          scanNow,
        ),
      ),
    )
    // Two positions in the MUSD market (BTC collateral): one owes, one
    // only holds collateral. Markets lending another token are left out,
    // as Borrowed leaves them out.
    await env.READ_DB.batch(
      [
        [people.alice, "500", (3n * e18).toString()],
        [people.bob, "0", (e18 / 2n).toString()],
      ].map(([account, borrowed, collateral]) =>
        env.READ_DB.prepare(
          `INSERT INTO morpho_positions (network, market_id, account,
             supply_shares_raw, borrow_shares_raw, collateral_raw, block,
             updated_at)
           VALUES ('mezo', ?1, ?2, '0', ?3, ?4, 13118900, ?5)`,
        ).bind(musdMarket, account, borrowed, collateral, scanNow - 60),
      ),
    )
    const trove = await env.READ_DB.prepare(
      "SELECT coll_raw FROM troves WHERE network = 'mezo' AND status = 'active'",
    ).first<{ coll_raw: string }>()
    const troves = BigInt(trove?.coll_raw ?? "0")
    const totals = await totalsOf()
    const markets = (35n * e18) / 10n
    const enclaves = (25n * e18) / 10n
    expect(totals.collateral).toEqual({
      status: "ok",
      data: {
        token: BTC,
        decimals: 18,
        total: (troves + enclaves + markets).toString(),
        troves: troves.toString(),
        enclaves: enclaves.toString(),
        markets: markets.toString(),
        open_markets: 1,
      },
    })
  })

  it("lists markets lending another token, and never adds them", async () => {
    // MUSD whose decimals the chain read as 6: not MUSD's 18, so excluded.
    const odd = `0x${"5c".repeat(32)}`
    await addMarket(odd, MUSD, "777").run()
    // An earlier test drops the table (before migration 0006); restore it.
    const migration = env.TEST_MIGRATIONS.find((each) =>
      each.name.startsWith("0006_morpho_known_markets"),
    )
    for (const statement of migration?.queries ?? []) {
      await env.READ_DB.prepare(statement).run()
    }
    await env.READ_DB.prepare(
      `INSERT INTO morpho_known_markets (network, market_id, loan_token,
         collateral_token, oracle, irm, lltv_raw, loan_decimals,
         collateral_decimals, created_block, discovered_at)
       VALUES ('mezo', ?1, ?2, ?3, ?4, ?4, '860000000000000000', 6, 18,
         13118789, ?5)`,
    )
      .bind(odd, MUSD, BTC, `0x${"0e".repeat(20)}`, scanNow)
      .run()
    const totals = await totalsOf()
    const markets = totals.venues.markets
    if (markets.status !== "ok") throw new Error("markets unavailable")
    expect(markets.data.basis).toBe("total_borrow_assets")
    expect(markets.data.debt).toBe(marketDebt.toString())
    expect(markets.data.included).toEqual([
      {
        market_id: musdMarket,
        loan_token: MUSD,
        borrowed: marketDebt.toString(),
        loan_decimals: 18,
      },
    ])
    expect(
      markets.data.excluded.map((each) => [each.market_id, each.reason]),
    ).toEqual([
      // The fixtures' MEZO market, MUSD at 6 decimals, and mUSDC.
      [market, "loan_token"],
      [odd, "decimals"],
      [musdcMarket, "loan_token"],
    ])
    expect(
      markets.data.excluded.find((each) => each.market_id === musdcMarket),
    ).toEqual({
      market_id: musdcMarket,
      loan_token: MUSDC,
      borrowed: "62710840000",
      loan_decimals: 6,
      reason: "loan_token",
    })
    expect(totals.total).toBe((troveDebt + enclaveDebt + marketDebt).toString())
  })

  it("draws daily closes and Enclave principal by day, today live", async () => {
    await env.SCAN_DB.batch([
      close("musd.trove_debt", "", -2, 40_000n * e18),
      close("musd.trove_debt", "", -1, 45_000n * e18),
      close("morpho.total_borrow", musdMarket, -2, 0n),
      close("morpho.total_borrow", musdMarket, -1, 500n * e18),
      // Not a MUSD market: never read for the history.
      close("morpho.total_borrow", musdcMarket, -1, 9n),
    ])
    const history = (await totalsOf()).history
    if (history.status !== "ok") throw new Error("history unavailable")
    expect(history.data.points).toHaveLength(30)
    expect(history.data.from).toBe(day(-29))
    expect(history.data.to).toBe(day(0))
    const on = (offset: number) =>
      history.data.points.find((each) => each.day === day(offset))
    expect(on(-1)).toEqual({
      day: day(-1),
      total: (45_000n * e18 + enclaveDebt + 500n * e18).toString(),
      troves: (45_000n * e18).toString(),
      enclaves: enclaveDebt.toString(),
      markets: (500n * e18).toString(),
      partial: false,
    })
    expect(on(-2)?.total).toBe((40_000n * e18 + enclaveDebt).toString())
    // No trove close that day: unknown, so no total, never a smaller one.
    expect(on(-3)).toMatchObject({
      total: null,
      troves: null,
      enclaves: enclaveDebt.toString(),
      markets: null,
    })
    // Before the position opened (lastEpoch) it owed nothing.
    expect(on(-12)?.enclaves).toBe("0")
    expect(on(0)).toEqual({
      day: day(0),
      total: (troveDebt + enclaveDebt + marketDebt).toString(),
      troves: troveDebt.toString(),
      enclaves: enclaveDebt.toString(),
      markets: marketDebt.toString(),
      partial: true,
    })
  })

  it("follows Enclave positions through repayment and closing", async () => {
    await env.SCAN_DB.batch([
      enclaveEvent("2", 13_000_100, "POSITION_OPENED", "1000"),
      enclaveEvent("2", 13_000_200, "DEBT_REPAID", "400"),
      enclaveEvent("3", 13_000_300, "POSITION_OPENED", "50"),
      enclaveEvent("3", 13_000_400, "POSITION_CLOSED", "50"),
    ])
    const totals = await totalsOf()
    expect(totals.venues.enclaves).toEqual({
      status: "ok",
      data: {
        basis: "principal",
        debt: (enclaveDebt + 400n).toString(),
        open: 2,
        positions: 3,
        latest_block: 13_000_400,
        latest_timestamp: scanNow - 86_400 * 2 + 400,
      },
    })
    const history = totals.history
    if (history.status !== "ok") throw new Error("history unavailable")
    const on = (offset: number) =>
      history.data.points.find((each) => each.day === day(offset))
    // Two days ago: position 2 repaid down to 400, position 3 closed.
    expect(on(-2)?.enclaves).toBe((enclaveDebt + 400n).toString())
    // Before then only the fixtures' position.
    expect(on(-3)?.enclaves).toBe(enclaveDebt.toString())
  })

  it("gives no total, and says why, when a venue is unavailable", async () => {
    const totals = await totalsOf(harness({ scanDb: null }))
    expect(totals.total).toBeNull()
    expect(totals.enclaves_share).toBeNull()
    expect(totals.missing).toEqual(["enclaves"])
    expect(totals.venues.enclaves).toEqual({
      status: "unavailable",
      reason: "disabled",
    })
    expect(totals.history).toEqual({
      status: "unavailable",
      reason: "disabled",
    })
    // The other venues still answer.
    expect(totals.venues.troves.status).toBe("ok")
    expect(totals.venues.markets.status).toBe("ok")

    const noRead = await totalsOf(harness({ readDb: null }))
    expect(noRead.total).toBeNull()
    expect(noRead.missing).toEqual(["troves", "markets"])
    expect(noRead.venues.enclaves.status).toBe("ok")
    expect(noRead.history).toEqual({
      status: "unavailable",
      reason: "disabled",
    })
  })

  it("serves a venue whose row fails its schema as unavailable, unstored", async () => {
    // An open position's latest event with no principal.
    await enclaveEvent("2", 13_000_100, "DEBT_INCREASED", null).run()
    const response = await h.get("/borrow/totals")
    expect(response.status).toBe(200)
    expect(response.headers.get("Cache-Control")).toBe("private, no-store")
    const totals = scanBorrowTotalsResponseSchema.parse(
      await response.json(),
    ).data
    expect(totals.venues.enclaves).toEqual({
      status: "unavailable",
      reason: "schema",
    })
    expect(totals.total).toBeNull()
    expect(totals.missing).toEqual(["enclaves"])
    // Not kept: the next request renders again.
    expect((await h.get("/borrow/totals")).headers.get("X-Cache")).toBe("miss")
  })

  it("reads at most 25 Enclave positions and says when there are more", async () => {
    // With the fixtures' position, 26.
    await env.SCAN_DB.batch(
      Array.from({ length: 25 }, (_, index) =>
        enclaveEvent(
          `9${String(index).padStart(2, "0")}`,
          13_000_100 + index,
          "POSITION_OPENED",
          "1",
        ),
      ),
    )
    const totals = await totalsOf()
    expect(totals.venues.enclaves).toEqual({
      status: "unavailable",
      reason: "incomplete",
    })
    expect(totals.total).toBeNull()
  })

  it("carries the live snapshot's age, as every live Borrow answer", async () => {
    await env.READ_DB.prepare(
      "UPDATE stability_pool SET musd_btc_price_block = ?1",
    )
      .bind(13_199_950)
      .run()
    const body = await h.json("/borrow/totals", scanBorrowTotalsResponseSchema)
    expect(body.snapshot).toEqual({
      block: 13_199_950,
      head: 13_200_000,
      behind_blocks: 50,
      stale: false,
      max_behind_blocks: 240,
    })
    // Kept for the snapshot's five-minute slot.
    expect((await h.get("/borrow/totals")).headers.get("X-Cache")).not.toBe(
      "miss",
    )
    // No query parameters.
    expect((await h.get("/borrow/totals?days=7")).status).toBe(400)
  })
})

describe("cross-chain", () => {
  // The shared seed predates these tables (scan-migrations 0006).
  beforeEach(async () => {
    await env.SCAN_DB.batch(
      [
        "market_quotes",
        "market_price_daily",
        "token_supply_daily",
        "pool_daily",
        "bridge_route_totals",
        "bridge_daily",
      ].map((table) => env.SCAN_DB.prepare(`DELETE FROM ${table}`)),
    )
  })

  const MUSD_ADDRESS = "0xdd468a1ddc392dcdbef6db6e34e89aa338f9f186"
  const quote = (
    venue: string,
    price: string,
    readAt: number,
    detail: string | null = null,
  ) =>
    env.SCAN_DB.prepare(
      `INSERT INTO market_quotes (asset, venue, chain, price, depth_usd,
         method, source, block, read_at, detail)
       VALUES ('musd', ?1, ?2, ?3, '1000', 'test', ?4, NULL, ?5, ?6)`,
    ).bind(
      venue,
      venue === "headline" ? null : "ethereum",
      price,
      venue === "headline" ? "venues" : venue,
      readAt,
      detail,
    )
  const headlineDetail = JSON.stringify({
    spread_bps: 6,
    diverged: false,
    venues: ["curve-musd-2pool", "aero-musd-usdc", "tigris-musdc-musd"],
  })

  it("answers MUSD's venues and median, and MEZO's basis", async () => {
    await env.SCAN_DB.batch([
      quote("curve-musd-2pool", "0.993748", scanNow - 60),
      quote("aero-musd-usdc", "0.993524", scanNow - 60),
      quote("tigris-musdc-musd", "0.99412", scanNow - 900),
      quote("headline", "0.993748", scanNow - 60, headlineDetail),
    ])
    const body = await h.json("/crosschain/prices", scanCrossChainPricesSchema)
    expect(body.data.musd).toMatchObject({
      price_usd: "0.993748",
      basis: "venues",
      basis_label: "Liquidity-weighted median of 3 venues",
      stale: false,
      spread_bps: 6,
      diverged: false,
    })
    expect(
      body.data.musd.venues.map((venue) => [venue.venue, venue.stale]),
    ).toEqual([
      ["aero-musd-usdc", false],
      ["curve-musd-2pool", false],
      // Read 15 minutes ago: shown, marked stale.
      ["tigris-musdc-musd", true],
    ])
    // The harness's KV has no MEZO price: null, with the reason.
    expect(body.data.mezo.price_usd).toBeNull()
    expect(body.data.mezo.unavailable.price_usd).toBeTruthy()
    expect(body.attribution.coingecko.text).toBe("Data provided by CoinGecko")
  })

  it("prices MUSD's token row at the market while the headline is fresh", async () => {
    await env.SCAN_DB.batch([
      quote("headline", "0.993748", scanNow - 60, headlineDetail),
      env.SCAN_DB.prepare(
        `INSERT INTO daily (metric, dimension, day, value, source, partial,
           updated_at)
         VALUES ('token.total_supply', ?1, ?2, '2000000000000000000', 'test',
           0, ?3)`,
      ).bind(MUSD_ADDRESS, day(-1), scanNow),
    ])
    const body = await h.json("/tokens", scanTokenListSchema)
    expect(
      body.data.find((item) => item.address === MUSD_ADDRESS),
    ).toMatchObject({
      priced_as: "market",
      price_usd: "0.993748",
      price_source: "venues",
      supply_usd: "1.987496",
    })
  })

  it("keeps MUSD at $1 taken when the headline is stale", async () => {
    await env.SCAN_DB.batch([
      quote("headline", "0.993748", scanNow - 700, headlineDetail),
    ])
    const body = await h.json("/tokens", scanTokenListSchema)
    expect(
      body.data.find((item) => item.address === MUSD_ADDRESS),
    ).toMatchObject({
      priced_as: "usd",
      price_usd: "1",
      price_source: "registry",
    })
  })

  it("answers supply by chain, and says when a chain is missing", async () => {
    const supply = (
      asset: string,
      chain: string,
      offset: number,
      total: string,
      locked: string | null,
      circulating: string,
    ) =>
      env.SCAN_DB.prepare(
        `INSERT INTO token_supply_daily (asset, chain, day, total_supply,
           locked, circulating, decimals, block, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 18, '1', ?7)`,
      ).bind(asset, chain, day(offset), total, locked, circulating, scanNow)
    await env.SCAN_DB.batch([
      supply("musd", "mezo", -1, "100", "30", "70"),
      supply("musd", "mezo", 0, "100", "40", "60"),
      supply("musd", "ethereum", 0, "35", null, "35"),
      supply("musd", "base", 0, "5", null, "5"),
      supply("mezo", "mezo", 0, "1000", "400", "600"),
    ])
    const body = await h.json(
      "/crosschain/supply?days=7",
      scanCrossChainSupplySchema,
    )
    expect(body.data.musd.circulating).toBe("100")
    expect(body.data.musd.chains.map((chain) => chain.chain)).toEqual([
      "mezo",
      "ethereum",
      "base",
    ])
    expect(body.data.musd.history).toEqual([
      { day: day(-1), chains: { mezo: "70" } },
      { day: day(0), chains: { mezo: "60", ethereum: "35", base: "5" } },
    ])
    // MEZO on Ethereum, Base and BNB Chain not read yet: no total.
    expect(body.data.mezo.circulating).toBeNull()
    expect(body.data.mezo.unavailable["chains.bsc"]).toBeTruthy()
  })

  it("answers pools with 7-day figures once a week is stored", async () => {
    const statements = Array.from({ length: 7 }, (_, index) =>
      env.SCAN_DB.prepare(
        `INSERT INTO pool_daily (pool_id, day, tvl_usd, volume_24h_usd,
           apr_fees, apr_rewards, apr_merkl, apr_gauge, sources, unavailable,
           updated_at)
         VALUES ('ethereum-curve-musd-2pool', ?1, '3350000', '1000', '0.1',
           '8', '0.1', NULL, '{"apr_fees":"defillama"}',
           '{"apr_gauge":"not yet"}', ?2)`,
      ).bind(day(-index), scanNow),
    )
    statements.push(
      env.SCAN_DB.prepare(
        `INSERT INTO pool_daily (pool_id, day, tvl_usd, volume_24h_usd,
           apr_fees, apr_rewards, apr_merkl, apr_gauge, sources, unavailable,
           updated_at)
         VALUES ('base-aerodrome-musd-usdc', ?1, '820000', '65000', NULL, NULL,
           NULL, NULL, '{}', '{"apr_fees":"Aerodrome: not available"}', ?2)`,
      ).bind(day(0), scanNow),
    )
    await env.SCAN_DB.batch(statements)
    const body = await h.json("/crosschain/pools", scanCrossChainPoolsSchema)
    const curve = body.data.find(
      (pool) => pool.id === "ethereum-curve-musd-2pool",
    )
    expect(curve).toMatchObject({
      day: day(0),
      tvl_usd: "3350000",
      volume_7d_usd: "7000",
      apr: { fees: "0.1", rewards: "8", merkl: "0.1", total: "8.2" },
      apr_7d: "8.2",
    })
    const aero = body.data.find(
      (pool) => pool.id === "base-aerodrome-musd-usdc",
    )
    expect(aero?.volume_7d_usd).toBeNull()
    expect(aero?.unavailable.volume_7d_usd).toBe("Fewer than 7 days stored")
    expect(aero?.unavailable.apr_fees).toContain("Aerodrome")
    // A tracked pool with no snapshot yet is listed, every figure null.
    const unseen = body.data.find((pool) => pool.id === "mezo-savings-smusd")
    expect(unseen?.day).toBeNull()
    expect(unseen?.unavailable.day).toBeTruthy()
  })

  it("answers bridge flows per route as the change between days", async () => {
    const total = (offset: number, transfers: number, usd: string) =>
      env.SCAN_DB.prepare(
        `INSERT INTO bridge_route_totals (asset, from_chain, to_chain, day,
           transfers_total, notional_usd_total, updated_at)
         VALUES ('musd', 'mezo', 'ethereum', ?1, ?2, ?3, ?4)`,
      ).bind(day(offset), transfers, usd, scanNow)
    await env.SCAN_DB.batch([
      total(-1, 6670, "20390000.5"),
      total(0, 6676, "20397670.34"),
      env.SCAN_DB.prepare(
        `INSERT INTO bridge_daily (asset, day, transfers, notional_usd,
           updated_at) VALUES ('musd', ?1, 4, '56007.71', ?2)`,
      ).bind(day(-1), scanNow),
    ])
    const body = await h.json(
      "/crosschain/bridge-flows?days=7",
      scanBridgeFlowsSchema,
    )
    expect(body.routes).toEqual([
      {
        from: "mezo",
        to: "ethereum",
        transfers_total: 6676,
        notional_usd_total: "20397670.34",
        daily: [{ day: day(0), transfers: 6, notional_usd: "7669.84" }],
      },
    ])
    expect(body.daily).toEqual([
      { day: day(-1), transfers: 4, notional_usd: "56007.71" },
    ])
    const mezo = await h.json(
      "/crosschain/bridge-flows?asset=mezo",
      scanBridgeFlowsSchema,
    )
    expect(mezo.routes).toEqual([])
    expect(mezo.unavailable.routes).toContain("MEZO")
  })

  it("answers the peg chart's daily closes", async () => {
    const close = (venue: string, offset: number, price: string) =>
      env.SCAN_DB.prepare(
        `INSERT INTO market_price_daily (asset, venue, day, price, depth_usd,
           source, updated_at) VALUES ('musd', ?1, ?2, ?3, NULL, 'test', ?4)`,
      ).bind(venue, day(offset), price, scanNow)
    await env.SCAN_DB.batch([
      close("headline", -1, "0.9931"),
      close("curve-musd-2pool", -1, "0.9931"),
      close("headline", 0, "0.9937"),
    ])
    const body = await h.json(
      "/crosschain/prices/history?days=7",
      scanPriceHistorySchema,
    )
    expect(body.days).toEqual([
      {
        day: day(-1),
        price_usd: "0.9931",
        venues: { "curve-musd-2pool": "0.9931" },
      },
      { day: day(0), price_usd: "0.9937", venues: {} },
    ])
  })
})

describe("Enclave positions", () => {
  const e18 = 10n ** 18n
  const enclaveAddress = `0x${"e9c".padStart(40, "0")}`

  /** One Enclave row of `position` on `token` at `block`. */
  const row = (
    position: string,
    token: string,
    block: number,
    action: string,
    fields: { amount?: bigint; principal: bigint; pledged: string[] },
  ) =>
    env.SCAN_DB.prepare(
      `INSERT INTO enclave_events (tx_hash, log_index, ve_btc_token_id,
         block_number, timestamp, tx_from, contract_address, enclave,
         position_id, borrower, action, amount, principal, interest_rate,
         originator_fee_rate, warning_cr, minimum_cr, lock_duration,
         other_ve_btc_token_id, pledged_ve_btc)
       VALUES (?1, 0, ?2, ?3, ?4, ?5, ?6, ?6, ?7, ?5, ?8, ?9, ?10, 100,
         NULL, NULL, NULL, NULL, NULL, ?11)`,
    ).bind(
      `0x${block.toString(16).padStart(64, "0")}`,
      token,
      block,
      scanNow - 86_400 + (block % 1_000),
      people.bob,
      enclaveAddress,
      position,
      action,
      fields.amount?.toString() ?? null,
      fields.principal.toString(),
      JSON.stringify(fields.pledged),
    )

  beforeEach(async () => {
    await env.SCAN_DB.batch([
      // Position 2: opened with 1,000 on veBTC 7, raised by 500, 400 repaid.
      row("2", "7", 13_000_100, "POSITION_OPENED", {
        amount: 1_000n * e18,
        principal: 1_000n * e18,
        pledged: ["7"],
      }),
      row("2", "7", 13_000_200, "DEBT_INCREASED", {
        amount: 500n * e18,
        principal: 1_500n * e18,
        pledged: ["7"],
      }),
      row("2", "7", 13_000_300, "DEBT_REPAID", {
        amount: 400n * e18,
        principal: 1_100n * e18,
        pledged: ["7"],
      }),
      // Position 3: opened with 50 on veBTC 9, then closed.
      row("3", "9", 13_000_400, "POSITION_OPENED", {
        amount: 50n * e18,
        principal: 50n * e18,
        pledged: ["9"],
      }),
      row("3", "9", 13_000_500, "POSITION_CLOSED", {
        principal: 0n,
        pledged: [],
      }),
    ])
  })

  it("lists positions with principal minted and repaid", async () => {
    const page = await h.json(
      "/borrow/enclave/positions",
      scanPageSchema(scanEnclavePositionSummarySchema),
    )
    expect(page.nextCursor).toBeNull()
    expect(page.data.map((each) => each.position_id)).toEqual(["1", "2", "3"])
    const [first, raised, closed] = page.data
    // The fixtures' position: opened with 5,000, a second veBTC added.
    expect(first).toMatchObject({
      status: "open",
      borrower: people.alice,
      principal: (5_000n * e18).toString(),
      minted: (5_000n * e18).toString(),
      repaid: "0",
      pledged_ve_btc: ["11", "12"],
      ve_btc_token_ids: ["11", "12"],
      opened: { block_number: 12_960_000 },
      latest: { block_number: 12_960_001, action: "COLLATERAL_PLEDGED" },
      complete: true,
    })
    expect(raised).toMatchObject({
      status: "open",
      borrower: people.bob,
      enclave: enclaveAddress,
      principal: (1_100n * e18).toString(),
      minted: (1_500n * e18).toString(),
      repaid: (400n * e18).toString(),
      pledged_ve_btc: ["7"],
      opened: {
        block_number: 13_000_100,
        timestamp: scanNow - 86_400 + 100,
      },
      latest: { block_number: 13_000_300, action: "DEBT_REPAID" },
    })
    expect(closed).toMatchObject({
      status: "closed",
      principal: "0",
      minted: (50n * e18).toString(),
      repaid: "0",
      pledged_ve_btc: [],
      ve_btc_token_ids: ["9"],
      latest: { action: "POSITION_CLOSED" },
    })
  })

  it("pages positions whole, one cursor per position", async () => {
    const all = await allPages(
      h,
      "/borrow/enclave/positions",
      scanEnclavePositionSummarySchema,
      1,
    )
    expect(all.items.map((each) => each.position_id)).toEqual(["1", "2", "3"])
    expect(all.items.every((each) => each.complete)).toBe(true)
    expect((await h.get("/borrow/enclave/positions?cursor=bad!")).status).toBe(
      400,
    )
  })

  it("finds the positions a veBTC backs by its token id", async () => {
    const pledged = await h.json(
      "/borrow/enclave/locks/7",
      z.object({ data: scanEnclaveLockSchema }),
    )
    expect(pledged.data.token_id).toBe("7")
    expect(pledged.data.positions).toHaveLength(1)
    expect(pledged.data.positions[0]).toMatchObject({
      position_id: "2",
      status: "open",
      principal: (1_100n * e18).toString(),
      pledged_ve_btc: ["7"],
      complete: true,
    })
    // A debt row names only the lowest veBTC: the second one still finds
    // its position through the row that pledged it.
    const second = await h.json(
      "/borrow/enclave/locks/12",
      z.object({ data: scanEnclaveLockSchema }),
    )
    expect(second.data.positions.map((each) => each.position_id)).toEqual(["1"])
    const released = await h.json(
      "/borrow/enclave/locks/9",
      z.object({ data: scanEnclaveLockSchema }),
    )
    expect(released.data.positions[0]?.status).toBe("closed")
    expect(released.data.positions[0]?.pledged_ve_btc).toEqual([])
    const never = await h.json(
      "/borrow/enclave/locks/404",
      z.object({ data: scanEnclaveLockSchema }),
    )
    expect(never.data.positions).toEqual([])
    expect((await h.get("/borrow/enclave/locks/x1")).status).toBe(404)
  })
})

describe("locks as the chain has them", () => {
  const wad = 10n ** 18n
  const kiln = `0x${"4b".repeat(20)}`
  const latestIds: LatestLockIds = {
    block: 13_200_100,
    ids: { vebtc: 6_179n, vemezo: 2_945n },
  }

  type Answer<T> = T | "fail" | "hang"

  /** A lock as the chain reads it. */
  function chainLock(
    fields: Partial<LiveLock> & Pick<LiveLock, "escrow" | "tokenId">,
  ): LiveLock {
    return {
      amount: 6n * wad,
      end: 0,
      isPermanent: true,
      votingPower: 6n * wad,
      votes: [],
      lastVotedAt: 0,
      lastVoted: [],
      earned: [],
      ...fields,
    }
  }

  function settle<T>(answer: Answer<T>): Promise<T> {
    if (answer === "hang") return new Promise(() => undefined)
    if (answer === "fail") {
      return Promise.reject(new ClaimableUnread("throttled"))
    }
    return Promise.resolve(answer)
  }

  /** Matchscan's three readers over `world`, counting their reads. */
  function fakeChain(world: {
    lock?: (escrow: Escrow, tokenId: string) => Answer<LiveLockRead>
    owner?: (address: string) => Answer<OwnerLocks>
    latest?: Answer<LatestLockIds>
    /** Called as each read is asked, before it answers. */
    onAsk?: () => void
  }) {
    const reads = { lock: [] as string[], owner: [] as string[], latest: 0 }
    /**
     * Each read's time left when it was asked: its deadline less the
     * moment it was called, on the clock the readers use. Checking these
     * proves the route's bound without timing the route itself.
     */
    const left: number[] = []
    const ask = (deadline: number) => {
      world.onAsk?.()
      left.push(deadline - Date.now())
    }
    const readers: ScanChainReaders = {
      lock: (escrow, tokenId, deadline) => {
        ask(deadline)
        reads.lock.push(`${escrow}:${tokenId}`)
        return settle(world.lock?.(escrow, tokenId) ?? "fail")
      },
      owner: (address, deadline) => {
        ask(deadline)
        reads.owner.push(address)
        return settle(world.owner?.(address) ?? "fail")
      },
      latest: (deadline) => {
        ask(deadline)
        reads.latest += 1
        return settle(world.latest ?? latestIds)
      },
    }
    return { readers, reads, left }
  }

  /** The harness's clock on a minute's first second. */
  function onTheMinute(live: ReturnType<typeof harness>): void {
    live.state.now = Math.ceil(live.state.now / 60_000) * 60_000
  }

  async function queued(): Promise<number> {
    const row = await env.READ_DB.prepare(
      "SELECT count(*) AS n FROM wallet_requests",
    ).first<{ n: number }>()
    return row?.n ?? 0
  }

  beforeEach(async () => {
    await env.READ_DB.prepare("DELETE FROM wallet_requests").run()
  })

  it("lays the chain's owner, amount, unlock, power and votes over a stored lock", async () => {
    const chain = fakeChain({
      lock: (escrow, tokenId) => ({
        block: 13_200_100,
        owner: people.bob,
        lock: chainLock({
          escrow,
          tokenId,
          amount: 7n * wad,
          isPermanent: false,
          end: scanNow + 86_400 * 20,
          votingPower: 5n * wad,
          votes: [{ gauge: kiln, voter: "validators", weight: 5n * wad }],
          lastVotedAt: scanNow - 3_600,
          lastVoted: [{ voter: "validators", at: scanNow - 3_600 }],
        }),
      }),
    })
    const live = harness({ chain: chain.readers })
    const body = await live.json("/locks/vebtc/1", scanLockDocumentSchema)
    expect(body.indexed).toBe(true)
    expect(body.data).toMatchObject({
      token_id: "1",
      owner: people.bob,
      amount: (7n * wad).toString(),
      unlock_at: scanNow + 86_400 * 20,
      is_permanent: false,
      // What only the store knows stays the store's.
      created_at: scanNow - 86_400 * 50,
      activity_count: 3,
      updated_at: scanNow,
    })
    expect(body.live).toEqual({
      block: 13_200_100,
      voting_power: (5n * wad).toString(),
      votes: [
        {
          gauge: kiln,
          source: "VALIDATORS_VOTER",
          weight: (5n * wad).toString(),
          voted_at: scanNow - 3_600,
        },
      ],
      last_voted_at: scanNow - 3_600,
    })
    // A stored lock needs no newest-id read.
    expect(chain.reads.latest).toBe(0)
  })

  it("serves a lock the store does not have yet, made from the chain, and writes nothing", async () => {
    const chain = fakeChain({
      lock: (escrow, tokenId) => ({
        block: 13_200_100,
        owner: people.bob,
        lock: chainLock({ escrow, tokenId }),
      }),
    })
    const live = harness({ chain: chain.readers })
    const body = await live.json("/locks/vebtc/6179", scanLockDocumentSchema)
    expect(body.indexed).toBe(false)
    expect(body.data).toEqual({
      escrow: vebtc,
      token_id: "6179",
      owner: people.bob,
      amount: (6n * wad).toString(),
      unlock_at: 0,
      is_permanent: true,
      created_at: null,
      last_extended_at: null,
      withdrawn_at: null,
      is_withdrawn: false,
      is_merged: false,
      merged_into_token_id: null,
      merged_at: null,
      boost: null,
      // Only the store counts activity and dates its rows: never made up.
      activity_count: null,
      updated_at: null,
    })
    expect(body.live?.voting_power).toBe((6n * wad).toString())
    await settled()
    expect(await queued()).toBe(0)
  })

  it("reads the chain at most once a minute per lock, across isolates", async () => {
    const chain = fakeChain({
      lock: (escrow, tokenId) => ({
        block: 13_200_100,
        owner: people.alice,
        lock: chainLock({ escrow, tokenId }),
      }),
    })
    const live = harness({ chain: chain.readers })
    onTheMinute(live)
    await live.json("/locks/vebtc/2", scanLockDocumentSchema)
    live.state.now += 30_000
    await live.json("/locks/vebtc/2", scanLockDocumentSchema)
    await settled()
    live.isolate()
    await live.json("/locks/vebtc/2", scanLockDocumentSchema)
    expect(chain.reads.lock).toEqual(["vebtc:2"])
    live.state.now += 30_000
    await live.json("/locks/vebtc/2", scanLockDocumentSchema)
    expect(chain.reads.lock).toEqual(["vebtc:2", "vebtc:2"])
  })

  it("shares one read among requests that arrive together", async () => {
    const chain = fakeChain({
      lock: (escrow, tokenId) => ({
        block: 13_200_100,
        owner: people.alice,
        lock: chainLock({ escrow, tokenId }),
      }),
    })
    const live = harness({ chain: chain.readers })
    const answers = await Promise.all(
      Array.from({ length: 5 }, () => live.get("/locks/vebtc/6100")),
    )
    expect(answers.map((answer) => answer.status)).toEqual([
      200, 200, 200, 200, 200,
    ])
    expect(chain.reads.lock).toEqual(["vebtc:6100"])
    expect(chain.reads.latest).toBe(1)
  })

  it("answers an id past the escrow's newest as not found without reading it", async () => {
    const chain = fakeChain({ lock: () => "fail" })
    const live = harness({ chain: chain.readers })
    // veMEZO's newest is 2945; up to 20 past it may be minting now.
    expect((await live.get("/locks/vemezo/2966")).status).toBe(404)
    expect((await live.get("/locks/vemezo/999999999999")).status).toBe(404)
    expect(chain.reads.lock).toEqual([])
    // One newest-id read serves every id that minute.
    expect(chain.reads.latest).toBe(1)
    // Within the margin the lock itself is read.
    await live.get("/locks/vemezo/2965")
    expect(chain.reads.lock).toEqual(["vemezo:2965"])
  })

  it("remembers that a lock does not exist at the edge, for every isolate", async () => {
    const chain = fakeChain({
      lock: () => ({ block: 13_200_100, owner: null, lock: null }),
    })
    const live = harness({ chain: chain.readers })
    onTheMinute(live)
    expect((await live.get("/locks/vebtc/6000")).status).toBe(404)
    await settled()
    // A new isolate has no memory of its own: only the edge entry.
    live.isolate()
    expect((await live.get("/locks/vebtc/6000")).status).toBe(404)
    expect(chain.reads.lock).toEqual(["vebtc:6000"])
    live.state.now += 60_000
    live.isolate()
    expect((await live.get("/locks/vebtc/6000")).status).toBe(404)
    expect(chain.reads.lock).toEqual(["vebtc:6000", "vebtc:6000"])
  })

  it("serves the stored lock when the chain fails, and remembers the failure", async () => {
    const chain = fakeChain({ lock: () => "fail" })
    const live = harness({ chain: chain.readers })
    onTheMinute(live)
    const body = await live.json("/locks/vebtc/3", scanLockDocumentSchema)
    expect(body).toMatchObject({ indexed: true, live: null })
    expect(body.data).toMatchObject({ token_id: "3", owner: people.alice })
    // A lock the store does not have: unknown, so never a 404, and the
    // failure is kept for the minute, so the 500 does not read again.
    expect((await live.get("/locks/vebtc/6100")).status).toBe(500)
    await settled()
    live.isolate()
    expect((await live.get("/locks/vebtc/6100")).status).toBe(500)
    expect(chain.reads.lock).toEqual(["vebtc:3", "vebtc:6100"])
  })

  it("serves stored rows once the shared budget is spent", async () => {
    const memory = createMemoryRateLimitClient(() => Date.now())
    const spent: RateLimitClient = {
      consume: (key, policy) =>
        key === scanChainBudgetKey
          ? Promise.resolve({
              allowed: false,
              limit: policy.perMinute,
              remaining: 0,
              resetAt: 0,
              retryAfterSeconds: 60,
            })
          : memory.consume(key, policy),
    }
    const chain = fakeChain({
      lock: (escrow, tokenId) => ({
        block: 13_200_100,
        owner: people.alice,
        lock: chainLock({ escrow, tokenId }),
      }),
    })
    const live = harness({ chain: chain.readers, rateLimits: spent })
    const body = await live.json("/locks/vebtc/3", scanLockDocumentSchema)
    expect(body).toMatchObject({ indexed: true, live: null })
    expect(chain.reads.lock).toEqual([])
    expect(chain.reads.latest).toBe(0)
  })

  it("does not read the chain for a withdrawn lock", async () => {
    const chain = fakeChain({})
    const live = harness({ chain: chain.readers })
    const body = await live.json("/locks/vebtc/5", scanLockDocumentSchema)
    expect(body).toMatchObject({ indexed: true, live: null })
    expect(body.data.is_withdrawn).toBe(true)
    expect(chain.reads.lock).toEqual([])
  })

  async function addressLocks(live: ReturnType<typeof harness>) {
    const response = await live.get(`/entities/address/${people.alice}`)
    expect(response.status).toBe(200)
    const document = scanAddressDocumentSchema.parse(
      z.object({ data: z.unknown() }).parse(await response.json()).data,
    )
    if (document.locks.status !== "ok") throw new Error("locks unavailable")
    return document.locks.data.data
  }

  /** Alice's locks on the chain: amount and unlock only. */
  function holds(
    locks: { tokenId: string; amount?: bigint; end?: number }[],
  ): OwnerLocks {
    return {
      block: 13_200_100,
      capped: [],
      locks: locks.map((lock) => ({
        escrow: "vebtc",
        tokenId: lock.tokenId,
        amount: lock.amount ?? wad,
        end: lock.end ?? 0,
        isPermanent: lock.end === undefined,
      })),
    }
  }

  it("lists an address's locks as the chain has them, and writes nothing", async () => {
    // Alice moved #2 away, made #10, got #4 from Bob, and #1 grew. #5 was
    // withdrawn.
    const chain = fakeChain({
      owner: () =>
        holds([
          { tokenId: "1", amount: 8n * wad, end: scanNow + 86_400 * 300 },
          { tokenId: "3", amount: 9n * wad },
          { tokenId: "4" },
          { tokenId: "10" },
        ]),
    })
    const live = harness({ chain: chain.readers })
    const locks = await addressLocks(live)
    // Scan's order: escrow, then id as text.
    expect(locks.map((lock) => lock.token_id)).toEqual([
      "1",
      "10",
      "3",
      "4",
      "5",
    ])
    expect(locks[0]).toMatchObject({
      amount: (8n * wad).toString(),
      created_at: scanNow - 86_400 * 50,
    })
    expect(locks[1]).toMatchObject({
      owner: people.alice,
      created_at: null,
      activity_count: null,
    })
    // Transferred in: the store's creation, though it lists it under Bob.
    expect(locks[3]).toMatchObject({
      owner: people.alice,
      created_at: scanNow - 86_400 * 20,
      activity_count: 3,
    })
    expect(locks[4]).toMatchObject({ is_withdrawn: true })
    await settled()
    expect(await queued()).toBe(0)
  })

  it("reads an owner's locks once a minute, however often the head moves", async () => {
    const chain = fakeChain({ owner: () => holds([]) })
    const live = harness({ chain: chain.readers })
    onTheMinute(live)
    await addressLocks(live)
    for (let step = 1; step <= 3; step += 1) {
      live.state.clock = { ...live.state.clock, height: 13_200_000 + step }
      live.state.now += 4_000
      await addressLocks(live)
    }
    await settled()
    live.isolate()
    live.state.clock = { ...live.state.clock, height: 13_200_010 }
    await addressLocks(live)
    expect(chain.reads.owner).toEqual([people.alice])
    live.state.now += 60_000
    live.state.clock = { ...live.state.clock, height: 13_200_020 }
    await addressLocks(live)
    expect(chain.reads.owner).toEqual([people.alice, people.alice])
  })

  /** How late a reader may be called after its deadline was set, ms. */
  const askSlack = 50

  /** Matchscan's own wait for the API, which every live read fits inside. */
  const matchscanWaitMs = 3_000

  it("lists the stored locks, in time, when the chain fails or never answers", async () => {
    // The route's deadline fits Matchscan's wait, with time to render.
    expect(scanLiveDeadlineMs + 500).toBeLessThanOrEqual(matchscanWaitMs)
    for (const answer of ["fail", "hang"] as const) {
      const chain = fakeChain({ owner: () => answer })
      const live = harness({ chain: chain.readers })
      // A guard against a hang only: the bound is checked on the deadline
      // each read was given, below, not on the machine's speed.
      const locks = await fulfilledWithin(addressLocks(live), 10_000)
      expect(locks.map((lock) => lock.token_id)).toEqual(["1", "2", "3", "5"])
      expect(chain.left.length).toBeGreaterThan(0)
      for (const ms of chain.left) {
        expect(ms).toBeLessThanOrEqual(scanLiveDeadlineMs + askSlack)
      }
    }
  })

  /**
   * The harness's clock: standing still until the returned `start()`, then
   * running with real time. A test starts it at its first real timer (a
   * read that hangs, the budget's ask), so the D1 work before that, slow on
   * a loaded machine, does not use up the route's deadline: on a real
   * clock from the start, a busy CI runner left no time for the live read.
   * What still runs on real time is that timer, and the checks hold unless
   * it fires more than a second and a half late.
   */
  function realClock(live: ReturnType<typeof harness>): () => void {
    const frozen = live.state.now
    let offset: number | null = null
    Object.defineProperty(live.state, "now", {
      get: () => (offset === null ? frozen : Date.now() + offset),
      set: () => undefined,
      configurable: true,
    })
    return () => {
      offset ??= frozen - Date.now()
    }
  }

  const visitor = (user: string) => ({
    headers: {
      [blockscoutClientHeader]: "scan",
      [blockscoutEndUserHeader]: user,
    },
  })

  it("answers a lock not stored inside Matchscan's 3 s when every read hangs", async () => {
    // The route's one deadline fits Matchscan's wait, with time to render.
    expect(scanLiveDeadlineMs + 500).toBeLessThanOrEqual(matchscanWaitMs)
    let startClock = (): void => undefined
    const chain = fakeChain({
      lock: () => "hang",
      latest: "hang",
      onAsk: () => startClock(),
    })
    const live = harness({ chain: chain.readers })
    startClock = realClock(live)
    for (const path of ["/locks/vebtc/3", "/locks/vebtc/6100"]) {
      // A guard against a hang only; the bound is the deadlines below.
      const response = await fulfilledWithin(live.get(path), 10_000)
      expect(response.status, path).toBe(path.endsWith("/3") ? 200 : 500)
    }
    // One deadline per route: no read was given more than the route's.
    expect(chain.left.length).toBeGreaterThan(0)
    for (const ms of chain.left) {
      expect(ms).toBeLessThanOrEqual(scanLiveDeadlineMs + askSlack)
    }
    // The newest ids hung: the lock itself was never asked for.
    expect(chain.reads.lock).toEqual(["vebtc:3"])
  })

  it("gives the budget 300 ms, then reads a lock anyway", async () => {
    const chain = fakeChain({
      lock: (escrow, tokenId) => ({
        block: 13_200_100,
        owner: people.alice,
        lock: chainLock({ escrow, tokenId }),
      }),
    })
    let startClock = (): void => undefined
    const unreachable: RateLimitClient = {
      consume: (key, policy) => {
        if (key.startsWith("scan:live:") || key === scanChainBudgetKey) {
          startClock()
          return new Promise(() => undefined)
        }
        return createMemoryRateLimitClient(() => Date.now()).consume(
          key,
          policy,
        )
      },
    }
    const live = harness({ chain: chain.readers, rateLimits: unreachable })
    startClock = realClock(live)
    // The budget's wait fits inside the route's deadline.
    expect(budgetCallMs).toBeLessThan(scanLiveDeadlineMs)
    const body = await fulfilledWithin(
      live.json("/locks/vebtc/3", scanLockDocumentSchema),
      10_000,
    )
    expect(body.live).not.toBeNull()
    expect(chain.reads.lock).toEqual(["vebtc:3"])
    // The read came after the budget's wait, out of the same deadline: it
    // was given at most what the wait left (less on a busy machine).
    for (const ms of chain.left) {
      expect(ms).toBeLessThanOrEqual(
        scanLiveDeadlineMs - budgetCallMs + askSlack,
      )
    }
  })

  it("serves an address's stored locks when the budget cannot be asked", async () => {
    const chain = fakeChain({ owner: () => holds([{ tokenId: "10" }]) })
    const unreachable: RateLimitClient = {
      consume: (key, policy) =>
        key.startsWith("scan:live:") || key === scanChainBudgetKey
          ? Promise.reject(new Error("Durable Object unreachable"))
          : createMemoryRateLimitClient(() => Date.now()).consume(key, policy),
    }
    const live = harness({ chain: chain.readers, rateLimits: unreachable })
    const locks = await addressLocks(live)
    expect(locks.map((lock) => lock.token_id)).toEqual(["1", "2", "3", "5"])
    expect(chain.reads.owner).toEqual([])
  })

  it("stops one visitor's live reads at their allowance, not others'", async () => {
    const chain = fakeChain({
      lock: (escrow, tokenId) => ({
        block: 13_200_100,
        owner: people.alice,
        lock: chainLock({ escrow, tokenId }),
      }),
    })
    const live = harness({ chain: chain.readers })
    onTheMinute(live)
    const greedy = "Z3JlZWR5LWVuZC11c2VyLTAwMDAwMQ"
    const answers: (string | null)[] = []
    // 16 locks the store does not have, each a read of its own.
    for (let index = 0; index < 16; index += 1) {
      const response = await live.get(
        `/locks/vebtc/${6_100 + index}`,
        visitor(greedy),
      )
      answers.push(response.status === 200 ? "live" : String(response.status))
    }
    expect(answers.slice(0, 15)).toEqual(Array(15).fill("live"))
    // Past the allowance: nothing stored to fall back on, so unavailable.
    expect(answers[15]).toBe("500")
    expect(chain.reads.lock).toHaveLength(15)
    // Not remembered for others: another visitor reads it.
    const other = await live.get(
      "/locks/vebtc/6115",
      visitor("b3RoZXItZW5kLXVzZXItMDAwMDE"),
    )
    expect(other.status).toBe(200)
    expect(chain.reads.lock).toHaveLength(16)
    // And a stored lock past the allowance is its stored row.
    const stored = await live.get("/locks/vebtc/2", visitor(greedy))
    expect(scanLockDocumentSchema.parse(await stored.json()).live).toBeNull()
  })

  it("says more locks only when some are left unlisted", async () => {
    // Alice holds 30 more veBTC locks (#200 to #229): the stored page of
    // 25 ends before them.
    const extra = Array.from({ length: 30 }, (_, index) => String(200 + index))
    await env.SCAN_DB.batch(
      extra.map((tokenId) =>
        env.SCAN_DB.prepare(
          `INSERT INTO locks (escrow, token_id, owner, amount, amount_key,
             unlock_at, created_at, last_extended_at, withdrawn_at,
             is_permanent, is_withdrawn, is_merged, merged_into_token_id,
             merged_at, boost, activity_count, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6, NULL, NULL, 1, 0, 0, NULL,
             NULL, NULL, 1, ?6)`,
        ).bind(
          vebtc,
          tokenId,
          people.alice,
          wad.toString(),
          wad.toString().padStart(40, "0"),
          scanNow - 86_400,
        ),
      ),
    )
    let held = ["1", "2", "3", ...extra]
    const chain = fakeChain({
      owner: () => holds(held.map((tokenId) => ({ tokenId }))),
    })
    const live = harness({ chain: chain.readers })
    const page = async () => {
      const response = await live.get(`/entities/address/${people.alice}`)
      const document = scanAddressDocumentSchema.parse(
        z.object({ data: z.unknown() }).parse(await response.json()).data,
      )
      if (document.locks.status !== "ok") throw new Error("locks")
      return document.locks.data
    }
    // Without withdrawn #5 (which sorts past the stored page, by text),
    // every lock is listed, the chain's: nothing is left, so no "more".
    await env.SCAN_DB.prepare(
      "DELETE FROM locks WHERE escrow = ?1 AND token_id = '5'",
    )
      .bind(vebtc)
      .run()
    const listed = await page()
    expect(listed.data).toHaveLength(held.length)
    expect(listed.nextCursor).toBeNull()
    // A lock withdrawn past the stored page (which ends at #222) is left
    // unlisted: "more".
    held = held.filter((tokenId) => tokenId !== "229")
    await env.SCAN_DB.prepare(
      "UPDATE locks SET is_withdrawn = 1, owner = ?1 WHERE escrow = ?2 AND token_id = '229'",
    )
      .bind(people.alice, vebtc)
      .run()
    live.state.now += 60_000
    live.state.clock = { ...live.state.clock, height: 13_200_500 }
    const withdrawn = await page()
    expect(withdrawn.nextCursor).not.toBeNull()
  })
})

describe("a transaction the explorer and the copy have yet to reach", () => {
  const [vote, claim] = liveFixtures.receipts
  if (vote === undefined || claim === undefined) throw new Error("fixtures")

  function mined(receipt: NonNullable<typeof vote>): LiveTxRead {
    return {
      state: "mined",
      transaction: {
        from: receipt.from,
        to: receipt.to,
        value: "0",
        nonce: 3,
        gas_limit: "900000",
        gas_price: "1000",
        input: receipt.input,
        input_truncated: false,
        method: "vote",
      },
      receipt: {
        status: "success",
        block_number: receipt.blockNumber,
        position: receipt.position,
        gas_used: "500000",
        effective_gas_price: "1000",
        created: null,
        logs: receipt.logs,
        logs_truncated: false,
      },
      timestamp: receipt.timestamp,
      head: receipt.blockNumber + 2,
      locks: null,
    }
  }

  const unknownTx: LiveTxRead = {
    state: "unknown",
    transaction: null,
    receipt: null,
    timestamp: null,
    head: null,
    locks: null,
  }

  function txReader(answer: (hash: string) => Promise<LiveTxRead>) {
    const reads: string[] = []
    const readers: ScanChainReaders = {
      lock: () => Promise.reject(new ClaimableUnread("unused")),
      owner: () => Promise.reject(new ClaimableUnread("unused")),
      latest: () => Promise.reject(new ClaimableUnread("unused")),
      tx: (hash) => {
        reads.push(hash)
        return answer(hash)
      },
    }
    return { readers, reads }
  }

  async function documentOf(response: Response) {
    expect(response.status).toBe(200)
    return scanTransactionDocumentSchema.parse(
      z.object({ data: z.unknown() }).parse(await response.json()).data,
    )
  }

  const gauges = async (): Promise<Gauge[]> =>
    liveFixtures.known.map((reward) => ({
      voter: "boost",
      network: "mezo",
      gaugeAddress: reward.gauge,
      isAlive: true,
      weight: null,
      bribeContract: reward.address,
      vebtcTokenId: null,
      beneficiary: null,
      boostMultiplier: null,
    }))

  it("reads a mined transaction Blockscout lacks from the chain, decoded", async () => {
    const chain = txReader(async () => mined(vote))
    const h = harness({ chain: chain.readers })
    const document = await documentOf(await h.get(`/entities/tx/${vote.hash}`))
    expect(document.transaction).toEqual({
      status: "unavailable",
      reason: "not_found",
    })
    expect(document.final).toBe(false)
    if (document.live?.status !== "ok") throw new Error("no live part")
    const live = document.live.data
    expect(live.state).toBe("mined")
    expect(live.receipt?.block_number).toBe(vote.blockNumber)
    const copied = liveFixtures.rows.filter((row) => row.tx_hash === vote.hash)
    expect(live.activity.map((row) => row.id)).toEqual(
      copied.map((row) => row.id),
    )
    expect(live.activity.map((row) => row.gauge)).toEqual(
      copied.map((row) => row.gauge),
    )
    expect(chain.reads).toEqual([vote.hash])
  })

  it("decodes a claim through the snapshot's reward contracts", async () => {
    const without = harness({
      chain: txReader(async () => mined(claim)).readers,
    })
    const bare = await documentOf(
      await without.get(`/entities/tx/${claim.hash}`),
    )
    const withGauges = harness({
      chain: txReader(async () => mined(claim)).readers,
      gauges,
    })
    const full = await documentOf(
      await withGauges.get(`/entities/tx/${claim.hash}`),
    )
    if (bare.live?.status !== "ok" || full.live?.status !== "ok") {
      throw new Error("no live part")
    }
    const copied = liveFixtures.rows.filter((row) => row.tx_hash === claim.hash)
    expect(full.live.data.activity).toEqual(copied)
    expect(bare.live.data.activity.length).toBeLessThan(copied.length)
  })

  it("says the chain has never seen a hash, for one block", async () => {
    const chain = txReader(async () => unknownTx)
    const h = harness({ chain: chain.readers })
    const hash = `0x${"5e".repeat(32)}`
    const document = await documentOf(await h.get(`/entities/tx/${hash}`))
    expect(document.live).toMatchObject({
      status: "ok",
      data: { state: "unknown", activity: [] },
    })
    await h.get(`/entities/tx/${hash}`)
    expect(chain.reads).toHaveLength(1)
    h.state.now += 4_000
    h.state.clock = {
      ...h.state.clock,
      height: (h.state.clock.height ?? 0) + 1,
    }
    await h.get(`/entities/tx/${hash}`)
    expect(chain.reads).toHaveLength(2)
  })

  it("serves the document without the chain when the read fails", async () => {
    const chain = txReader(() => Promise.reject(new ClaimableUnread("down")))
    const h = harness({ chain: chain.readers })
    const response = await h.get(`/entities/tx/${vote.hash}`)
    const document = await documentOf(response)
    expect(document.live).toEqual({ status: "unavailable", reason: "upstream" })
    // Not stored for the next caller.
    expect(response.headers.get("Cache-Control")).toBe("private, no-store")
  })

  it("does not read the chain once the copy has the transaction", async () => {
    await env.SCAN_DB.prepare(
      "UPDATE scan_cursors SET value = '1900000000' WHERE name = 'copy:activity'",
    ).run()
    const chain = txReader(async () => mined(vote))
    const h = harness({ chain: chain.readers })
    h.blockscout.reply(`transactions/${blockTx}`, {
      status: 200,
      body: { ...transaction, has_error_in_internal_transactions: false },
    })
    const document = await documentOf(await h.get(`/entities/tx/${blockTx}`))
    expect(document.live).toBeUndefined()
    expect(chain.reads).toEqual([])
  })

  it("sends no live part for an old transaction while Blockscout is failing", async () => {
    // The copy is past the block by the chain's own time; the explorer's
    // time is missing.
    await env.SCAN_DB.prepare(
      "UPDATE scan_cursors SET value = ?1 WHERE name = 'copy:activity'",
    )
      .bind(String(vote.timestamp + 3_600))
      .run()
    const chain = txReader(async () => mined(vote))
    const h = harness({ chain: chain.readers })
    h.blockscout.reply(`transactions/${vote.hash}`, { status: 503 })
    const document = await documentOf(await h.get(`/entities/tx/${vote.hash}`))
    expect(document.transaction.status).toBe("unavailable")
    expect(document.live).toBeUndefined()
  })

  it("never reads the chain for a transaction our rows already cover", async () => {
    await env.SCAN_DB.prepare(
      "UPDATE scan_cursors SET value = '1' WHERE name = 'copy:activity'",
    ).run()
    await env.SCAN_DB.prepare(
      `INSERT INTO activity (id, tx_hash, log_index, block_number, timestamp,
         epoch_start, action_type, source, contract_address, tx_from, actor,
         recipient, extra)
       VALUES ('covered-1', ?1, 0, ?2, ?3, ?4, 'BOOST_POKE', 'BOOST_VOTER',
         ?5, ?6, NULL, NULL, '{}')`,
    )
      .bind(
        vote.hash,
        vote.blockNumber,
        vote.timestamp,
        vote.timestamp - (vote.timestamp % 604_800),
        vote.to,
        vote.from,
      )
      .run()
    const chain = txReader(async () => mined(vote))
    const h = harness({ chain: chain.readers })
    h.blockscout.reply(`transactions/${vote.hash}`, { status: 503 })
    const document = await documentOf(await h.get(`/entities/tx/${vote.hash}`))
    expect(document.activity.status).toBe("ok")
    expect(document.live).toBeUndefined()
    expect(chain.reads).toEqual([])
  })

  it("reads the chain while Blockscout has it and the copy does not", async () => {
    await env.SCAN_DB.prepare(
      "UPDATE scan_cursors SET value = '1' WHERE name = 'copy:activity'",
    ).run()
    const chain = txReader(async () => mined(vote))
    const h = harness({ chain: chain.readers })
    h.blockscout.reply(`transactions/${blockTx}`, {
      status: 200,
      body: { ...transaction, has_error_in_internal_transactions: false },
    })
    const document = await documentOf(await h.get(`/entities/tx/${blockTx}`))
    expect(document.transaction.status).toBe("ok")
    expect(document.live?.status).toBe("ok")
    expect(chain.reads).toEqual([blockTx])
  })
})
