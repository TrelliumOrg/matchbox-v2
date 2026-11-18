import { describe, expect, it } from "vitest"
import type { GaugeSummary } from "../../data/view-models"
import { gaugeCalcSearch } from "./gauge-calc"

const wei = (whole: bigint): string => `${whole * 10n ** 18n}`

const gauge = (meta: object, votes: string): GaugeSummary =>
  ({ meta, votes }) as unknown as GaugeSummary

describe("opening the calculator from a gauge", () => {
  it("fills in the gauge's veBTC weight and its votes, working out the boost", () => {
    expect(
      gaugeCalcSearch(
        gauge(
          {
            kind: "vebtc",
            tokenId: "7",
            weight: "3.1047",
            boost: "4.4",
            lock: "auto-max",
          },
          wei(5_880_000n),
        ),
      ),
    ).toEqual({ calc: 1, vebtc: 3.1047, vemezo: 5_880_000, solve: "boost" })
  })

  it("cuts the chain's eighteen decimals to six, so the URL keeps a number", () => {
    expect(
      gaugeCalcSearch(
        gauge(
          {
            kind: "vebtc",
            tokenId: "6033",
            weight: "250.166000859788582573",
            boost: "5",
            lock: "auto-max",
          },
          wei(40_425_652n),
        ),
      ),
    ).toEqual({ calc: 1, vebtc: 250.166, vemezo: 40_425_652, solve: "boost" })
    expect(
      gaugeCalcSearch(
        gauge(
          {
            kind: "vebtc",
            tokenId: "1",
            weight: "0.000000400000000000",
            boost: "1",
            lock: "active",
          },
          wei(1n),
        ),
      ),
    ).toBeNull()
  })

  it("offers nothing for a gauge without a boost", () => {
    expect(gaugeCalcSearch(gauge({ kind: "pool" }, wei(10n)))).toBeNull()
    expect(gaugeCalcSearch(gauge({ kind: "validator" }, wei(10n)))).toBeNull()
  })

  it("offers nothing when the lock has no weight left", () => {
    expect(
      gaugeCalcSearch(
        gauge(
          {
            kind: "vebtc",
            tokenId: "9",
            weight: "0",
            boost: null,
            lock: "expired",
          },
          wei(10n),
        ),
      ),
    ).toBeNull()
  })
})
