import { applyD1Migrations } from "cloudflare:test"
import { env } from "cloudflare:workers"
import {
  activityCategory,
  type GaugeCard,
  gaugeConsistencyRankingSchema,
  gaugeDirectoryResponseSchema,
  gaugeProfileResponseSchema,
  proSummaryResponseSchema,
  protocolActivityResponseSchema,
  protocolEpochResponseSchema,
  protocolHistoryResponseSchema,
  protocolResponseSchema,
  walletActivityResponseSchema,
  walletBalancesResponseSchema,
  walletIdentityResponseSchema,
  walletOverviewResponseSchema,
  walletRewardsResponseSchema,
  watchListLimit,
  watchListResponseSchema,
} from "@matchbox/contracts/read-models"
import {
  demoBlock,
  demoGaugeCards,
  demoGaugeDetails,
  demoGaugeDirectory,
  demoGaugeProfile,
  demoGauges,
  demoKindCards,
  demoNow,
  demoPrices,
  demoProtocol,
  demoProtocolEpoch,
  demoProtocolHistory,
  demoSummary,
  demoWallet,
  demoWalletOverview,
  demoWalletRewards,
} from "@matchbox/contracts/read-models/fixtures"
import { errorHandler, notFoundHandler } from "@matchbox/server"
import { Hono } from "hono"
import type { PublicClient } from "viem"
import { beforeEach, describe, expect, it } from "vitest"
import { z } from "zod"
import type { ApiEnv } from "../context"
import { cors } from "../middleware/cors"
import { fulfilledWithin, rejectedWithin } from "../test-timing"
import { silentLogger } from "../testing"
import type { BalanceReader } from "./balances"
import { type GaugeVotesReader, refreshGaugeVotes } from "./gauge-votes"
import {
  ClaimableUnread,
  claimableDeadlineMs,
  createLiveClaimableReader,
  createLockCountReader,
  type LiveClaimableReader,
  type LockCountReader,
} from "./live-claimable"
import { createLiveLocksReader, type LiveLocksReader } from "./live-locks"
import type { LiveLock, LiveWalletReader } from "./live-wallet"
import { subtractUsd, sumUsd, toCents } from "./money"
import { pricesKvKey, readPricesFromKv } from "./publish"
import registerInternalProRoutes, {
  forgetClaimableReads,
  forgetLiveBuilds,
  liveWalletDeadlineMs,
} from "./routes"
import {
  currentKey,
  type ReadModelKind,
  type ReadModelWrite,
  readReadModel,
  writeReadModels,
} from "./store"

const wad = 10n ** 18n

const base = {
  network: "mezo" as const,
  block: demoBlock,
  source: "fixture" as const,
  updatedAt: demoNow,
}

/** 120 gauges: the demo cards repeated under new addresses. */
function manyCards(): GaugeCard[] {
  const templates = demoGaugeDirectory.gauges
  return Array.from({ length: 120 }, (_, index) => {
    const template = templates[index % templates.length]
    if (template === undefined) throw new Error("fixture")
    const address = `0x${index.toString(16).padStart(40, "0")}`
    return {
      ...template,
      gauge: { ...template.gauge, address, name: `Gauge ${index}` },
      votes: String(1_000_000 - index),
    }
  })
}

const documents: ReadModelWrite<ReadModelKind>[] = [
  { ...base, kind: "protocol", key: currentKey, data: demoProtocol },
  { ...base, kind: "gauges", key: currentKey, data: demoGaugeDirectory },
  {
    ...base,
    kind: "protocol-history",
    key: currentKey,
    data: demoProtocolHistory,
  },
  { ...base, kind: "protocol-epoch", key: "47", data: demoProtocolEpoch },
  {
    ...base,
    kind: "protocol-activity",
    key: currentKey,
    data: { rows: demoProtocol.feed.rows },
  },
]

const liveWalletAddress = `0x${"ab".repeat(20)}`
const emptyWallet = `0x${"cd".repeat(20)}`

let liveReads = 0
const liveWallet: LiveWalletReader = async (address) => {
  liveReads += 1
  if (address !== liveWalletAddress) return { block: 13_100_000, locks: [] }
  return {
    block: 13_100_000,
    locks: [
      {
        escrow: "vemezo",
        tokenId: "77",
        amount: 1_000n * wad,
        end: demoNow + 365 * 86_400,
        isPermanent: false,
        votingPower: 900n * wad,
        votes: [
          {
            gauge: demoGaugeCards.kilnLabs.gauge.address,
            voter: "boost",
            weight: 900n * wad,
          },
        ],
        lastVotedAt: demoNow - 60,
        earned: [],
      },
    ],
  }
}

const balances: BalanceReader = async () => ({
  block: 13_100_001,
  btc: (412n * wad) / 10_000n,
  mezo: 12_500n * wad,
  musd: 1_840n * wad,
  others: new Map([
    ["0x04671c72aab5ac02a03c1098314b1bb6b560c197", 25_000_000n],
  ]),
})

function app(
  options: {
    live?: boolean
    balances?: boolean
    claimable?: LiveClaimableReader
    lockCount?: LockCountReader
    locks?: LiveLocksReader
    /** The wallet build for wallets outside the sweep; the fake by default. */
    wallet?: LiveWalletReader
  } = {},
) {
  const hono = new Hono<ApiEnv>()
  hono.use("*", cors())
  hono.onError(errorHandler())
  hono.notFound(notFoundHandler)
  registerInternalProRoutes(hono, {
    readDb: env.READ_DB,
    readPrices: () => readPricesFromKv(env.PRICES),
    cache: null,
    heads: null,
    network: "mezo",
    liveWallet: options.live === false ? null : (options.wallet ?? liveWallet),
    liveClaimable: options.claimable ?? null,
    lockCount: options.lockCount ?? null,
    liveLocks: options.locks ?? null,
    balances: options.balances === false ? null : balances,
    identity: async (address) =>
      address === liveWalletAddress
        ? {
            address,
            status: "found",
            mezoId: "alice.mezo",
            linkedAccounts: [
              { type: "wallet", evmAddress: address, btcAddress: null },
            ],
          }
        : { address, status: "unavailable", mezoId: null, linkedAccounts: [] },
    nowSeconds: () => demoNow,
  })
  return hono
}

