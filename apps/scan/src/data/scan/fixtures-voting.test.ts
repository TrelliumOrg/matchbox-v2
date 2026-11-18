import {
  demoGaugeDetails,
  demoKindCards,
} from "@matchbox/contracts/read-models/fixtures"
import { describe, expect, it } from "vitest"
import { scanFixture } from "./fixtures"
import { epochStart, fixtureNow } from "./fixtures/shared"
import { gauges } from "./fixtures/world"
import { type ScanSchemaName, scanSchemas } from "./schemas"

/**
 * The Voting and Locks fixtures beyond the shared cases (fixtures.test.ts):
 * the directory's other gauge kinds, their profiles, rankings for every
 * voter source, the overlapping lock ids and the pool series. Each answer
 * parses with its route's schema from `@matchbox/contracts/scan`.
 */

const epoch = epochStart(47)
const today = new Date(fixtureNow * 1000).toISOString().slice(0, 10)
const pool = demoKindCards.btcMusdCl.gauge.address.toLowerCase()
const validator = demoKindCards.northfieldNodes.gauge.address.toLowerCase()
const btc = "0x7b7c000000000000000000000000000000000000"

const cases: [string, Record<string, string>, ScanSchemaName][] = [
  [`gauges/${pool}`, {}, "gaugeProfile"],
  [`gauges/${validator}`, {}, "gaugeProfile"],
  [`gauges/${gauges.northgate}`, {}, "gaugeProfile"],
  [`gauges/${pool}/epochs`, { limit: "100" }, "gaugeHistory"],
  [`gauges/${pool}/voters`, { limit: "10" }, "votePage"],
  [`epochs/${epoch}/gauges`, { source: "POOLS_VOTER" }, "epochGauges"],
  [`epochs/${epoch}/gauges`, { source: "VALIDATORS_VOTER" }, "epochGauges"],
  [`epochs/${epoch}/gauges`, { source: "THIRD_PARTY_VOTER" }, "epochGauges"],
  ["locks/vemezo/604", {}, "lock"],
  ["locks/vemezo/604/votes", {}, "votePage"],
  ["locks", { escrow: "vemezo", order: "created" }, "lockPage"],
  ["activity/lock/vebtc/604", {}, "activityPage"],
  [
    "series",
    {
      metric: "dex.volume_in",
      dimension: `${demoGaugeDetails.btcMusdCl.pool.toLowerCase()}:${btc}`,
      from: "2026-10-01",
      to: today,
    },
    "series",
  ],
  [
    "series",
    { metric: "escrow.supply", dimension: "vemezo", from: today, to: today },
    "series",
  ],
]

describe("voting fixtures", () => {
  it.each(cases)("%s parses with its contract", (path, query, schema) => {
    const answer = scanFixture(path, new URLSearchParams(query))
    expect(answer.status, path).toBe(200)
    const parsed = scanSchemas[schema].safeParse(answer.body)
    expect(parsed.error?.issues.slice(0, 3) ?? [], path).toEqual([])
  })

  it("lists every gauge kind with its count", () => {
    const parsed = scanSchemas.gauges.parse(
      scanFixture("gauges", new URLSearchParams()).body,
    )
    const kinds = new Set(parsed.data.gauges.map((card) => card.gauge.kind))
    expect([...kinds].sort()).toEqual(["mezo", "pool", "validator", "vebtc"])
    expect(parsed.data.total).toBe(parsed.data.gauges.length)
    expect(parsed.data.kinds.pool).toBe(2)
  })

  it("gives a pool gauge its pool's details", () => {
    const parsed = scanSchemas.gaugeProfile.parse(
      scanFixture(`gauges/${pool}`, new URLSearchParams()).body,
    )
    expect(parsed.data.details?.kind).toBe("pool")
  })

  it("ranks each voter source from 1 and sums to the epoch's weight", () => {
    const doc = scanSchemas.epoch.parse(
      scanFixture(`epochs/${epoch}`, new URLSearchParams()).body,
    )
    const detail = doc.data
    expect(detail).not.toBeNull()
    for (const [source, rows] of Object.entries(detail?.topGauges ?? {})) {
      expect(
        rows.map((row) => row.rank),
        source,
      ).toEqual(rows.map((_, index) => index + 1))
    }
    const pools = detail?.topGauges.POOLS_VOTER ?? []
    const sum = pools.reduce(
      (total, row) => total + BigInt(row.vote_weight),
      0n,
    )
    expect(sum.toString()).toBe(detail?.epoch.vote_weight.POOLS_VOTER)
  })

  it("keeps lock ids per escrow: veBTC #604 and veMEZO #604 differ", () => {
    const vebtc = scanSchemas.lock.parse(
      scanFixture("locks/vebtc/604", new URLSearchParams()).body,
    )
    const vemezo = scanSchemas.lock.parse(
      scanFixture("locks/vemezo/604", new URLSearchParams()).body,
    )
    expect(vebtc.data.escrow).not.toBe(vemezo.data.escrow)
    expect(scanFixture("locks/vemezo/605", new URLSearchParams()).status).toBe(
      404,
    )
  })

  it("plays the still-filling scenario on gauge history and rankings", () => {
    const history = scanSchemas.gaugeHistory.parse(
      scanFixture(
        `gauges/${gauges.kilnLabs}/epochs`,
        new URLSearchParams(),
        "filling",
      ).body,
    )
    expect(history.meta.complete).toBe(false)
    expect(history.data[0]?.complete).toBe(false)
    const ranking = scanSchemas.epochGauges.parse(
      scanFixture(
        `epochs/${epoch}/gauges`,
        new URLSearchParams({ source: "BOOST_VOTER" }),
        "filling",
      ).body,
    )
    expect(ranking.meta.complete).toBe(false)
  })
})
