import { MORPHO_MARKETS } from "@matchbox/chain"
import { scanMetrics } from "@matchbox/contracts/scan"
import { describe, expect, it } from "vitest"
import { fixtureIds } from "../blockscout/fixtures"
import { fixtureScenario, scanFixture } from "./fixtures"
import { degradedAddress } from "./fixtures/entities"
import { fixtureBtc } from "./fixtures/mezo-ids"
import { epochStart, fixtureNow } from "./fixtures/shared"
import { enclavePositionId, gauges, wallet } from "./fixtures/world"
import { type ScanSchemaName, scanSchemas } from "./schemas"

/**
 * Every /internal/scan fixture parses with its route's schema from
 * `@matchbox/contracts/scan`, so fixtures mode cannot drift from the
 * contract the API answers with.
 */

const market = MORPHO_MARKETS.mainnet.btcMusdc
const epoch = epochStart(47)
const today = new Date(fixtureNow * 1000).toISOString().slice(0, 10)

const cases: [string, Record<string, string>, ScanSchemaName][] = [
  [`entities/tx/${fixtureIds.transaction}`, {}, "txDocument"],
  [`entities/tx/0x${"1".repeat(64)}`, {}, "txDocument"],
  [`entities/address/${fixtureIds.address}`, {}, "addressDocument"],
  [`entities/address/${wallet}`, {}, "addressDocument"],
  [`entities/address/${degradedAddress}`, {}, "addressDocument"],
  [`entities/block/${fixtureIds.block}`, {}, "blockDocument"],
  [`entities/block/${fixtureIds.blockHash}`, {}, "blockDocument"],
  ["activity", {}, "activityPage"],
  [`activity/address/${wallet}`, { role: "any" }, "activityPage"],
  [`activity/tx/${fixtureIds.transaction}`, {}, "activityPage"],
  [`activity/gauge/${gauges.kilnLabs}`, {}, "activityPage"],
  ["activity/lock/vemezo/2207", {}, "activityPage"],
  [`activity/epoch/${epoch}`, {}, "activityPage"],
  ["activity/action/BOOST_VOTE", {}, "activityPage"],
  [`owners/${wallet}/locks`, {}, "lockPage"],
  [`owners/${wallet}/votes`, {}, "ownerVotePage"],
  [`owners/${wallet}/votes`, { epoch: String(epoch) }, "ownerVotePage"],
  ["locks", { escrow: "vebtc", order: "amount" }, "lockPage"],
  ["locks", { escrow: "vemezo", order: "unlock" }, "lockPage"],
  ["locks", { escrow: "vebtc", order: "created" }, "lockPage"],
  ["locks/vemezo/2207", {}, "lock"],
  ["locks/vemezo/2207/votes", {}, "votePage"],
  ["gauges", {}, "gauges"],
  [`gauges/${gauges.kilnLabs}`, {}, "gaugeProfile"],
  [`gauges/${gauges.kilnLabs}/voters`, { epoch: String(epoch) }, "votePage"],
  [`gauges/${gauges.kilnLabs}/incentives`, {}, "incentivePage"],
  [`gauges/${gauges.kilnLabs}/epochs`, {}, "gaugeHistory"],
  [`depositors/${wallet}/incentives`, {}, "incentivePage"],
  ["epochs", {}, "epochPage"],
  [`epochs/${epoch}`, {}, "epoch"],
  [`epochs/${epochStart(30)}`, {}, "epoch"],
  [`epochs/${epoch}/gauges`, { source: "BOOST_VOTER" }, "epochGauges"],
  [`epochs/${epoch}/incentives`, {}, "incentivePage"],
  ["search", { kind: "name", q: "kiln" }, "search"],
  ["search", { kind: "address", q: fixtureIds.address }, "search"],
  ["search", { kind: "address-prefix", q: "0x2ba6" }, "search"],
  ["search", { kind: "epoch", q: "47" }, "search"],
  ["search", { kind: "lock", q: "604" }, "search"],
  ["mezo-ids/alice.mezo", {}, "mezoId"],
  ["mezo-ids/kiln.mezo", {}, "mezoId"],
  ["mezo-ids/down.mezo", {}, "mezoId"],
  ["mezo-ids/nobody.mezo", {}, "mezoId"],
  [`mezo-ids/${wallet}`, {}, "mezoId"],
  [`mezo-ids/${fixtureIds.address}`, {}, "mezoId"],
  [`mezo-ids/${fixtureBtc.alice}`, {}, "mezoId"],
  [`mezo-ids/${fixtureBtc.kiln}`, {}, "mezoId"],
  [`mezo-ids/${fixtureBtc.none}`, {}, "mezoId"],
  [`mezo-ids/${fixtureBtc.down}`, {}, "mezoId"],
  ["labels", { address: `${fixtureIds.address},${wallet}` }, "labels"],
  ["prices/btc", { from: "2026-10-01", to: today }, "prices"],
  [
    "series/split",
    { metric: "pool.token_balance", from: "2026-10-01", to: today },
    "seriesSplit",
  ],
  [
    "series/split",
    { metric: "pool.balance", from: "2026-11-07", to: today },
    "seriesSplit",
  ],
  ["markets", { days: "30" }, "dexMarkets"],
  ["borrow/totals", {}, "borrowTotals"],
  ["borrow/markets", {}, "markets"],
  [`borrow/markets/${market}`, {}, "market"],
  [`borrow/markets/${market}/positions`, {}, "positionPage"],
  [`borrow/markets/${market}/events`, {}, "morphoEventPage"],
  [
    `borrow/markets/${market}/positions/${wallet}/events`,
    {},
    "morphoEventPage",
  ],
  [`borrow/owners/${wallet}`, {}, "borrowOwner"],
  [
    `borrow/enclave/positions/${enclavePositionId}/events`,
    {},
    "enclaveEventPage",
  ],
  [`borrow/enclave/borrowers/${wallet}/events`, {}, "enclaveEventPage"],
  ["borrow/troves", {}, "trovePage"],
  [`borrow/troves/${wallet}`, {}, "trove"],
  [`borrow/troves/${wallet}/events`, {}, "troveEventPage"],
  ["borrow/liquidations", {}, "liquidationPage"],
  ["borrow/redemptions", {}, "troveEventPage"],
  ["borrow/stability-pool", {}, "stabilityPool"],
  ["status", {}, "status"],
]