beforeEach(async () => {
  await applyD1Migrations(env.READ_DB, env.TEST_MIGRATIONS)
  await env.READ_DB.batch(
    ["read_models", "watch_items", "wallet_requests"].map((table) =>
      env.READ_DB.prepare(`DELETE FROM ${table}`),
    ),
  )
  await env.PRICES.put(pricesKvKey, JSON.stringify(demoPrices))
  await writeReadModels(env.READ_DB, documents)
  liveReads = 0
  // The live caches are per isolate, and every test shares one.
  forgetClaimableReads()
  forgetLiveBuilds()
})

async function json(path: string, init?: RequestInit) {
  const response = await app().request(path, init)
  return { status: response.status, body: await response.json() }
}

describe("gauge directory paging", () => {
  beforeEach(async () => {
    await writeReadModels(env.READ_DB, [
      {
        ...base,
        kind: "gauges",
        key: currentKey,
        data: { ...demoGaugeDirectory, gauges: manyCards(), total: 120 },
      },
    ])
  })

  it("serves 50 gauges a page and walks the cursor to the end", async () => {
    const first = gaugeDirectoryResponseSchema.parse(
      (await json("/internal/pro/gauges")).body,
    )
    expect(first.data.gauges).toHaveLength(50)
    expect(first.data.total).toBe(120)
    expect(first.data.nextCursor).toBe("50")
    expect(first.data.gauges[0]?.gauge.name).toBe("Gauge 0")
    const last = gaugeDirectoryResponseSchema.parse(
      (await json("/internal/pro/gauges?cursor=100")).body,
    )
    expect(last.data.gauges).toHaveLength(20)
    expect(last.data.nextCursor).toBeNull()
  })

  it("filters by voter, search, addresses and funding, and sorts by APY", async () => {
    const pools = gaugeDirectoryResponseSchema.parse(
      (await json("/internal/pro/gauges?voter=pools&limit=5")).body,
    )
    expect(pools.data.total).toBe(0)
    const search = gaugeDirectoryResponseSchema.parse(
      (await json("/internal/pro/gauges?q=gauge%2011")).body,
    )
    expect(search.data.gauges.map((card) => card.gauge.name)).toEqual([
      "Gauge 11",
      "Gauge 110",
      "Gauge 111",
      "Gauge 112",
      "Gauge 113",
      "Gauge 114",
      "Gauge 115",
      "Gauge 116",
      "Gauge 117",
      "Gauge 118",
      "Gauge 119",
    ])
    const picked = gaugeDirectoryResponseSchema.parse(
      (
        await json(
          `/internal/pro/gauges?addresses=0x${"0".repeat(39)}3,0x${"0".repeat(39)}5`,
        )
      ).body,
    )
    expect(picked.data.gauges).toHaveLength(2)
    const byApy = gaugeDirectoryResponseSchema.parse(
      (await json("/internal/pro/gauges?sort=apy&funded=true&limit=100")).body,
    )
    const apys = byApy.data.gauges.map((card) => card.apy)
    expect(apys[0]).toBe("3.30")
    expect(apys.includes(null)).toBe(false)
    expect((await json("/internal/pro/gauges?limit=500")).status).toBe(400)
  })
})

describe("summary and protocol history", () => {
  it("serves the signed-out summary", async () => {
    const summary = proSummaryResponseSchema.parse(
      (await json("/internal/pro/summary")).body,
    )
    // The epoch's incentives and funded count come from the directory's
    // cards, not from the protocol document the indexer's deposits built.
    const cards = demoGaugeDirectory.gauges.filter(
      (card) => card.incentives.tokens.length > 0,
    )
    const usd = sumUsd(cards.map((card) => card.incentives.usd))
    expect(summary.data).toEqual({
      ...demoSummary,
      incentives: {
        usd,
        previousUsd: demoProtocol.incentives.previousUsd,
        changeUsd: subtractUsd(usd, demoProtocol.incentives.previousUsd ?? "0"),
      },
      fundedCount: cards.length,
    })
  })

  it("never lists a gauge holding more than the epoch's total", async () => {
    const [summary, protocol, directory] = await Promise.all([
      json("/internal/pro/summary"),
      json("/internal/pro/protocol"),
      json("/internal/pro/gauges?funded=true&sort=incentives&limit=100"),
    ])
    const total = proSummaryResponseSchema.parse(summary.body).data.incentives
      .usd
    const page = protocolResponseSchema.parse(protocol.body).data
    const cards = gaugeDirectoryResponseSchema.parse(directory.body).data.gauges
    expect(cards.length).toBeGreaterThan(0)
    expect(page.incentives.usd).toBe(total)
    expect(page.incentivesByEpoch.at(-1)?.totalUsd).toBe(total)
    expect(
      sumUsd(page.funded.gauges.map((entry) => entry.incentives.usd)),
    ).toBe(total)
    for (const card of cards) {
      expect(toCents(card.incentives.usd)).toBeLessThanOrEqual(toCents(total))
    }
  })

  it("pages and filters everyone's activity", async () => {
    const all = demoProtocol.feed.rows
    const first = protocolActivityResponseSchema.parse(
      (await json("/internal/pro/protocol/activity?limit=2")).body,
    ).data
    expect(first.rows).toEqual(all.slice(0, 2))
    expect(first.nextCursor).toBe(all[1]?.id)
    const next = protocolActivityResponseSchema.parse(
      (
        await json(
          `/internal/pro/protocol/activity?limit=100&cursor=${first.nextCursor}`,
        )
      ).body,
    ).data
    expect(next.rows).toEqual(all.slice(2))
    expect(next.nextCursor).toBeNull()

    const votes = protocolActivityResponseSchema.parse(
      (await json("/internal/pro/protocol/activity?category=votes")).body,
    ).data
    expect(votes.rows).toEqual(
      all.filter((row) => activityCategory(row.type) === "votes"),
    )
    expect(
      (await json("/internal/pro/protocol/activity?cursor=unknown")).status,
    ).toBe(400)
    expect(
      (await json("/internal/pro/protocol/activity?category=everything"))
        .status,
    ).toBe(400)
  })

  it("serves every epoch and one epoch's detail", async () => {
    const history = protocolHistoryResponseSchema.parse(
      (await json("/internal/pro/protocol/epochs")).body,
    )
    expect(history.data.epochs).toHaveLength(10)
    const epoch = protocolEpochResponseSchema.parse(
      (await json("/internal/pro/protocol/epochs/47")).body,
    )
    expect(epoch.data.epoch.number).toBe(47)
    expect((await json("/internal/pro/protocol/epochs/41")).status).toBe(404)
    expect((await json("/internal/pro/protocol/epochs/nine")).status).toBe(404)
  })
})

