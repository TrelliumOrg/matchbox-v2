import { createLogger } from "@matchbox/logger"
import { describe, expect, it } from "vitest"
import { fixtureEpoch, fixturePrices, fixtureRead } from "./fixtures"
import { aprPercent, sumUsd } from "./money"
import { buildSnapshot } from "./snapshot"
import createSqliteMarketDatabase from "./sqlite-database"
import { createD1MarketStore } from "./store"
import {
  escrowAprPercent,
  listVoterEpochs,
  refreshVoterEpochs,
  voterEpochsRefreshSeconds,
} from "./voter-epochs"

const logger = createLogger({ level: "error" })
const takenAt = new Date("2026-09-30T12:00:00.000Z")
const now = Math.floor(takenAt.getTime() / 1000)

async function seeded() {
  const db = createSqliteMarketDatabase()
  const store = createD1MarketStore(db)
  const snapshot = buildSnapshot(fixtureRead(), fixturePrices, takenAt)
  await store.saveSnapshot(snapshot)
  return { db, snapshot }
}

describe("voter epochs", () => {
  it("sums each voter's priced rewards and applies the gauges' APR formula", async () => {
    const { db, snapshot } = await seeded()
    const result = await refreshVoterEpochs({
      db,
      network: "mezo",
      nowSeconds: now,
      logger,
    })
    expect(result?.current).toBe("written")
    const rows = await listVoterEpochs(db, "mezo", fixtureEpoch)
    const current = snapshot.epochs[0]
    expect(current).toBeDefined()
    const kinds = {
      pools: ["pools"],
      validators: ["validators"],
      boost: ["boost"],
      "third-party": ["third-party"],
      vebtc: ["pools", "validators"],
      vemezo: ["boost", "third-party"],
    } as const
    expect(rows.map((row) => row.voter).sort()).toEqual(
      Object.keys(kinds).sort(),
    )
    for (const row of rows) {
      const voters: readonly string[] = kinds[row.voter]
      const gauges = (current?.gauges ?? []).filter(
        (gauge) =>
          voters.includes(gauge.incentives.voter) &&
          gauge.incentives.rewards.length > 0,
      )
      const priced = gauges.flatMap((gauge) =>
        gauge.incentives.totalUsd === null ? [] : [gauge.incentives.totalUsd],
      )
      const totalUsd = priced.length === 0 ? null : sumUsd(priced)
      expect(row.funded_gauges, row.voter).toBe(gauges.length)
      expect(row.total_usd, row.voter).toBe(totalUsd)
      const weights = voters.map(
        (voter) =>
          current?.epoch.totalWeights[
            voter as keyof NonNullable<typeof current>["epoch"]["totalWeights"]
          ] ?? null,
      )
      expect(row.weight).toBe(
        weights.some((weight) => weight === null)
          ? null
          : weights
              .reduce((sum, weight) => sum + BigInt(weight ?? "0"), 0n)
              .toString(),
      )
      expect(row.open).toBe(1)
      if (row.voter === "vebtc" || row.voter === "vemezo") {
        // A lock votes on each of its escrow's ballots: the voters' APRs
        // add up (a voter with no rewards adds 0; one with only unpriced
        // rewards leaves the escrow's unknown).
        const parts = rows.filter((part) => voters.includes(part.voter))
        expect(parts).toHaveLength(2)
        const aprs = parts.map((part) =>
          part.total_usd !== null
            ? part.apr_percent
            : part.unpriced_rewards > 0
              ? null
              : "0",
        )
        expect(row.apr_percent, row.voter).toBe(
          aprs.some((apr) => apr === null)
            ? null
            : sumUsd(aprs.map((apr) => apr ?? "0")),
        )
      } else if (
        totalUsd !== null &&
        row.weight !== null &&
        row.voting_token_usd !== null
      ) {
        expect(row.apr_percent).toBe(
          aprPercent({
            totalUsd,
            weight: BigInt(row.weight),
            votingTokenUsd: row.voting_token_usd,
          }),
        )
      }
    }
    expect(rows.some((row) => row.apr_percent !== null)).toBe(true)
  })

  it("adds each voter's APR for an escrow, not its summed weights", () => {
    // 1,000 BTC of votes on both veBTC ballots; pools pay $5k a week,
    // validators $3k, BTC at $100k. A lock voting on both earns 0.26% +
    // 0.15%, not $8k over 2,000 BTC (0.20%).
    const weight = 1_000n * 10n ** 18n
    expect(
      escrowAprPercent(
        [
          { totalUsd: "5000", weight },
          { totalUsd: "3000", weight },
        ],
        "100000",
      ),
    ).toBe("0.41")
    expect(
      escrowAprPercent(
        [
          { totalUsd: "5000", weight },
          { totalUsd: null, weight: 0n },
        ],
        "100000",
      ),
    ).toBe("0.26")
    expect(
      escrowAprPercent(
        [
          { totalUsd: "5000", weight },
          { totalUsd: "3000", weight: null },
        ],
        "100000",
      ),
    ).toBeNull()
    expect(escrowAprPercent([{ totalUsd: "5000", weight }], null)).toBeNull()
    // A voter whose rewards are all unpriced is not known to add 0: the
    // escrow's figure would be the other voter's alone.
    expect(
      escrowAprPercent(
        [
          { totalUsd: "5000", weight },
          { totalUsd: null, weight, unpriced: 2 },
        ],
        "100000",
      ),
    ).toBeNull()
  })

  it("rewrites the current epoch at most every 30 minutes", async () => {
    const { db } = await seeded()
    await refreshVoterEpochs({ db, network: "mezo", nowSeconds: now, logger })
    const soon = await refreshVoterEpochs({
      db,
      network: "mezo",
      nowSeconds: now + 300,
      logger,
    })
    expect(soon?.current).toBe("fresh")
    const later = await refreshVoterEpochs({
      db,
      network: "mezo",
      nowSeconds: now + voterEpochsRefreshSeconds,
      logger,
    })
    expect(later?.current).toBe("written")
  })

  it("settles an epoch once it has ended", async () => {
    const { db } = await seeded()
    await refreshVoterEpochs({ db, network: "mezo", nowSeconds: now, logger })
    const nextWeek = fixtureEpoch + 7 * 86_400 + 3_600
    const result = await refreshVoterEpochs({
      db,
      network: "mezo",
      nowSeconds: nextWeek,
      logger,
    })
    expect(result?.settled).toBe(fixtureEpoch)
    const rows = await listVoterEpochs(db, "mezo", fixtureEpoch)
    expect(
      rows
        .filter((row) => row.epoch_start === fixtureEpoch)
        .every((row) => row.open === 0),
    ).toBe(true)
    // Settled epochs are not read again.
    const again = await refreshVoterEpochs({
      db,
      network: "mezo",
      nowSeconds: nextWeek + 300,
      logger,
    })
    expect(again?.settled).toBeNull()
  })

  it("never throws without its table", async () => {
    const result = await refreshVoterEpochs({
      db: {
        prepare() {
          throw new Error("no such table: market_voter_epochs")
        },
        async batch() {},
      },
      network: "mezo",
      nowSeconds: now,
      logger,
    })
    expect(result).toBeNull()
  })
})
