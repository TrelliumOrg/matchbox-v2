import { applyD1Migrations } from "cloudflare:test"
import { env } from "cloudflare:workers"
import {
  scanAprHistorySchema,
  scanEpochSourcesSchema,
  scanGaugeAprHistorySchema,
  scanGaugeEmissionsSchema,
  scanLockDistributionDocumentSchema,
} from "@matchbox/contracts/scan"
import { createLogger } from "@matchbox/logger"
import { errorHandler, notFoundHandler, requestId } from "@matchbox/server"
import { Hono } from "hono"
import { beforeEach, describe, expect, it } from "vitest"
import type { ApiEnv } from "../context"
import { internalAccess } from "../internal/access"
import { cors } from "../middleware/cors"
import {
  currentEpoch,
  gauge,
  lastEpoch,
  scanNow,
  writeStatus,
} from "./fixtures"
import { scanQueries } from "./queries"
import registerScanRoutes from "./routes"

// The governance summary routes over Miniflare D1: SCAN_DB's
// epoch_sources, gauge_emissions and lock_distribution, MARKET_DB's
// market_voter_epochs and market_gauges.

const base = "https://api.internal/internal/scan"
const logger = createLogger({ level: "error" })
const usdc = "0x00000000000000000000000000000000000000d4"

function app(options: { market?: boolean } = {}) {
  const hono = new Hono<ApiEnv>()
  hono.use(requestId({ logger }))
  hono.use(internalAccess({ internalToken: null }))
  hono.use(cors())
  hono.onError(errorHandler())
  hono.notFound(notFoundHandler)
  hono.use("/internal/*", async (c, next) => {
    c.set("cors", { kind: "public" })
    await next()
  })
  registerScanRoutes(hono, {
    scanDb: env.SCAN_DB,
    readDb: env.READ_DB,
    marketDb: options.market === false ? null : env.MARKET_DB,
    network: "mezo",
    cache: null,
    rateLimits: null,
    readPrices: async () => null,
    proxy: null,
    clock: async () => ({ height: null, lastActive: null }),
    logger,
    now: () => scanNow * 1000,
  })
  return hono
}

async function get(path: string, options?: { market?: boolean }) {
  return app(options).request(`${base}${path}`)
}

function lockDoc(dayKey: string, permanent: number) {
  const group = (count: number) => ({
    count,
    amount: String(count * 10),
    voting_power: String(count * 10),
  })
  return {
    escrow: "vebtc",
    day: dayKey,
    block: 13_000_000,
    read_at: Date.parse(`${dayKey}T00:05:00Z`) / 1000,
    max_lock_seconds: 2_419_200,
    ids_read: 10,
    supply: String((permanent + 2) * 10),
    live: group(permanent + 2),
    permanent: group(permanent),
    timed: group(2),
    expired: group(0),
    largest: "10",
    median: "10",
    mean_remaining_seconds: 86_400,
    by_size: [{ ...group(permanent + 2), min: "0", max: null }],
    by_remaining: [{ ...group(2), min_seconds: 0, max_seconds: 604_800 }],
    unlocks: [{ at: currentEpoch + 604_800, count: 2, amount: "20" }],
  }
}

function dayKey(offset: number): string {
  return new Date((scanNow + offset * 86_400) * 1000).toISOString().slice(0, 10)
}

beforeEach(async () => {
  await applyD1Migrations(env.READ_DB, env.TEST_MIGRATIONS)
  await applyD1Migrations(env.SCAN_DB, env.SCAN_MIGRATIONS)
  await applyD1Migrations(env.MARKET_DB, env.MARKET_MIGRATIONS)
  await env.SCAN_DB.batch(
    ["epoch_sources", "gauge_emissions", "lock_distribution", "scan_dirty"].map(
      (table) => env.SCAN_DB.prepare(`DELETE FROM ${table}`),
    ),
  )
  await env.MARKET_DB.batch(
    ["market_voter_epochs", "market_gauges"].map((table) =>
      env.MARKET_DB.prepare(`DELETE FROM ${table}`),
    ),
  )
  await writeStatus(env.SCAN_DB)
})