describe("wallets outside the sweep", () => {
  it("builds the overview from RPC, stores it and queues the wallet", async () => {
    const overview = walletOverviewResponseSchema.parse(
      (await json(`/internal/pro/wallets/${liveWalletAddress}/overview`)).body,
    )
    expect(overview.meta).toMatchObject({ source: "live", block: 13_100_000 })
    expect(overview.data.locks).toHaveLength(1)
    expect(overview.data.locks[0]?.vote.status).toBe("voted")
    const rewards = walletRewardsResponseSchema.parse(
      (await json(`/internal/pro/wallets/${liveWalletAddress}/rewards`)).body,
    )
    expect(rewards.data.address).toBe(liveWalletAddress)
    const activity = walletActivityResponseSchema.parse(
      (await json(`/internal/pro/wallets/${liveWalletAddress}/activity`)).body,
    )
    expect(activity.data.rows).toEqual([])
    // One RPC build serves all three routes.
    expect(liveReads).toBe(1)
    // Let the background writes land.
    await new Promise((resolve) => setTimeout(resolve, 20))
    const stored = await readReadModel(
      env.READ_DB,
      "mezo",
      "wallet-overview",
      liveWalletAddress,
    )
    expect(stored?.meta.source).toBe("live")
    const queued = await env.READ_DB.prepare(
      "SELECT wallet FROM wallet_requests",
    ).all<{ wallet: string }>()
    expect(queued.results).toEqual([{ wallet: liveWalletAddress }])
  })

  it("renders an empty wallet without writing to D1", async () => {
    const { status, body } = await json(
      `/internal/pro/wallets/${emptyWallet}/overview`,
    )
    expect(status).toBe(200)
    expect(walletOverviewResponseSchema.parse(body).data.locks).toEqual([])
    await new Promise((resolve) => setTimeout(resolve, 20))
    const rows = await env.READ_DB.prepare(
      "SELECT count(*) AS n FROM read_models WHERE doc_key = ?1",
    )
      .bind(emptyWallet)
      .first<{ n: number }>()
    expect(rows?.n).toBe(0)
  })

  it("answers 503 while a slow build runs, and the retry joins it", async () => {
    let builds = 0
    const hono = app({
      wallet: () => {
        builds += 1
        return new Promise(() => undefined)
      },
    })
    // An address no other test builds: builds are kept per isolate.
    const path = `/internal/pro/wallets/0x${"5a".repeat(20)}/overview`
    for (let attempt = 0; attempt < 2; attempt += 1) {
      // Answered at the build's deadline, before a timer 1 s past it.
      const response = await fulfilledWithin(
        Promise.resolve(hono.request(path)),
        liveWalletDeadlineMs + 1_000,
      )
      expect(response.status).toBe(503)
      expect(response.headers.get("Retry-After")).toBe("5")
    }
    // The retry waited on the same build instead of starting another.
    expect(builds).toBe(1)
  }, 20_000)

  it("remembers a failed build, so retries answer at once", async () => {
    let builds = 0
    const hono = app({
      wallet: async () => {
        builds += 1
        throw new ClaimableUnread("throttled")
      },
    })
    const path = `/internal/pro/wallets/0x${"5b".repeat(20)}/overview`
    const first = await hono.request(path)
    expect(first.status).toBe(503)
    const again = await hono.request(path)
    expect(again.status).toBe(503)
    expect(Number(again.headers.get("Retry-After"))).toBeGreaterThan(0)
    expect(builds).toBe(1)
  })

  it("still 404s without a live reader", async () => {
    const response = await app({ live: false }).request(
      `/internal/pro/wallets/${emptyWallet}/overview`,
    )
    expect(response.status).toBe(404)
  })
})

describe("balances", () => {
  it("serves BTC, MEZO and MUSD priced from KV for one block", async () => {
    const response = await app().request(
      `/internal/pro/wallets/${demoWallet}/balances`,
    )
    expect(response.headers.get("Cache-Control")).toContain("max-age=4")
    const body = walletBalancesResponseSchema.parse(await response.json())
    expect(body.meta).toMatchObject({ source: "live", block: 13_100_001 })
    expect(body.data.btc).toMatchObject({ amount: "0.0412", usd: "4355.25" })
    expect(body.data.mezo).toMatchObject({ amount: "12500", usd: "2300.00" })
    expect(body.data.musd).toMatchObject({ amount: "1840", usd: "1840.00" })
  })

  it("is unavailable without a reader", async () => {
    const response = await app({ balances: false }).request(
      `/internal/pro/wallets/${demoWallet}/balances`,
    )
    expect(response.status).toBe(503)
  })
})

