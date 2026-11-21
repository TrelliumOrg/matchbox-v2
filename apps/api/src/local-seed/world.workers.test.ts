import { applyD1Migrations } from "cloudflare:test"
import { env } from "cloudflare:workers"
import {
  gaugeDirectoryResponseSchema,
  gaugeProfileResponseSchema,
  pricesResponseSchema,
  proSummaryResponseSchema,
  protocolActivityResponseSchema,
  protocolEpochResponseSchema,
  protocolHistoryResponseSchema,
  protocolResponseSchema,
  walletActivityResponseSchema,
  walletOverviewResponseSchema,
  walletRewardsResponseSchema,
  watchListResponseSchema,
} from "@matchbox/contracts/read-models"
import {
  demoActivityRows,
  demoGaugeProfile,
  demoNow,
  demoWallet,
} from "@matchbox/contracts/read-models/fixtures"
import { errorHandler, notFoundHandler } from "@matchbox/server"
import { Hono } from "hono"
import { beforeAll, describe, expect, it } from "vitest"
import type { z } from "zod"
import type { ApiEnv } from "../context"
import { readPricesFromKv } from "../read-models/prices-kv"
import registerInternalProRoutes from "../read-models/routes"
import { readReadModel } from "../read-models/store"
import {
  fixtureReadModels,
  seedDocumentRows,
  seedLocalWorld,
  seedNetwork,
} from "./world"

// Keeps `pnpm db:seed:local` working: the seed runs on freshly migrated
// databases (the same migration directories the script applies), every
// document reads back through its read-model contract, and the routes Pro
// and Stuart call answer with documents that parse. A migration or
// contract change that breaks the fixture world fails here.

function app() {
  const hono = new Hono<ApiEnv>()
  hono.onError(errorHandler())
  hono.notFound(notFoundHandler)
  registerInternalProRoutes(hono, {
    readDb: env.READ_DB,
    readPrices: () => readPricesFromKv(env.PRICES),
    cache: null,
    heads: null,
    network: seedNetwork,
    nowSeconds: () => demoNow,
  })
  return hono
}

async function get<T>(path: string, schema: z.ZodType<T>): Promise<T> {
  const response = await app().request(path)
  expect(response.status, path).toBe(200)
  return schema.parse(await response.json())
}

/** Every seeded row that a second run could change. */
async function snapshot() {
  const documents = await env.READ_DB.prepare(
    "SELECT kind, doc_key, etag, source FROM read_models ORDER BY kind, doc_key",
  ).all()
  const counts = await Promise.all(
    ["activity", "locks", "scan_runs", "scan_status"].map((table) =>
      env.SCAN_DB.prepare(`SELECT count(*) AS n FROM ${table}`).first(),
    ),
  )
  const reads = await Promise.all(
    [
      "troves",
      "morpho_markets",
      "stability_pool",
      "watch_items",
      "wallet_activity_rows",
      "wallet_history_state",
    ].map((table) =>
      env.READ_DB.prepare(`SELECT count(*) AS n FROM ${table}`).first(),
    ),
  )
  const history = await env.READ_DB.prepare(
    "SELECT row_id, etag FROM wallet_activity_rows ORDER BY sort_ts, row_id",
  ).all()
  return {
    documents: documents.results,
    counts,
    reads,
    history: history.results,
  }
}

beforeAll(async () => {
  await applyD1Migrations(env.READ_DB, env.TEST_MIGRATIONS)
  await applyD1Migrations(env.SCAN_DB, env.SCAN_MIGRATIONS)
  await seedLocalWorld(env)
})

describe("local seed", () => {
  it("stores every document so it reads back through its contract", async () => {
    for (const write of fixtureReadModels()) {
      const stored = await readReadModel(
        env.READ_DB,
        write.network,
        write.kind,
        write.key,
      )
      expect(stored?.data, `${write.kind} ${write.key}`).toEqual(write.data)
      expect(stored?.meta.source).toBe("fixture")
    }
  })

  it("serves the routes Pro and Stuart read", async () => {
    const gauges = await get(
      "/internal/pro/gauges",
      gaugeDirectoryResponseSchema,
    )
    expect(gauges.data.gauges.length).toBeGreaterThan(0)
    const summary = await get("/internal/pro/summary", proSummaryResponseSchema)
    expect(summary.data.topGauges.length).toBeGreaterThan(0)
    const protocol = await get("/internal/pro/protocol", protocolResponseSchema)
    await get(
      `/internal/pro/protocol/epochs/${protocol.data.epoch.number}`,
      protocolEpochResponseSchema,
    )
    await get("/internal/pro/protocol/epochs", protocolHistoryResponseSchema)
    await get("/internal/pro/protocol/activity", protocolActivityResponseSchema)
    await get(
      `/internal/pro/gauges/${demoGaugeProfile.card.gauge.address}`,
      gaugeProfileResponseSchema,
    )
    await get(
      `/internal/pro/wallets/${demoWallet}/overview`,
      walletOverviewResponseSchema,
    )
    await get(
      `/internal/pro/wallets/${demoWallet}/rewards`,
      walletRewardsResponseSchema,
    )
    const watchList = await get(
      `/internal/pro/wallets/${demoWallet}/watchlist`,
      watchListResponseSchema,
    )
    expect(watchList.data.items.length).toBeGreaterThan(0)
    const prices = await get("/internal/pro/prices", pricesResponseSchema)
    expect(prices.data.btc).not.toBeNull()
  })

  it("pages the demo wallet's Activity into its stored history", async () => {
    const path = `/internal/pro/wallets/${demoWallet}/activity`
    const first = await get(path, walletActivityResponseSchema)
    expect(first.data.rows).toEqual(seedDocumentRows)
    const cursor = first.data.nextCursor
    expect(cursor).toMatch(/^h\./)
    const earlier = await get(
      `${path}?cursor=${encodeURIComponent(cursor ?? "")}`,
      walletActivityResponseSchema,
    )
    // Together the document and the history are every demo row, once.
    expect([...first.data.rows, ...earlier.data.rows]).toEqual(demoActivityRows)
    expect(earlier.data.nextCursor).toBeNull()
  })

  it("fills the scan database", async () => {
    const activity = await env.SCAN_DB.prepare(
      "SELECT count(*) AS n FROM activity",
    ).first<{ n: number }>()
    expect(activity?.n).toBeGreaterThan(0)
  })

  it("leaves the same state when run again", async () => {
    const first = await snapshot()
    await seedLocalWorld(env)
    expect(await snapshot()).toEqual(first)
  })
})
