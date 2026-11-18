import {
  scanAprHistorySchema,
  scanEpochSourcesSchema,
  scanGaugeAprHistorySchema,
  scanGaugeEmissionsSchema,
  scanLockDistributionDocumentSchema,
} from "@matchbox/contracts/scan"
import { describe, expect, it } from "vitest"
import type { z } from "zod"
import { scanFixture } from "./fixtures"
import { epochStart } from "./fixtures/shared"
import { gauges } from "./fixtures/world"

/** The governance fixtures parse with their routes' contract schemas. */

const cases: [string, Record<string, string>, z.ZodType][] = [
  ["epoch-sources", { epochs: "26" }, scanEpochSourcesSchema],
  [
    `epoch-emissions/${epochStart(46)}`,
    { source: "VALIDATORS_VOTER" },
    scanGaugeEmissionsSchema,
  ],
  [
    `gauges/${gauges.kilnLabs}/emissions`,
    { limit: "26" },
    scanGaugeEmissionsSchema,
  ],
  [`gauges/${gauges.kilnLabs}/apr`, { limit: "26" }, scanGaugeAprHistorySchema],
  ["apr", { epochs: "26" }, scanAprHistorySchema],
  [
    "lock-distribution",
    { escrow: "vebtc" },
    scanLockDistributionDocumentSchema,
  ],
  [
    "lock-distribution",
    { escrow: "vemezo" },
    scanLockDistributionDocumentSchema,
  ],
]

describe("governance fixtures", () => {
  for (const [path, query, schema] of cases) {
    it(`${path} ${JSON.stringify(query)} parses`, () => {
      for (const scenario of ["normal", "filling"] as const) {
        const answer = scanFixture(path, new URLSearchParams(query), scenario)
        expect(answer.status).toBe(200)
        const parsed = schema.safeParse(answer.body)
        expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true)
      }
    })
  }

  it("each lock document adds up to the escrow's supply", () => {
    for (const escrow of ["vebtc", "vemezo"]) {
      const body = scanLockDistributionDocumentSchema.parse(
        scanFixture("lock-distribution", new URLSearchParams({ escrow })).body,
      )
      const latest = body.data.latest
      expect(latest?.supply).toBe(latest?.live.amount)
    }
  })

  it("refuses an unknown escrow and an epoch's emissions without a source", () => {
    expect(
      scanFixture("lock-distribution", new URLSearchParams({ escrow: "x" }))
        .status,
    ).toBe(400)
    expect(
      scanFixture(`epoch-emissions/${epochStart(46)}`, new URLSearchParams())
        .status,
    ).toBe(400)
  })
})