describe("watch list", () => {
  const gauge = demoGaugeCards.kilnLabs.gauge.address
  const path = `/internal/pro/wallets/${demoWallet}/watchlist`
  const client = { "X-Matchbox-Client": "browser-1234" }

  it("adds, dedupes and removes items", async () => {
    const empty = watchListResponseSchema.parse((await json(path)).body)
    expect(empty.data.items).toEqual([])
    const added = watchListResponseSchema.parse(
      (await json(`${path}/gauge/${gauge}`, { method: "PUT", headers: client }))
        .body,
    )
    expect(added.data.items).toEqual([
      { kind: "gauge", address: gauge, addedAt: demoNow },
    ])
    await json(`${path}/gauge/${gauge.toUpperCase().replace("0X", "0x")}`, {
      method: "PUT",
      headers: client,
    })
    const again = watchListResponseSchema.parse((await json(path)).body)
    expect(again.data.items).toHaveLength(1)
    const removed = watchListResponseSchema.parse(
      (
        await json(`${path}/gauge/${gauge}`, {
          method: "DELETE",
          headers: client,
        })
      ).body,
    )
    expect(removed.data.items).toEqual([])
  })

  it("needs a client id, a known kind and room in the list", async () => {
    expect(
      (await json(`${path}/gauge/${gauge}`, { method: "PUT" })).status,
    ).toBe(400)
    expect(
      (await json(`${path}/pool/${gauge}`, { method: "PUT", headers: client }))
        .status,
    ).toBe(404)
    await env.READ_DB.batch(
      Array.from({ length: watchListLimit }, (_, index) =>
        env.READ_DB.prepare(
          `INSERT INTO watch_items (network, owner, kind, address, added_at, client_id)
           VALUES ('mezo', ?1, 'wallet', ?2, ?3, 'seed')`,
        ).bind(demoWallet, `0x${index.toString(16).padStart(40, "0")}`, index),
      ),
    )
    const full = await json(`${path}/gauge/${gauge}`, {
      method: "PUT",
      headers: client,
    })
    expect(full.status).toBe(400)
  })

  it("answers preflight for writes with the client header", async () => {
    const response = await app().request(`${path}/gauge/${gauge}`, {
      method: "OPTIONS",
      headers: { Origin: "https://pro.matchbox.markets" },
    })
    expect(response.status).toBe(204)
    expect(response.headers.get("Access-Control-Allow-Methods")).toContain(
      "PUT",
    )
    expect(response.headers.get("Access-Control-Allow-Headers")).toContain(
      "X-Matchbox-Client",
    )
  })
})

describe("gauge kinds, metadata, history and consistency", () => {
  const kindCards = Object.values(demoKindCards)

  beforeEach(async () => {
    await writeReadModels(env.READ_DB, [
      {
        ...base,
        kind: "gauges",
        key: currentKey,
        data: {
          ...demoGaugeDirectory,
          gauges: [...demoGaugeDirectory.gauges, ...kindCards],
          total: demoGaugeDirectory.gauges.length + kindCards.length,
        },
      },
      {
        ...base,
        kind: "gauge-profile",
        key: demoGaugeProfile.card.gauge.address,
        data: { ...demoGaugeProfile, history: [] },
      },
      {
        ...base,
        kind: "gauge-history",
        key: demoGaugeProfile.card.gauge.address,
        data: {
          address: demoGaugeProfile.card.gauge.address,
          votesUnit: "veMEZO",
          epochs: demoGaugeProfile.history ?? [],
        },
      },
      {
        ...base,
        kind: "gauge-funding",
        key: currentKey,
        data: {
          window: 8,
          throughEpoch: 46,
          gauges: {
            [demoGauges.kilnLabs.address]: { recent: 8, total: 9, streak: 9 },
            [demoGauges.btcMusdCl.address]: {
              recent: 8,
              total: 12,
              streak: 12,
            },
            [demoGauges.northfieldNodes.address]: {
              recent: 5,
              total: 5,
              streak: 1,
            },
          },
        },
      },
    ])
  })

  it("filters by kind and counts every kind for tabs", async () => {
    const mezo = gaugeDirectoryResponseSchema.parse(
      (await json("/internal/pro/gauges?kind=mezo")).body,
    )
    expect(mezo.data.gauges.map((card) => card.gauge.name)).toEqual([
      "Aerodrome MEZO/MUSD CL200",
    ])
    expect(mezo.data.gauges[0]?.meta).toEqual({
      kind: "mezo",
      chain: "Base",
      protocol: "Aerodrome",
    })
    expect(mezo.data.kinds).toEqual({
      vebtc: 8,
      validator: 1,
      pool: 2,
      mezo: 1,
    })
    const pools = gaugeDirectoryResponseSchema.parse(
      (await json("/internal/pro/gauges?kind=pool")).body,
    )
    expect(pools.data.gauges.map((card) => card.meta?.kind)).toEqual([
      "pool",
      "pool",
    ])
    expect((await json("/internal/pro/gauges?kind=thirdParty")).status).toBe(
      400,
    )
    // No consistency figure on cards.
    expect(Object.keys(pools.data.gauges[0] ?? {})).not.toContain("funding")
  })

  it("serves the full metadata and every epoch on the profile", async () => {
    const profile = gaugeProfileResponseSchema.parse(
      (
        await json(
          `/internal/pro/gauges/${demoGaugeProfile.card.gauge.address}`,
        )
      ).body,
    )
    expect(profile.data.details).toEqual(demoGaugeDetails.kilnLabs)
    expect(profile.data.history?.map((entry) => entry.epoch.number)).toEqual([
      46, 47,
    ])
  })

  it("ranks gauges by how consistently they are funded", async () => {
    const ranking = gaugeConsistencyRankingSchema.parse(
      z
        .object({ data: z.unknown() })
        .parse((await json("/internal/pro/gauges/consistency")).body).data,
    )
    expect(ranking.gauges.map((entry) => entry.gauge.name)).toEqual([
      "BTC/MUSD",
      "Kiln Labs",
      "Northfield Nodes",
    ])
    const validators = gaugeConsistencyRankingSchema.parse(
      z
        .object({ data: z.unknown() })
        .parse(
          (
            await json(
              "/internal/pro/gauges/consistency?kind=validator&limit=5",
            )
          ).body,
        ).data,
    )
    expect(validators.gauges).toHaveLength(1)
    expect(validators.gauges[0]?.recent).toBe(5)
  })
})

