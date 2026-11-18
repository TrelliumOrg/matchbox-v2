import { applyD1Migrations } from "cloudflare:test"
import { env } from "cloudflare:workers"
import {
  walletActivityResponseSchema,
  walletOverviewResponseSchema,
} from "@matchbox/contracts/read-models"
import {
  demoActivityRows,
  demoBlock,
  demoGaugeDirectory,
  demoNow,
  demoPrices,
  demoProtocol,
  demoWallet,
  demoWalletOverview,
  demoWalletRewards,
} from "@matchbox/contracts/read-models/fixtures"
import { errorHandler, notFoundHandler } from "@matchbox/server"
import { Hono } from "hono"
import { beforeEach, describe, expect, it } from "vitest"
import type { ApiEnv } from "../context"
import { pricesKvKey, readPricesFromKv } from "./publish"
import registerInternalProRoutes from "./routes"
import {
  currentKey,
  type ReadModelKind,
  type ReadModelWrite,
  readReadModel,
  writeReadModels,
} from "./store"

const base = {
  network: "mezo" as const,
  block: demoBlock,
  source: "fixture" as const,
  updatedAt: demoNow,
}

const documents: ReadModelWrite<ReadModelKind>[] = [
  {
    ...base,
    kind: "wallet-overview",
    key: demoWallet,
    data: demoWalletOverview,
  },
  { ...base, kind: "wallet-rewards", key: demoWallet, data: demoWalletRewards },
  {
    ...base,
    kind: "wallet-activity",
    key: demoWallet,
    data: { address: demoWallet, rows: demoActivityRows, nextCursor: null },
  },
  { ...base, kind: "protocol", key: currentKey, data: demoProtocol },
  { ...base, kind: "gauges", key: currentKey, data: demoGaugeDirectory },
]

function app(cache: Cache | null) {
  const hono = new Hono<ApiEnv>()
  hono.onError(errorHandler())
  hono.notFound(notFoundHandler)
  registerInternalProRoutes(hono, {
    readDb: env.READ_DB,
    readPrices: () => readPricesFromKv(env.PRICES),
    cache,
    heads: env.BLOCK_HUB,
    network: "mezo",
  })
  return hono
}

beforeEach(async () => {
  await applyD1Migrations(env.READ_DB, env.TEST_MIGRATIONS)
  await env.READ_DB.exec("DELETE FROM read_models")
  await env.PRICES.put(pricesKvKey, JSON.stringify(demoPrices))
})

describe("read model store", () => {
  it("round-trips documents and skips unchanged rewrites", async () => {
    expect(await writeReadModels(env.READ_DB, documents)).toBe(5)
    expect(await writeReadModels(env.READ_DB, documents)).toBe(0)
    const stored = await readReadModel(
      env.READ_DB,
      "mezo",
      "wallet-overview",
      demoWallet,
    )
    expect(stored?.data).toEqual(demoWalletOverview)
    expect(stored?.meta).toEqual({
      network: "mezo",
      source: "fixture",
      block: demoBlock,
      updatedAt: demoNow,
    })
  })

  it("does not rewrite a document whose only change is a USD value", async () => {
    await writeReadModels(env.READ_DB, documents)
    const repriced = {
      ...demoWalletOverview,
      claimable: { ...demoWalletOverview.claimable, usd: "1.00" },
    }
    expect(
      await writeReadModels(env.READ_DB, [
        { ...base, kind: "wallet-overview", key: demoWallet, data: repriced },
      ]),
    ).toBe(0)
    const added = {
      ...demoWalletOverview,
      recentActivity: demoWalletOverview.recentActivity.slice(1),
    }
    expect(
      await writeReadModels(env.READ_DB, [
        { ...base, kind: "wallet-overview", key: demoWallet, data: added },
      ]),
    ).toBe(1)
  })

  it("refuses documents that do not match their schema", async () => {
    await expect(
      writeReadModels(env.READ_DB, [
        {
          ...base,
          kind: "protocol",
          key: currentKey,
          data: { ...demoProtocol, epoch: null },
        } as never,
      ]),
    ).rejects.toThrow()
  })
})