describe("scan fixtures", () => {
  it.each(cases)("%s parses with its contract", (path, query, schema) => {
    const answer = scanFixture(path, new URLSearchParams(query))
    expect(answer.status, path).toBe(200)
    const parsed = scanSchemas[schema].safeParse(answer.body)
    expect(parsed.error?.issues.slice(0, 3) ?? [], path).toEqual([])
  })

  it("answers every registered series", () => {
    for (const [metric, definition] of Object.entries(scanMetrics)) {
      const dimension =
        definition.dimension === "escrow"
          ? "vebtc"
          : definition.dimension === "voter-source"
            ? "BOOST_VOTER"
            : ""
      if (
        definition.dimension === "pool-token" ||
        definition.dimension === "token-destination"
      ) {
        continue
      }
      const answer = scanFixture(
        "series",
        new URLSearchParams({
          metric,
          dimension,
          from: "2026-09-01",
          to: today,
        }),
      )
      expect(answer.status, metric).toBe(200)
      const parsed = scanSchemas.series.safeParse(answer.body)
      expect(parsed.success, metric).toBe(true)
      const points = parsed.data?.data.points ?? []
      expect(points.length, metric).toBeGreaterThan(0)
      if (definition.liveWriter) {
        expect(points.at(-1), metric).toMatchObject({
          day: today,
          partial: true,
        })
      } else {
        expect(parsed.data?.data.endsOn, metric).not.toBeNull()
      }
    }
  })

  it("rejects what the API rejects", () => {
    expect(
      scanFixture(
        "series",
        new URLSearchParams({ metric: "nope", from: today, to: today }),
      ).status,
    ).toBe(400)
    expect(
      scanFixture("activity", new URLSearchParams({ limit: "101" })).status,
    ).toBe(400)
    expect(
      scanFixture("activity", new URLSearchParams({ cursor: "bad!" })).status,
    ).toBe(400)
    expect(
      scanFixture("locks", new URLSearchParams({ escrow: "other" })).status,
    ).toBe(400)
    expect(
      scanFixture("locks/vebtc/999999", new URLSearchParams()).status,
    ).toBe(404)
    expect(
      scanFixture(`epochs/${epochStart(48)}`, new URLSearchParams()).status,
    ).toBe(404)
  })

  it("pages with an opaque cursor", () => {
    const first = scanFixture("activity", new URLSearchParams({ limit: "3" }))
    const body = first.body as { data: unknown[]; nextCursor: string | null }
    expect(body.data).toHaveLength(3)
    expect(body.nextCursor).toMatch(/^[A-Za-z0-9_-]{4,}$/)
    const second = scanFixture(
      "activity",
      new URLSearchParams({ limit: "3", cursor: body.nextCursor ?? "" }),
    )
    expect((second.body as { data: unknown[] }).data[0]).not.toEqual(
      body.data[0],
    )
  })

  it("plays the 503, 429 and still-filling scenarios", () => {
    expect(
      scanFixture("gauges", new URLSearchParams(), "disabled").status,
    ).toBe(503)
    expect(scanFixture("gauges", new URLSearchParams(), "limited").status).toBe(
      429,
    )
    const filling = scanFixture(
      `epochs/${epoch}`,
      new URLSearchParams(),
      "filling",
    )
    expect(filling.body).toMatchObject({
      data: null,
      meta: { computed: false },
    })
    expect(fixtureScenario("disabled")).toBe("disabled")
    expect(fixtureScenario("anything")).toBe("normal")
    expect(fixtureScenario(null)).toBe("normal")
  })
})