describe("epoch sources and emissions", () => {
  it("serves each voter's epochs oldest first, with completeness", async () => {
    await env.SCAN_DB.batch([
      ...[lastEpoch, currentEpoch].flatMap((epoch) =>
        ["POOLS_VOTER", "VALIDATORS_VOTER"].map((source) =>
          env.SCAN_DB.prepare(
            `INSERT INTO epoch_sources (epoch_start, source, emissions,
               incentives, fees, vote_weight, gauges, emission_gauges, updated_at)
             VALUES (?1, ?2, '100', ?3, '{}', '5', 1, 1, ?1)`,
          ).bind(epoch, source, JSON.stringify({ [usdc]: "7" })),
        ),
      ),
      env.SCAN_DB.prepare(
        "INSERT INTO scan_dirty (kind, key, generation) VALUES ('epoch', ?1, 0)",
      ).bind(String(currentEpoch)),
    ])
    const response = await get("/epoch-sources?epochs=4")
    expect(response.status).toBe(200)
    const body = scanEpochSourcesSchema.parse(await response.json())
    expect(body.data.map((row) => [row.epoch_start, row.source])).toEqual([
      [lastEpoch, "POOLS_VOTER"],
      [lastEpoch, "VALIDATORS_VOTER"],
      [currentEpoch, "POOLS_VOTER"],
      [currentEpoch, "VALIDATORS_VOTER"],
    ])
    expect(body.data[0]?.incentives).toEqual({ [usdc]: "7" })
    expect(body.data.map((row) => row.complete)).toEqual([
      true,
      true,
      false,
      false,
    ])
    expect(body.meta.complete).toBe(false)
  })

  it("serves a gauge's emissions newest first, and an epoch's by voter", async () => {
    await env.SCAN_DB.batch(
      [lastEpoch, currentEpoch].map((epoch, index) =>
        env.SCAN_DB.prepare(
          `INSERT INTO gauge_emissions (gauge, epoch_start, source, amount,
             events, updated_at) VALUES (?1, ?2, 'VALIDATORS_VOTER', ?3, 1, ?2)`,
        ).bind(gauge, epoch, String(1_000 + index)),
      ),
    )
    const history = scanGaugeEmissionsSchema.parse(
      await (await get(`/gauges/${gauge}/emissions?limit=5`)).json(),
    )
    expect(history.data.map((row) => row.amount)).toEqual(["1001", "1000"])
    const epoch = scanGaugeEmissionsSchema.parse(
      await (
        await get(`/epoch-emissions/${lastEpoch}?source=VALIDATORS_VOTER`)
      ).json(),
    )
    expect(epoch.data.map((row) => row.gauge)).toEqual([gauge])
    expect((await get(`/epoch-emissions/${lastEpoch}`)).status).toBe(400)
    expect((await get("/epoch-emissions/123?source=X_Y")).status).toBe(404)
  })
})

describe("lock distribution", () => {
  it("is empty before the first daily read", async () => {
    const body = scanLockDistributionDocumentSchema.parse(
      await (await get("/lock-distribution?escrow=vebtc")).json(),
    )
    expect(body.data.latest).toBeNull()
    expect(body.data.history).toEqual([])
  })

  it("serves the newest day, 30 and 90 days before, and the history", async () => {
    const rows = [
      [-150, 0],
      [-92, 1],
      [-31, 3],
      [-1, 5],
      [0, 6],
    ] as const
    await env.SCAN_DB.batch(
      rows.map(([offset, permanent]) =>
        env.SCAN_DB.prepare(
          `INSERT INTO lock_distribution (escrow, day, block, data, source, updated_at)
           VALUES ('vebtc', ?1, 13000000, ?2, 'live', ?3)`,
        ).bind(
          dayKey(offset),
          JSON.stringify(lockDoc(dayKey(offset), permanent)),
          scanNow,
        ),
      ),
    )
    const body = scanLockDistributionDocumentSchema.parse(
      await (await get("/lock-distribution?escrow=vebtc")).json(),
    )
    expect(body.data.latest?.permanent.count).toBe(6)
    expect(body.data.ago30?.permanent.count).toBe(3)
    expect(body.data.ago90?.permanent.count).toBe(1)
    expect(body.data.history.map((point) => point.permanent.count)).toEqual([
      0, 1, 3, 5, 6,
    ])
    expect((await get("/lock-distribution?escrow=other")).status).toBe(400)
  })

  it("compares only with a read within 3 days of 30 or 90 days back", async () => {
    // Daily reads missed for weeks: the newest read before 30 days back is
    // 60 days old, the one before 90 days back 150.
    await env.SCAN_DB.batch(
      [
        [-150, 1],
        [-60, 2],
        [0, 4],
      ].map(([offset = 0, permanent = 0]) =>
        env.SCAN_DB.prepare(
          `INSERT INTO lock_distribution (escrow, day, block, data, source, updated_at)
           VALUES ('vebtc', ?1, 13000000, ?2, 'live', ?3)`,
        ).bind(
          dayKey(offset),
          JSON.stringify(lockDoc(dayKey(offset), permanent)),
          scanNow,
        ),
      ),
    )
    const body = scanLockDistributionDocumentSchema.parse(
      await (await get("/lock-distribution?escrow=vebtc")).json(),
    )
    expect(body.data.latest?.permanent.count).toBe(4)
    expect(body.data.ago30).toBeNull()
    expect(body.data.ago90).toBeNull()
  })
})