describe("/internal/pro routes", () => {
  beforeEach(async () => {
    await writeReadModels(env.READ_DB, documents)
  })

  it("serves a wallet overview repriced from KV, with an ETag", async () => {
    const response = await app(null).request(
      `/internal/pro/wallets/${demoWallet.toUpperCase().replace("0X", "0x")}/overview`,
    )
    expect(response.status).toBe(200)
    expect(response.headers.get("Cache-Control")).toContain("s-maxage=30")
    const body = walletOverviewResponseSchema.parse(await response.json())
    expect(body.data.claimable.usd).toBe("212.48")
    expect(body.meta.block).toBe(demoBlock)

    const etag = response.headers.get("ETag")
    expect(etag).toMatch(/^"[0-9a-f]+-[0-9a-f]+"$/)
    const again = await app(null).request(
      `/internal/pro/wallets/${demoWallet}/overview`,
      { headers: { "If-None-Match": etag ?? "" } },
    )
    expect(again.status).toBe(304)

    // A new price changes the ETag and the claimable total.
    await env.PRICES.put(
      pricesKvKey,
      JSON.stringify({
        ...demoPrices,
        btc: { ...demoPrices.btc, usd: "100000" },
      }),
    )
    const repriced = await app(null).request(
      `/internal/pro/wallets/${demoWallet}/overview`,
      { headers: { "If-None-Match": etag ?? "" } },
    )
    expect(repriced.status).toBe(200)
    const repricedBody = walletOverviewResponseSchema.parse(
      await repriced.json(),
    )
    expect(repricedBody.data.claimable.usd).toBe("210.13")
  })

  it("answers from the edge cache on the second request", async () => {
    const cache = await caches.open("internal-pro-test")
    const first = await app(cache).request(
      "http://api.test/internal/pro/protocol",
    )
    expect(first.headers.get("X-Cache")).toBe("miss")
    // Let the background cache.put land.
    await new Promise((resolve) => setTimeout(resolve, 10))
    const second = await app(cache).request(
      "http://api.test/internal/pro/protocol",
    )
    expect(second.headers.get("X-Cache")).toBe("hit")
    expect(await second.json()).toEqual(await first.json())
    const conditional = await app(cache).request(
      "http://api.test/internal/pro/protocol",
      { headers: { "If-None-Match": first.headers.get("ETag") ?? "" } },
    )
    expect(conditional.status).toBe(304)
  })

  it("keeps an answer asked for after a block apart, and only once it is that new", async () => {
    const cache = await caches.open("internal-pro-after-test")
    const gauges = "http://api.test/internal/pro/gauges"
    await app(cache).request(gauges)
    await new Promise((resolve) => setTimeout(resolve, 10))
    // The cached directory does not answer a request that names a block.
    const later = `${gauges}?after=${demoBlock + 5}`
    const behind = await app(cache).request(later)
    expect(behind.headers.get("X-Cache")).not.toBe("hit")
    expect(behind.headers.get("Cache-Control")).toBe("no-store")
    await new Promise((resolve) => setTimeout(resolve, 10))
    // Still older than the block: it was not kept, so it is read again.
    expect((await app(cache).request(later)).headers.get("X-Cache")).not.toBe(
      "hit",
    )
    // A directory at that block is kept like any other answer.
    const reached = `${gauges}?after=${demoBlock}`
    await app(cache).request(reached)
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect((await app(cache).request(reached)).headers.get("X-Cache")).toBe(
      "hit",
    )
  })

  it("pages activity by category", async () => {
    const response = await app(null).request(
      `/internal/pro/wallets/${demoWallet}/activity?category=claims&limit=1`,
    )
    const page = walletActivityResponseSchema.parse(await response.json())
    expect(page.data.rows.map((row) => row.type)).toEqual(["claim"])
    expect(page.data.nextCursor).not.toBeNull()
    const next = walletActivityResponseSchema.parse(
      await (
        await app(null).request(
          `/internal/pro/wallets/${demoWallet}/activity?category=claims&limit=5&cursor=${page.data.nextCursor}`,
        )
      ).json(),
    )
    expect(next.data.rows).toHaveLength(2)
    expect(next.data.nextCursor).toBeNull()
  })

  it("serves prices, gauges and 404s", async () => {
    const prices = await app(null).request("/internal/pro/prices")
    expect(await prices.json()).toEqual({ data: demoPrices })
    const directory = await app(null).request("/internal/pro/gauges")
    expect(directory.status).toBe(200)
    const missing = await app(null).request(
      "/internal/pro/wallets/0x0000000000000000000000000000000000000001/rewards",
    )
    expect(missing.status).toBe(404)
    const invalid = await app(null).request(
      "/internal/pro/wallets/not-an-address/overview",
    )
    expect(invalid.status).toBe(404)
  })
})