describe("wallet identity", () => {
  it("serves the Mezo ID and stays up when Mezo's API is not", async () => {
    const found = walletIdentityResponseSchema.parse(
      (await json(`/internal/pro/wallets/${liveWalletAddress}/identity`)).body,
    )
    expect(found.data.mezoId).toBe("alice.mezo")
    const down = await json(`/internal/pro/wallets/${emptyWallet}/identity`)
    expect(down.status).toBe(200)
    expect(walletIdentityResponseSchema.parse(down.body).data.status).toBe(
      "unavailable",
    )
  })
})

describe("claimable read live over a stored wallet", () => {
  beforeEach(async () => {
    await writeReadModels(env.READ_DB, [
      {
        ...base,
        kind: "wallet-overview",
        key: demoWallet,
        data: demoWalletOverview,
      },
      {
        ...base,
        kind: "wallet-rewards",
        key: demoWallet,
        data: demoWalletRewards,
      },
    ])
  })

  const path = (kind: "overview" | "rewards") =>
    `/internal/pro/wallets/${demoWallet}/${kind}`
  async function both(hono: ReturnType<typeof app>) {
    const read = async (kind: "overview" | "rewards"): Promise<unknown> =>
      (await hono.request(path(kind))).json()
    const [overview, rewards] = await Promise.all([
      read("overview"),
      read("rewards"),
    ])
    return {
      overview: walletOverviewResponseSchema.parse(overview).data,
      rewards: walletRewardsResponseSchema.parse(rewards).data,
    }
  }

  it("serves the live figure in both documents from one read", async () => {
    let reads = 0
    const claimable: LiveClaimableReader = async () => {
      reads += 1
      return {
        block: 13_180_426,
        partial: false,
        // Lock #2207 has 1,000 MEZO on Kiln Labs that the stored document
        // (47.30 MEZO) does not know about.
        locks: [
          {
            escrow: "vemezo",
            tokenId: "2207",
            amount: 0n,
            end: 0,
            isPermanent: false,
            votingPower: 0n,
            votes: [
              {
                gauge: demoGaugeCards.kilnLabs.gauge.address,
                voter: "boost",
                weight: 1n,
              },
            ],
            lastVotedAt: 0,
            earned: [
              {
                gauge: demoGaugeCards.kilnLabs.gauge.address,
                token: "0x7b7c000000000000000000000000000000000001",
                amount: 1_000n * wad,
              },
            ],
          },
        ],
      }
    }
    const { overview, rewards } = await both(app({ claimable }))
    expect(reads).toBe(1)
    expect(overview.claimableAsOf).toEqual({
      block: 13_180_426,
      source: "live",
      partial: false,
    })
    expect(rewards.claimableAsOf).toEqual(overview.claimableAsOf)
    const lock = overview.locks.find((each) => each.tokenId === "2207")
    expect(lock?.claimable.tokens.map((token) => token.amount)).toEqual([
      "1000",
    ])
    // The veBTC lock was not in the read: its stored figure stays.
    const other = overview.locks.find((each) => each.tokenId === "4120")
    expect(other?.claimable).toEqual(
      demoWalletOverview.locks.find((each) => each.tokenId === "4120")
        ?.claimable,
    )
    // Rewards and Overview agree to the token.
    expect(rewards.readyToClaim.tokens).toEqual(overview.claimable.tokens)
  })

  it("serves the stored figure, marked as stored, when the read fails", async () => {
    const stored = await both(app())
    forgetClaimableReads()
    const failing: LiveClaimableReader = async () => {
      throw new ClaimableUnread("The chain did not answer in time")
    }
    const { overview, rewards } = await both(app({ claimable: failing }))
    expect(overview.claimableAsOf).toMatchObject({ source: "stored" })
    expect(overview.claimableAsOf?.block).toBeGreaterThan(0)
    // Never zero: exactly what was stored.
    expect(overview.claimable).toEqual(stored.overview.claimable)
    expect(overview.claimable.tokens.length).toBeGreaterThan(0)
    expect(overview.locks.map((lock) => lock.claimable)).toEqual(
      stored.overview.locks.map((lock) => lock.claimable),
    )
    expect(rewards.readyToClaim).toEqual(stored.rewards.readyToClaim)
    expect(rewards.byLock).toEqual(stored.rewards.byLock)
  })

  it("without a reader, says the figures are the stored ones", async () => {
    const { overview } = await both(app())
    expect(overview.claimableAsOf).toMatchObject({
      source: "stored",
      partial: false,
    })
  })

  describe("a stored document that names no locks", () => {
    // 0x7277…e419 on 12 Nov 2026: stored before the replay with no locks,
    // while the chain had one. Rewards read "As of block 13,105,327".
    const lockless = {
      ...demoWalletOverview,
      locks: [],
      address: liveWalletAddress,
    }
    beforeEach(async () => {
      await writeReadModels(env.READ_DB, [
        {
          ...base,
          kind: "wallet-overview",
          key: liveWalletAddress,
          data: lockless,
        },
        {
          ...base,
          kind: "wallet-rewards",
          key: liveWalletAddress,
          data: {
            ...demoWalletRewards,
            address: liveWalletAddress,
            byLock: [],
          },
        },
      ])
    })
    const read = async (hono: ReturnType<typeof app>) =>
      walletOverviewResponseSchema.parse(
        await (
          await hono.request(
            `/internal/pro/wallets/${liveWalletAddress}/overview`,
          )
        ).json(),
      )

    it("is a live answer when the chain has none either: no note", async () => {
      let asked = 0
      const lockCount: LockCountReader = async () => {
        asked += 1
        return { locks: 0, block: 13_181_500 }
      }
      const hono = app({ lockCount })
      const first = await read(hono)
      expect(first.data.claimableAsOf).toEqual({
        block: 13_181_500,
        source: "live",
        partial: false,
      })
      expect(first.data.locks).toEqual([])
      // The answer is kept for the minute: a second view asks nothing.
      await read(hono)
      expect(asked).toBe(1)
      expect(liveReads).toBe(0)
    })

    it("serves the live wallet when the chain has locks the document lacks", async () => {
      const lockCount: LockCountReader = async () => ({
        locks: 1,
        block: 13_181_500,
      })
      const overview = await read(app({ lockCount }))
      // The lock the stored document did not have.
      expect(overview.data.locks.map((lock) => lock.tokenId)).toEqual(["77"])
      expect(overview.meta.source).toBe("live")
      expect(overview.data.claimableAsOf).toMatchObject({ source: "live" })
    })

    it("keeps the stored document, with its note, when the count cannot be read", async () => {
      const lockCount: LockCountReader = async () => {
        throw new ClaimableUnread("The lock count")
      }
      const overview = await read(app({ lockCount }))
      expect(overview.data.locks).toEqual([])
      expect(overview.data.claimableAsOf).toMatchObject({ source: "stored" })
    })
  })
})