describe("voting APR", () => {
  it("serves stored voter epochs oldest first", async () => {
    await env.MARKET_DB.batch(
      ["pools", "validators"].map((voter, index) =>
        env.MARKET_DB.prepare(
          `INSERT INTO market_voter_epochs (network, epoch_start, voter,
             total_usd, weight, voting_token_usd, apr_percent, funded_gauges,
             unpriced_rewards, open, updated_at)
           VALUES ('mezo', ?1, ?2, '100.5', '1000000000000000000', '80000',
             ?3, 2, 0, ?4, ?1)`,
        ).bind(
          index === 0 ? lastEpoch : currentEpoch,
          voter,
          index === 0 ? "6.53" : "1.20",
          index,
        ),
      ),
    )
    const body = scanAprHistorySchema.parse(
      await (await get("/apr?epochs=4")).json(),
    )
    expect(
      body.data.map((row) => [row.voter, row.apr_percent, row.open]),
    ).toEqual([
      ["pools", "6.53", false],
      ["validators", "1.20", true],
    ])
  })

  it("serves a gauge's stored APR, skipping upcoming epochs", async () => {
    const incentives = (epoch: number, apr: string | null) =>
      JSON.stringify({
        network: "mezo",
        voter: "validators",
        gaugeAddress: gauge,
        epochStart: epoch,
        isAlive: true,
        weight: "1000",
        rewards: [],
        totalUsd: apr === null ? null : "10",
        unpricedRewards: 0,
        aprPercent: apr,
      })
    await env.MARKET_DB.batch(
      [
        [lastEpoch, "2.50"],
        [currentEpoch, "2.10"],
        [currentEpoch + 604_800, "9.99"],
      ].map(([epoch, apr]) =>
        env.MARKET_DB.prepare(
          `INSERT INTO market_gauges (network, epoch_start, gauge_address,
             voter, vebtc_token_id, has_rewards, gauge, incentives, hash)
           VALUES ('mezo', ?1, ?2, 'validators', NULL, 1, '{}', ?3, 'h')`,
        ).bind(epoch, gauge, incentives(Number(epoch), String(apr))),
      ),
    )
    const body = scanGaugeAprHistorySchema.parse(
      await (await get(`/gauges/${gauge}/apr`)).json(),
    )
    expect(body.data.map((point) => point.apr_percent)).toEqual([
      "2.50",
      "2.10",
    ])
  })

  it("answers 503 without MARKET_DB", async () => {
    expect((await get("/apr", { market: false })).status).toBe(503)
  })
})

describe("before the migrations", () => {
  // The routes deploy before their tables: each answers 404 (Matchscan's
  // "not available yet", a page it may cache), never a 500.
  it("answers 404 while a governance table does not exist", async () => {
    const hidden = [
      [env.SCAN_DB, "epoch_sources"],
      [env.SCAN_DB, "gauge_emissions"],
      [env.SCAN_DB, "lock_distribution"],
      [env.MARKET_DB, "market_voter_epochs"],
    ] as const
    for (const [db, table] of hidden) {
      await db.exec(`ALTER TABLE ${table} RENAME TO ${table}_hidden`)
    }
    try {
      for (const path of [
        "/epoch-sources",
        `/gauges/${gauge}/emissions`,
        `/epoch-emissions/${currentEpoch}?source=POOLS_VOTER`,
        "/lock-distribution?escrow=vebtc",
        "/apr",
      ]) {
        expect((await get(path)).status, path).toBe(404)
      }
    } finally {
      for (const [db, table] of hidden) {
        await db.exec(`ALTER TABLE ${table}_hidden RENAME TO ${table}`)
      }
    }
  })
})

describe("query plans", () => {
  it("lists the governance statements for the plan test", () => {
    for (const name of [
      "epochSources",
      "gaugeEmissions",
      "epochEmissions",
      "lockDistributionOn",
      "lockDistributionHistory",
    ] as const) {
      expect(scanQueries[name].db).toBe("scan")
    }
  })
})