describe("fixtures follow the API at 6c1fd83", () => {
  const body = (path: string, query: Record<string, string> = {}) =>
    scanFixture(path, new URLSearchParams(query)).body as Record<
      string,
      unknown
    >

  it("orders unlocks timed first, then permanent, then none", () => {
    const rows = (body("locks", { escrow: "vemezo", order: "unlock" }).data ??
      []) as { unlock_at: number | null; is_permanent: boolean }[]
    const ranks = rows.map((lock) =>
      lock.is_permanent ? 1 : lock.unlock_at === null ? 2 : 0,
    )
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b))
    const timed = rows.filter(
      (lock) => !lock.is_permanent && lock.unlock_at !== null,
    )
    expect(timed.map((lock) => lock.unlock_at)).toEqual(
      timed.map((lock) => lock.unlock_at).sort((a, b) => (a ?? 0) - (b ?? 0)),
    )
  })

  it("says how many rows each list skipped", () => {
    expect(body("activity").meta).toEqual({ skipped: 0 })
    expect(body("locks", { escrow: "vemezo", order: "created" }).meta).toEqual({
      skipped: 1,
    })
  })

  it("marks trove health as a market-price estimate", () => {
    const trove = body(`borrow/troves/${wallet}`).data as {
      health_basis?: { estimate: boolean; source: string }
    }
    expect(trove.health_basis).toMatchObject({
      source: "market",
      estimate: true,
    })
  })

  it("resolves a market series' token and its decimals", () => {
    const series = body("series", {
      metric: "morpho.total_borrow",
      dimension: MORPHO_MARKETS.mainnet.btcMusdc,
      from: "2026-11-01",
      to: today,
    }).data as {
      resolvedDecimals: number | null
      token: { symbol: string } | null
    }
    expect(series.resolvedDecimals).toBe(6)
    expect(series.token?.symbol).toBe("mUSDC")
  })

  it("serves an owner's votes in one read, by lock then newest epoch", () => {
    const answer = body(`owners/${wallet}/votes`, { limit: "100" })
    const rows = answer.data as {
      escrow: string
      token_id: string
      epoch_start: number
      gauge: string
    }[]
    expect(rows.length).toBeGreaterThan(1)
    const order = rows.map(
      (vote) =>
        `${vote.escrow}:${vote.token_id.padStart(12, "0")}:${String(9_999_999_999 - vote.epoch_start).padStart(10, "0")}:${vote.gauge}`,
    )
    const sorted = [...order].sort()
    expect(order).toEqual(sorted)
    const labels = answer.labels as Record<string, unknown>
    for (const name of Object.keys(labels)) {
      expect(rows.some((vote) => vote.gauge === name)).toBe(true)
    }
    expect(answer).toMatchObject({ labelLimit: 50, labelsTruncated: false })
    const one = body(`owners/${wallet}/votes`, { epoch: String(epoch) })
      .data as { epoch_start: number }[]
    expect(one.every((vote) => vote.epoch_start === epoch)).toBe(true)
  })

  it("labels what the address document's parts name, the address first", () => {
    const doc = body(`entities/address/${wallet}`).data as {
      labels: Record<string, unknown>
      labelLimit: number
    }
    expect(Object.keys(doc.labels).length).toBeGreaterThan(0)
    expect(doc.labelLimit).toBe(50)
  })

  it("says how old every live Borrow answer's snapshot is", () => {
    for (const path of [
      "borrow/markets",
      `borrow/markets/${market}`,
      `borrow/markets/${market}/positions`,
      "borrow/troves",
      `borrow/troves/${wallet}`,
      `borrow/owners/${wallet}`,
      "borrow/stability-pool",
    ]) {
      expect(body(path).snapshot, path).toMatchObject({
        stale: false,
        max_behind_blocks: 240,
      })
    }
    for (const path of [
      "borrow/liquidations",
      `borrow/troves/${wallet}/events`,
    ]) {
      expect(body(path).snapshot, path).toBeUndefined()
    }
    const delayed = scanFixture(
      "borrow/troves",
      new URLSearchParams(),
      "delayed",
    )
    expect((delayed.body as { snapshot: unknown }).snapshot).toMatchObject({
      stale: true,
    })
    expect(
      (
        scanFixture("status", new URLSearchParams(), "delayed").body as {
          data: { liveSnapshot: { stale: boolean } }
        }
      ).data.liveSnapshot.stale,
    ).toBe(true)
  })

  it("prices the address document's balances, labelling the $1 assumption", () => {
    const doc = body(`entities/address/${wallet}`).data as {
      tokens: {
        status: string
        data: {
          items: {
            token: { symbol: string }
            value_usd: string
            priced_as: string
          }[]
        }
      }
    }
    expect(doc.tokens.status).toBe("ok")
    expect(
      doc.tokens.data.items.map((item) => [
        item.token.symbol,
        item.priced_as,
        item.value_usd,
      ]),
    ).toEqual([
      ["MUSD", "usd", "1250.00"],
      ["MEZO", "mezo", "3386.06"],
    ])
  })

  it("halts tables only in the delayed scenario", () => {
    expect(body("status").data).toMatchObject({
      halted: false,
      haltedTables: [],
    })
    const delayed = scanFixture("status", new URLSearchParams(), "delayed")
    expect(scanSchemas.status.safeParse(delayed.body).success).toBe(true)
    expect((delayed.body as { data: unknown }).data).toMatchObject({
      halted: true,
      stale: true,
    })
    expect(fixtureScenario("delayed")).toBe("delayed")
  })

  it("answers documents without the database with their own parts disabled", () => {
    const answer = scanFixture(
      `entities/tx/${fixtureIds.transaction}`,
      new URLSearchParams(),
      "disabled",
    )
    expect(answer.status).toBe(200)
    const doc = (answer.body as { data: Record<string, unknown> }).data
    expect(doc.activity).toEqual({ status: "unavailable", reason: "disabled" })
    expect(doc.transaction).toMatchObject({ status: "ok" })
    expect(doc).toMatchObject({
      labelLimit: 50,
      labelsTruncated: false,
      final: false,
    })
    expect(
      scanFixture("gauges", new URLSearchParams(), "disabled").status,
    ).toBe(503)
  })
})