describe("locks read live over a stored wallet", () => {
  beforeEach(async () => {
    await writeReadModels(env.READ_DB, [
      {
        ...base,
        kind: "wallet-overview",
        key: demoWallet,
        data: demoWalletOverview,
      },
      {
        ...base,
        kind: "wallet-rewards",
        key: demoWallet,
        data: demoWalletRewards,
      },
    ])
  })

  const path = (kind: "overview" | "rewards", query = "") =>
    `/internal/pro/wallets/${demoWallet}/${kind}${query}`
  describe("a chain that never answers", () => {
    /** An RPC client whose requests never come back. */
    const hung = {
      multicall: () => new Promise(() => undefined),
    } as unknown as PublicClient

    it("serves the stored locks and claimable within the deadline", async () => {
      // Each read's time left when it was asked: the bound, checked on
      // the deadline the route gave, not on the machine's speed.
      const left: number[] = []
      const locks = createLiveLocksReader(hung)
      const claimable = createLiveClaimableReader(hung)
      const hono = app({
        locks: (address, deadline, expected) => {
          left.push(deadline - Date.now())
          return locks(address, deadline, expected)
        },
        claimable: (overview, deadline) => {
          left.push(deadline - Date.now())
          return claimable(overview, deadline)
        },
      })
      // A guard against a hang only.
      const response = await fulfilledWithin(
        Promise.resolve(
          hono.request(`/internal/pro/wallets/${demoWallet}/overview`),
        ),
        10_000,
      )
      expect(response.status).toBe(200)
      expect(left.length).toBeGreaterThan(0)
      for (const ms of left) {
        expect(ms).toBeLessThanOrEqual(claimableDeadlineMs + 50)
      }
      const overview = walletOverviewResponseSchema.parse(await response.json())
      expect(overview.data.locksAsOf?.source).toBe("stored")
      expect(overview.data.claimableAsOf?.source).toBe("stored")
      expect(overview.data.locks).toHaveLength(demoWalletOverview.locks.length)
    })

    it("keeps a stored wallet with no locks when the lock count never comes", async () => {
      // Given up at the deadline, before a timer 1 s past it.
      expect(
        await rejectedWithin(
          createLockCountReader(hung)(demoWallet),
          claimableDeadlineMs + 1_000,
        ),
      ).toBeInstanceOf(ClaimableUnread)
    })
  })

  async function overviewOf(hono: ReturnType<typeof app>, query = "") {
    const response = await hono.request(path("overview", query))
    return {
      cacheControl: response.headers.get("Cache-Control"),
      ...walletOverviewResponseSchema.parse(await response.json()),
    }
  }

  /** A stored lock as the chain has it, unchanged. */
  function held(tokenId: string): LiveLock {
    const lock = demoWalletOverview.locks.find(
      (each) => each.tokenId === tokenId,
    )
    if (lock === undefined) throw new Error("fixture")
    return {
      escrow: lock.escrow,
      tokenId,
      amount: wad,
      end: lock.unlocksAt ?? 0,
      isPermanent: lock.isPermanent,
      votingPower: wad,
      votes: [],
      lastVotedAt: 0,
      lastVoted: [],
      earned: [],
    }
  }
  /** The veBTC lock the wallet just created. */
  const created: LiveLock = {
    escrow: "vebtc",
    tokenId: "6179",
    amount: 10n ** 13n,
    end: 0,
    isPermanent: true,
    votingPower: 10n ** 13n,
    votes: [],
    lastVotedAt: 0,
    lastVoted: [],
    earned: [],
  }
  const before = [held("4120"), held("2207")]
  const tokenIds = (locks: readonly { tokenId: string }[]) =>
    locks.map((lock) => lock.tokenId)
  /** Wallets waiting for the next warehouse run. */
  async function queued(): Promise<string[]> {
    const { results } = await env.READ_DB.prepare(
      "SELECT wallet FROM wallet_requests",
    ).all<{ wallet: string }>()
    return results.map((row) => row.wallet)
  }

  /** A chain whose head and locks a test moves. */
  function chain(start: { block: number; locks: LiveLock[] }) {
    const state = { ...start, reads: 0, down: false }
    const locks: LiveLocksReader = async () => {
      state.reads += 1
      if (state.down) throw new ClaimableUnread("The chain did not answer")
      return { block: state.block, locks: state.locks, capped: [] }
    }
    // Claimable from the same chain: nothing new to claim.
    const claimable: LiveClaimableReader = async () => {
      if (state.down) throw new ClaimableUnread("The chain did not answer")
      return { block: state.block, partial: false, locks: [] }
    }
    return { state, locks, claimable }
  }

  it("lists a lock the chain has before the warehouse does, history kept", async () => {
    const { locks } = chain({ block: 13_203_206, locks: [...before, created] })
    const hono = app({ locks })
    const overview = await overviewOf(hono)
    expect(tokenIds(overview.data.locks)).toEqual(["4120", "2207", "6179"])
    expect(overview.data.locksAsOf).toEqual({
      block: 13_203_206,
      source: "live",
      partial: false,
    })
    const lock = overview.data.locks.find((each) => each.tokenId === "6179")
    expect(lock?.locked.amount).toBe("0.00001")
    expect(lock?.isPermanent).toBe(true)
    // What the chain cannot say stays the stored document's.
    expect(overview.data.recentActivity).toEqual(
      demoWalletOverview.recentActivity,
    )
    expect(overview.data.locks[0]?.createdAt).toBe(
      demoWalletOverview.locks[0]?.createdAt,
    )
    const rewards = walletRewardsResponseSchema.parse(
      await (await hono.request(path("rewards"))).json(),
    )
    expect(rewards.data.history).toEqual(demoWalletRewards.history)
    expect(rewards.data.earned).toEqual(demoWalletRewards.earned)
    // Nothing was written over the warehouse document.
    const stored = await readReadModel(
      env.READ_DB,
      "mezo",
      "wallet-overview",
      demoWallet,
    )
    expect(tokenIds(stored?.data.locks ?? [])).toEqual(["4120", "2207"])
    expect(stored?.meta.source).toBe("fixture")
    // The wallet is queued, so the next warehouse run rebuilds it first.
    expect(await queued()).toEqual([demoWallet])
  })

  it("queues nothing while the stored locks are the chain's", async () => {
    const { locks } = chain({ block: 13_203_206, locks: before })
    await overviewOf(app({ locks }))
    expect(await queued()).toEqual([])
  })

  it("stops listing a lock the wallet no longer owns", async () => {
    const { locks } = chain({ block: 13_203_206, locks: [held("2207")] })
    const hono = app({ locks })
    const overview = await overviewOf(hono)
    expect(tokenIds(overview.data.locks)).toEqual(["2207"])
    const rewards = walletRewardsResponseSchema.parse(
      await (await hono.request(path("rewards"))).json(),
    )
    expect(rewards.data.byLock.map((entry) => entry.lock.tokenId)).toEqual(
      demoWalletRewards.byLock
        .map((entry) => entry.lock.tokenId)
        .filter((tokenId) => tokenId !== "4120"),
    )
  })

  it("serves the stored locks, said to be stored, when the chain does not answer", async () => {
    const { state, locks } = chain({ block: 13_203_206, locks: [] })
    state.down = true
    const overview = await overviewOf(app({ locks }))
    // Never dropped on a failed read.
    expect(overview.data.locks).toEqual(demoWalletOverview.locks)
    expect(overview.data.locksAsOf).toEqual({
      block: demoBlock,
      source: "stored",
      partial: false,
    })
  })

  it("asks the chain for the claimable of a lock the document did not name", async () => {
    const asked: string[][] = []
    const claimable: LiveClaimableReader = async (overview) => {
      asked.push(overview.locks.map((lock) => lock.tokenId))
      return { block: 13_203_206, partial: false, locks: [] }
    }
    const { locks } = chain({ block: 13_203_206, locks: [...before, created] })
    const overview = await overviewOf(app({ locks, claimable }))
    // The stored locks, then the one the chain added.
    expect(asked).toEqual([["4120", "2207"], ["6179"]])
    expect(overview.data.claimableAsOf).toEqual({
      block: 13_203_206,
      source: "live",
      partial: false,
    })
  })

  describe("after a transaction (?after=block)", () => {
    it("reads again past the memo, and only then", async () => {
      const { state, locks, claimable } = chain({
        block: 13_203_200,
        locks: before,
      })
      const hono = app({ locks, claimable })
      await overviewOf(hono)
      // The lock is mined in block 13,203,206.
      state.block = 13_203_207
      state.locks = [...before, created]
      // A view that names no block is still answered from the memo.
      expect(tokenIds((await overviewOf(hono)).data.locks)).toEqual([
        "4120",
        "2207",
      ])
      expect(state.reads).toBe(1)
      const fresh = await overviewOf(hono, "?after=13203206")
      expect(tokenIds(fresh.data.locks)).toEqual(["4120", "2207", "6179"])
      expect(fresh.data.locksAsOf?.block).toBe(13_203_207)
      expect(fresh.cacheControl).toContain("max-age")
      // Rewards, asked for with it, shares that read.
      await hono.request(path("rewards", "?after=13203206"))
      expect(state.reads).toBe(2)
      // And every later view has it.
      expect(tokenIds((await overviewOf(hono)).data.locks)).toContain("6179")
      expect(state.reads).toBe(2)
    })

    it("does not keep an answer that is behind the transaction", async () => {
      // The RPC node is a block behind the one the transaction is in.
      const { state, locks, claimable } = chain({
        block: 13_203_205,
        locks: before,
      })
      const hono = app({ locks, claimable })
      const behind = await overviewOf(hono, "?after=13203206")
      expect(behind.cacheControl).toBe("no-store")
      expect(behind.data.locksAsOf).toMatchObject({
        block: 13_203_205,
        source: "live",
      })
      state.block = 13_203_207
      state.locks = [...before, created]
      const caught = await overviewOf(hono, "?after=13203206")
      expect(state.reads).toBe(2)
      expect(tokenIds(caught.data.locks)).toContain("6179")
      expect(caught.cacheControl).toContain("max-age")
    })

    it("does not keep the stored answer when the chain is down", async () => {
      const { state, locks, claimable } = chain({
        block: 13_203_207,
        locks: before,
      })
      state.down = true
      const overview = await overviewOf(
        app({ locks, claimable }),
        "?after=13203206",
      )
      expect(overview.cacheControl).toBe("no-store")
      expect(overview.data.locksAsOf?.source).toBe("stored")
    })

    it("ignores a malformed block", async () => {
      const { state, locks } = chain({ block: 13_203_200, locks: before })
      const hono = app({ locks })
      await overviewOf(hono)
      const overview = await overviewOf(hono, "?after=latest")
      expect(state.reads).toBe(1)
      expect(overview.cacheControl).toContain("max-age")
    })
  })
})

