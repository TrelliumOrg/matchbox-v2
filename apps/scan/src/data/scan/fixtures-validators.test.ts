import { blocksPageSchema } from "@matchbox/contracts/blockscout"
import {
  gaugeCardSchema,
  validatorGaugeDetailsSchema,
} from "@matchbox/contracts/read-models"
import { demoKindCards } from "@matchbox/contracts/read-models/fixtures"
import { unitsToDecimal } from "@matchbox/domain/format"
import { describe, expect, it } from "vitest"
import { blockscoutFixture } from "../blockscout/fixtures"
import { scanFixture } from "./fixtures"
import { epochStart } from "./fixtures/shared"
import {
  matchedProposer,
  unmatchedProposer,
  validatorCards,
  validatorDetails,
} from "./fixtures/validators"
import { scanSchemas } from "./schemas"

/**
 * What the validators pages add to the fixture world (fixtures/validators
 * .ts): two validator gauges, one whose operator proposed a recorded block
 * and one that left the set. Each parses with its contract, and the
 * recorded blocks page's proposers are the ones the fixtures say.
 */

const epoch = epochStart(47)
const harbor = validatorCards.harborStake.gauge.address
const tallow = validatorCards.tallow.gauge.address

describe("validators fixtures", () => {
  it("parses the added cards and details with their contracts", () => {
    for (const card of Object.values(validatorCards)) {
      const parsed = gaugeCardSchema.safeParse(card)
      expect(parsed.error?.issues.slice(0, 3) ?? []).toEqual([])
    }
    for (const details of Object.values(validatorDetails)) {
      const parsed = validatorGaugeDetailsSchema.safeParse(details)
      expect(parsed.error?.issues.slice(0, 3) ?? []).toEqual([])
    }
  })

  it("lists both in the directory, with their profiles", () => {
    const directory = scanSchemas.gauges.parse(
      scanFixture("gauges", new URLSearchParams()).body,
    )
    const addresses = directory.data.gauges.map((card) => card.gauge.address)
    expect(addresses).toContain(harbor)
    expect(addresses).toContain(tallow)
    expect(directory.data.kinds.validator).toBe(3)
    for (const gauge of [harbor, tallow]) {
      const profile = scanSchemas.gaugeProfile.parse(
        scanFixture(`gauges/${gauge}`, new URLSearchParams()).body,
      )
      expect(profile.data.details?.kind).toBe("validator")
    }
  })

  it("ranks Harbor Stake with the validators, summing to the epoch", () => {
    const ranking = scanSchemas.gaugeRanking.parse(
      scanFixture(
        `epochs/${epoch}/gauges`,
        new URLSearchParams({ source: "VALIDATORS_VOTER", limit: "100" }),
      ).body,
    )
    expect(ranking.data.map((row) => row.gauge)).toContain(harbor)
    expect(ranking.data.map((row) => row.rank)).toEqual([1, 2])
    const doc = scanSchemas.epoch.parse(
      scanFixture(`epochs/${epoch}`, new URLSearchParams()).body,
    )
    const sum = ranking.data.reduce(
      (total, row) => total + BigInt(row.vote_weight),
      0n,
    )
    expect(sum.toString()).toBe(doc.data?.epoch.vote_weight.VALIDATORS_VOTER)
  })

  it.each([
    ["Northfield Nodes", demoKindCards.northfieldNodes.gauge.address],
    ["Harbor Stake", harbor],
  ])(
    "gives %s voters and deposits that add up to its aggregates",
    (_, address) => {
      const gauge = address.toLowerCase()
      const history = scanSchemas.gaugeHistory.parse(
        scanFixture(
          `gauges/${gauge}/epochs`,
          new URLSearchParams({ limit: "100" }),
        ).body,
      )
      const deposits = scanSchemas.incentivePage.parse(
        scanFixture(
          `gauges/${gauge}/incentives`,
          new URLSearchParams({ limit: "100" }),
        ).body,
      )
      const profile = scanSchemas.gaugeProfile.parse(
        scanFixture(`gauges/${gauge}`, new URLSearchParams()).body,
      )
      expect(history.data.length).toBeGreaterThan(0)
      for (const row of history.data) {
        const votes = scanSchemas.votePage.parse(
          scanFixture(
            `gauges/${gauge}/voters`,
            new URLSearchParams({
              epoch: String(row.epoch_start),
              limit: "100",
            }),
          ).body,
        )
        const weight = votes.data.reduce(
          (sum, vote) => sum + BigInt(vote.weight),
          0n,
        )
        expect(weight.toString(), String(row.epoch_start)).toBe(row.vote_weight)
        expect(votes.data).toHaveLength(row.voters)
        const posted: Record<string, bigint> = {}
        for (const each of deposits.data) {
          if (each.epoch_start !== row.epoch_start) continue
          posted[each.token] = (posted[each.token] ?? 0n) + BigInt(each.amount)
        }
        expect(
          Object.fromEntries(
            Object.entries(posted).map(([token, amount]) => [
              token,
              amount.toString(),
            ]),
          ),
          String(row.epoch_start),
        ).toEqual(row.incentives)
        const epoch = profile.data.history?.find(
          (each) => each.epoch.start === row.epoch_start,
        )
        expect(epoch?.votes, String(row.epoch_start)).toBe(
          unitsToDecimal(row.vote_weight, 18),
        )
      }
    },
  )

  it.each([
    ["normal", true],
    ["filling", false],
  ] as const)(
    "answers /validators (%s) with its contract",
    (scenario, counted) => {
      const answer = scanFixture("validators", new URLSearchParams(), scenario)
      expect(answer.status).toBe(200)
      const parsed = scanSchemas.validators.safeParse(answer.body)
      expect(parsed.error?.issues.slice(0, 3) ?? []).toEqual([])
      const data = parsed.data?.data
      expect(data?.available).toBe(counted)
      expect(data?.shares_complete).toBe(counted)
      expect(data?.reason === null).toBe(counted)
      for (const row of data?.validators ?? []) {
        expect(row.blocks === null, row.address).toBe(!counted)
        expect(row.blocks_total).not.toBeNull()
      }
      if (counted) {
        const sum = (data?.validators ?? []).reduce(
          (total, row) => total + BigInt(row.blocks ?? "0"),
          0n,
        )
        expect(sum.toString()).toBe(data?.day_total)
      }
    },
  )

  it("matches /validators to the gauge directory's validators", () => {
    const directory = scanSchemas.gauges.parse(
      scanFixture("gauges", new URLSearchParams()).body,
    )
    const validators = scanSchemas.validators.parse(
      scanFixture("validators", new URLSearchParams()).body,
    )
    const pool = directory.data.gauges.flatMap((card) =>
      card.meta?.kind === "validator"
        ? [
            {
              gauge: card.gauge.address.toLowerCase(),
              operator: card.meta.operator?.toLowerCase() ?? null,
              status: card.meta.status,
            },
          ]
        : [],
    )
    for (const entry of pool) {
      if (entry.operator === null) {
        expect(
          validators.data.pool_without_operator.map((each) => each.gauge),
        ).toContain(entry.gauge)
        continue
      }
      const row = validators.data.validators.find(
        (each) => each.address === entry.operator,
      )
      expect(row, entry.gauge).toMatchObject({
        operator: entry.operator,
        gauge: entry.gauge,
        pool_status: entry.status,
      })
    }
    const outside = validators.data.validators.filter(
      (row) => row.gauge === null,
    )
    expect(outside.map((row) => row.address)).toEqual([unmatchedProposer])
  })

  it("takes its proposers from the recorded blocks page", () => {
    const page = blocksPageSchema.parse(
      blockscoutFixture("blocks", new URLSearchParams({ type: "block" })).body,
    )
    const miners = page.items.map((block) => block.miner.hash.toLowerCase())
    expect(miners).toContain(matchedProposer)
    expect(miners).toContain(unmatchedProposer)
    expect(validatorDetails.harborStake.operator).toBe(matchedProposer)
    const operators = Object.values(validatorCards).map((card) =>
      card.meta.operator?.toLowerCase(),
    )
    expect(operators).not.toContain(unmatchedProposer)
  })
})
