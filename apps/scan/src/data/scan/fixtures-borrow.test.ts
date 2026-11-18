import { MORPHO_MARKETS } from "@matchbox/chain"
import { describe, expect, it } from "vitest"
import { scanFixture } from "./fixtures"
import { marketList, morphoPositions, troves } from "./fixtures/borrow"
import { fixtureNow } from "./fixtures/shared"
import {
  enclavePositionId,
  markets,
  otherVoter,
  wallet,
} from "./fixtures/world"
import { type ScanSchemaName, scanSchemas } from "./schemas"

/**
 * The /internal/scan/borrow answers the Borrow pages read, with the
 * queries they send, parse with their route contracts; and the figures
 * the fixtures compute agree with themselves as the API's would.
 */

const musdc = MORPHO_MARKETS.mainnet.btcMusdc
const musd = MORPHO_MARKETS.mainnet.btcMusd
const today = new Date(fixtureNow * 1000).toISOString().slice(0, 10)
const wad = 10n ** 18n

const cases: [string, Record<string, string>, ScanSchemaName][] = [
  ["borrow/markets", {}, "markets"],
  [`borrow/markets/${musd}`, {}, "market"],
  [`borrow/markets/${musdc}/positions`, { limit: "100" }, "positionPage"],
  [`borrow/markets/${musd}/positions`, { limit: "100" }, "positionPage"],
  [`borrow/markets/${musd}/events`, {}, "morphoEventPage"],
  [
    `borrow/markets/${musdc}/positions/${wallet}/events`,
    { limit: "50" },
    "morphoEventPage",
  ],
  [`borrow/owners/${otherVoter}`, {}, "borrowOwner"],
  [`borrow/owners/0x${"0".repeat(40)}`, {}, "borrowOwner"],
  [
    `borrow/enclave/positions/${enclavePositionId}/events`,
    { limit: "100" },
    "enclaveEventPage",
  ],
  ["borrow/enclave/positions/12/events", {}, "enclaveEventPage"],
  ["borrow/enclave/positions", { limit: "100" }, "enclavePositionPage"],
  ["borrow/enclave/locks/604", {}, "enclaveLock"],
  ["borrow/enclave/locks/1", {}, "enclaveLock"],
  ["borrow/totals", {}, "borrowTotals"],
  ["borrow/troves", { limit: "100" }, "trovePage"],
  ["borrow/troves", { limit: "25" }, "trovePage"],
  [`borrow/troves/${otherVoter}`, {}, "trove"],
  [`borrow/troves/${wallet}/events`, { limit: "50" }, "troveEventPage"],
  ["borrow/liquidations", { limit: "100" }, "liquidationPage"],
  ["borrow/redemptions", { limit: "10" }, "troveEventPage"],
  ["locks/vebtc/604", {}, "lock"],
  [
    "series",
    {
      dimension: musdc,
      from: "2026-10-11",
      metric: "morpho.total_borrow",
      to: today,
    },
    "series",
  ],
  [
    "series",
    {
      dimension: musd,
      from: "2025-11-09",
      metric: "morpho.total_supply",
      to: today,
    },
    "series",
  ],
]

describe("borrow fixtures", () => {
  it.each(cases)("%s %o parses with its contract", (path, query, schema) => {
    const answer = scanFixture(path, new URLSearchParams(query))
    expect(answer.status, path).toBe(200)
    const parsed = scanSchemas[schema].safeParse(answer.body)
    expect(parsed.error?.issues.slice(0, 3) ?? [], path).toEqual([])
  })

  it("answers 404 for markets and troves that do not exist", () => {
    for (const path of [
      `borrow/markets/0x${"ab".repeat(32)}`,
      `borrow/markets/0x${"ab".repeat(32)}/positions`,
      `borrow/troves/0x${"0".repeat(40)}`,
    ]) {
      expect(scanFixture(path, new URLSearchParams()).status, path).toBe(404)
    }
  })

  it("pages troves with an opaque cursor", () => {
    const first = scanFixture(
      "borrow/troves",
      new URLSearchParams({ limit: "2" }),
    )
    const body = first.body as { data: unknown[]; nextCursor: string | null }
    expect(body.data).toHaveLength(2)
    expect(body.nextCursor).not.toBeNull()
    const second = scanFixture(
      "borrow/troves",
      new URLSearchParams({ limit: "2", cursor: body.nextCursor ?? "" }),
    )
    expect((second.body as { data: unknown[] }).data).toHaveLength(1)
  })

  it("plays the 503 and 429 scenarios on borrow routes", () => {
    expect(
      scanFixture("borrow/markets", new URLSearchParams(), "disabled").status,
    ).toBe(503)
    expect(
      scanFixture(`borrow/troves/${wallet}`, new URLSearchParams(), "limited")
        .status,
    ).toBe(429)
  })

  it("gives the wallet a trove, a Morpho position and an Enclave position", () => {
    const owner = scanFixture(`borrow/owners/${wallet}`, new URLSearchParams())
    const parsed = scanSchemas.borrowOwner.parse(owner.body)
    expect(parsed.data.trove?.owner).toBe(wallet)
    expect(parsed.data.morpho.map((each) => each.market_id)).toEqual([
      musdc,
      markets.discovered,
    ])
    expect(parsed.data.enclave[0]?.position_id).toBe(enclavePositionId)
  })

  it("bands each position by its own health factor", () => {
    for (const position of morphoPositions) {
      if (position.borrow_assets === "0") {
        expect(position.health.band).toBe("no_debt")
        continue
      }
      const factor = BigInt(position.health.health_factor ?? "0")
      const band =
        factor < wad
          ? "liquidatable"
          : factor < (wad * 11n) / 10n
            ? "near_liquidation"
            : "healthy"
      expect(position.health.band).toBe(band)
    }
    for (const trove of troves) {
      expect(trove.health.collateral_ratio).not.toBeNull()
      expect(BigInt(trove.health.ltv ?? "0")).toBeLessThan(wad)
    }
  })

  it("keeps utilization and the oracle price consistent per market", () => {
    for (const market of marketList) {
      const utilization =
        (BigInt(market.total_borrow_assets) * wad) /
        BigInt(market.total_supply_assets)
      expect(market.utilization).toBe(utilization.toString())
      expect(market.oracle_price).not.toBeNull()
    }
  })
})