describe("gauge votes kept as the chain has them", () => {
  const kiln = demoGaugeCards.kilnLabs
  const stored = new Map(
    demoGaugeDirectory.gauges.map((card) => [
      card.gauge.address,
      BigInt(card.votes) * wad,
    ]),
  )

  beforeEach(async () => {
    await writeReadModels(env.READ_DB, [
      {
        ...base,
        kind: "gauge-profile",
        key: kiln.gauge.address,
        data: demoGaugeProfile,
      },
    ])
  })

  function refresh(votes: GaugeVotesReader) {
    return refreshGaugeVotes({
      network: "mezo",
      readDb: env.READ_DB,
      market: null,
      votes,
      boosts: async () => new Map([[kiln.gauge.vebtcTokenId ?? "", 5n * wad]]),
      now: () => new Date((demoNow + 60) * 1000),
      logger: silentLogger,
    })
  }
  const voted = (block: number, votes: bigint): GaugeVotesReader => {
    return async () => ({
      block,
      weights: new Map([...stored, [kiln.gauge.address, votes]]),
      boostTotal: null,
    })
  }
  const directory = () =>
    readReadModel(env.READ_DB, "mezo", "gauges", currentKey)

  it("writes nothing in a minute without a vote", async () => {
    const before = await directory()
    const result = await refresh(
      voted(demoBlock + 10, BigInt(kiln.votes) * wad),
    )
    expect(result).toMatchObject({ status: "unchanged", rows: 0 })
    expect(await directory()).toEqual(before)
  })

  it("writes the voted gauge into the directory and its profile", async () => {
    const result = await refresh(voted(demoBlock + 10, 11_760_000n * wad))
    expect(result).toMatchObject({ status: "written", changed: 1, rows: 2 })
    const after = await directory()
    // The document now says which block its votes are from.
    expect(after?.meta.block).toBe(demoBlock + 10)
    const card = after?.data.gauges.find(
      (each) => each.gauge.address === kiln.gauge.address,
    )
    expect(card).toMatchObject({ votes: "11760000", apy: "1.28", boost: "5" })
    const profile = await readReadModel(
      env.READ_DB,
      "mezo",
      "gauge-profile",
      kiln.gauge.address,
    )
    expect(profile?.data.card).toEqual(card)
    // The route serves it.
    const served = gaugeDirectoryResponseSchema.parse(
      (await json(`/internal/pro/gauges?addresses=${kiln.gauge.address}`)).body,
    )
    expect(served.data.gauges[0]?.votes).toBe("11760000")
    expect(served.meta.block).toBe(demoBlock + 10)
    // The next minute finds nothing to do.
    expect(
      await refresh(voted(demoBlock + 26, 11_760_000n * wad)),
    ).toMatchObject({ status: "unchanged", rows: 0 })
  })

  it("does not write over a directory published while it was reading", async () => {
    const published = {
      ...demoGaugeDirectory,
      totalVotes: "282900001",
    }
    const result = await refresh(async () => {
      await writeReadModels(env.READ_DB, [
        { ...base, kind: "gauges", key: currentKey, data: published },
      ])
      return {
        block: demoBlock + 10,
        weights: new Map([...stored, [kiln.gauge.address, 1n * wad]]),
        boostTotal: null,
      }
    })
    expect(result.status).toBe("superseded")
    expect((await directory())?.data.totalVotes).toBe("282900001")
  })

  it("leaves the directory alone when the RPC is behind it", async () => {
    const result = await refresh(voted(demoBlock - 1, 1n * wad))
    expect(result.status).toBe("behind")
  })

  describe("a directory asked for after a vote (?after=block)", () => {
    const cacheControl = async (query: string) =>
      (await app().request(`/internal/pro/gauges${query}`)).headers.get(
        "Cache-Control",
      )

    it("is not kept while it is older than the vote", async () => {
      expect(await cacheControl(`?after=${demoBlock + 5}`)).toBe("no-store")
      // Unchanged for everyone who names no block.
      expect(await cacheControl("")).toContain("max-age=30")
    })

    it("is kept once the refresh has passed the vote", async () => {
      await refresh(voted(demoBlock + 10, 11_760_000n * wad))
      expect(await cacheControl(`?after=${demoBlock + 5}`)).toContain(
        "max-age=30",
      )
    })
  })
})
