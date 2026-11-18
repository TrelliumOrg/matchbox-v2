import { describe, expect, it } from "vitest"
import {
  scanBorrowTotalsReasonSchema,
  scanBorrowTotalsResponseSchema,
} from "./borrow-totals"

const musd = "0xdd468a1ddc392dcdbef6db6e34e89aa338f9f186"

function answer() {
  return {
    data: {
      unit: { symbol: "MUSD", token: musd, decimals: 18 },
      total: "4055533000000000000000000",
      missing: [],
      enclaves_share: "986306855350455784",
      venues: {
        troves: {
          status: "ok",
          data: {
            basis: "principal_plus_interest",
            debt: "55533000000000000000000",
            principal: "55524000000000000000000",
            interest: "9000000000000000000",
            open: 3,
            block: 13_098_400,
          },
        },
        enclaves: {
          status: "ok",
          data: {
            basis: "principal",
            debt: "4000000000000000000000000",
            open: 1,
            positions: 4,
            latest_block: 13_022_717,
            latest_timestamp: 1_794_000_000,
          },
        },
        markets: {
          status: "ok",
          data: {
            basis: "total_borrow_assets",
            debt: "0",
            included: [
              {
                market_id: `0x${"29".repeat(32)}`,
                loan_token: musd,
                borrowed: "0",
                loan_decimals: 18,
              },
            ],
            excluded: [
              {
                market_id: `0x${"6f".repeat(32)}`,
                loan_token: "0x04671c72aab5ac02a03c1098314b1bb6b560c197",
                borrowed: "62710840000",
                loan_decimals: 6,
                reason: "loan_token",
              },
            ],
          },
        },
      },
      history: {
        status: "ok",
        data: {
          from: "2026-10-11",
          to: "2026-11-09",
          points: [
            {
              day: "2026-11-09",
              total: "4055533000000000000000000",
              troves: "55533000000000000000000",
              enclaves: "4000000000000000000000000",
              markets: "0",
              partial: true,
            },
          ],
        },
      },
    },
    snapshot: {
      block: 13_098_400,
      head: 13_098_465,
      behind_blocks: 65,
      stale: false,
      max_behind_blocks: 240,
    },
  }
}

describe("scanBorrowTotalsResponseSchema", () => {
  it("parses a whole answer", () => {
    expect(scanBorrowTotalsResponseSchema.parse(answer())).toEqual(answer())
  })

  it("parses a venue that did not answer, with no total", () => {
    const body = answer()
    const parsed = scanBorrowTotalsResponseSchema.parse({
      ...body,
      data: {
        ...body.data,
        total: null,
        missing: ["enclaves"],
        enclaves_share: null,
        venues: {
          ...body.data.venues,
          enclaves: { status: "unavailable", reason: "incomplete" },
        },
        history: { status: "unavailable", reason: "upstream" },
      },
    })
    expect(parsed.data.total).toBeNull()
  })

  it("keeps the composed reasons and adds incomplete", () => {
    expect(scanBorrowTotalsReasonSchema.options).toEqual([
      "not_found",
      "rate_limited",
      "upstream",
      "schema",
      "invalid",
      "disabled",
      "incomplete",
    ])
  })

  it("rejects amounts that are not base-unit integers", () => {
    const body = answer()
    for (const total of ["4055533.5", "-1", "4.05e24"]) {
      expect(
        scanBorrowTotalsResponseSchema.safeParse({
          ...body,
          data: { ...body.data, total },
        }).success,
        total,
      ).toBe(false)
    }
  })

  it("names MUSD as the only unit", () => {
    const body = answer()
    expect(
      scanBorrowTotalsResponseSchema.safeParse({
        ...body,
        data: { ...body.data, unit: { ...body.data.unit, symbol: "USD" } },
      }).success,
    ).toBe(false)
  })
})
